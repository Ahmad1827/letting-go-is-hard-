import { bus } from '../bus';
import type { Team } from '../agents/types';
import { byId, el } from './dom';
import { DOT, labelOf, type AgentView, type ApprovalView } from './hud';
import { NAMES, panels, type PanelName } from './panels';
import { savedTheme, THEMES, type TermTheme } from './pixels';
import { dockTerm, type Term } from './terminal';

/**
 * The terminal view: the office as nothing but terminals. Group terminals sit
 * in the top row (a message there goes to the whole group), everyone's own
 * terminal below. Click one to zoom in and work in it; Esc, the ⊖ button or
 * Ctrl + scroll down zooms back out. The tabs along the top jump straight to
 * any of them. Drag a terminal in the overview to move it; the order is kept.
 */

const KEY = 'lgih.view';
/** The order the terminals were dragged into. */
const ORDER_KEY = 'lgih.deck.order';
/** How far the mouse has to move before a press on a terminal becomes a drag rather than a click. */
const DRAG_PX = 6;

interface Tile { key: string; box: HTMLElement; term: Term }

let agents: AgentView[] = [];
let teams: Team[] = [];
let approvals: ApprovalView[] = [];
let on = false;
/** The terminal zoomed in on, if any. */
let zoomed: string | null = null;
const tiles = new Map<string, Tile>();
/** Panels that were open in the office, put away while only terminals show. */
let stowed: PanelName[] = [];

const deck = () => byId('deck');
const grid = () => byId('deck-grid');

/** Smooth zoom where the browser can (view transitions), instant otherwise. */
function animate(change: () => void) {
  const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
  if (start && !matchMedia('(prefers-reduced-motion: reduce)').matches) start.call(document, change);
  else change();
}

let arranged: string[] = [];
try {
  arranged = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') ?? [];
} catch {
  arranged = [];
}

/** In the order they were dragged into; anyone new goes at the end. */
function inOrder<T>(list: T[], keyOf: (x: T) => string) {
  const rank = (x: T) => {
    const i = arranged.indexOf(keyOf(x));
    return i < 0 ? Infinity : i;
  };
  return list.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(({ x }) => x);
}

/** Who and what should have a terminal: groups first, unless they were dragged elsewhere. */
function wanted(): { key: string; agentId: string | null; teamId: string | null }[] {
  return inOrder(
    [
      ...teams.map((t) => ({ key: `t:${t.id}`, agentId: null, teamId: t.id })),
      ...agents.map((a) => ({ key: `a:${a.id}`, agentId: a.id, teamId: null })),
    ],
    (w) => w.key,
  );
}

/** When a drag last ended: the click that follows it isn't a zoom. */
let droppedAt = 0;

