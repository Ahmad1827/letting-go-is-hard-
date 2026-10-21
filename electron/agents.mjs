// Real agents: one headless Claude Code process per employee, using the
// Claude Code already installed and logged in on this machine (no API key).
//
// Talks the CLI's stream-json protocol: user messages in on stdin, events out
// on stdout. Permission prompts come back as control requests, which the
// office answers (approve/deny) instead of a terminal.
import { execFile, spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { engine, settings } from './settings.mjs';

const TOOLS = 'Bash,Read,Glob,Grep,Edit,Write,WebSearch,WebFetch';
/** Approved work happens in git worktrees here, so a project's own checkout is never touched. */
const worktrees = () => path.join(settings().projectsRoot, '.letting-go', 'worktrees');

const procs = new Map();

// Windows git refuses repos it doesn't own, like ones inside WSL (\\wsl.localhost\...)
const GIT_ENV = process.platform === 'win32' ? { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' } : {};

function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 20000, env: { ...process.env, ...GIT_ENV } }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim())));
  });
}

/**
 * Find the engine's program. A bare name is looked up on PATH, then where
 * Claude Code's installers put it, since apps started from the desktop don't
 * always see the PATH a terminal does. npm's claude.cmd can't be spawned
 * directly, so its cli.js runs on Electron's own Node instead.
 */
function resolveCommand(command) {
  if (path.isAbsolute(command)) return { file: command, pre: [], env: {} };
  const win = process.platform === 'win32';
  const exts = win ? ['.exe', '.cmd', ''] : [''];
  const dirs = [
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'),
    ...(win && process.env.APPDATA ? [path.join(process.env.APPDATA, 'npm')] : []),
  ];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, command + ext);
      if (!existsSync(file)) continue;
      if (ext !== '.cmd') return { file, pre: [], env: {} };
      const cli = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (existsSync(cli)) return { file: process.execPath, pre: [cli], env: { ELECTRON_RUN_AS_NODE: '1' } };
    }
  }
  return { file: command, pre: [], env: {} };
}

/** Keep only what the office needs from each stream-json event. */
function slim(m) {
  if (m.type === 'system' && m.subtype === 'init') return { kind: 'init', model: m.model, cwd: m.cwd };
  if (m.type === 'assistant') {
    const parts = [];
    for (const c of m.message.content) {
      if (c.type === 'text' && c.text.trim()) parts.push({ type: 'text', text: c.text });
      if (c.type === 'tool_use') parts.push({ type: 'tool', name: c.name, input: c.input });
    }
    return parts.length ? { kind: 'assistant', model: m.message.model, parts } : null;
  }
  if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool')
    return { kind: 'permission', requestId: m.request_id, tool: m.request.tool_name, input: m.request.input, description: m.request.description ?? '' };
  if (m.type === 'result') {
    const u = m.usage ?? {};
    const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
    // cost is cumulative for the session, tokens are for this turn only
    return { kind: 'result', ok: m.subtype === 'success', text: m.result ?? '', cost: m.total_cost_usd ?? 0, tokens };
  }
  // the plan's usage windows (5-hour, weekly), as fractions of the limit
  if (m.type === 'rate_limit_event') return { kind: 'limits', status: m.rate_limit_info?.status, windows: m.rate_limit_info?.unifiedWindows ?? {} };
  return null;
}

