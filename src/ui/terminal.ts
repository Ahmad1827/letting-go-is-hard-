import { bus } from '../bus';
import { DEFAULT_SETTINGS, engineIn, modelLabel } from '../agents/crew';
import type { AgentActivity, Idea, Picture, Question, Settings, Team, TermEntry } from '../agents/types';
import { el } from './dom';
import { LABEL, labelOf, type AgentView, type ApprovalView } from './hud';
import { raise } from './panels';
import { acceptPictures } from './paste';
import { pixelArt, savedTheme, setTheme, THEMES, type TermTheme } from './pixels';

/**
 * Terminals: a window per agent that looks and works like Claude Code in a
 * terminal. Their messages, tool calls and results scroll by; you type at the
 * ❯ prompt, Esc interrupts, and permission questions are answered inline.
 *
 * A team gets one too: everyone's lines interleaved, each tagged with who said
 * it. Messages go to the whole team (the manager decides what happens) unless
 * they start with @name.
 *
 * The same terminals also live docked in the terminal view (see deck.ts):
 * no dragging or closing there, the view lays them out.
 */

const BUSY: AgentActivity[] = ['thinking', 'reading', 'writing', 'running'];
const VERB: Partial<Record<AgentActivity, string>> = { thinking: 'Thinking', reading: 'Reading', writing: 'Writing', running: 'Running' };
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
/** Names in a team terminal. */
const COLORS = ['#d77757', '#b1b9f9', '#4eba65', '#e5b800', '#ff8fb1', '#56d4dd', '#ffa657', '#c3a6ff'];
/** Lines of a tool result shown before "… +N lines". */
const OUT_LINES = 3;
/** Lines kept on screen; older ones scroll away. */
const MAX_ROWS = 1200;
const KEY = 'lgih.terms';
/** How much of a window has to stay on screen when it's dragged off the edge. */
const KEEP = 80;

interface Place { x: number; y: number; w: number; h: number }

let agents: AgentView[] = [];
let teams: Team[] = [];
let approvals: ApprovalView[] = [];
let settings: Settings = DEFAULT_SETTINGS;
const terms = new Map<string, Term>();
let places: Record<string, Place> = {};

function remember() {
  try {
    localStorage.setItem(KEY, JSON.stringify(places));
  } catch {
    // not remembered: fine
  }
}

const shortTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

const viewOf = (id: string) => agents.find((a) => a.id === id);

/** Text with the bits of markdown agents use: code blocks, `code`, **bold**, headings. */
function md(text: string) {
  const box = el('div', 't-md');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/^#{1,6} (.*)$/gm, '<b>$1</b>');
  text.split(/```[^\n]*\n?([\s\S]*?)```/g).forEach((part, i) => {
    if (i % 2) {
      const pre = el('pre', 't-code');
      pre.textContent = part.replace(/\n$/, '');
      box.append(pre);
    } else if (part.trim()) {
      const p = el('div');
      p.innerHTML = inline(part.replace(/^\n+|\n+$/g, ''));
      box.append(p);
    }
  });
  return box;
}

class Term {
  readonly win = el('section', 'term-win');
  private readonly tabLabel = el('span');
  private readonly screen = el('div', 'term-screen');
  private readonly banner = el('div', 'term-banner');
  private readonly log = el('div', 'term-log');
  private readonly status = el('div', 'term-status');
  private readonly ask = el('div', 'term-ask');
  private readonly input = el('textarea');
  private readonly foot = el('div', 'term-foot');
  private readonly pics = acceptPictures(this.input);
  private bannerKey = '';
  private askKey = '';
  private footKey = '';
  /** The last line on screen, by its office-wide number. */
  private lastN = -1;
  /** Lines up to here were cleared with /clear. */
  private clearedAt = -1;
  private busySince = 0;
  private history: string[] = [];
  private hist = -1;
  private choice = 0;
  /** Team view: who the last line was from, so a run of lines shows the name once. */
  private lastWho = '';
  /** Team view: the last message from the owner, so one sent to several people shows once. */
  private lastUser: { text: string; t: number; to: HTMLElement; names: string[] } | null = null;
  private colors = new Map<string, string>();
  /** What each person is writing right now, kept at the bottom of the log until the finished line replaces it. */
  private liveRows = new Map<string, { row: HTMLElement; body: HTMLElement }>();
  /** Answering questions: which one is up, and what's been answered so far. */
  private quiz: { key: string; at: number; answers: Record<string, string>; picked: Set<number> } | null = null;