/** Press and drag a terminal (in the overview) to move it among the others in its row. */
function draggable(box: HTMLElement) {
  box.addEventListener('pointerdown', (e) => {
    if (zoomed || e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let lifted = false;
    let target: HTMLElement | null = null;
    let before = false;
    const mark = () => {
      document.querySelectorAll('.tile.drop-before, .tile.drop-after').forEach((t) => t.classList.remove('drop-before', 'drop-after'));
      target?.classList.add(before ? 'drop-before' : 'drop-after');
    };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!lifted) {
        if (Math.hypot(dx, dy) < DRAG_PX) return;
        lifted = true;
        box.classList.add('lifted');
        box.style.pointerEvents = 'none';
        document.body.classList.add('dragging-tile');
      }
      box.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.tile') ?? null;
      target = under && under !== box ? under : null;
      if (target) {
        const r = target.getBoundingClientRect();
        before = ev.clientX < r.left + r.width / 2;
      }
      mark();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!lifted) return;
      droppedAt = Date.now();
      const drop = target;
      target = null;
      mark();
      document.body.classList.remove('dragging-tile');
      box.classList.remove('lifted');
      box.style.pointerEvents = '';
      box.style.transform = '';
      if (!drop) return;
      animate(() => {
        drop.parentElement!.insertBefore(box, before ? drop : drop.nextSibling);
        arranged = [...grid().querySelectorAll<HTMLElement>(':scope > .tile')].map((t) => t.dataset.key!);
        try {
          localStorage.setItem(ORDER_KEY, JSON.stringify(arranged));
        } catch {
          // not remembered: fine
        }
        tabsKey = '';
        renderTabs();
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

function sync() {
  if (!on) return;
  const want = wanted();
  const keys = new Set(want.map((w) => w.key));
  for (const [key, t] of tiles) {
    // gone, or their terminal closed itself (let go, disbanded)
    if (!keys.has(key) || !t.term.alive) {
      t.term.close();
      t.box.remove();
      tiles.delete(key);
    }
  }
  for (const w of want) {
    if (tiles.has(w.key)) continue;
    const box = el('div', 'tile');
    box.dataset.key = w.key;
    box.style.setProperty('view-transition-name', `tile-${w.key.replace(/[^\w-]/g, '-')}`);
    // in the overview a click anywhere on it zooms in; a drag moves it
    box.addEventListener('click', () => Date.now() - droppedAt > 250 && zoomed !== w.key && zoom(w.key), true);
    draggable(box);
    grid().append(box);
    tiles.set(w.key, { key: w.key, box, term: dockTerm(box, w.agentId, w.teamId) });
  }
  // keep them in the same order as the tabs
  const boxes = want.map((w) => tiles.get(w.key)!.box);
  const shown = [...grid().querySelectorAll(':scope > .tile')];
  if (boxes.some((b, i) => shown[i] !== b)) grid().append(...boxes);
  if (zoomed && !tiles.has(zoomed)) zoomed = null;
  byId('deck-empty').hidden = tiles.size > 0;
  layout();
  renderTabs();
}

function layout() {
  grid().classList.toggle('zoomed', !!zoomed);
  for (const t of tiles.values()) {
    t.box.classList.toggle('big', t.key === zoomed);
    t.box.classList.toggle('need', needs(t.key));
  }
  byId('deck-out').hidden = !zoomed;
}

/** Waiting on the owner: someone in it has a hand up. */
function needs(key: string) {
  const ids = key.startsWith('a:') ? [key.slice(2)] : (() => {
    const t = teams.find((x) => x.id === key.slice(2));
    return t ? [t.manager, ...t.workers] : [];
  })();
  return approvals.some((p) => ids.includes(p.id)) || agents.some((a) => ids.includes(a.id) && !!a.status.pitch);
}

function zoom(key: string | null) {
  if (key === zoomed) return;
  animate(() => {
    zoomed = key;
    layout();
    renderTabs();
  });
  if (key) window.setTimeout(() => tiles.get(key)?.term.focus(), 30);
}

/** Tabs in order, so Alt + a number jumps to one, tmux style. */
let order: (string | null)[] = [null];

function tab(key: string | null, label: string, dot?: string, title?: string) {
  const b = el('button', `deck-tab${zoomed === key ? ' on' : ''}${key?.startsWith('t:') ? ' team' : ''}`);
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-selected', String(zoomed === key));
  const n = order.length;
  order.push(key);
  b.append(el('span', 'num', `${n}:`));
  if (dot) {
    const d = el('span', 'dot');
    d.style.background = dot;
    b.append(d);
  }
  b.append(el('span', undefined, label));
  if (zoomed === key) b.append(el('span', 'mark', '*'));
  if (key && needs(key)) b.append(el('b', 'flag', '!'));
  if (n < 10) title = `${title ?? label} (Alt+${n})`;
  if (title) b.title = title;
  b.onclick = () => zoom(key);
  return b;
}

let tabsKey = '';
function renderTabs() {
  const views = new Map(agents.map((a) => [a.id, a]));
  const key = JSON.stringify([zoomed, teams.map((t) => [t.id, t.name]), agents.map((a) => [a.id, a.name, a.activity, a.status.phase, !!a.status.pitch]), approvals.map((p) => p.id)]);
  if (key === tabsKey) return;
  tabsKey = key;
  order = [];
  const parts: HTMLElement[] = [tab(null, 'all', undefined, 'Every terminal at once')];
  if (teams.length) parts.push(el('span', 'deck-sep'));
  for (const t of inOrder(teams, (x) => `t:${x.id}`)) {
    const m = views.get(t.manager);
    parts.push(tab(`t:${t.id}`, t.name, m ? DOT[m.activity] : undefined, `${t.name}: message everyone in the group`));
  }
  if (agents.length) parts.push(el('span', 'deck-sep'));
  for (const a of inOrder(agents, (x) => `a:${x.id}`)) parts.push(tab(`a:${a.id}`, a.name, DOT[a.activity], `${a.name}: ${labelOf(a)}`));
  const tabs = byId('deck-tabs');
  tabs.replaceChildren(...parts);
  tabs.querySelector('.deck-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderStatus();
}

/** The bottom line, like tmux's: who's doing what, and the time. */
function renderStatus() {
  if (!on) return;
  const count = (f: (a: AgentView) => boolean) => agents.filter(f).length;
  const busy = count((a) => a.status.phase === 'work' || a.status.phase === 'research');
  const pitches = count((a) => !!a.status.pitch);
  const left = [`${agents.length} agent${agents.length === 1 ? '' : 's'}`, `${teams.length} group${teams.length === 1 ? '' : 's'}`, `${busy} busy`];
  if (pitches) left.push(`${pitches} pitch${pitches === 1 ? '' : 'es'} waiting`);
  if (approvals.length) left.push(`${approvals.length} need${approvals.length === 1 ? 's' : ''} you`);
  byId('deck-status-left').replaceChildren(el('b', undefined, '✻ office  '), left.join(' · '));
  byId('deck-status-right').textContent = `alt+n jump · esc back · ctrl+scroll zoom · t office   ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function setOn(next: boolean) {
  on = next;
  try {
    localStorage.setItem(KEY, on ? 'terminals' : 'office');
  } catch {
    // not remembered: fine
  }
  document.body.classList.toggle('deck-on', on);
  byId('view-toggle').classList.toggle('on', on);
  deck().hidden = !on;
  if (on) {
    // only terminals: the panels go away (the icons still open them) and come back on the way out
    stowed = NAMES.filter((n) => panels.isOpen(n));
    stowed.forEach((n) => panels.close(n));
    sync();
    return;
  }
  stowed.forEach((n) => panels.open(n));
  stowed = [];
  zoomed = null;
  for (const t of tiles.values()) {
    t.term.close();
    t.box.remove();
  }
  tiles.clear();
  tabsKey = '';
}

export function initDeck() {
  // the tab bar starts right of the icon bar, however wide that is
  const dockBar = byId('dock');
  new ResizeObserver(() => deck().style.setProperty('--dock-w', `${dockBar.offsetWidth}px`)).observe(dockBar);
  byId('view-toggle').onclick = () => setOn(!on);
  byId('deck-out').onclick = () => zoom(null);
  byId('deck-group').onclick = () => bus.emit('team:new');
  // the theme button names the theme it's on, and moves to the next
  const ICON: Record<TermTheme, string> = { normal: '◐ normal', purple: '▰ purple', night: '☾ night', light: '☀ light' };
  const themeBtn = byId('deck-theme');
  const showTheme = (t: TermTheme) => (themeBtn.textContent = ICON[t]);
  showTheme(savedTheme());
  themeBtn.onclick = () => bus.emit('theme', THEMES[(THEMES.indexOf(savedTheme()) + 1) % THEMES.length]);
  bus.on('theme', (t: TermTheme) => showTheme(t));
  bus.on('deck:out', () => zoom(null));
  // after everyone else has heard: a new group's terminal must already know the group, or it closes itself
  bus.on('agents', (views: AgentView[]) => {
    agents = views;
    queueMicrotask(sync);
  });
  bus.on('teams', (list: Team[]) => {
    teams = list;
    queueMicrotask(sync);
  });
  bus.on('approvals', (list: ApprovalView[]) => {
    approvals = list;
    if (!on) return;
    layout();
    renderTabs();
  });
  // "open their terminal" from anywhere zooms to it here
  bus.on('term:open', (id: string) => on && tiles.has(`a:${id}`) && zoom(`a:${id}`));
  bus.on('term:team', (id: string) => on && tiles.has(`t:${id}`) && zoom(`t:${id}`));

  // Ctrl + scroll: down zooms out, up zooms into the terminal under the mouse
  deck().addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY > 0) return zoom(null);
      const box = (e.target as HTMLElement).closest<HTMLElement>('.tile');
      if (box?.dataset.key) zoom(box.dataset.key);
    },
    { passive: false },
  );
  // T switches views (when not typing)
  window.setInterval(renderStatus, 15_000);
  window.addEventListener('keydown', (e) => {
    // Alt + number: straight to that tab, typing or not
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
    if (on && digit && e.altKey && !e.ctrlKey && !e.metaKey) {
      const n = Number(digit[1]);
      if (n < order.length) {
        e.preventDefault();
        zoom(order[n]);
      }
      return;
    }
    const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]');
    if (typing || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 't' || e.key === 'T') setOn(!on);
    else if (on && e.key === 'Escape' && zoomed) zoom(null);
  });

  let saved = 'office';
  try {
    saved = localStorage.getItem(KEY) ?? 'office';
  } catch {
    // first run
  }
  if (saved === 'terminals') setOn(true);
}
