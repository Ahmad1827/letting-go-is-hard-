import { BOSS_H, BOSS_SCREEN, BOSS_W, DESK_H, DESK_SCREEN, DESK_VARIANTS, DESK_W } from '../art/props';

/**
 * Floor plan of the whole 88th floor: a 40x27 grid of 48px tiles.
 *
 *   rows 0-2    window wall
 *   rows 3-8    archive | conference room | mainframe | your corner office
 *   row  9      wall with doorways
 *   rows 10-18  open-plan cubicles
 *   row  19     wall with doorways (the lobby is open to the floor)
 *   rows 20-25  break room | elevator lobby & reception | mail room
 *   row  26     bottom wall with the elevators
 */
export const TILE = 48;
export const COLS = 40;
export const ROWS = 27;
export const WIDTH = COLS * TILE;
export const HEIGHT = ROWS * TILE;
/** Rows hidden behind the window band at the top. */
export const BAND_ROWS = 3;

export type Facing = 'down' | 'up' | 'left' | 'right';
export interface Tile { x: number; y: number }
/** A place an agent can stand. `dy` nudges the sprite, e.g. to sit in a chair. */
export interface Spot extends Tile { face: Facing; dy?: number }

/** A static sprite, positioned by its bottom-center pixel. */
export interface Prop { key: string; x: number; y: number; anim?: string; depth?: number }

export interface Desk {
  id: number;
  seat: Spot;
  /** Top-left pixel of the monitor screen, and the depth to draw it at (just above its desk). */
  screen: { x: number; y: number; depth: number };
}

export interface Room { name: string; floor: string; x0: number; y0: number; x1: number; y1: number }

export const rooms: Room[] = [
  { name: 'Archive', floor: 'floor-grey', x0: 1, y0: 3, x1: 7, y1: 8 },
  { name: 'Conference', floor: 'floor-wood', x0: 9, y0: 3, x1: 18, y1: 8 },
  { name: 'Mainframe', floor: 'floor-raised', x0: 20, y0: 3, x1: 27, y1: 8 },
  { name: 'Corner office', floor: 'floor-parquet', x0: 29, y0: 3, x1: 38, y1: 8 },
  { name: 'Cubicles', floor: 'carpet', x0: 1, y0: 10, x1: 38, y1: 18 },
  { name: 'Break room', floor: 'lino', x0: 1, y0: 20, x1: 10, y1: 25 },
  { name: 'Lobby', floor: 'floor-marble', x0: 12, y0: 20, x1: 27, y1: 25 },
  { name: 'Mail room', floor: 'floor-vinyl', x0: 29, y0: 20, x1: 38, y1: 25 },
];

const solid: boolean[][] = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
/** Wall tiles, kept apart from furniture so the scene can draw them. */
export const walls: boolean[][] = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));

function block(x0: number, y0: number, x1 = x0, y1 = y0) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) solid[y][x] = true;
}

function wall(x0: number, y0: number, x1: number, y1: number, doors: number[] = []) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (doors.includes(x0 === x1 ? y : x)) continue;
      walls[y][x] = solid[y][x] = true;
    }
}

export const props: Prop[] = [];

/** Place a prop over a tile footprint and block those tiles. */
function place(key: string, x0: number, y0: number, x1 = x0, y1 = y0, anim?: string) {
  props.push({ key, x: (x0 + x1 + 1) * (TILE / 2), y: (y1 + 1) * TILE, anim });
  block(x0, y0, x1, y1);
}

/** A prop that doesn't block movement, like a rug or an empty chair at a spot. */
function decor(key: string, x: number, y: number, depth?: number) {
  props.push({ key, x, y, depth });
}

/**
 * Sitting: the person drops by SEAT_DY and the chair back, drawn in front of them,
 * hides everything below the waist.
 */
const SEAT_DY = 12;
const SEAT_CHAIR_Y = 56;

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------------------------------------------------------------- walls

block(0, 0, COLS - 1, BAND_ROWS - 1);
wall(0, BAND_ROWS, 0, ROWS - 1);
wall(COLS - 1, BAND_ROWS, COLS - 1, ROWS - 1);
export const ELEVATORS: Tile[] = [{ x: 17, y: ROWS - 1 }, { x: 22, y: ROWS - 1 }];
wall(0, ROWS - 1, COLS - 1, ROWS - 1, ELEVATORS.map((e) => e.x));
// top rooms
for (const x of [8, 19, 28]) wall(x, BAND_ROWS, x, 8);
wall(1, 9, 38, 9, [4, 5, 13, 14, 23, 33, 34]);
// bottom rooms, the lobby open to the floor
wall(1, 19, 38, 19, [5, 6, ...range(15, 24), 33, 34]);
for (const x of [11, 28]) wall(x, 20, x, 25);

// ---------------------------------------------------------------- archive

place('shelf', 1, 3, 2, 3);
place('shelf2', 3, 3, 4, 3);
for (const x of [5, 6, 7]) place('cabinet', x, 3);
place('shelf2', 2, 6, 3, 6);
place('shelf', 5, 6, 6, 6);
place('plant', 7, 8);

// ---------------------------------------------------------------- conference room

