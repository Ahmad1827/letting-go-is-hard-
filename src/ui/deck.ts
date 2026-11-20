import { bus } from '../bus';
import type { Team } from '../agents/types';
import { byId, el } from './dom';
import { DOT, labelOf, type AgentView, type ApprovalView } from './hud';
import { NAMES, panels, type PanelName } from './panels';
import { dockTerm, type Term } from './terminal';

/**
 * The terminal view: the office as nothing but terminals. Group terminals sit
 * in the top row (a message there goes to the whole group), everyone's own
 * terminal below. Click one to zoom in and work in it; Esc, the ⊖ button or
 * Ctrl + scroll down zooms back out. The tabs along the top jump straight to
 * any of them.
 */

const KEY = 'lgih.view';

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

/** Who and what should have a terminal, groups first. */
function wanted(): { key: string; agentId: string | null; teamId: string | null; row: 'groups' | 'people' }[] {
  return [
    ...teams.map((t) => ({ key: `t:${t.id}`, agentId: null, teamId: t.id, row: 'groups' as const })),
    ...agents.map((a) => ({ key: `a:${a.id}`, agentId: a.id, teamId: null, row: 'people' as const })),
  ];
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
    // in the overview a click anywhere on it zooms in
    box.addEventListener('click', () => zoomed !== w.key && zoom(w.key), true);
    byId(`deck-${w.row}`).append(box);
    tiles.set(w.key, { key: w.key, box, term: dockTerm(box, w.agentId, w.teamId) });
  }
  // keep them in the same order as the tabs, without moving the one being typed in
  for (const row of ['groups', 'people'] as const) {
    const parent = byId(`deck-${row}`);
    const order = want.filter((w) => w.row === row).map((w) => tiles.get(w.key)!.box);
    if (order.some((b, i) => parent.children[i] !== b)) parent.append(...order);
  }
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
  for (const row of ['groups', 'people'] as const) byId(`deck-${row}`).classList.toggle('has-big', !!zoomed && zoomed.startsWith(row === 'groups' ? 't:' : 'a:'));
  byId('deck-out').hidden = !zoomed;
}

/** Waiting on the owner: someone in it has a hand up. */
function needs(key: string) {
  const ids = key.startsWith('a:') ? [key.slice(2)] : (() => {
    const t = teams.find((x) => x.id === key.slice(2));
    return t ? [t.manager, ...t.workers] : [];
  })();
  return approvals.some((p) => ids.includes(p.id));
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

function tab(key: string | null, label: string, dot?: string, title?: string) {
  const b = el('button', `deck-tab${zoomed === key ? ' on' : ''}${key?.startsWith('t:') ? ' team' : ''}`);
  b.setAttribute('role', 'tab');
  b.setAttribute('aria-selected', String(zoomed === key));
  if (dot) {
    const d = el('span', 'dot');
    d.style.background = dot;
    b.append(d);
  }
  b.append(el('span', undefined, label));
  if (key && needs(key)) b.append(el('b', 'flag', '!'));
  if (title) b.title = title;
  b.onclick = () => zoom(key);
  return b;
}

let tabsKey = '';
function renderTabs() {
  const views = new Map(agents.map((a) => [a.id, a]));
  const key = JSON.stringify([zoomed, teams.map((t) => [t.id, t.name]), agents.map((a) => [a.id, a.name, a.activity, a.status.phase]), approvals.map((p) => p.id)]);
  if (key === tabsKey) return;
  tabsKey = key;
  const parts: HTMLElement[] = [tab(null, 'All terminals', undefined, 'Every terminal at once')];
  if (teams.length) parts.push(el('span', 'deck-sep'));
  for (const t of teams) {
    const m = views.get(t.manager);
    parts.push(tab(`t:${t.id}`, t.name, m ? DOT[m.activity] : undefined, `${t.name}: message everyone in the group`));
  }
  if (agents.length) parts.push(el('span', 'deck-sep'));
  for (const a of agents) parts.push(tab(`a:${a.id}`, a.name, DOT[a.activity], `${a.name}: ${labelOf(a)}`));
  const tabs = byId('deck-tabs');
  tabs.replaceChildren(...parts);
  tabs.querySelector('.deck-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
  bus.on('deck:out', () => zoom(null));
  bus.on('agents', (views: AgentView[]) => {
    agents = views;
    sync();
  });
  bus.on('teams', (list: Team[]) => {
    teams = list;
    sync();
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
  window.addEventListener('keydown', (e) => {
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
