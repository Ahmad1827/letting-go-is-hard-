import { bus } from '../bus';
import { DEFAULT_SETTINGS, engineIn, modelLabel } from '../agents/crew';
import type { AgentActivity, Settings, Team, TermEntry } from '../agents/types';
import { el } from './dom';
import { LABEL, type AgentView, type ApprovalView } from './hud';
import { raise } from './panels';
import { acceptPictures } from './paste';

/**
 * Terminals: a window per agent that looks and works like Claude Code in a
 * terminal. Their messages, tool calls and results scroll by; you type at the
 * ❯ prompt, Esc interrupts, and permission questions are answered inline.
 *
 * A team gets one too: everyone's lines interleaved, each tagged with who said
 * it. Messages go to the manager unless they start with @name or @all.
 */

const BUSY: AgentActivity[] = ['thinking', 'reading', 'writing', 'running'];
const VERB: Partial<Record<AgentActivity, string>> = { thinking: 'Thinking', reading: 'Reading', writing: 'Writing', running: 'Running' };
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const COLORS = ['#d97757', '#6cb6ff', '#7ee787', '#f0c674', '#d2a8ff', '#ff7b9c', '#56d4dd', '#ffa657'];
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

  constructor(readonly key: string, readonly agentId: string | null, readonly teamId: string | null) {
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
    raise(this.win);
    this.input.focus();
  }

  close() {
    terms.delete(this.key);
    this.win.classList.add('closing');
    window.setTimeout(() => this.win.remove(), 180);
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
    if (!ids.length) return this.close();
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
    const key = [t?.name, ...views.map((v) => `${v.name}|${v.model}|${v.role}|${v.team}`), where, engine].join('/');
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
    this.banner.replaceChildren(faces, info);
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
    const stick = this.screen.scrollHeight - this.screen.scrollTop - this.screen.clientHeight < 40;
    for (const e of fresh.slice(-MAX_ROWS)) this.append(e, e.who);
    this.lastN = fresh[fresh.length - 1].n;
    while (this.log.childElementCount > MAX_ROWS) this.log.firstElementChild!.remove();
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
        ? waiting.map((v) => `${v.name}: ${LABEL[v.activity]}`).join(' · ')
        : waiting.map((v) => (v.detail && v.activity !== 'done' ? `${LABEL[v.activity]} · ${v.detail}` : LABEL[v.activity])).join('');
      this.status.className = 'term-status idle';
      this.status.textContent = text;
      return;
    }
    this.busySince ||= Date.now();
    const secs = Math.floor((Date.now() - this.busySince) / 1000);
    const frame = SPIN[Math.floor(Date.now() / 120) % SPIN.length];
    const what = this.teamId ? busy.map((v) => `${v.name} ${VERB[v.activity]!.toLowerCase()}`).join(', ') : VERB[busy[0].activity];
    this.status.className = 'term-status';
    this.status.replaceChildren(el('span', 't-spin', frame), el('span', 't-verb', ` ${what}…`), el('span', 'dim', ` (${secs}s · esc to interrupt)`));
  }

  /** The first permission question from anyone here, Claude Code style. */
  private pending(ids: string[]) {
    return approvals.find((p) => ids.includes(p.id));
  }

  private renderAsk(ids: string[]) {
    const p = this.pending(ids);
    const key = p ? `${p.id}|${p.detail}|${this.choice}` : '';
    if (key === this.askKey) return;
    if (!p) this.choice = 0;
    this.askKey = key;
    if (!p) {
      this.ask.replaceChildren();
      this.input.placeholder = this.placeholder();
      return;
    }
    const run = p.detail.match(/^run: ([\s\S]*)$/);
    const title = el('b', undefined, `${this.teamId ? `${p.name}: ` : ''}${run ? 'Bash command' : 'Permission needed'}`);
    const what = el('pre', 't-ask-what', run ? run[1] : p.detail);
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

  private answer(ok: boolean) {
    const p = this.pending(this.members());
    if (!p) return;
    bus.emit('approval:resolve', { id: p.id, ok });
    this.choice = 0;
  }

  private placeholder() {
    if (!this.teamId) return '';
    const m = viewOf(this.members()[0]);
    return `Message ${m?.name ?? 'the manager'}, or @name / @all`;
  }

  private renderFoot(ids: string[]) {
    const auto = settings.approvals === 'auto';
    const lead = viewOf(ids[0])!;
    const right = this.teamId ? `to ${lead.name} · @name · @all · /help` : `${modelLabel(settings, lead.status.engine, lead.model)} · /help`;
    const key = `${auto}|${right}`;
    if (key === this.footKey) return;
    this.footKey = key;
    this.foot.replaceChildren(
      el('span', auto ? 'auto' : 'dim', auto ? '⏵⏵ auto mode on' : '⏵ asks before changing files'),
      el('span', 'dim', right),
    );
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
    if (asking && empty) {
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
    let targets = ids.slice(0, 1);
    let text = raw;
    const at = this.teamId ? raw.match(/^@(\S+)\s*([\s\S]*)$/) : null;
    if (at) {
      const who = at[1].toLowerCase();
      if (who === 'all' || who === 'everyone' || who === 'team') targets = ids;
      else {
        const found = ids.filter((id) => viewOf(id)!.name.toLowerCase().startsWith(who));
        if (!found.length) return this.print(`Nobody called "${at[1]}" on this team. Try ${ids.map((id) => `@${viewOf(id)!.name}`).join(', ')} or @all.`);
        targets = found.slice(0, 1);
      }
      text = at[2].trim();
    }
    const pictures = this.pics.take();
    if (!text && !pictures.length) return;
    for (const id of targets) bus.emit('agent:say', { id, text: text || 'Have a look at this picture.', pictures });
  }

  private command(raw: string) {
    const [cmd, ...rest] = raw.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    const ids = this.members();
    switch (cmd.toLowerCase()) {
      case 'help':
      case '?':
        return [
          'Enter sends · Shift+Enter new line · Esc interrupts · ↑ previous message · Ctrl+V pastes a picture',
          ...(this.teamId ? ['@Name message talks to one person, @all to everyone; otherwise it goes to the manager'] : []),
          '/clear clears this screen (they still remember everything)',
          '/stop interrupts what they are doing',
          '/hold puts them on hold · /reopen brings them back',
          '/model shows the models · /model <name> switches',
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
        return this.print('Told them to stop');
      case 'hold':
      case 'reopen': {
        const on = cmd.toLowerCase() === 'hold';
        if (this.teamId) bus.emit('team:hold', { id: this.teamId, on });
        else bus.emit('agent:hold', { id: ids[0], on });
        return this.print(on ? 'On hold. /reopen to bring them back.' : 'Reopened');
      }
      case 'model': {
        const lead = viewOf(ids[0])!;
        const models = engineIn(settings, lead.status.engine).models;
        if (!arg) {
          this.print(`Now: ${modelLabel(settings, lead.status.engine, lead.model)}`);
          return this.print(`Pick one: ${models.map((m) => m.label).join(', ')}`);
        }
        const q = arg.toLowerCase();
        const m = models.find((x) => x.id.toLowerCase() === q || x.label.toLowerCase() === q) ?? models.find((x) => x.label.toLowerCase().includes(q) || (x.id && x.id.toLowerCase().includes(q)));
        if (!m) return this.print(`No model matches "${arg}". Pick one: ${models.map((x) => x.label).join(', ')}`);
        ids.forEach((id) => bus.emit('agent:model', { id, model: m.id }));
        return this.print(`Model set to ${m.label}`);
      }
      default:
        return this.print(`Unknown command /${cmd}. Type /help.`);
    }
  }
}

function openTerm(key: string, agentId: string | null, teamId: string | null) {
  // the Work Board covers the windows; get it out of the way
  const board = document.getElementById('board-pop');
  if (board) board.hidden = true;
  const t = terms.get(key);
  if (t) return t.show();
  terms.set(key, new Term(key, agentId, teamId));
}

export function initTerminals() {
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
  window.setInterval(() => terms.forEach((t) => t.tick()), 120);
  window.addEventListener('resize', () => terms.forEach((t) => t.clamp()));
}
