import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { bus } from '../bus';
import type { Team } from '../agents/types';
import { el } from './dom';
import type { AgentView } from './hud';
import { dockTerm, type Term } from './terminal';

/**
 * The first tab in the terminal view: a real shell (bash in WSL on Windows).
 * `claude <name>` there opens that person's (or team's) office terminal in
 * the tab; `claude` on its own runs Claude Code in the current folder. Either
 * way, Ctrl+C in the tab is the only thing that ends it.
 *
 * The shell keeps running when you go back to the office, and starts again by
 * itself if it's exited.
 */

interface ShellBridge {
  start(id: string, cols: number, rows: number): Promise<{ ok: boolean; error?: string }>;
  input(id: string, text: string): void;
  resize(id: string, cols: number, rows: number): void;
  names(id: string, names: string[]): void;
  stop(id: string): void;
  onData(cb: (id: string, data: Uint8Array) => void): void;
  onExit(cb: (id: string, code: number | null) => void): void;
}

const bridge = () => (window as { office?: { shell?: ShellBridge } }).office?.shell;
const ID = 'main';
const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');

let agents: AgentView[] = [];
let teams: Team[] = [];

const CSS = (name: string) => getComputedStyle(document.body).getPropertyValue(name).trim();

class Shell {
  readonly root = el('div', 'shell-win');
  private readonly screen = el('div', 'shell-screen');
  private readonly over = el('div', 'shell-over');
  private readonly xt: Terminal;
  private readonly fit = new FitAddon();
  private started = false;
  /** Claude Code is running in it: Ctrl+C ends that session. */
  private cli = false;
  /** Someone's office terminal shown over the shell. */
  private attached: { term: Term; key: string } | null = null;

  constructor() {
    this.root.append(this.screen, this.over);
    this.over.hidden = true;
    this.xt = new Terminal({
      fontFamily: "'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      theme: this.theme(),
    });
    this.xt.loadAddon(this.fit);
    this.xt.open(this.screen);
    this.xt.attachCustomKeyEventHandler((e) => this.key(e));
    this.xt.onData((d) => bridge()?.input(ID, d));
    this.xt.onResize(({ cols, rows }) => bridge()?.resize(ID, cols, rows));
    this.xt.parser.registerOscHandler(7337, (data) => this.osc(data));
    new ResizeObserver(() => this.refit()).observe(this.screen);
    this.over.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'c' || e.key === 'C') && !window.getSelection()?.toString()) {
        e.preventDefault();
        e.stopPropagation();
        this.detach();
      }
    }, true);
    bus.on('theme', () => queueMicrotask(() => (this.xt.options.theme = this.theme())));
  }

  private theme() {
    return {
      background: CSS('--t-bg') || '#141413',
      foreground: CSS('--t-ink') || '#e3e1dc',
      cursor: CSS('--t-accent') || '#d77757',
      selectionBackground: CSS('--t-user') || '#2a2927',
    };
  }

  /** Copy and paste work as they do in Windows Terminal; Ctrl+C with Claude Code running ends it. */
  private key(e: KeyboardEvent) {
    if (e.type !== 'keydown') return true;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'c' && (e.shiftKey || this.xt.hasSelection())) {
      if (this.xt.hasSelection()) void navigator.clipboard.writeText(this.xt.getSelection());
      this.xt.clearSelection();
      e.preventDefault();
      return false;
    }
    if (e.ctrlKey && k === 'c' && this.cli) {
      bridge()?.stop(ID);
      e.preventDefault();
      return false;
    }
    // let the browser paste (xterm hears the paste event)
    if (e.ctrlKey && k === 'v') return false;
    return true;
  }

  private osc(data: string) {
    const [kind, arg] = data.split(';');
    if (kind === 'cli') this.cli = arg === '1';
    else if (kind === 'attach') this.attach(arg ?? '');
    return true;
  }

  private attach(want: string) {
    const team = teams.find((t) => norm(t.name) === want);
    const agent = team ? undefined : agents.find((a) => norm(a.name) === want);
    if (!team && !agent) {
      this.xt.write(`\r\nNobody called ${want} works here any more.\r\n`);
      bridge()?.input(ID, '\x03');
      return;
    }
    this.over.replaceChildren();
    const term = dockTerm(this.over, agent?.id ?? null, team?.id ?? null, 'shell');
    this.attached = { term, key: agent ? `a:${agent.id}` : `t:${team!.id}` };
    const hint = el('div', 'shell-hint', `${agent?.name ?? team!.name} · Ctrl+C back to the shell`);
    this.over.prepend(hint);
    this.over.hidden = false;
    window.setTimeout(() => term.focus(), 30);
  }

  /** Back to the shell: the waiting `claude` command is interrupted. */
  private detach() {
    if (!this.attached) return;
    this.attached.term.close();
    this.attached = null;
    this.over.hidden = true;
    this.over.replaceChildren();
    bridge()?.input(ID, '\x03');
    this.focus();
  }

  /** Their terminal closed itself (fired, team disbanded): back to the shell. */
  check() {
    if (this.attached && !this.attached.term.alive) this.detach();
  }

  refit() {
    if (!this.screen.isConnected || !this.screen.offsetWidth) return;
    try {
      this.fit.fit();
    } catch {
      // not laid out yet
    }
  }

  async start() {
    if (this.started) return;
    this.started = true;
    const b = bridge();
    if (!b) {
      this.xt.write('The shell only runs in the desktop app.\r\n');
      return;
    }
    this.refit();
    const res = await b.start(ID, this.xt.cols, this.xt.rows);
    if (!res.ok) {
      this.started = false;
      this.xt.write(`Couldn't start the shell: ${res.error}\r\n`);
      return;
    }
    sendNames();
  }

  exited() {
    this.started = false;
    this.cli = false;
    if (this.attached) this.detach();
    this.xt.write('\r\n\x1b[2m(shell exited, starting a new one)\x1b[0m\r\n');
    window.setTimeout(() => void this.start(), 600);
  }

  write(data: Uint8Array) {
    this.xt.write(data);
  }

  focus() {
    if (this.attached) this.attached.term.focus();
    else this.xt.focus();
  }
}

let shell: Shell | null = null;

function sendNames() {
  const names = [...agents.map((a) => a.name), ...teams.map((t) => t.name)].map(norm);
  bridge()?.names(ID, [...new Set(names)]);
}

/** The shell, put into `parent` (it keeps running when taken out again). */
export function mountShell(parent: HTMLElement) {
  if (!shell) {
    shell = new Shell();
    bridge()?.onData((id, data) => id === ID && shell?.write(data));
    bridge()?.onExit((id) => id === ID && shell?.exited());
  }
  parent.append(shell.root);
  void shell.start();
  requestAnimationFrame(() => shell?.refit());
  return shell;
}

export function focusShell() {
  shell?.focus();
}

bus.on('agents', (views: AgentView[]) => {
  const before = agents.map((a) => a.name).join();
  agents = views;
  if (agents.map((a) => a.name).join() !== before) sendNames();
  queueMicrotask(() => shell?.check());
});
bus.on('teams', (list: Team[]) => {
  teams = list;
  sendNames();
  queueMicrotask(() => shell?.check());
});
