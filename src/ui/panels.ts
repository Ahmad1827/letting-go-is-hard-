import { bus } from '../bus';
import { byId } from './dom';

/**
 * The panels are small windows floating over the office: drag them by the
 * title, minimize them to just the title, close them. An icon bar in the top
 * left corner opens them (and folds away). Where each window sits, whether
 * it's minimized and which are open are remembered between runs.
 */

export type PanelName = 'staff' | 'office' | 'requests' | 'agent' | 'usage' | 'music';

const NAMES: PanelName[] = ['staff', 'office', 'requests', 'agent', 'usage', 'music'];
const KEY = 'lgih.windows';
/** Matches the close animation in style.css. */
const CLOSE_MS = 200;
const WIDTHS: Record<PanelName, number> = { staff: 340, office: 360, requests: 340, agent: 380, usage: 380, music: 260 };
/** How much of a window has to stay on screen when it's dragged off the edge. */
const KEEP = 80;

/** 12x11 pixel icons for the rail; # is a lit pixel. */
const ICONS: Record<string, string[]> = {
  staff: [
    '............',
    '..##....##..',
    '.####..####.',
    '.####..####.',
    '..##....##..',
    '............',
    '.####..####.',
    '############',
    '############',
    '############',
    '............',
  ],
  office: [
    '..########..',
    '..#......#..',
    '..#.####.#..',
    '..#......#..',
    '..#......#..',
    '..#....#.#..',
    '..#......#..',
    '..#......#..',
    '..#......#..',
    '############',
    '............',
  ],
  requests: [
    '.....##.....',
    '....####....',
    '....####....',
    '....####....',
    '.....##.....',
    '.....##.....',
    '............',
    '.....##.....',
    '....####....',
    '.....##.....',
    '............',
  ],
  agent: [
    '............',
    '############',
    '#..........#',
    '#.###......#',
    '#.###.####.#',
    '#.###......#',
    '#.###.###..#',
    '#..........#',
    '############',
    '............',
    '............',
  ],
  usage: [
    '............',
    '.........##.',
    '.........##.',
    '......##.##.',
    '......##.##.',
    '...##.##.##.',
    '...##.##.##.',
    '##.##.##.##.',
    '##.##.##.##.',
    '############',
    '............',
  ],
  music: [
    '....########',
    '....########',
    '....#......#',
    '....#......#',
    '....#......#',
    '..###....###',
    '.####...####',
    '.####...####',
    '..##.....##.',
    '............',
    '............',
  ],
  board: [
    '############',
    '#..........#',
    '#.###..##..#',
    '#.###..##..#',
    '#..........#',
    '#..##.###..#',
    '#..##.###..#',
    '#..........#',
    '############',
    '..#......#..',
    '..#......#..',
  ],
  settings: [
    '.....##.....',
    '..#.####.#..',
    '..########..',
    '...##..##...',
    '.###....###.',
    '.###....###.',
    '...##..##...',
    '..########..',
    '..#.####.#..',
    '.....##.....',
    '............',
  ],
  power: [
    '.....##.....',
    '..#..##..#..',
    '.##..##..##.',
    '##...##...##',
    '##........##',
    '##........##',
    '.##......##.',
    '..##....##..',
    '...######...',
    '............',
    '............',
  ],
  menu: [
    '............',
    '############',
    '############',
    '............',
    '............',
    '############',
    '############',
    '............',
    '............',
    '############',
    '############',
  ],
  fit: [
    '###......###',
    '##........##',
    '#.#......#.#',
    '............',
    '............',
    '............',
    '............',
    '#.#......#.#',
    '##........##',
    '###......###',
    '............',
  ],
};

