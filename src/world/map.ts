/**
 * Floor plan of the office: a 30x17 grid of 16px tiles.
 *
 *   rows 0-3   window wall (archive on the left, mainframe on the right)
 *   rows 4-15  open floor: two rows of cubicles, kitchenette, your corner office, outbox
 *   row 16     bottom wall with the elevator door
 */
export const TILE = 16;
export const COLS = 30;
export const ROWS = 17;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;

export type Facing = 'down' | 'up' | 'left' | 'right';
export interface Tile { x: number; y: number }
/** A place an agent can stand. `dy` nudges the sprite, e.g. to sit in a chair. */
export interface Spot extends Tile { face: Facing; dy?: number }

/** A static sprite, positioned by its bottom-center pixel. */
export interface Prop { key: string; x: number; y: number; anim?: string }

export interface Desk {
  id: number;
  seat: Spot;
  /** Top-left pixel of the 12x9 monitor screen. */
  screen: { x: number; y: number };
}

const solid: boolean[][] = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));

function block(x0: number, y0: number, x1 = x0, y1 = y0) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) solid[y][x] = true;
}

export const props: Prop[] = [];

/** Place a prop over a tile footprint and block those tiles. */
function place(key: string, x0: number, y0: number, x1 = x0, y1 = y0, anim?: string) {
  props.push({ key, x: (x0 + x1 + 1) * (TILE / 2), y: (y1 + 1) * TILE, anim });
  block(x0, y0, x1, y1);
}

// walls
block(0, 0, COLS - 1, 3);
block(0, 4, 0, ROWS - 1);
block(COLS - 1, 4, COLS - 1, ROWS - 1);
block(0, ROWS - 1, COLS - 1, ROWS - 1);
export const ELEVATOR: Tile = { x: 8, y: ROWS - 1 };
solid[ELEVATOR.y][ELEVATOR.x] = false;

// cubicles: 2 rows x 4 desks, each desk 3 tiles wide with the chair below its middle
export const desks: Desk[] = [];
for (const row of [7, 11]) {
  for (const col of [8, 12, 16, 20]) {
    place('desk', col - 1, row, col + 1, row);
    // the chair tile is blocked for passers-by; only the owner path-finds into it
    block(col, row + 1);
    props.push({ key: 'chair', x: col * TILE + 8, y: (row + 1) * TILE + 15 });
    desks.push({
      id: desks.length,
      seat: { x: col, y: row + 1, face: 'up', dy: -3 },
      screen: { x: col * TILE + 8 - 24 + 18, y: (row + 1) * TILE - 32 + 6 },
    });
  }
}

// archive (top left)
place('shelf', 1, 4, 2, 4);
for (const col of [3, 4, 5]) place('cabinet', col, 4);
place('plant', 6, 4);

// mainframe (top right)
place('plant', 23, 4);
[24, 25, 26, 27, 28].forEach((col, i) => place(i % 2 ? 'tape' : 'rack', col, 4, col, 4, i % 2 ? 'tape-spin' : 'rack-blink'));
place('copier', 28, 9);

// kitchenette (bottom left)
place('cooler', 1, 10);
place('counter', 1, 12, 1, 13);
place('plant', 1, 15);

// your corner office (bottom right)
place('bossdesk', 24, 13, 26, 13);
props.push({ key: 'bosschair', x: 25 * TILE + 8, y: 15 * TILE - 1 });
block(25, 14);
place('plant', 28, 15);
export const BOSS_SCREEN = { x: 25 * TILE + 8 - 28 + 23, y: 14 * TILE - 30 + 2 };

// outbox (bottom middle)
place('table', 13, 15, 16, 15);
export const OUTBOX = { left: 15 * TILE - 32, top: 16 * TILE - 20 };

const row = (y: number, xs: number[], face: Facing): Spot[] => xs.map((x) => ({ x, y, face }));
export const spots = {
  archive: row(5, [1, 2, 3, 4, 5], 'up'),
  server: row(5, [24, 25, 26, 27, 28], 'up'),
  approval: row(12, [25, 24, 26, 23, 27], 'down'),
  outbox: row(14, [14, 15, 13, 16], 'down'),
  lounge: [
    { x: 2, y: 10, face: 'left' },
    { x: 2, y: 12, face: 'left' },
    { x: 4, y: 11, face: 'left' },
    { x: 3, y: 14, face: 'up' },
    { x: 5, y: 13, face: 'left' },
  ] as Spot[],
  /** Floor area the idle agents drift around in. */
  loungeCenter: { x: 3, y: 12 } as Tile,
};

export function walkable(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS && !solid[y][x];
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Breadth-first path from `from` to `to` (exclusive of start). The goal may be a blocked tile, like a chair. */
export function findPath(from: Tile, to: Tile): Tile[] | null {
  const key = (x: number, y: number) => y * COLS + x;
  const start = key(from.x, from.y), goal = key(to.x, to.y);
  const prev = new Map<number, number>([[start, -1]]);
  const queue = [start];
  for (let i = 0; i < queue.length && !prev.has(goal); i++) {
    const cx = queue[i] % COLS, cy = Math.floor(queue[i] / COLS);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy, nk = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || prev.has(nk)) continue;
      if (solid[ny][nx] && nk !== goal) continue;
      prev.set(nk, queue[i]);
      queue.push(nk);
    }
  }
  if (!prev.has(goal)) return null;
  const path: Tile[] = [];
  for (let k = goal; k !== start; k = prev.get(k)!) path.unshift({ x: k % COLS, y: Math.floor(k / COLS) });
  return path;
}

/** A random open floor tile within `r` steps of `center`. */
export function randomNear(center: Tile, r: number): Tile | null {
  const options: Tile[] = [];
  for (let y = center.y - r; y <= center.y + r; y++)
    for (let x = center.x - r; x <= center.x + r; x++)
      if (y < ROWS - 1 && walkable(x, y) && Math.abs(x - center.x) + Math.abs(y - center.y) <= r) options.push({ x, y });
  return options.length ? options[Math.floor(Math.random() * options.length)] : null;
}
