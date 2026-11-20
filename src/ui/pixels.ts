/**
 * The app's themes (terminals, panels and the view out of the office window
 * all follow them), and a little pixel-art picture for each, shown in the
 * terminals' welcome box:
 * a moon and stars at night, the sun in the light theme, the sun peeking out
 * from behind a cloud in the normal one, a sunset over the sea in purple, a
 * floppy disk in retro. Drawn on a 16×16 grid as SVG squares,
 * so they stay crisp at any size.
 */

export type TermTheme = 'normal' | 'night' | 'light' | 'purple' | 'retro';

export const THEMES: TermTheme[] = ['normal', 'purple', 'night', 'light', 'retro'];

/** How each theme is described in Settings. */
export const THEME_LABEL: Record<TermTheme, string> = {
  normal: 'Normal: Claude Code dark, the city at night',
  purple: 'Purple: Windows Terminal (Ubuntu) colours, at dusk',
  night: 'Night: deep blue, lights low, the moon out',
  light: 'Light: Claude Code light, in daylight',
  retro: 'Retro: Windows 95 and cmd.exe, in daylight',
};

/** What the city outside the office window looks like in each theme. */
export const SKY: Record<TermTheme, 'day' | 'dusk' | 'night'> = { normal: 'night', purple: 'dusk', night: 'night', light: 'day', retro: 'day' };

const N = 16;
const SVG = 'http://www.w3.org/2000/svg';

type Grid = (string | null)[][];

const blank = (): Grid => Array.from({ length: N }, () => Array<string | null>(N).fill(null));
const inDisk = (x: number, y: number, cx: number, cy: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function paintDisk(g: Grid, cx: number, cy: number, r: number, fill: string, edge?: string) {
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inDisk(x, y, cx, cy, r)) continue;
      // the outermost pixels of the disk get the edge colour
      const rim = edge && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inDisk(x + dx, y + dy, cx, cy, r));
      g[y][x] = rim ? edge! : fill;
    }
}

function sun(g: Grid, cx: number, cy: number, r: number, rays: number) {
  paintDisk(g, cx, cy, r, '#ffd84a', '#f39c12');
  // highlight
  const hx = Math.round(cx - r / 2), hy = Math.round(cy - r / 2);
  if (g[hy]?.[hx]) g[hy][hx] = '#fff6c2';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    for (const d of [r + 2, r + 3].slice(0, rays)) {
      const x = Math.round(cx + Math.cos(a) * d), y = Math.round(cy + Math.sin(a) * d);
      if (x >= 0 && y >= 0 && x < N && y < N && !g[y][x]) g[y][x] = '#ffc21a';
    }
  }
}

function moon(): Grid {
  const g = blank();
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inDisk(x, y, 7, 8, 5.6) || inDisk(x, y, 9.6, 6.4, 4.8)) continue;
      const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inDisk(x + dx, y + dy, 7, 8, 5.6) || inDisk(x + dx, y + dy, 9.6, 6.4, 4.8));
      g[y][x] = rim ? '#c9b77a' : '#f6ecc0';
    }
  // a couple of craters
  for (const [x, y] of [[3, 9], [4, 11]]) if (g[y][x]) g[y][x] = '#d9c98f';
  return g;
}

function cloud(g: Grid) {
  const puffs: [number, number, number][] = [[5, 11, 2.6], [8.5, 10, 3.2], [12, 11.2, 2.4]];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const inside = (px: number, py: number) => py <= 13 && puffs.some(([cx, cy, r]) => inDisk(px, py, cx, cy, r));
      if (!inside(x, y)) continue;
      const rim = !inside(x, y + 1) || !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y - 1);
      g[y][x] = rim ? '#aab4c3' : y > 11 ? '#dfe5ee' : '#ffffff';
    }
}

/** The sun going down into the sea, its light in stripes on the water. */
function sunset(): Grid {
  const g = blank();
  const sea = 10;
  const bands = ['#ffe08a', '#ffc15e', '#ff9a4d', '#ff7155', '#f2547a'];
  for (let y = 0; y < sea; y++)
    for (let x = 0; x < N; x++) if (inDisk(x, y, 7.5, sea, 5.5)) g[y][x] = bands[Math.min(bands.length - 1, Math.max(0, y - 4))];
  for (let x = 0; x < N; x++) g[sea][x] = '#c2448a';
  // the reflection: shorter stripes the further down
  for (const [y, half, c] of [[11, 4, '#ff9a4d'], [12, 3, '#f2547a'], [13, 2, '#c2448a'], [14, 1, '#8a2f78']] as [number, number, string][])
    for (let x = Math.round(7.5 - half); x <= Math.round(7.5 + half); x += 2) g[y][x] = c;
  return g;
}

/** A 3½-inch floppy disk. */
function floppy(): Grid {
  const g = blank();
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c;
  };
  fill(2, 2, 13, 13, '#1d3b8a');
  fill(2, 13, 13, 13, '#132a66');
  fill(13, 2, 13, 13, '#132a66');
  g[2][13] = null; // the cut corner
  fill(5, 2, 10, 6, '#c8ccd2'); // metal shutter
  fill(8, 3, 9, 5, '#5a606a');
  fill(4, 8, 11, 13, '#f4f1e6'); // label
  for (const y of [10, 12]) fill(5, y, 10, y, '#9aa3c0');
  g[12][3] = '#000000'; // write-protect hole
  return g;
}

/** Stars that twinkle (night only). */
const STARS: [number, number][] = [[13, 2], [11, 12], [14, 8], [2, 2]];

function grid(theme: TermTheme): Grid {
  if (theme === 'night') return moon();
  if (theme === 'purple') return sunset();
  if (theme === 'retro') return floppy();
  const g = blank();
  if (theme === 'light') sun(g, 7.5, 7.5, 3.6, 2);
  else {
    sun(g, 6, 6, 3.4, 1);
    cloud(g);
  }
  return g;
}

/** The picture for a theme, `size` pixels square. */
export function pixelArt(theme: TermTheme, size = 48): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${N} ${N}`);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('pixel-art', `pixel-${theme}`);
  const g = grid(theme);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!g[y][x]) continue;
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      r.setAttribute('fill', g[y][x]!);
      svg.append(r);
    }
  if (theme === 'night')
    STARS.forEach(([x, y], i) => {
      const r = document.createElementNS(SVG, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      r.setAttribute('fill', '#fff8d6');
      r.classList.add('star');
      r.style.animationDelay = `${i * 0.7}s`;
      svg.append(r);
    });
  return svg;
}

const KEY = 'lgih.theme';

export function savedTheme(): TermTheme {
  try {
    const t = localStorage.getItem(KEY) as TermTheme | null;
    return t && THEMES.includes(t) ? t : 'normal';
  } catch {
    return 'normal';
  }
}

/** Switch every terminal (and the terminal view) to a theme, and remember it. */
export function setTheme(theme: TermTheme) {
  document.body.dataset.termTheme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // not remembered: fine
  }
}