function icon(name: string) {
  const rows = ICONS[name];
  if (!rows) return '';
  const rects = rows.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ''))).join('');
  return `<svg viewBox="0 0 12 11" width="24" height="22" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

interface Place { x: number; y: number; min: boolean }

interface Memory { open: PanelName[]; places: Partial<Record<PanelName, Place>>; dock: boolean }

let memory: Memory = { open: ['staff', 'office'], places: {}, dock: true };
const open = new Set<PanelName>();
const closing = new Map<PanelName, number>();
let top = 20;

function remember() {
  memory.open = [...open];
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // not remembered: fine
  }
}

/** Where a window goes the first time: staff on the left, pitches in the middle, the agent on the right. */
function firstPlace(name: PanelName): Place {
  const w = innerWidth, mid = (w - WIDTHS[name]) / 2;
  const at: Record<PanelName, [number, number]> = {
    staff: [12, 64], office: [mid, 12], requests: [mid, 300], agent: [w - WIDTHS.agent - 12, 12], usage: [12, 420], music: [12, 620],
  };
  const [x, y] = at[name];
  return { x, y, min: false };
}

const win = (name: PanelName) => byId(`panel-${name}`);
const place = (name: PanelName) => (memory.places[name] ??= firstPlace(name));

/** Keep at least a grab-able part of the window on screen. */
function clamp(p: Place, el: HTMLElement) {
  p.x = Math.round(Math.min(Math.max(p.x, KEEP - el.offsetWidth), innerWidth - KEEP));
  p.y = Math.round(Math.min(Math.max(p.y, 0), innerHeight - 36));
}

function put(name: PanelName) {
  const el = win(name), p = place(name);
  clamp(p, el);
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  el.classList.toggle('min', p.min);
}

function front(name: PanelName) {
  win(name).style.zIndex = String(++top);
  for (const n of NAMES) win(n).classList.toggle('front', n === name);
}

const isFront = (name: PanelName) => win(name).classList.contains('front');

/** Grow out of (and shrink back into) the icon that opens the window. */
function originAt(name: PanelName) {
  const el = win(name), icon = byId(`tab-${name}`).getBoundingClientRect(), p = place(name);
  const from = byId('dock').classList.contains('collapsed') ? byId('dock-toggle').getBoundingClientRect() : icon;
  el.style.transformOrigin = `${from.left + from.width / 2 - p.x}px ${from.top + from.height / 2 - p.y}px`;
}

export const panels = {
  isOpen: (name: PanelName) => open.has(name),

  /** Open it, or if it's already open bring it to the front and unfold it. */
  open(name: PanelName) {
    const el = win(name);
    if (open.has(name)) {
      if (place(name).min) panels.minimize(name, false);
      front(name);
      return;
    }
    window.clearTimeout(closing.get(name));
    closing.delete(name);
    el.classList.remove('closing');
    el.style.width = `${WIDTHS[name]}px`;
    el.hidden = false;
    put(name);
    originAt(name);
    front(name);
    open.add(name);
    byId(`tab-${name}`).classList.add('on');
    remember();
    bus.emit('panel', name, true);
  },

  close(name: PanelName) {
    if (!open.has(name)) return;
    const el = win(name);
    open.delete(name);
    byId(`tab-${name}`).classList.remove('on');
    originAt(name);
    el.classList.add('closing');
    closing.set(name, window.setTimeout(() => {
      el.hidden = true;
      el.classList.remove('closing');
      closing.delete(name);
    }, CLOSE_MS));
    remember();
    bus.emit('panel', name, false);
  },

  minimize(name: PanelName, min = !place(name).min) {
    place(name).min = min;
    win(name).classList.toggle('min', min);
    remember();
  },

  /** A click on its icon: open it, unfold it, bring it forward, or (if it's already in front) close it. */
  toggle(name: PanelName) {
    if (!open.has(name)) panels.open(name);
    else if (place(name).min || !isFront(name)) panels.open(name);
    else panels.close(name);
  },
};

/** Drag a window around by its title bar. */
function draggable(name: PanelName) {
  const el = win(name);
  const bar = el.querySelector('header')!;
  el.addEventListener('pointerdown', () => front(name));
  bar.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
    const p = place(name), sx = e.clientX - p.x, sy = e.clientY - p.y;
    bar.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      p.x = ev.clientX - sx;
      p.y = ev.clientY - sy;
      put(name);
    };
    const up = () => {
      el.classList.remove('dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      remember();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
  // double-click the title to fold it up, like an old window shade
  bar.addEventListener('dblclick', (e) => {
    if (!(e.target as HTMLElement).closest('button')) panels.minimize(name);
  });
}

export function initPanels() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Memory | null;
    if (saved && Array.isArray(saved.open)) memory = { ...memory, ...saved, open: saved.open.filter((n) => NAMES.includes(n)) };
  } catch {
    // first run: the defaults
  }
  for (const i of document.querySelectorAll<HTMLElement>('[data-icon]')) i.innerHTML = icon(i.dataset.icon!);
  for (const name of NAMES) {
    // the body folds away when minimized
    const el = win(name), fold = document.createElement('div');
    fold.className = 'fold';
    fold.append(...[...el.children].filter((c) => c.tagName !== 'HEADER'));
    el.append(fold);
    draggable(name);
  }
  for (const tab of document.querySelectorAll<HTMLElement>('.tab[data-panel]')) tab.onclick = () => panels.toggle(tab.dataset.panel as PanelName);
  for (const x of document.querySelectorAll<HTMLElement>('[data-close]')) x.onclick = () => panels.close(x.dataset.close as PanelName);
  for (const x of document.querySelectorAll<HTMLElement>('[data-min]')) x.onclick = () => panels.minimize(x.dataset.min as PanelName);
  byId('board-open').onclick = () => bus.emit('board:open');
  byId('settings-open').onclick = () => bus.emit('settings:open');
  byId('power').onclick = () => bus.emit('app:close');

  const dock = byId('dock');
  dock.classList.toggle('collapsed', !memory.dock);
  byId('dock-toggle').onclick = () => {
    memory.dock = !memory.dock;
    dock.classList.toggle('collapsed', !memory.dock);
    remember();
  };

  memory.open.forEach((n) => panels.open(n));
  window.addEventListener('resize', () => open.forEach(put));

  // Escape closes the topmost popup
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const pop = [...document.querySelectorAll<HTMLElement>('.modal')].find((m) => !m.hidden);
    if (pop) pop.hidden = true;
  });
}

const counts: Record<string, [number, boolean]> = {};

/** A number on an icon (people waiting, requests); 0 hides it. The folded bar shows the total. */
export function badge(tab: string, n: number, alert = false) {
  const set = (button: HTMLElement, count: number, on: boolean) => {
    const b = button.querySelector<HTMLElement>('.badge')!;
    b.hidden = count <= 0;
    b.textContent = count > 9 ? '9+' : String(count);
    button.classList.toggle('alert', on);
  };
  counts[tab] = [n, alert];
  set(byId(`tab-${tab}`), n, alert);
  const all = Object.values(counts);
  set(byId('dock-toggle'), all.reduce((t, [c]) => t + c, 0), all.some(([, a]) => a));
}
