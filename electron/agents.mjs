// Real agents: one headless Claude Code process per employee, using the
// Claude Code already installed and logged in on this machine (no API key).
//
// Talks the CLI's stream-json protocol: user messages in on stdin, events out
// on stdout. Permission prompts come back as control requests, which the
// office answers (approve/deny) instead of a terminal.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { app } from 'electron';
import { engine, settings } from './settings.mjs';
import { appsBrief } from './apps.mjs';
import { pcBrief } from './pc.mjs';
import { screenBrief } from './screen.mjs';
import { catalog, forget, skillPrompt } from './skills.mjs';

/**
 * Agents get every tool Claude Code has, every installed skill, and the MCP
 * servers set up on this machine (Blender and friends), except moving between
 * worktrees, which the office does itself.
 */
const NOT_HERE = ['EnterWorktree', 'ExitWorktree'];
/** Left out while someone is only looking around for an idea: the costly ways to look. */
const LEAN_OFF = ['Agent', 'Task', 'WebSearch', 'WebFetch', 'Skill'];

/**
 * The standing instructions each conversation was given, by session id (a hash).
 * Claude Code keeps a conversation's first system prompt for good, even when a
 * resume passes a new one, so changed instructions have to go in as a message.
 */
const briefsFile = () => path.join(app.getPath('userData'), 'briefs.json');
let briefs = null;
const hashOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16);
function briefOf(session) {
  if (!briefs) {
    try {
      briefs = JSON.parse(readFileSync(briefsFile(), 'utf8'));
    } catch {
      briefs = {};
    }
  }
  return briefs[session];
}
function rememberBrief(session, hash) {
  briefOf(session);
  if (briefs[session] === hash) return;
  delete briefs[session];
  briefs[session] = hash;
  // the newest few hundred are plenty
  const keys = Object.keys(briefs);
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete briefs[k];
  try {
    writeFileSync(briefsFile(), JSON.stringify(briefs));
  } catch {
    // only means the instructions are sent again next time
  }
}
/** A message with a note in front of it, for plain text and for text with pictures. */
const prefixed = (note, content) => (typeof content === 'string' ? `${note}\n\n${content}` : [{ type: 'text', text: note }, ...content]);
/** Approved work happens in git worktrees here, so a project's own checkout is never touched. */
const worktrees = () => path.join(settings().projectsRoot, '.letting-go', 'worktrees');

const procs = new Map();

/** Of a NUL-separated list of repo paths, the ones Windows can't create. */
function unwritable(list) {
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  return list.split('\0').filter((f) => f && f.split('/').some((part) => /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || reserved.test(part)));
}

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

/** A tool result as plain text, cut short: the terminal only shows the first few lines. */
function resultText(content) {
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : '')).join('\n')
    : '';
  return text.length > 4000 ? text.slice(0, 4000) : text;
}

/** Text pieces arriving within this long of each other go to the office together. */
const DELTA_MS = 30;

/** How often the running token count goes to the office. */
const USAGE_MS = 250;
/** Rough characters per token, for output still being written (the real count comes when each reply ends). */
const CHARS_PER_TOKEN = 4;

/**
 * Tokens used so far in the current turn, counted the way the turn's result adds them up:
 * each model call's input (with cache) when it starts, and its output when it ends.
 * While a reply is being written its output is estimated from the text streamed so far.
 */
