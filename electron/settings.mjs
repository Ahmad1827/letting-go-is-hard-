// The owner's settings, saved as JSON in the app's user-data folder.
import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Claude Code's models, as offered for the built-in engine. */
const CLAUDE_MODELS = [
  { id: '', label: 'Claude Code default' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

/**
 * An engine is a Claude Code-compatible command line: the binary, extra
 * environment variables (e.g. ANTHROPIC_BASE_URL to reach another LLM, or
 * CLAUDE_CONFIG_DIR for another account) and the models it offers.
 */
export const BUILT_IN = { id: 'claude-code', name: 'Claude Code', command: process.env.CLAUDE_BIN || 'claude', env: {}, models: CLAUDE_MODELS };

const DEFAULTS = {
  projectsRoot: path.join(os.homedir(), 'proiecte'),
  engines: [BUILT_IN],
  defaultEngine: 'claude-code',
  defaultModel: '',
  /** 'auto': Claude Code's auto mode decides what's safe; 'ask': anything that changes files asks first. */
  approvals: 'auto',
  /** On closing with work in progress: 'ask', 'finish' in the background, or 'stop'. */
  onClose: 'ask',
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

let current = structuredClone(DEFAULTS);

const run = (cmd, args, encoding = 'utf8') =>
  new Promise((resolve) => execFile(cmd, args, { encoding, timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? '' : out)));

/**
 * On Windows with no projects folder yet, look for ~/proiecte inside WSL
 * (\\wsl.localhost\<distro>\home\<user>\proiecte), where it usually lives.
 */
async function findWslProjects() {
  if (process.platform !== 'win32') return null;
  // wsl.exe lists distros in UTF-16
  const distros = (await run('wsl.exe', ['-l', '-q'], 'utf16le')).split(/\r?\n/).map((d) => d.replace(/\0/g, '').trim()).filter((d) => d && !d.startsWith('docker-desktop'));
  for (const d of distros) {
    const home = (await run('wsl.exe', ['-d', d, '-e', 'sh', '-c', 'echo $HOME'])).trim();
    if (!home.startsWith('/')) continue;
    const dir = `\\\\wsl.localhost\\${d}${home.replace(/\//g, '\\')}\\proiecte`;
    if (existsSync(dir)) return dir;
  }
  return null;
}

export async function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(await fs.readFile(file(), 'utf8'));
  } catch {}
  current = { ...structuredClone(DEFAULTS), ...saved };
  if (!existsSync(current.projectsRoot)) {
    const wsl = await findWslProjects();
    if (wsl) current.projectsRoot = wsl;
  }
  if (!current.engines.some((e) => e.id === BUILT_IN.id)) current.engines.unshift(BUILT_IN);
  return settings();
}

/** The settings in effect; LETTING_GO_PROJECTS still wins for the projects folder. */
export function settings() {
  return { ...current, projectsRoot: process.env.LETTING_GO_PROJECTS || current.projectsRoot };
}

export async function saveSettings(next) {
  // the LETTING_GO_PROJECTS override is for this run only, never saved
  const override = process.env.LETTING_GO_PROJECTS;
  current = { ...current, ...next, ...(override && next.projectsRoot === override ? { projectsRoot: current.projectsRoot } : {}) };
  if (!current.engines.some((e) => e.id === BUILT_IN.id)) current.engines.unshift(BUILT_IN);
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(current, null, 2));
  return settings();
}

export function engine(id) {
  return current.engines.find((e) => e.id === id) ?? current.engines.find((e) => e.id === current.defaultEngine) ?? BUILT_IN;
}

/** Check an engine starts: runs `<command> --version` with its environment. */
export function testEngine(e) {
  return new Promise((resolve) => {
    execFile(e.command, ['--version'], { env: { ...process.env, ...e.env }, timeout: 15000 }, (err, stdout, stderr) =>
      resolve(err ? { ok: false, text: (stderr || err.message).trim().split('\n').pop() } : { ok: true, text: stdout.trim() }));
  });
}