export function setupAgents(ipcMain, getWindow) {
  const emit = (id, msg) => getWindow()?.webContents.send('agent:msg', id, msg);

  /** (Re)start an agent's Claude Code session. */
  function start(id, { cwd, model, system, prompt, mode, engine: engineId }) {
    const eng = engine(engineId);
    stop(id);
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--permission-prompt-tool', 'stdio', '--permission-mode', mode || 'default',
      '--tools', TOOLS, '--strict-mcp-config', '--no-session-persistence',
      '--append-system-prompt', system,
    ];
    if (model) args.push('--model', model);
    const dir = cwd || settings().projectsRoot;
    // a missing folder makes spawn fail with a misleading "claude ENOENT"
    if (!existsSync(dir)) {
      queueMicrotask(() => emit(id, { kind: 'exit', code: -1, error: `The folder ${dir} doesn't exist. Pick your projects folder in Start > Settings.` }));
      return;
    }
    const cmd = resolveCommand(eng.command);
    const p = spawn(cmd.file, [...cmd.pre, ...args], { cwd: dir, env: { ...process.env, ...GIT_ENV, ...cmd.env, ...eng.env }, windowsHide: true });
    const entry = { p, closed: false };
    procs.set(id, entry);
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      const out = slim(m);
      if (out) emit(id, out);
    });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    p.on('error', (e) => emit(id, { kind: 'exit', code: -1, error: `Could not start ${eng.name} (${eng.command}): ${e.message}` }));
    p.on('exit', (code) => {
      if (procs.get(id) === entry) procs.delete(id);
      if (!entry.closed) emit(id, { kind: 'exit', code, error: code ? err.trim().split('\n').pop() : '' });
    });
    send(id, prompt);
  }

  function write(id, obj) {
    const e = procs.get(id);
    if (e && !e.p.stdin.destroyed) e.p.stdin.write(JSON.stringify(obj) + '\n');
  }

  function send(id, text) {
    write(id, { type: 'user', message: { role: 'user', content: text } });
  }

  function stop(id) {
    const e = procs.get(id);
    if (!e) return;
    e.closed = true;
    procs.delete(id);
    e.p.kill();
  }

  /**
   * Where approved work happens: a fresh worktree and branch for git projects.
   * `base` starts the branch from another one (a team worker branching off the team's branch);
   * `inPlace` works in the project folder itself (a new project's lead).
   */
  async function prepareWork({ project, projectPath, branch, isNew, base, inPlace }) {
    if (isNew) {
      const dir = path.join(settings().projectsRoot, project);
      await fs.mkdir(dir, { recursive: true });
      const fresh = !(await fs.access(path.join(dir, '.git')).then(() => true, () => false));
      if (fresh) {
        await git(dir, ['init', '-q']);
        // a first commit so teammates have something to branch from
        await git(dir, ['commit', '-q', '--allow-empty', '-m', `Start ${project}`]);
      }
      return { cwd: dir, path: dir, mode: 'acceptEdits', note: `Created ${dir}` };
    }
    if (inPlace) return { cwd: projectPath, path: projectPath, mode: 'acceptEdits', note: `Working in ${projectPath}` };
    const isGit = await fs.access(path.join(projectPath, '.git')).then(() => true, () => false);
    const hasCommits = isGit && (await git(projectPath, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false));
    if (!hasCommits) {
      // no history to branch from: work in place, and every file change asks first
      return { cwd: projectPath, path: projectPath, mode: 'default', note: `${project} isn't a git repo with commits, so every change will ask first` };
    }
    let name = branch;
    for (let i = 2; await git(projectPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).then(() => true, () => false); i++) name = `${branch}-${i}`;
    const dir = path.join(worktrees(), `${project}--${name.replace(/[^\w.-]+/g, '-')}`);
    await fs.mkdir(worktrees(), { recursive: true });
    await git(projectPath, ['worktree', 'add', '-q', '-b', name, dir, ...(base ? [base] : [])]);
    return { cwd: dir, path: projectPath, mode: 'acceptEdits', branch: name, note: `Working in ${dir} on branch ${name}` };
  }

  ipcMain.handle('agent:start', (_e, id, cfg) => start(id, cfg));
  ipcMain.on('agent:send', (_e, id, text) => send(id, text));
  ipcMain.on('agent:model', (_e, id, model) => write(id, { type: 'control_request', request_id: `model-${Date.now()}`, request: { subtype: 'set_model', model } }));
  ipcMain.on('agent:interrupt', (_e, id) => write(id, { type: 'control_request', request_id: `int-${Date.now()}`, request: { subtype: 'interrupt' } }));
  ipcMain.on('agent:stop', (_e, id) => stop(id));
  ipcMain.on('agent:answer', (_e, id, requestId, allow, input, message) =>
    write(id, {
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response: allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: message || 'Denied' } },
    }));
  ipcMain.handle('work:prepare', (_e, req) => prepareWork(req));

  return { stopAll: () => [...procs.keys()].forEach(stop) };
}