function turnTally() {
  let done = 0, input = 0, output = 0, chars = 0, thinking = 0;
  // how big the conversation is: the latest model call's whole input, kept across turns
  let context = 0;
  const inputOf = (u) => (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
  return {
    /** Takes a stream-json event; true if the count changed. */
    see(m) {
      if (m.type !== 'stream_event' || m.parent_tool_use_id) return false;
      const e = m.event;
      if (e?.type === 'message_start') {
        input = inputOf(e.message?.usage);
        context = input;
        output = e.message?.usage?.output_tokens ?? 0;
        chars = thinking = 0;
        return true;
      }
      if (e?.type === 'content_block_delta') {
        const d = e.delta ?? {};
        if (typeof d.text === 'string') chars += d.text.length;
        else if (typeof d.partial_json === 'string') chars += d.partial_json.length;
        else if (typeof d.estimated_tokens === 'number') thinking = Math.max(thinking, d.estimated_tokens);
        else return false;
        return true;
      }
      if (e?.type === 'message_delta') {
        // the call is over: its real output count replaces the estimate
        done += input + (e.usage?.output_tokens ?? output);
        input = output = chars = thinking = 0;
        return true;
      }
      return false;
    },
    context: () => context,
    total: () => done + input + Math.max(output, Math.round(chars / CHARS_PER_TOKEN) + thinking),
    reset() {
      done = input = output = chars = thinking = 0;
    },
  };
}

/** Keep only what the office needs from each stream-json event. */
function slim(m) {
  // a piece of text as it's being written (only theirs, not a subagent's); usage is counted separately
  if (m.type === 'stream_event') {
    const d = m.event?.type === 'content_block_delta' && m.event.delta;
    return d?.type === 'text_delta' && d.text && !m.parent_tool_use_id ? { kind: 'delta', text: d.text } : null;
  }
  if (m.type === 'system' && m.subtype === 'init') return { kind: 'init', model: m.model, cwd: m.cwd, session: m.session_id };
  // a subagent's own turns stay inside it, the way Claude Code folds them away
  if ((m.type === 'assistant' || m.type === 'user') && m.parent_tool_use_id) return null;
  if (m.type === 'assistant') {
    const parts = [];
    for (const c of m.message.content) {
      if (c.type === 'text' && c.text.trim()) parts.push({ type: 'text', text: c.text });
      if (c.type === 'tool_use') parts.push({ type: 'tool', id: c.id, name: c.name, input: c.input });
    }
    return parts.length ? { kind: 'assistant', model: m.message.model, parts } : null;
  }
  // what each tool call gave back, for the agent's terminal
  if (m.type === 'user' && Array.isArray(m.message?.content)) {
    const results = m.message.content
      .filter((c) => c.type === 'tool_result')
      .map((c) => ({ id: c.tool_use_id, error: !!c.is_error, text: resultText(c.content) }));
    return results.length ? { kind: 'results', results } : null;
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

  /** How to run an engine, and where to look when asking it about itself. */
  function launchOf(eng) {
    const cmd = resolveCommand(eng.command);
    const root = settings().projectsRoot;
    return { file: cmd.file, pre: cmd.pre, env: { ...process.env, ...GIT_ENV, ...cmd.env, ...eng.env }, cwd: existsSync(root) ? root : os.homedir() };
  }

  /** (Re)start an agent's Claude Code session. */
  async function start(id, { cwd, model, system, prompt, mode, engine: engineId, resume, skills, lean, anywhere, effort }) {
    const eng = engine(engineId);
    stop(id);
    // their folder is gone (a merged job's worktree): the projects folder will do, in a new conversation
    if (anywhere && cwd && !existsSync(cwd)) {
      cwd = '';
      resume = undefined;
    }
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-prompt-tool', 'stdio', '--permission-mode', mode || 'default',
    ];
    if (model) args.push('--model', model);
    // quick answers and looking for ideas don't need the deepest thinking; real work keeps the model's own
    if (effort) args.push('--effort', effort);
    // where they are (folder, git status) goes in the first message, so the rest of Claude Code's prompt is shared and cached across agents
    args.push('--exclude-dynamic-system-prompt-sections');
    // pick last time's conversation back up, so they remember what was said and done
    if (resume) args.push('--resume', resume);
    const dir = cwd || settings().projectsRoot;
    // a missing folder makes spawn fail with a misleading "claude ENOENT"
    if (!existsSync(dir)) {
      queueMicrotask(() => emit(id, { kind: 'exit', code: -1, error: `The folder ${dir} doesn't exist. Pick your projects folder in Start > Settings.` }));
      return;
    }
    // messages sent while the skills are being looked up wait here until the process exists
    const entry = { p: null, closed: false, pending: [] };
    procs.set(id, entry);
    // every skill is theirs; the ones picked for them are named as their go-to ones
    // lean (looking around for an idea): no MCP servers, subagents, skills or web, so a pitch stays cheap
    const brief = lean ? system : [system, skills?.length ? skillPrompt(skills) : '', pcBrief(), screenBrief(), appsBrief()].filter(Boolean).join('\n\n');
    const hash = hashOf(brief);
    // a picked-up conversation still has the instructions it started with: hand over the new ones if they changed
    const stale = resume && briefOf(resume) !== hash;
    send(id, stale ? prefixed(`(Your standing instructions have changed. Where they differ from what you were told before, follow these:\n\n${brief})`, prompt) : prompt);
    if (lean) args.push('--strict-mcp-config');
    args.push('--disallowedTools', [...NOT_HERE, ...(lean ? LEAN_OFF : [])].join(','), '--append-system-prompt', brief);
    const launch = launchOf(eng);
    const p = spawn(launch.file, [...launch.pre, ...args], { cwd: dir, env: launch.env, windowsHide: true });
    entry.p = p;
    // text pieces are gathered for a moment and sent together; anything else sends them first, so order holds
    let text = '';
    let timer = null;
    const flush = () => {
      clearTimeout(timer);
      timer = null;
      if (text && !entry.closed) emit(id, { kind: 'delta', text });
      text = '';
    };
    const tally = turnTally();
    let tallyTimer = null;
    const sendTally = () => {
      tallyTimer = null;
      if (!entry.closed) emit(id, { kind: 'usage', tokens: tally.total() });
    };
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.type === 'system' && m.subtype === 'init' && m.session_id) rememberBrief(m.session_id, hash);
      if (tally.see(m)) tallyTimer ??= setTimeout(sendTally, USAGE_MS);
      const context = tally.context();
      // the turn's real total comes with the result; the running count starts over
      if (m.type === 'result') {
        clearTimeout(tallyTimer);
        tallyTimer = null;
        tally.reset();
      }
      // Claude Code waits for an answer to every request it sends; one left unanswered hangs the agent for good
      if (m.type === 'control_request' && m.request?.subtype !== 'can_use_tool') {
        answerOther(id, m);
        return;
      }
      const out = slim(m);
      if (!out) return;
      if (out.kind === 'result') out.context = context;
      if (out.kind === 'delta') {
        text += out.text;
        timer ??= setTimeout(flush, DELTA_MS);
        return;
      }
      flush();
      emit(id, out);
    });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    p.on('error', (e) => emit(id, { kind: 'exit', code: -1, error: `Could not start ${eng.name} (${eng.command}): ${e.message}` }));
    p.on('exit', (code) => {
      flush();
      clearTimeout(tallyTimer);
      if (procs.get(id) === entry) procs.delete(id);
      if (!entry.closed) emit(id, { kind: 'exit', code, error: code ? err.trim().split('\n').pop() : '' });
    });
    for (const line of entry.pending.splice(0)) p.stdin.write(line);
  }

  function write(id, obj) {
    const e = procs.get(id);
    if (!e) return;
    const line = JSON.stringify(obj) + '\n';
    if (!e.p) e.pending.push(line);
    else if (!e.p.stdin.destroyed) e.p.stdin.write(line);
  }

  /**
   * Requests other than tool permissions. An MCP server asking a question
   * (Blender's "share usage data?" on its first call, say) gets "no": the
   * agents can't answer for the owner, and saying nothing hangs the tool call
   * forever. Anything else is turned down, so it fails instead of waiting.
   */
  function answerOther(id, m) {
    const r = m.request ?? {};
    if (r.subtype === 'elicitation') {
      write(id, { type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { action: 'decline' } } });
      const what = String(r.message ?? '').split('\n')[0].slice(0, 160);
      emit(id, { kind: 'note', text: `${r.mcp_server_name ?? 'An MCP server'} asked "${what}" and was told no` });
      return;
    }
    write(id, { type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: `Not supported here: ${r.subtype}` } });
  }

  function send(id, text) {
    write(id, { type: 'user', message: { role: 'user', content: text } });
  }

  function stop(id) {
    const e = procs.get(id);
    if (!e) return;
    e.closed = true;
    procs.delete(id);
    e.p?.kill();
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
    const start = base ? [base] : [];
    // files Windows can't have (a ':' in the name, say) would make the checkout fail: leave just those out
    const skip = process.platform === 'win32' ? unwritable(await git(projectPath, ['ls-tree', '-r', '-z', '--name-only', base || 'HEAD'])) : [];
    try {
      if (!skip.length) await git(projectPath, ['worktree', 'add', '-q', '-b', name, dir, ...start]);
      else {
        await git(projectPath, ['worktree', 'add', '-q', '--no-checkout', '-b', name, dir, ...start]);
        // sparse checkout: they stay in git and in every commit, they just aren't written to disk
        await git(dir, ['sparse-checkout', 'set', '--no-cone', '/*', ...skip.map((f) => `!/${f.replace(/[\\*?[\]!#]/g, '\\$&')}`)]);
        await git(dir, ['checkout', '-q']);
      }
    } catch (e) {
      // don't leave a half-made worktree and branch behind
      await git(projectPath, ['worktree', 'remove', '--force', dir]).catch(() => {});
      await git(projectPath, ['branch', '-D', name]).catch(() => {});
      throw e;
    }
    const left = skip.length ? ` (left out ${skip.length} file${skip.length > 1 ? 's' : ''} Windows can't have: ${skip.slice(0, 3).join(', ')}${skip.length > 3 ? '...' : ''})` : '';
    return { cwd: dir, path: projectPath, mode: 'acceptEdits', branch: name, note: `Working in ${dir} on branch ${name}${left}` };
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
  ipcMain.handle('skills:list', async (_e, engineId) => {
    const eng = engine(engineId);
    try {
      return { skills: (await catalog(eng.id, launchOf(eng), { fresh: true })).skills };
    } catch (e) {
      return { skills: [], error: e.message };
    }
  });

  // the owner said yes to a plugin an agent asked for
  ipcMain.handle('skills:install', (_e, engineId, plugin) => {
    const eng = engine(engineId);
    const launch = launchOf(eng);
    return new Promise((resolve) => {
      if (!/^[\w.@/-]+$/.test(plugin)) return resolve({ ok: false, text: `"${plugin}" isn't a plugin name` });
      const p = spawn(launch.file, [...launch.pre, 'plugin', 'install', plugin, '--scope', 'user'], { cwd: launch.cwd, env: launch.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const keep = (d) => (out = (out + d).slice(-4000));
      p.stdout.on('data', keep);
      p.stderr.on('data', keep);
      const timer = setTimeout(() => p.kill(), 180_000);
      p.on('error', (e) => resolve({ ok: false, text: e.message }));
      p.on('exit', (code) => {
        clearTimeout(timer);
        forget(eng.id);
        resolve({ ok: code === 0, text: out.trim().split('\n').slice(-3).join('\n') || `exit ${code}` });
      });
    });
  });

  return { stopAll: () => [...procs.keys()].forEach(stop) };
}