place('conftable', 11, 5, 16, 6);
place('flipchart', 9, 3);
place('plant2', 18, 3);
place('tvcart', 18, 8);
const confTop = range(12, 15), confBottom = range(12, 15);
for (const x of confTop) decor('cchairF', x * TILE + TILE / 2, 4 * TILE + 36, 4 * TILE + 30);
for (const x of confBottom) decor('cchair', x * TILE + TILE / 2, 7 * TILE + SEAT_CHAIR_Y);

// ---------------------------------------------------------------- mainframe

range(20, 27).forEach((x, i) => place(i % 3 === 1 ? 'tape' : 'rack', x, 3, x, 3, i % 3 === 1 ? 'tape-spin' : 'rack-blink'));
range(21, 25).forEach((x, i) => place(i % 2 ? 'tape' : 'rack', x, 6, x, 6, i % 2 ? 'tape-spin' : 'rack-blink'));
place('acunit', 27, 6);
place('console', 20, 8, 21, 8);

// ---------------------------------------------------------------- corner office

decor('rug', 33.5 * TILE, 8 * TILE + 24, -8);
place('bossdesk', 32, 5, 34, 5);
decor('bosschair', 33 * TILE + TILE / 2, 5 * TILE - 6);
block(33, 4);
place('shelf', 37, 3, 38, 3);
place('plant2', 29, 3);
place('plant', 36, 3);
place('sofa', 36, 6, 38, 6);
place('coffeetable', 36, 7, 37, 7);
place('plant', 38, 8);
decor('plaque', 35 * TILE + 24, 9 * TILE + 32, 10 * TILE + 1);
export const BOSS_MONITOR = {
  x: 33 * TILE + TILE / 2 - BOSS_W / 2 + BOSS_SCREEN.x,
  y: 6 * TILE - BOSS_H + BOSS_SCREEN.y,
  depth: 6 * TILE + 0.1,
};

// ---------------------------------------------------------------- cubicles

export const desks: Desk[] = [];
for (const row of [11, 15]) {
  for (const col of [3, 7, 11, 26, 30, 34]) {
    place(`desk${desks.length % DESK_VARIANTS}`, col - 1, row, col + 1, row);
    // the chair tile is blocked for passers-by; only the owner path-finds into it
    block(col, row + 1);
    decor('chair', col * TILE + TILE / 2, (row + 1) * TILE + SEAT_CHAIR_Y);
    desks.push({
      id: desks.length,
      seat: { x: col, y: row + 1, face: 'up', dy: SEAT_DY },
      screen: {
        x: col * TILE + TILE / 2 - DESK_W / 2 + DESK_SCREEN.x,
        y: (row + 1) * TILE - DESK_H + DESK_SCREEN.y,
        depth: (row + 1) * TILE + 0.1,
      },
    });
  }
}
place('plant2', 16, 10);
place('plant', 21, 10);
// a filing island in the middle of the floor
for (const x of [18, 19, 20]) place('cabinet', x, 14);
place('plant', 17, 14);
place('plant2', 21, 14);
place('cooler', 14, 16);
place('copier', 23, 16);
place('plant', 1, 18);
place('plant2', 38, 18);

// ---------------------------------------------------------------- break room

place('kitchen', 1, 20, 4, 20);
place('fridge', 7, 20);
place('vending', 8, 20);
place('cooler', 9, 20);
place('roundtable', 2, 23, 3, 23);
place('roundtable', 7, 23, 8, 23);
place('plant2', 10, 25);

// ---------------------------------------------------------------- lobby

place('reception', 18, 21, 21, 21);
place('lobbysofa', 12, 24, 14, 24);
place('plant', 12, 20);
place('plant2', 27, 20);
place('plant', 15, 25);
place('plant', 24, 25);
place('lobbysofa', 25, 24, 27, 24);

// ---------------------------------------------------------------- mail room

place('copier', 29, 20);
place('fax', 30, 20);
place('cubbies', 36, 20, 37, 20);
place('table', 32, 23, 34, 23);
export const OUTBOX = { left: 33.5 * TILE - 64, top: 24 * TILE - 40 };
place('plant', 38, 25);

// ---------------------------------------------------------------- where agents go

const row = (y: number, xs: number[], face: Facing, dy?: number): Spot[] => xs.map((x) => ({ x, y, face, dy }));
export const spots = {
  archive: [...row(4, range(1, 7), 'up'), ...row(7, [2, 3, 5, 6], 'up')],
  server: [...row(4, range(20, 27), 'up'), ...row(7, range(21, 25), 'up')],
  /** Around the conference table, where planning happens. */
  conference: [...row(7, confBottom, 'up', SEAT_DY), { x: 10, y: 4, face: 'down' }, { x: 17, y: 4, face: 'down' }] as Spot[],
  /** In front of the owner's desk, where ideas get pitched. */
  pitch: { x: 33, y: 6, face: 'up' } as Spot,
  /** The line outside the owner's door; whoever is first goes in next. */
  line: row(10, [32, 31, 30], 'right'),
  outbox: row(22, [33, 32, 34], 'down'),
  lounge: [
    { x: 1, y: 23, face: 'right' },
    { x: 4, y: 23, face: 'left' },
    { x: 6, y: 23, face: 'right' },
    { x: 9, y: 23, face: 'left' },
    { x: 3, y: 21, face: 'up' },
    { x: 7, y: 21, face: 'up' },
    { x: 5, y: 25, face: 'up' },
  ] as Spot[],
  /** Floor area the idle agents drift around in. */
  loungeCenter: { x: 5, y: 22 } as Tile,
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