  constructor(readonly key: string, readonly agentId: string | null, readonly teamId: string | null, readonly dock: HTMLElement | null = null) {
    const bar = el('header', 'term-bar');
    const tab = el('span', 'term-tab');
    tab.append(el('span', 'term-star', '✱'), this.tabLabel);
    const ctrls = el('span', 'ctrls');
    const min = el('button', 'x', '_');
    min.title = 'Minimize';
    min.onclick = () => this.win.classList.toggle('min');
    const close = el('button', 'x', '×');
    close.title = 'Close';
    close.onclick = () => this.close();
    ctrls.append(min, close);
    bar.append(tab, ctrls);
    bar.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('button')) this.win.classList.toggle('min');
    });

    const prompt = el('div', 'term-prompt');
    this.input.rows = 1;
    this.input.spellcheck = false;
    prompt.append(el('span', 'term-caret', '❯'), this.input);
    this.screen.append(this.banner, this.log, this.status, this.ask);
    const body = el('div', 'term-body');
    body.append(this.screen, this.pics.strip, prompt, this.foot);
    this.win.append(bar, body);

    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('input', () => this.fit());
    // a click on the screen (that isn't selecting text) puts the cursor back at the prompt
    this.screen.addEventListener('mouseup', () => {
      if (window.getSelection()?.isCollapsed) this.input.focus();
    });
    if (dock) {
      // the terminal view places and sizes it
      this.win.classList.add('docked');
      ctrls.hidden = true;
      dock.append(this.win);
      this.update();
      this.screen.scrollTop = this.screen.scrollHeight;
      return;
    }
    this.win.addEventListener('pointerdown', () => raise(this.win));
    this.drag(bar);

    const p = (places[key] ??= this.firstPlace());
    Object.assign(this.win.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
    let saving = 0;
    new ResizeObserver(() => {
      if (this.win.classList.contains('min') || !this.win.isConnected) return;
      window.clearTimeout(saving);
      saving = window.setTimeout(() => {
        p.w = this.win.offsetWidth;
        p.h = this.win.offsetHeight;
        remember();
      }, 300);
    }).observe(this.win);

    document.getElementById('windows')!.append(this.win);
    this.clamp();
    raise(this.win);
    this.update();
    this.screen.scrollTop = this.screen.scrollHeight;
    this.input.focus();
  }

  private firstPlace(): Place {
    const w = Math.min(700, innerWidth - 24), h = Math.min(500, innerHeight - 90);
    const step = (terms.size % 6) * 28;
    return { x: Math.max(12, (innerWidth - w) / 2 + step), y: Math.max(56, (innerHeight - h) / 3 + step), w, h };
  }

  clamp() {
    if (this.dock) return;
    const p = places[this.key];
    p.x = Math.round(Math.min(Math.max(p.x, KEEP - this.win.offsetWidth), innerWidth - KEEP));
    p.y = Math.round(Math.min(Math.max(p.y, 0), innerHeight - 36));
    this.win.style.left = `${p.x}px`;
    this.win.style.top = `${p.y}px`;
  }

  private drag(bar: HTMLElement) {
    bar.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
      const p = places[this.key], sx = e.clientX - p.x, sy = e.clientY - p.y;
      bar.setPointerCapture(e.pointerId);
      this.win.classList.add('dragging');
      const move = (ev: PointerEvent) => {
        p.x = ev.clientX - sx;
        p.y = ev.clientY - sy;
        this.clamp();
      };
      const up = () => {
        this.win.classList.remove('dragging');
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        remember();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
  }

  show() {
    this.win.classList.remove('min');
    if (!this.dock) raise(this.win);
    this.input.focus();
  }

  focus() {
    this.input.focus({ preventScroll: true });
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  close() {
    if (terms.get(this.key) === this) terms.delete(this.key);
    if (this.dock) return this.win.remove();
    this.win.classList.add('closing');
    window.setTimeout(() => this.win.remove(), 180);
  }

  /** Still showing someone (or a team) who's around. */
  get alive() {
    return terms.get(this.key) === this;
  }

  private team() {
    return this.teamId ? teams.find((t) => t.id === this.teamId) : undefined;
  }

  /** Who this terminal is for: one person, or the team with its manager first. */
  private members(): string[] {
    if (this.agentId) return viewOf(this.agentId) ? [this.agentId] : [];
    const t = this.team();
    return t ? [t.manager, ...t.workers].filter((id) => viewOf(id)) : [];
  }

  private colorOf(id: string) {
    if (!this.colors.has(id)) this.colors.set(id, COLORS[this.colors.size % COLORS.length]);
    return this.colors.get(id)!;
  }

  /** Bring everything up to date; closes itself if the person was let go or the team disbanded. */
  update() {
    const ids = this.members();
    // in the terminal view the view decides when it goes; its people may just not be known yet
    if (!ids.length) return this.dock ? undefined : this.close();
    if (this.teamId) this.members().forEach((id) => this.colorOf(id));
    this.renderBanner(ids);
    this.renderLog(ids);
    this.renderStatus(ids);
    this.renderAsk(ids);
    this.renderFoot(ids);
  }

  private renderBanner(ids: string[]) {
    const views = ids.map((id) => viewOf(id)!);
    const lead = views[0];
    const t = this.team();
    const where = lead.status.project ? `${settings.projectsRoot.replace(/[\\/]$/, '')}/${lead.status.project}${lead.status.branch ? ` (${lead.status.branch})` : ''}` : settings.projectsRoot;
    const engine = engineIn(settings, lead.status.engine).name;
    const theme = savedTheme();
    const key = [t?.name, ...views.map((v) => `${v.name}|${v.model}|${v.role}|${v.team}`), where, engine, theme].join('/');
    if (key === this.bannerKey) return;
    this.bannerKey = key;
    this.tabLabel.textContent = t ? `${t.name} — team` : `${lead.name} — ${engine}`;
    const faces = el('div', 'term-faces');
    for (const v of views.slice(0, 6)) {
      const img = el('img');
      img.src = v.avatar;
      img.alt = v.name;
      img.title = v.name;
      if (t) img.style.borderColor = this.colorOf(v.id);
      faces.append(img);
    }
    const info = el('div', 'term-info');
    const line1 = el('div');
    const line2 = el('div', 'dim');
    if (t) {
      line1.append(el('b', undefined, t.name), el('span', 'dim', `  ${views.length} people`));
      const names = (list: AgentView[]) => list.map((v) => v.name).join(', ');
      line2.textContent = `Manager ${lead.name} · ${names(views.slice(1)) || 'no workers'}`;
    } else {
      line1.append(el('b', undefined, lead.name), el('span', 'dim', `  ${engine}`));
      line2.textContent = `${modelLabel(settings, lead.status.engine, lead.model)} · ${lead.team ? `${lead.role === 'manager' ? 'Manager' : 'Worker'}, ${lead.team}` : 'Works on their own'}`;
    }
    info.append(line1, line2, el('div', 'dim', where));
    const art = el('div', 'term-art');
    art.title = `${theme[0].toUpperCase()}${theme.slice(1)} theme (/theme to change)`;
    art.append(pixelArt(theme));
    this.banner.replaceChildren(faces, info, art);
  }

  private renderLog(ids: string[]) {
    const fresh: (TermEntry & { who: string })[] = [];
    for (const id of ids) {
      const lines = viewOf(id)!.term;
      // walk back from the end: only the new lines are wanted
      for (let i = lines.length - 1; i >= 0 && lines[i].n > this.lastN; i--) if (lines[i].n > this.clearedAt) fresh.push({ ...lines[i], who: id });
    }
    if (!fresh.length) return;
    fresh.sort((a, b) => a.n - b.n);
    const stick = this.atBottom();
    for (const e of fresh.slice(-MAX_ROWS)) this.append(e, e.who);
    this.lastN = fresh[fresh.length - 1].n;
    while (this.log.childElementCount > MAX_ROWS) this.log.firstElementChild!.remove();
    // whatever is still being written stays below the finished lines
    for (const { row } of this.liveRows.values()) this.log.append(row);
    if (stick) this.screen.scrollTop = this.screen.scrollHeight;
  }

  private atBottom() {
    return this.screen.scrollHeight - this.screen.scrollTop - this.screen.clientHeight < 40;
  }

  /** A new line for someone: show it now, if they're in this terminal. */
  lineAdded(id: string) {
    const ids = this.members();
    if (ids.includes(id)) this.renderLog(ids);
  }

  /** The text someone is writing grew (or is done: null). */
  setLive(id: string, text: string | null) {
    if (!this.members().includes(id)) return;
    const stick = this.atBottom();
    let live = this.liveRows.get(id);
    if (text === null) {
      live?.row.remove();
      this.liveRows.delete(id);
      return;
    }
    if (!live) {
      const line = el('div', 't-msg live');
      const body = el('div');
      line.append(el('span', 't-dot', '●'), body);
      let row = line;
      if (this.teamId) {
        row = el('div', 't-row');
        const tag = el('span', 't-who', this.lastWho === id ? '' : viewOf(id)?.name ?? id);
        tag.style.color = this.colorOf(id);
        row.append(tag, line);
      }
      live = { row, body };
      this.liveRows.set(id, live);
    }
    live.body.replaceChildren(md(text));
    if (!live.row.isConnected) this.log.append(live.row);
    if (stick) this.screen.scrollTop = this.screen.scrollHeight;
  }

  private append(e: TermEntry, who: string) {
    const team = !!this.teamId;
    const name = viewOf(who)?.name ?? who;
    if (e.k === 'user') {
      this.lastWho = '';
      const row = el('div', `t-user${e.from ? ' from' : ''}`);
      const images = e.pics ? ' ' + Array.from({ length: e.pics }, (_, i) => `[Image #${i + 1}]`).join(' ') : '';
      if (e.from) {
        const tag = el('span', 't-from', team ? `${e.from} → ${name}` : e.from);
        if (team) tag.style.color = this.colorOf(agents.find((a) => a.name === e.from)?.id ?? e.from);
        row.append(tag, el('span', undefined, `${e.text}${images}`));
      } else if (team) {
        // one message to several people shows once, addressed to all of them
        if (this.lastUser && this.lastUser.text === e.text && e.t - this.lastUser.t < 3000) {
          this.lastUser.names.push(name);
          this.lastUser.to.textContent = `→ ${this.lastUser.names.join(', ')}`;
          return;
        }
        const to = el('span', 't-to', `→ ${name}`);
        row.append(el('span', 'term-caret', '❯ '), el('span', undefined, `${e.text}${images}`), to);
        this.lastUser = { text: e.text, t: e.t, to, names: [name] };
      } else row.append(el('span', 'term-caret', '❯ '), el('span', undefined, `${e.text}${images}`));
      this.log.append(row);
      return;
    }
    let line: HTMLElement;
    if (e.k === 'text') {
      line = el('div', 't-msg');
      line.append(el('span', 't-dot', '●'), md(e.text));
    } else if (e.k === 'tool') {
      line = el('div', 't-tool');
      const call = el('span');
      call.append(el('b', undefined, e.name), `(${e.arg})`);
      line.append(el('span', 't-dot ok', '●'), call);
    } else if (e.k === 'out') {
      line = el('div', `t-out${e.error ? ' error' : ''}`);
      const all = e.text.replace(/\s+$/, '').split('\n');
      const pre = el('pre');
      const short = () => (pre.textContent = all.slice(0, OUT_LINES).join('\n') + (all.length > OUT_LINES ? `\n… +${all.length - OUT_LINES} lines (click to expand)` : ''));
      short();
      if (all.length > OUT_LINES) {
        let open = false;
        pre.classList.add('more');
        pre.onclick = () => ((open = !open) ? (pre.textContent = all.join('\n')) : short());
      }
      line.append(el('span', 't-elbow', '⎿'), pre);
    } else {
      line = el('div', 't-note', e.text);
    }
    if (!team) {
      this.log.append(line);
      return;
    }
    // team view: who said it, once per run of lines
    const row = el('div', 't-row');
    const tag = el('span', 't-who', this.lastWho === who ? '' : name);
    tag.style.color = this.colorOf(who);
    row.append(tag, line);
    this.log.append(row);
    this.lastWho = who;
  }

  private busy(v: AgentView) {
    return BUSY.includes(v.activity) && (v.status.phase === 'research' || v.status.phase === 'work');
  }

  private renderStatus(ids: string[]) {
    const views = ids.map((id) => viewOf(id)!);
    const busy = views.filter((v) => this.busy(v));
    if (!busy.length) {
      this.busySince = 0;
      const waiting = views.filter((v) => v.activity !== 'awaiting');
      const text = this.teamId
        ? waiting.map((v) => `${v.name}: ${labelOf(v)}`).join(' · ')
        : waiting.map((v) => (v.detail && v.activity !== 'done' ? `${labelOf(v)} · ${v.detail}` : labelOf(v))).join('');
      this.status.className = 'term-status idle';
      this.status.textContent = text;
      return;
    }
    this.busySince ||= Date.now();
    const secs = Math.floor((Date.now() - this.busySince) / 1000);
    const frame = SPIN[Math.floor(Date.now() / 120) % SPIN.length];
    const what = this.teamId ? busy.map((v) => `${v.name} ${VERB[v.activity]!.toLowerCase()}`).join(', ') : VERB[busy[0].activity];
    this.status.className = 'term-status';
    // this turn's tokens so far, climbing as they work
    const turn = busy.reduce((n, v) => n + (v.usage?.turn ?? 0), 0);
    const used = turn ? ` · ${shortTokens(turn)} tokens` : '';
    this.status.replaceChildren(el('span', 't-spin', frame), el('span', 't-verb', ` ${what}…`), el('span', 'dim', ` (${secs}s${used} · esc to interrupt)`));
  }

  /** The first permission question from anyone here, Claude Code style. */
  private pending(ids: string[]) {
    return approvals.find((p) => ids.includes(p.id));
  }

  /** Someone here waiting with an idea, when nothing more urgent is asked. */
  private pitchUp(ids = this.members()): { id: string; name: string; idea: Idea } | null {
    if (this.pending(ids)) return null;
    const v = ids.map((id) => viewOf(id)!).find((x) => x.status.pitch);
    return v ? { id: v.id, name: v.name, idea: v.status.pitch! } : null;
  }

  private renderAsk(ids: string[]) {
    const p = this.pending(ids);
    const pitch = p ? null : this.pitchUp(ids);
    if (pitch) {
      const key = `pitch|${pitch.id}|${pitch.idea.title}|${this.choice}`;
      if (key === this.askKey) return;
      this.askKey = key;
      return this.renderPitch(pitch.name, pitch.idea);
    }
    const quizKey = p?.ask?.kind === 'question' ? `${p.id}|${p.detail}` : '';
    if (this.quiz?.key !== quizKey) this.quiz = quizKey ? { key: quizKey, at: 0, answers: {}, picked: new Set() } : null;
    const key = p ? `${p.id}|${p.detail}|${this.choice}|${this.quiz ? `${this.quiz.at}:${[...this.quiz.picked]}` : ''}` : '';
    if (key === this.askKey) return;
    if (!p) this.choice = 0;
    this.askKey = key;
    if (!p) {
      this.ask.replaceChildren();
      this.input.placeholder = this.placeholder();
      return;
    }
    if (p.ask?.kind === 'question') return this.renderQuestion(p.name, p.ask.questions);
    const run = p.detail.match(/^run: ([\s\S]*)$/);
    const install = p.ask?.kind === 'install' ? p.ask : null;
    const title = el('b', undefined, `${this.teamId ? `${p.name}: ` : ''}${run ? 'Bash command' : install ? 'Install a plugin' : 'Permission needed'}`);
    const what = el('pre', 't-ask-what', run ? run[1] : install ? `${install.plugin}${install.why ? `\n${install.why}` : ''}` : p.detail);
    const options = ['Yes', 'No, and tell them to find another way'].map((label, i) => {
      const o = el('div', `t-opt${i === this.choice ? ' on' : ''}`, `${i === this.choice ? '❯' : ' '} ${i + 1}. ${label}`);
      o.onclick = () => this.answer(i === 0);
      return o;
    });
    this.ask.replaceChildren(title, what, el('div', undefined, 'Do you want to proceed?'), ...options);
    this.input.placeholder = 'Press 1 or 2 (or ↑↓ and Enter)';
    const stick = this.screen.scrollHeight - this.screen.scrollTop - this.screen.clientHeight < 120;
    if (stick) this.screen.scrollTop = this.screen.scrollHeight;
  }

  /** Their idea, the way Claude Code shows a plan: yes, no, or type what to do instead. */
  private renderPitch(name: string, idea: Idea) {
    this.choice = Math.min(this.choice, 1);
    const head = el('div', 't-q-head');
    head.append(el('span', 't-q-chip', 'Pitch'), el('span', 'dim', ` ${idea.project}${idea.path ? '' : ' (new project)'}`));
    const title = el('b', undefined, `${name}: ${idea.title}`);
    const body = el('div', 't-ask-what');
    body.append(md(idea.summary));
    if (idea.steps.length) body.append(el('div', 'dim', idea.steps.map((t) => `  • ${t}`).join('\n')));
    const options = ['Yes, go ahead', 'No, pass on it'].map((label, i) => {
      const o = el('div', `t-opt${i === this.choice ? ' on' : ''}`, `${i === this.choice ? '❯' : ' '} ${i + 1}. ${label}`);
      o.onclick = () => this.decide(i === 0);
      return o;
    });
    const hint = el('div', 'dim', 'Or type what they should do instead');
    this.ask.replaceChildren(head, title, body, el('div', undefined, 'Should they do it?'), ...options, hint);
    this.input.placeholder = 'Press 1 or 2 (or ↑↓ and Enter), or type what to do instead';
    if (this.screen.scrollHeight - this.screen.scrollTop - this.screen.clientHeight < 200) this.screen.scrollTop = this.screen.scrollHeight;
  }

  private decide(ok: boolean, instead?: string, pictures?: Picture[]) {
    const pitch = this.pitchUp();
    if (!pitch) return;
    const decision = instead !== undefined ? { kind: 'instead', text: instead, pictures } : { kind: ok ? 'approve' : 'reject' };
    bus.emit('pitch:decide', { id: pitch.id, decision });
    this.choice = 0;
  }

  private answer(ok: boolean) {
    const p = this.pending(this.members());
    if (!p) return;
    bus.emit('approval:resolve', { id: p.id, ok });
    this.choice = 0;
  }

  /** The question that's up, Claude Code style: numbered options, "type something" for your own answer. */
  private renderQuestion(name: string, questions: Question[]) {
    const quiz = this.quiz!;
    const q = questions[quiz.at];
    const n = q.options.length;
    // the extra row at the bottom: submit for multi-select
    const rows = q.multiSelect ? n + 1 : n;
    this.choice = Math.min(this.choice, rows - 1);
    const head = el('div', 't-q-head');
    if (q.header) head.append(el('span', 't-q-chip', q.header));
    if (questions.length > 1) head.append(el('span', 'dim', ` ${quiz.at + 1} of ${questions.length}`));
    const title = el('b', undefined, `${this.teamId ? `${name}: ` : ''}${q.question}`);
    const options = q.options.map((o, i) => {
      const tick = q.multiSelect ? (quiz.picked.has(i) ? '[x] ' : '[ ] ') : '';
      const row = el('div', `t-opt${i === this.choice ? ' on' : ''}`);
      row.append(`${i === this.choice ? '❯' : ' '} ${i + 1}. ${tick}${o.label}`);
      if (o.description) row.append(el('span', 'dim', `  ${o.description}`));
      row.onclick = () => this.pick(i);
      return row;
    });
    if (q.multiSelect) {
      const submit = el('div', `t-opt${this.choice === n ? ' on' : ''}`, `${this.choice === n ? '❯' : ' '}    Submit`);
      submit.onclick = () => this.pick(n);
      options.push(submit);
    }
    const hint = el('div', 'dim', 'Or type your own answer below · Esc skips the question');
    this.ask.replaceChildren(head, title, ...options, hint);
    this.input.placeholder = q.multiSelect ? 'Press a number to tick, Enter on Submit (or type your own answer)' : 'Press a number (or ↑↓ and Enter), or type your own answer';
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  private questions() {
    const p = this.pending(this.members());
    return p?.ask?.kind === 'question' ? { id: p.id, questions: p.ask.questions } : null;
  }

  /** Option i of the question that's up (or Submit, for multi-select). */
  private pick(i: number) {
    const cur = this.questions();
    if (!cur || !this.quiz) return;
    const q = cur.questions[this.quiz.at];
    if (q.multiSelect && i < q.options.length) {
      if (!this.quiz.picked.delete(i)) this.quiz.picked.add(i);
      this.choice = i;
      return this.renderAsk(this.members());
    }
    const text = q.multiSelect ? [...this.quiz.picked].sort().map((k) => q.options[k].label).join(', ') : q.options[i]?.label;
    if (!text) return;
    this.answerWith(text);
  }

  /** Answer the question that's up and move on to the next one, or send them all. */
  private answerWith(text: string) {
    const cur = this.questions();
    if (!cur || !this.quiz) return;
    const q = cur.questions[this.quiz.at];
    this.quiz.answers[q.question] = text;
    this.quiz.picked.clear();
    this.choice = 0;
    if (this.quiz.at + 1 < cur.questions.length) {
      this.quiz.at++;
      return this.renderAsk(this.members());
    }
    bus.emit('approval:answer', { id: cur.id, answers: this.quiz.answers });
    this.quiz = null;
  }

  private placeholder() {
    if (!this.teamId) return '';
    return 'Message the whole team, or @name for one person';
  }

  private renderFoot(ids: string[]) {
    const auto = settings.approvals === 'auto';
    const lead = viewOf(ids[0])!;
    const right = this.teamId ? `to everyone · ${lead.name} decides · @name · /help` : `${modelLabel(settings, lead.status.engine, lead.model)} · /help`;
    const key = `${settings.approvals}|${right}`;
    if (key === this.footKey) return;
    this.footKey = key;
    const mode = settings.approvals === 'full' ? ['full', '⏵⏵ bypass permissions on'] : auto ? ['auto', '⏵⏵ auto mode on'] : ['dim', '⏵ asks before changing files'];
    this.foot.replaceChildren(el('span', mode[0], mode[1]), el('span', 'dim', right));
  }

  /** Called a few times a second, only for the spinner. */
  tick() {
    const ids = this.members();
    if (ids.some((id) => this.busy(viewOf(id)!))) this.renderStatus(ids);
  }

  private fit() {
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, 160)}px`;
  }

  private onKey(e: KeyboardEvent) {
    const empty = !this.input.value;
    const asking = !!this.pending(this.members());
    const quiz = this.questions();
    if (quiz && this.quiz) {
      const q = quiz.questions[this.quiz.at];
      const rows = q.options.length + (q.multiSelect ? 1 : 0);
      const num = Number(e.key);
      if (empty && Number.isInteger(num) && num >= 1 && num <= q.options.length) {
        e.preventDefault();
        return this.pick(num - 1);
      }
      if (empty && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        this.choice = (this.choice + (e.key === 'ArrowUp' ? rows - 1 : 1)) % rows;
        return this.renderAsk(this.members());
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const typed = this.input.value.trim();
        if (!typed) return this.pick(this.choice);
        this.input.value = '';
        this.fit();
        return this.answerWith(typed);
      }
      if (e.key === 'Escape' && empty) {
        e.preventDefault();
        e.stopPropagation();
        this.quiz = null;
        return this.answer(false);
      }
    }
    if (!asking && empty && this.pitchUp()) {
      if (e.key === '1' || e.key === '2') {
        e.preventDefault();
        return this.decide(e.key === '1');
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.choice = this.choice ? 0 : 1;
        return this.renderAsk(this.members());
      }
      if (e.key === 'Enter' && !e.shiftKey && !this.pics.count) {
        e.preventDefault();
        return this.decide(this.choice === 0);
      }
    }
    if (asking && empty && !quiz) {
      if (e.key === '1' || e.key === '2') {
        e.preventDefault();
        return this.answer(e.key === '1');
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.choice = this.choice ? 0 : 1;
        return this.renderAsk(this.members());
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        return this.answer(this.choice === 0);
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return this.submit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const busy = this.members().filter((id) => this.busy(viewOf(id)!));
      if (busy.length) {
        busy.forEach((id) => bus.emit('agent:stop', id));
        this.print('Interrupted · tell them what to do instead');
      } else if (this.input.value) this.input.value = '';
      else if (this.dock) bus.emit('deck:out');
      return;
    }
    // ↑ and ↓ at the edges of the box walk through what was sent before
    const atStart = this.input.selectionStart === 0 && this.input.selectionEnd === 0;
    const atEnd = this.input.selectionStart === this.input.value.length;
    if (e.key === 'ArrowUp' && atStart && this.history.length) {
      e.preventDefault();
      this.hist = this.hist < 0 ? this.history.length - 1 : Math.max(0, this.hist - 1);
      this.input.value = this.history[this.hist];
      this.fit();
    } else if (e.key === 'ArrowDown' && atEnd && this.hist >= 0) {
      e.preventDefault();
      this.hist++;
      this.input.value = this.hist < this.history.length ? this.history[this.hist] : '';
      if (this.hist >= this.history.length) this.hist = -1;
      this.fit();
    }
  }

  /** A line only this window shows (help, command results); it isn't kept. */
  private print(text: string) {
    this.log.append(el('div', 't-note local', text));
    this.lastWho = '';
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  private submit() {
    const raw = this.input.value.trim();
    if (!raw && !this.pics.count) return;
    if (raw) this.history.push(raw);
    this.hist = -1;
    this.input.value = '';
    this.fit();
    if (raw.startsWith('/')) return this.command(raw);
    const ids = this.members();
    let target: string | null = this.teamId ? null : ids[0];
    let text = raw;
    const at = this.teamId ? raw.match(/^@(\S+)\s*([\s\S]*)$/) : null;
    if (at) {
      const who = at[1].toLowerCase();
      if (!['all', 'everyone', 'team'].includes(who)) {
        const found = ids.filter((id) => viewOf(id)!.name.toLowerCase().startsWith(who));
        if (!found.length) return this.print(`Nobody called "${at[1]}" on this team. Try ${ids.map((id) => `@${viewOf(id)!.name}`).join(', ')}, or no @ for everyone.`);
        target = found[0];
      }
      text = at[2].trim();
      // @name /model ...: a command for that one person
      if (target && text.startsWith('/')) return this.command(text, [target]);
    }
    const pictures = this.pics.take();
    if (!text && !pictures.length) return;
    text ||= 'Have a look at this picture.';
    // an idea on the table: what's typed is "not that, do this instead"
    const pitch = this.pitchUp();
    if (pitch && !at && (!target || target === pitch.id)) return this.decide(false, text, pictures);
    // no @: the whole team hears it, and the manager decides what happens
    if (target) bus.emit('agent:say', { id: target, text, pictures });
    else bus.emit('team:say', { id: this.teamId, text, pictures });
  }

  /** Lines with a name in front, one per person: what a command says about each of them. */
  private printEach(rows: [string, string][]) {
    for (const [id, text] of rows) {
      const row = el('div', 't-row t-each');
      const tag = el('span', 't-who', viewOf(id)?.name ?? id);
      tag.style.color = this.colorOf(id);
      row.append(tag, el('div', 't-note local', text));
      this.log.append(row);
    }
    this.lastWho = '';
    this.screen.scrollTop = this.screen.scrollHeight;
  }

  /** One line per person: in a team each member by name; for one person, just the line. */
  private report(ids: string[], line: (v: AgentView) => string) {
    const views = ids.map((id) => viewOf(id)).filter((v): v is AgentView => !!v);
    if (this.teamId) return this.printEach(views.map((v) => [v.id, line(v)]));
    views.forEach((v) => this.print(line(v)));
  }

  /** `only`: the people it's for (@name in a team); otherwise everyone in this terminal. */
  private command(raw: string, only?: string[]) {
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    const ids = only ?? this.members();
    const whole = !!this.teamId && !only;
    const lead = viewOf(ids[0])!;
    const money = (n: number) => `$${n.toFixed(2)}`;
    const pitchMins = settings.pitchAfterMin ?? 5;
    switch (cmd.toLowerCase()) {
      case 'help':
      case '?':
        [
          'Enter sends · Shift+Enter new line · Esc interrupts · ↑ previous message · Ctrl+V pastes a picture',
          ...(this.teamId ? ['A message goes to the whole team and the manager decides. @Name message talks to one person; @Name /command runs a command for them only.'] : []),
          `/model [name]    show or switch the model${this.teamId ? ' (each person listed)' : ''}`,
          '/status          what they are doing, where, on which model',
          '/cost            tokens and money used',
          '/skills          their go-to skills',
          '/engine [name]   show or switch the engine',
          '/stop            interrupt what they are doing',
          '/hold, /reopen   put on hold, bring back',
          `/ideas on|off    ${this.teamId ? 'the manager pitches' : 'they pitch'} an idea after ${pitchMins} min with nothing to do`,
          '/approve, /pass  answer a pitch waiting here',
          '/theme [normal|night|light]  change how every terminal looks',
          '/clear           clear this screen (they still remember everything)',
          'Anything else starting with / goes to Claude Code itself, e.g. /compact or a skill',
        ].forEach((l) => this.print(l));
        return;
      case 'clear':
        this.clearedAt = this.lastN;
        this.lastWho = '';
        this.lastUser = null;
        this.log.replaceChildren();
        return;
      case 'stop':
      case 'interrupt':
        ids.forEach((id) => bus.emit('agent:stop', id));
        return this.report(ids, () => 'told to stop');
      case 'hold':
      case 'reopen': {
        const on = cmd.toLowerCase() === 'hold';
        if (whole) bus.emit('team:hold', { id: this.teamId, on });
        else ids.forEach((id) => bus.emit('agent:hold', { id, on }));
        return this.report(ids, () => (on ? 'on hold (/reopen brings them back)' : 'reopened'));
      }
      case 'ideas': {
        // in a team it's the manager who pitches
        const on = /^(on|yes|1)$/i.test(arg) ? true : /^(off|no|0)$/i.test(arg) ? false : !lead.status.ideas;
        bus.emit('agent:ideas', { id: lead.id, on });
        return this.report([lead.id], () => (on ? `pitches an idea after ${pitchMins} min with nothing to do` : 'stays idle until told what to do'));
      }
      case 'model': {
        if (!arg) {
          this.report(ids, (v) => `model: ${modelLabel(settings, v.status.engine, v.model)}`);
          const engines = [...new Set(ids.map((id) => viewOf(id)!.status.engine))];
          engines.forEach((e) => this.print(`${engines.length > 1 ? `${engineIn(settings, e).name}: ` : ''}pick one: ${engineIn(settings, e).models.map((m) => m.label).join(', ')}`));
          return;
        }
        const q = arg.toLowerCase();
        return this.report(ids, (v) => {
          const models = engineIn(settings, v.status.engine).models;
          const m = models.find((x) => x.id.toLowerCase() === q || x.label.toLowerCase() === q) ?? models.find((x) => x.label.toLowerCase().includes(q) || (x.id && x.id.toLowerCase().includes(q)));
          if (!m) return `no model matches "${arg}" on ${engineIn(settings, v.status.engine).name}`;
          bus.emit('agent:model', { id: v.id, model: m.id });
          return `model set to ${m.label}`;
        });
      }
      case 'engine': {
        if (!arg) {
          this.report(ids, (v) => `engine: ${engineIn(settings, v.status.engine).name}`);
          return this.print(`Pick one: ${settings.engines.map((e) => e.name).join(', ')}`);
        }
        const q = arg.toLowerCase();
        const e = settings.engines.find((x) => x.name.toLowerCase() === q) ?? settings.engines.find((x) => x.name.toLowerCase().includes(q));
        if (!e) return this.print(`No engine called "${arg}". Pick one: ${settings.engines.map((x) => x.name).join(', ')}`);
        ids.forEach((id) => bus.emit('agent:engine', { id, engine: e.id }));
        return this.report(ids, () => `engine set to ${e.name} (from the next task)`);
      }
      case 'status':
        return this.report(ids, (v) => {
          const where = v.status.project ? ` · ${v.status.project}${v.status.branch ? ` (${v.status.branch})` : ''}` : '';
          const role = v.team ? ` · ${v.role === 'manager' ? 'manager' : 'worker'} in ${v.team}` : '';
          const doing = v.status.phase === 'idle' ? 'Idle' : LABEL[v.activity];
          const detail = v.detail && v.activity !== 'done' ? `: ${v.detail}` : '';
          return `${doing}${detail}${where} · ${modelLabel(settings, v.status.engine, v.model)}${role}${v.status.ideas ? ' · ideas on' : ''}`;
        });
      case 'cost':
      case 'usage': {
        const views = ids.map((id) => viewOf(id)!);
        if (!views.some((v) => v.usage)) return this.print('Simulated agents use nothing.');
        this.report(ids, (v) => (v.usage ? `${shortTokens(v.usage.tokens)} tokens · ${money(v.usage.cost)}` : '-'));
        if (views.length > 1) {
          const total = views.reduce((a, v) => ({ t: a.t + (v.usage?.tokens ?? 0), c: a.c + (v.usage?.cost ?? 0) }), { t: 0, c: 0 });
          this.print(`Total: ${shortTokens(total.t)} tokens · ${money(total.c)}`);
        }
        return;
      }
      case 'skills':
        return this.report(ids, (v) => (v.skills.length ? `go-to skills: ${v.skills.join(', ')}` : 'no go-to skills (every installed skill is still there for them)'));
      case 'theme': {
        const q = arg.toLowerCase();
        const next = (THEMES.find((t) => t.startsWith(q) && q) ?? (q === 'dark' ? 'night' : q === 'day' ? 'light' : null)) as TermTheme | null;
        if (q && !next) return this.print(`No theme called "${arg}". Pick one: ${THEMES.join(', ')}`);
        const theme = next ?? THEMES[(THEMES.indexOf(savedTheme()) + 1) % THEMES.length];
        bus.emit('theme', theme);
        return this.print(`Theme: ${theme}`);
      }
      case 'approve':
      case 'pass':
        if (!this.pitchUp(ids)) return this.print('No pitch waiting here.');
        return this.decide(cmd.toLowerCase() === 'approve');
      default:
        // Claude Code's own commands and skills: straight through to the session
        ids.forEach((id) => bus.emit('agent:say', { id, text: raw }));
        return this.report(ids, () => `sent ${raw.split(/\s/)[0]} to Claude Code`);
    }
  }
}

/** A terminal for the terminal view, laid out by it: one person (agentId) or a team. */
export function dockTerm(parent: HTMLElement, agentId: string | null, teamId: string | null) {
  const key = `d:${agentId ? `a:${agentId}` : `t:${teamId}`}`;
  terms.get(key)?.close();
  const t = new Term(key, agentId, teamId, parent);
  terms.set(key, t);
  return t;
}

export type { Term };

function openTerm(key: string, agentId: string | null, teamId: string | null) {
  // in the terminal view the deck shows it instead
  if (document.body.classList.contains('deck-on')) return;
  // the Work Board covers the windows; get it out of the way
  const board = document.getElementById('board-pop');
  if (board) board.hidden = true;
  const t = terms.get(key);
  if (t) return t.show();
  terms.set(key, new Term(key, agentId, teamId));
}

/** Every terminal, and the terminal view, in one look. */
export function applyTheme(theme: TermTheme) {
  setTheme(theme);
  terms.forEach((t) => t.update());
}

export function initTerminals() {
  setTheme(savedTheme());
  bus.on('theme', (t: TermTheme) => applyTheme(t));
  try {
    places = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    places = {};
  }
  const refresh = () => [...terms.values()].forEach((t) => t.update());
  bus.on('agents', (views: AgentView[]) => {
    agents = views;
    refresh();
  });
  bus.on('teams', (list: Team[]) => {
    teams = list;
    refresh();
  });
  bus.on('approvals', (list: ApprovalView[]) => {
    approvals = list;
    refresh();
  });
  bus.on('settings', (s: Settings) => {
    settings = s;
    refresh();
  });
  bus.on('term:open', (id: string) => viewOf(id) && openTerm(`a:${id}`, id, null));
  bus.on('term:team', (id: string) => teams.some((t) => t.id === id) && openTerm(`t:${id}`, null, id));
  // straight from the agents, without waiting for the next office update
  bus.on('term:line', (id: string) => terms.forEach((t) => t.lineAdded(id)));
  bus.on('term:live', ({ id, text }: { id: string; text: string | null }) => terms.forEach((t) => t.setLive(id, text)));
  window.setInterval(() => terms.forEach((t) => t.tick()), 120);
  window.addEventListener('resize', () => terms.forEach((t) => t.clamp()));
}
