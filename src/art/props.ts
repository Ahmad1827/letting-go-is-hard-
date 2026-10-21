import Phaser from 'phaser';
import { OWNER } from '../owner';
import { bevel, disc, dither, floorShadow, loop, mix, pick, rng, shade, sheet, single, speckle, type R } from './draw';

const BEIGE = '#e0d8c0';
const BEIGE_SHADE = '#b8ae94';
const BEIGE_DARK = '#8a8270';
const BEZEL = '#3a3730';

/** 3x5 pixel letters for labels painted into the art. */
const FONT: Record<string, string> = {
  O: '111101101101111', U: '101101101101111', T: '111010010010010', B: '110101110101110', S: '111100111001111',
  I: '111010010010111', N: '101111111111101', '8': '111101111101111',
  A: '010101111101101', H: '101101111101101', M: '101111111101101', D: '110101101101110',
};

/** Pixel letters, `scale` pixels per dot. */
export function text(r: R, x: number, y: number, s: string, color: string, scale = 1) {
  [...s].forEach((ch, i) => {
    const bits = FONT[ch];
    if (bits) for (let k = 0; k < 15; k++) if (bits[k] === '1') r(x + (i * 4 + (k % 3)) * scale, y + Math.floor(k / 3) * scale, scale, scale, color);
  });
}

/** Width in pixels of `s` drawn by text() at `scale`. */
export const textWidth = (s: string, scale = 1) => (s.length * 4 - 1) * scale;

/** A classic 5x7 font for signs, where the 3x5 one is too cramped (its M looks like an H). */
const BIG: Record<string, string> = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001', I: '01110001000010000100001000010001110',
  J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001', O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
};

export function bigText(r: R, x: number, y: number, s: string, color: string, scale = 1) {
  [...s].forEach((ch, i) => {
    const bits = BIG[ch];
    if (bits) for (let k = 0; k < 35; k++) if (bits[k] === '1') r(x + (i * 6 + (k % 5)) * scale, y + Math.floor(k / 5) * scale, scale, scale, color);
  });
}

export const bigTextWidth = (s: string, scale = 1) => (s.length * 6 - 1) * scale;

export const SCREEN_W = 24;
export const SCREEN_H = 18;

/** A beige CRT with its 24x18 screen at (sx, sy). The screen itself is a separate animated sprite. */
function crt(r: R, sx: number, sy: number) {
  // body and the deep back of the tube, seen a little from above
  r(sx - 2, sy - 7, 28, 3, BEIGE_SHADE); r(sx, sy - 8, 24, 1, BEIGE_SHADE);
  for (let x = sx + 2; x < sx + 22; x += 3) r(x, sy - 7, 2, 1, BEIGE_DARK);
  bevel(r, sx - 5, sy - 5, 34, 28, BEIGE, 0.2);
  r(sx + 29, sy - 3, 2, 24, BEIGE_SHADE);
  // recessed bezel around the glass
  r(sx - 2, sy - 2, 28, 22, BEIGE_DARK); r(sx - 2, sy - 2, 28, 1, shade(BEIGE_DARK, -0.25)); r(sx - 2, sy - 2, 1, 22, shade(BEIGE_DARK, -0.15));
  r(sx - 1, sy + 19, 26, 1, shade(BEIGE, 0.2));
  r(sx, sy, SCREEN_W, SCREEN_H, '#101510');
  // badge, power button and LED along the chin
  r(sx + 1, sy + 20, 5, 1, BEIGE_DARK);
  r(sx + 19, sy + 20, 3, 2, BEIGE_SHADE); r(sx + 23, sy + 20, 2, 1, '#5f5');
  // swivel stand
  r(sx + 6, sy + 23, 12, 2, BEIGE_SHADE); r(sx + 3, sy + 25, 18, 3, BEIGE); r(sx + 3, sy + 27, 18, 1, BEIGE_DARK);
}

function keyboard(r: R, x: number, y: number) {
  r(x, y, 34, 8, BEIGE); r(x, y, 34, 1, shade(BEIGE, 0.25)); r(x, y + 7, 34, 1, BEIGE_DARK); r(x + 33, y, 1, 8, BEIGE_SHADE);
  for (let row = 0; row < 3; row++)
    for (let k = 0; k < 13; k++) r(x + 2 + k * 2 + (row % 2), y + 2 + row * 2, 1, 1, k === 12 && row === 0 ? '#c0a060' : BEIGE_DARK);
  r(x + 8, y + 6, 14, 1, BEIGE_SHADE); // space bar
}

function mouse(r: R, x: number, y: number) {
  r(x - 1, y - 1, 10, 9, '#3a3a48'); r(x - 1, y - 1, 10, 1, '#4e4e60'); // mouse pad
  r(x + 2, y + 1, 4, 6, BEIGE); r(x + 2, y + 1, 4, 1, shade(BEIGE, 0.3)); r(x + 4, y + 1, 1, 2, BEIGE_DARK); r(x + 5, y + 2, 1, 5, BEIGE_SHADE);
  r(x + 3, y - 2, 1, 3, '#555'); r(x + 2, y - 3, 1, 1, '#555');
}

function mug(r: R, x: number, y: number, color: string) {
  r(x, y, 5, 6, color); r(x, y, 1, 6, shade(color, 0.3)); r(x + 4, y, 1, 6, shade(color, -0.3));
  r(x + 5, y + 1, 2, 1, color); r(x + 6, y + 2, 1, 2, color); r(x + 5, y + 4, 2, 1, color);
  r(x + 1, y, 3, 1, '#4a2a14');
  r(x + 1, y - 2, 1, 1, 'rgba(255,255,255,0.5)'); r(x + 2, y - 3, 1, 1, 'rgba(255,255,255,0.35)');
}

function papers(r: R, x: number, y: number, rnd: () => number) {
  r(x + 1, y + 1, 11, 9, '#d8d3c4');
  r(x, y, 11, 9, '#f6f3ea');
  for (let l = 0; l < 4; l++) r(x + 1, y + 2 + l * 2, 4 + Math.floor(rnd() * 6), 1, '#a8a8b8');
}

function pinned(r: R, x: number, y: number, w: number, h: number, paper: string) {
  r(x + 1, y + 1, w, h, 'rgba(0,0,0,0.2)');
  r(x, y, w, h, paper);
  r(x + Math.floor(w / 2), y, 1, 1, '#d33');
}

/** One cubicle desk. Variants swap the clutter so the floor doesn't look copy-pasted. */
export const DESK_W = 144;
export const DESK_H = 72;
export const DESK_SCREEN = { x: 60, y: 14 };
export const DESK_VARIANTS = 4;

function desk(r: R, variant: number) {
  const rnd = rng(3 + variant * 17);
  const W = DESK_W, R2 = 48; // right-hand clutter sits 48px further out than on a narrow desk
  floorShadow(r, 0, 62, W, 10);
  // fabric partition with metal trim
  r(0, 0, W, 36, '#4c5a6e');
  r(0, 0, W, 3, '#a7aeb6'); r(0, 0, W, 1, '#d6dadf'); r(0, 2, W, 1, '#7d858f');
  r(0, 3, 2, 33, '#8e959e'); r(W - 2, 3, 2, 33, '#6f7680');
  r(2, 3, W - 4, 33, '#6d7f99');
  dither(r, 2, 3, W - 4, 1, '#5d6e88', '#6d7f99');
  speckle(r, rnd, 2, 4, W - 4, 31, 260, ['#647590', '#76889f', '#5f708a']);
  r(47, 3, 1, 33, '#5f708a'); r(96, 3, 1, 33, '#5f708a'); // panel seams
  // pinned-up stuff
  pinned(r, 6, 7, 16, 18, '#f2f0ea');
  r(6, 7, 16, 5, '#c0392b'); r(7, 8, 14, 1, '#e06050');
  for (let gy = 13; gy < 24; gy += 2) for (let gx = 7; gx < 21; gx += 2) r(gx, gy, 1, 1, rnd() < 0.15 ? '#c0392b' : '#9a9aa8');
  const notes = ['#f5ec9a', '#f7b5c9', '#a8e6cf'];
  pinned(r, 26, 9, 8, 8, pick(rnd, notes)); r(27, 11, 5, 1, '#8a7a50'); r(27, 13, 4, 1, '#8a7a50');
  pinned(r, 36, 14, 8, 8, pick(rnd, notes)); r(37, 16, 5, 1, '#8a7a50');
  if (variant % 2 === 0) {
    // the comic strip everyone pinned up
    pinned(r, 67 + R2, 6, 24, 9, '#fbfaf4');
    for (const px of [68, 76, 84]) { r(px + R2, 7, 7, 7, '#e8e6dc'); r(px + R2 + 2, 9, 2, 3, '#c9b48a'); r(px + R2 + 4, 10, 2, 3, '#7d8ba0'); }
  } else {
    pinned(r, 68 + R2, 6, 12, 12, '#f2f0ea'); r(69 + R2, 8, 10, 6, '#3a6b9a'); r(69 + R2, 12, 10, 2, '#4f8a3a'); r(73 + R2, 9, 2, 2, '#f4e4a0'); // vacation postcard
  }
  pinned(r, 82 + R2, 18, 8, 8, pick(rnd, notes)); r(83 + R2, 20, 5, 1, '#8a7a50'); r(83 + R2, 22, 4, 1, '#8a7a50');
  // a family photo or a cat poster
  if (variant === 1 || variant === 2) { pinned(r, 100, 8, 12, 14, '#f2f0ea'); r(101, 10, 10, 9, '#d8a050'); r(104, 12, 3, 3, '#7a5030'); r(105, 15, 1, 3, '#7a5030'); }
  else { pinned(r, 100, 10, 10, 8, '#f8f6ee'); r(102, 12, 2, 2, '#e0ac69'); r(105, 13, 3, 1, '#d33'); r(101, 16, 8, 1, '#888'); }
  // laminate work surface
  r(0, 36, W, 20, '#c8bfa8');
  r(0, 36, W, 2, '#a99f86');
  for (let i = 0; i < 9; i++) r(Math.floor(rnd() * 110), 39 + Math.floor(rnd() * 15), 10 + Math.floor(rnd() * 24), 1, '#c1b8a0');
  r(0, 55, W, 1, '#e4dcc6');
  // front: open knee space between two drawer pedestals
  r(0, 56, W, 12, '#9c927a'); r(0, 67, W, 1, '#6e6553');
  r(30, 57, 84, 10, '#6e6553'); r(30, 57, 84, 1, '#5a5242');
  for (const px of [3, 116]) {
    bevel(r, px, 56, 25, 6, '#a59b83', 0.15); bevel(r, px, 62, 25, 6, '#a59b83', 0.15);
    r(px + 10, 58, 5, 1, '#5a5242'); r(px + 10, 64, 5, 1, '#5a5242');
  }
  crt(r, DESK_SCREEN.x, DESK_SCREEN.y);
  keyboard(r, 55, 44);
  mouse(r, 96, 44);
  // personal clutter
  mug(r, 84 + R2 - 6, 38, pick(rnd, ['#c33', '#2d5fa8', '#f4f1e6', '#2e7d32']));
  papers(r, 6, 40, rnd);
  if (variant !== 1) papers(r, 20, 42, rnd);
  r(108, 47, 14, 8, '#d8c890'); r(108, 47, 14, 1, '#ece0a8'); r(110, 49, 9, 1, '#a89860'); // manila folder
  if (variant === 0 || variant === 3) { r(40, 42, 4, 5, '#333'); r(40, 42, 4, 1, '#999'); r(42, 45, 1, 1, '#ddd'); r(41, 40, 4, 5, '#2d5fa8'); r(41, 40, 4, 1, '#88a'); } // floppies
  if (variant === 1) { r(40, 40, 5, 6, '#c97a35'); r(40, 40, 5, 1, '#e09a55'); r(41, 35, 1, 5, '#e33'); r(43, 34, 1, 6, '#33e'); r(42, 36, 1, 4, '#222'); } // pencil cup
  if (variant === 2) { r(40, 41, 5, 5, '#b5651d'); r(41, 35, 3, 6, '#3a8a3a'); r(40, 37, 1, 2, '#3a8a3a'); r(44, 36, 1, 2, '#3a8a3a'); r(42, 36, 1, 1, '#5aba5a'); } // cactus
  if (variant === 3) { r(122, 37, 10, 7, '#2a2a2a'); r(122, 37, 10, 2, '#3e3e3e'); r(124, 35, 6, 2, '#2a2a2a'); r(124, 40, 1, 1, '#777'); r(127, 40, 1, 1, '#777'); } // phone
}

/** Office chair seen from behind, tall enough to hide a seated person's lower half. */
function chair(r: R) {
  floorShadow(r, 4, 38, 32, 9);
  const c = '#3a3f4a';
  r(7, 0, 26, 1, c); r(6, 1, 28, 22, c); r(7, 23, 26, 1, c);
  r(7, 1, 26, 1, '#5a6070'); r(6, 2, 1, 20, '#4a505c'); r(33, 2, 1, 20, '#2a2e36');
  dither(r, 9, 4, 22, 16, c, '#353a44');
  r(10, 2, 16, 1, '#666d7c');
  r(16, 21, 8, 1, '#2a2e36');
  r(3, 24, 34, 6, '#2e323b'); r(3, 24, 34, 1, '#454a56');
  r(1, 14, 4, 2, '#25282f'); r(2, 16, 3, 9, '#25282f'); r(35, 14, 4, 2, '#25282f'); r(35, 16, 3, 9, '#25282f');
  r(18, 30, 5, 6, '#2a2a2e'); r(18, 30, 1, 6, '#8a8e96');
  r(6, 36, 28, 3, '#26282c'); r(6, 36, 28, 1, '#3e4148');
  r(3, 39, 4, 3, '#111'); r(33, 39, 4, 3, '#111'); r(18, 40, 5, 3, '#111');
}

export const BOSS_W = 112;
export const BOSS_H = 64;
export const BOSS_SCREEN = { x: 44, y: 7 };

function bossdesk(r: R) {
  const rnd = rng(8);
  const wood = '#7d3a26', woodD = '#5a2618', woodL = '#9b5238';
  floorShadow(r, 0, 54, 112, 10);
  // top, with a green leather inlay
  r(0, 22, 112, 20, wood); r(0, 22, 112, 1, woodL);
  for (let i = 0; i < 10; i++) r(Math.floor(rnd() * 90), 23 + Math.floor(rnd() * 18), 14 + Math.floor(rnd() * 20), 1, shade(wood, -0.08));
  r(22, 26, 68, 13, '#c9a227'); r(23, 27, 66, 11, '#2f5a3a');
  dither(r, 23, 37, 66, 1, '#2f5a3a', '#244a2e');
  r(0, 41, 112, 2, woodL);
  // carved front with raised panels and brass pulls
  r(0, 43, 112, 15, woodD); r(0, 57, 112, 1, '#3a170d');
  for (const px of [4, 40, 76]) {
    bevel(r, px, 45, 32, 10, shade(woodD, 0.08), 0.22);
    r(px + 4, 47, 24, 6, shade(woodD, -0.08));
    r(px + 14, 49, 4, 2, '#c9a227'); r(px + 14, 49, 4, 1, '#f0d060');
  }
  crt(r, BOSS_SCREEN.x, BOSS_SCREEN.y);
  // banker's lamp
  r(9, 37, 10, 3, '#c9a227'); r(9, 37, 10, 1, '#f0d060'); r(13, 25, 2, 12, '#b08a1a'); r(14, 25, 1, 12, '#e8c84a');
  r(5, 20, 18, 3, '#1f6b3a'); r(4, 23, 20, 3, '#17552d'); r(6, 20, 14, 1, '#4aba6a'); r(5, 21, 4, 1, '#3a9a5a');
  r(5, 26, 18, 1, '#fff0b0');
  // multi-line phone
  r(84, 30, 18, 9, BEIGE); r(84, 30, 18, 1, shade(BEIGE, 0.3)); r(84, 38, 18, 1, BEIGE_DARK);
  r(83, 26, 20, 4, '#cfc6ac'); r(83, 26, 20, 1, '#e8e0c8'); r(84, 28, 3, 2, BEIGE_DARK); r(99, 28, 3, 2, BEIGE_DARK);
  for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) r(87 + j * 3, 32 + k * 2 - (k > 2 ? 1 : 0), 2, 1, '#777');
  r(97, 32, 3, 1, '#d33'); r(97, 34, 3, 1, '#3c3');
  r(103, 34, 1, 4, '#888'); r(104, 38, 2, 1, '#888');
  // rolodex, in-tray, framed photo
  r(28, 30, 9, 7, '#2a2a2a'); r(29, 27, 7, 4, '#f4f1e6'); r(30, 26, 5, 1, '#e6e1cc'); r(29, 29, 7, 1, '#bbb');
  r(68, 29, 13, 8, '#c9b38a'); r(69, 30, 11, 5, '#f4f1e6'); r(68, 36, 13, 1, '#8a754f');
  r(74, 17, 8, 9, '#c9a227'); r(75, 18, 6, 6, '#7a9ac0'); r(76, 20, 2, 3, '#f1c27d'); r(78, 21, 2, 3, '#5a3825');
  // nameplate on the front edge
  r(42, 37, 28, 6, '#3a2a10'); r(42, 37, 28, 5, '#c9a227'); r(42, 37, 28, 1, '#f0d060');
  const name = OWNER.toUpperCase().slice(0, 6);
  text(r, 56 - (name.length * 4 - 1) / 2, 37, name, '#3a2a08');
}

function bosschair(r: R) {
  floorShadow(r, 2, 29, 28, 7);
  const l = '#5a1e16', ld = '#3d150f', ll = '#7a3428';
  r(3, 0, 26, 1, l); r(2, 1, 28, 20, l); r(3, 21, 26, 1, l);
  r(3, 1, 26, 1, ll); r(2, 2, 1, 18, ll); r(29, 2, 1, 18, ld);
  // button tufting
  for (let y = 4; y < 20; y += 5)
    for (let x = 6 + ((y / 5) % 2 ? 3 : 0); x < 27; x += 6) {
      r(x, y, 1, 1, '#2a0c08'); r(x - 1, y + 1, 1, 1, ld); r(x + 1, y + 1, 1, 1, ld); r(x, y - 1, 1, 1, ll);
    }
  r(0, 12, 4, 10, ld); r(28, 12, 4, 10, ld); r(0, 12, 4, 1, ll); r(28, 12, 4, 1, ll);
  r(1, 22, 30, 5, ld); r(1, 22, 30, 1, l);
  r(14, 27, 4, 3, '#222'); r(14, 27, 1, 3, '#888');
  r(4, 30, 24, 2, '#26282c'); r(4, 30, 24, 1, '#3e4148');
  r(2, 32, 3, 2, '#111'); r(27, 32, 3, 2, '#111'); r(14, 32, 4, 2, '#111');
}

export const SHELF_W = 92;
export const SHELF_H = 96;

/** Bookcase full of binders; `seed` changes what's on it. */
function shelf(r: R, seed: number) {
  const rnd = rng(seed);
  const W = SHELF_W, H = SHELF_H;
  const wood = '#6b4a2e', inner = '#3e2a1a';
  r(0, 0, W, H, wood);
  r(0, 0, W, 4, '#8a6240'); r(0, 0, W, 1, '#a87a50'); r(0, 4, W, 1, '#4a321f');
  r(0, 4, 3, H - 4, '#7a5636'); r(W - 3, 4, 3, H - 4, '#553a22');
  r(3, 5, W - 6, H - 9, inner);
  const binders = ['#2d5fa8', '#c0392b', '#f1c40f', '#27ae60', '#ecf0f1', '#34495e', '#8e44ad', '#d35400'];
  for (const shelfY of [24, 44, 64]) {
    r(3, shelfY - 18, W - 6, 2, 'rgba(0,0,0,0.25)');
    let x = 4;
    while (x < W - 6) {
      if (rnd() < 0.08 && x < W - 18) {
        // a stack lying flat
        for (let k = 0; k < 3; k++) { const c = pick(rnd, binders); r(x, shelfY - 3 - k * 3, 12, 3, c); r(x, shelfY - 3 - k * 3, 12, 1, shade(c, 0.3)); }
        x += 14;
        continue;
      }
      const w = 4 + Math.floor(rnd() * 3), h = 13 + Math.floor(rnd() * 4);
      if (x + w > W - 4) break;
      const col = pick(rnd, binders);
      r(x, shelfY - h, w, h, col);
      r(x, shelfY - h, 1, h, shade(col, 0.25)); r(x + w - 1, shelfY - h, 1, h, shade(col, -0.3));
      r(x + 1, shelfY - h + 3, w - 2, 4, '#f4f1e6'); r(x + 1, shelfY - h + 4, w - 2, 1, '#999');
      disc(r, x + Math.floor(w / 2), shelfY - 4, 0, shade(col, -0.5));
      x += w + (rnd() < 0.12 ? 2 : 0);
    }
    r(3, shelfY, W - 6, 3, '#8a6240'); r(3, shelfY, W - 6, 1, '#a87a50'); r(3, shelfY + 2, W - 6, 1, '#4a321f');
  }
  // bottom shelves: archive boxes
  for (const by of [67, 81]) {
    for (let bx = 5; bx + 17 < W - 3; bx += 21) {
      bevel(r, bx, by, 17, by === 67 ? 9 : 10, '#cdb98e', 0.18);
      r(bx + 5, by + 3, 7, 3, '#f4f1e6'); r(bx + 6, by + 4, 5, 1, '#888');
    }
    if (by === 67) { r(3, 77, W - 6, 3, '#8a6240'); r(3, 77, W - 6, 1, '#a87a50'); }
  }
  r(0, H - 4, W, 4, '#4a321f'); r(0, H - 4, W, 1, '#7a5636');
}

function cabinet(r: R) {
  const m = '#b5b09a';
  r(0, 0, 28, 56, m);
  r(0, 0, 28, 2, '#d3cfbb'); r(0, 2, 28, 1, '#8a8572');
  r(25, 3, 3, 53, '#8a8572'); r(25, 3, 1, 53, '#9d9884');
  for (let i = 0; i < 4; i++) {
    const y = 4 + i * 13;
    bevel(r, 2, y, 22, 12, m, 0.18);
    r(8, y + 2, 10, 4, '#7a7562'); r(9, y + 3, 8, 2, '#f4f1e6'); r(10, y + 4, 4 + ((i * 3) % 5), 1, '#666');
    r(9, y + 8, 8, 2, '#5d5a4c'); r(9, y + 8, 8, 1, '#3a382f');
  }
  r(0, 55, 28, 1, '#5d5a4c');
}

function rack(r: R, frame: number) {
  const rnd = rng(20 + frame);
  r(0, 0, 32, 80, '#18191c');
  r(1, 0, 30, 2, '#3a3e45'); r(1, 0, 30, 1, '#5a5f68'); r(1, 2, 1, 77, '#30333a'); r(30, 2, 1, 77, '#0e0f11');
  // vented top door
  r(3, 4, 26, 10, '#24262b');
  for (let y = 5; y < 13; y += 2) r(4, y, 24, 1, '#0d0e10');
  // equipment units
  let y = 16;
  for (const h of [6, 8, 6, 12, 6, 8, 10]) {
    if (y + h > 77) break;
    bevel(r, 3, y, 26, h, '#2b2e33', 0.2);
    r(4, y + h - 2, 24, 1, '#3a3e45');
    if (h === 12) {
      // disk bays
      for (let k = 0; k < 4; k++) { r(5 + k * 6, y + 2, 5, 8, '#1b1d21'); r(5 + k * 6, y + 2, 5, 1, '#454a52'); r(9 + k * 6, y + 8, 1, 1, rnd() < 0.5 ? '#3f3' : '#0d2a0d'); }
    } else if (h === 10) {
      r(5, y + 2, 14, 5, '#0a2010'); r(6, y + 3, 4 + frame * 3, 1, '#3f6'); r(6, y + 5, 7, 1, '#2a5'); // status LCD
      r(22, y + 3, 2, 2, '#c33'); r(25, y + 3, 2, 2, '#ccc');
    } else {
      r(5, y + 2, 10, 1, '#1d1f23');
      for (let x = 18; x < 28; x += 2) r(x, y + 2, 1, 1, rnd() < 0.55 ? pick(rnd, ['#3f3', '#3f3', '#3f3', '#fa3', '#f33']) : '#0d2a0d');
    }
    y += h + 1;
  }
  r(1, 78, 30, 2, '#0a0a0c');
}

function tape(r: R, frame: number) {
  const body = '#c9c5b6';
  r(0, 0, 32, 80, '#9d9886'); bevel(r, 1, 0, 30, 79, body, 0.15);
  r(2, 0, 28, 2, '#e8e4d6');
  // glass door over the reels
  r(3, 4, 26, 42, '#4a5258'); r(4, 5, 24, 40, '#2e3438');
  for (const [cy, off] of [[15, 0], [34, 1]] as const) {
    disc(r, 16, cy, 8, '#1c1c1c');
    disc(r, 16, cy, 7, '#3a2a20'); // wound tape
    disc(r, 16, cy, 4, '#8a8e94');
    disc(r, 16, cy, 1, '#2a2a2a');
    for (let s = 0; s < 3; s++) {
      const a = ((frame + off) * Math.PI * 2) / 9 + (s * Math.PI * 2) / 3;
      r(16 + Math.round(Math.cos(a) * 3), cy + Math.round(Math.sin(a) * 3), 1, 1, '#2a2a2a');
      r(16 + Math.round(Math.cos(a) * 2), cy + Math.round(Math.sin(a) * 2), 1, 1, '#5a5e64');
    }
  }
  r(24, 15, 1, 19, '#3a2a20'); // tape path
  for (let i = 0; i < 9; i++) r(6 + i, 6 + i, 1, 1, 'rgba(255,255,255,0.13)');
  for (let i = 0; i < 5; i++) r(20 + i, 30 + i, 1, 1, 'rgba(255,255,255,0.1)');
  // control panel
  r(3, 49, 26, 13, '#6f7a80'); r(3, 49, 26, 1, '#8e9aa0');
  const rnd = rng(40 + frame);
  for (let k = 0; k < 4; k++) r(5 + k * 6, 52, 4, 3, ['#c33', '#3a3', '#dd3', '#ddd'][k]);
  for (let x = 5; x < 28; x += 3) r(x, 58, 2, 1, rnd() < 0.5 ? '#3f3' : '#0d2a0d');
  for (let yy = 65; yy < 77; yy += 2) r(4, yy, 24, 1, '#8a8676');
  r(0, 79, 32, 1, '#5d5a4c');
}

function cooler(r: R) {
  floorShadow(r, 0, 47, 20, 5);
  // the jug
  r(4, 0, 12, 1, '#7ab0dc'); r(3, 1, 14, 16, '#8cc0e6'); r(4, 17, 12, 2, '#7ab0dc'); r(8, 19, 4, 2, '#5a90bc');
  r(3, 1, 14, 5, '#b4d8f2'); r(3, 6, 14, 1, '#6aa0cc'); // air above the water line
  r(4, 2, 2, 14, '#d8eefc'); r(15, 2, 1, 14, '#5a90bc');
  r(3, 9, 14, 1, '#7ab0dc'); r(3, 13, 14, 1, '#7ab0dc');
  r(9, 10, 1, 1, '#d8eefc'); r(11, 14, 1, 1, '#d8eefc'); r(8, 15, 1, 1, '#d8eefc');
  // dispenser
  r(1, 21, 18, 26, '#e8e4d8'); r(1, 21, 18, 1, '#f8f6ee'); r(17, 22, 2, 25, '#bdb8a8'); r(1, 22, 1, 25, '#f4f1e6');
  r(3, 24, 14, 9, '#d8d3c4');
  r(5, 26, 2, 3, '#d33'); r(5, 26, 2, 1, '#f66'); r(13, 26, 2, 3, '#33d'); r(13, 26, 2, 1, '#66f');
  r(4, 31, 12, 2, '#999'); r(4, 31, 12, 1, '#bbb');
  r(4, 36, 12, 1, '#cfcab8'); r(4, 40, 12, 1, '#cfcab8');
  r(1, 46, 18, 1, '#8a8572');
}

/** A leafy office plant; `seed` varies the foliage. */
function plant(r: R, seed: number) {
  const rnd = rng(seed);
  floorShadow(r, 4, 50, 24, 6);
  const greens = ['#1b5e20', '#2e7d32', '#388e3c', '#43a047', '#66bb6a', '#81c784'];
  r(15, 16, 2, 24, '#5a3d22'); r(13, 26, 2, 1, '#5a3d22'); r(17, 22, 2, 1, '#5a3d22');
  // leaves drawn back to front, lighter toward the top
  const leaves = Array.from({ length: 34 }, () => {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
    return { x: 16 + Math.cos(a) * d * 12, y: 18 + Math.sin(a) * d * 15, a: rnd() * Math.PI };
  }).sort((p, q) => p.y - q.y);
  for (const l of leaves) {
    const tone = Math.max(0, Math.min(5, Math.round(5 - (l.y - 2) / 6 + rnd() * 1.5 - 0.7)));
    const c = greens[tone], dx = Math.cos(l.a), dy = Math.sin(l.a) * 0.6;
    for (let t = -3; t <= 3; t++) {
      const px = Math.round(l.x + dx * t), py = Math.round(l.y + dy * t);
      r(px, py, 1, 1, c);
      if (Math.abs(t) < 2) { r(px, py - 1, 1, 1, shade(c, 0.12)); r(px, py + 1, 1, 1, shade(c, -0.2)); }
    }
  }
  // terracotta pot
  r(7, 38, 18, 4, '#d4874a'); r(7, 38, 18, 1, '#e8a06a'); r(7, 41, 18, 1, '#a85a22');
  r(9, 39, 14, 1, '#3a2614');
  r(8, 42, 16, 4, '#c0753a'); r(9, 46, 14, 4, '#b5651d'); r(10, 50, 12, 1, '#8a4a14');
  r(9, 42, 2, 8, '#d8925a'); r(21, 42, 2, 8, '#8a4a14');
}

function copier(r: R) {
  floorShadow(r, 0, 38, 48, 6);
  // lid and glass
  r(4, 0, 36, 8, '#bfbaa9'); r(4, 0, 36, 1, '#e0dccd'); r(4, 7, 36, 1, '#8a8676');
  r(6, 2, 20, 1, '#a9a596');
  r(0, 8, 48, 6, '#e6e2d4'); r(0, 8, 48, 1, '#f6f3ea');
  // control panel
  r(30, 9, 16, 5, '#4a5560'); r(31, 10, 6, 3, '#9ad09a'); r(32, 11, 3, 1, '#2a5a2a');
  for (let k = 0; k < 3; k++) r(39 + k * 2, 10, 1, 1, '#ddd'); r(39, 12, 5, 1, '#3c3');
  // body with two paper trays
  r(0, 14, 48, 26, '#d6d2c4'); r(46, 14, 2, 26, '#a9a596'); r(0, 14, 1, 26, '#e6e2d4');
  r(0, 15, 48, 2, '#2d5fa8');
  for (const ty of [20, 29]) {
    bevel(r, 3, ty, 40, 8, '#cdc9ba', 0.15);
    r(18, ty + 3, 10, 2, '#8a8676'); r(36, ty + 2, 4, 4, '#f4f4f4'); r(36, ty + 4, 4, 2, '#d8d4c8');
  }
  r(0, 39, 48, 1, '#6e6a5c');
  // output tray with a fresh copy
  r(0, 11, 6, 2, '#a9a596');
  r(0, 10, 6, 1, '#f8f8f8');
}

function counter(r: R) {
  const rnd = rng(13);
  // cabinet
  r(0, 26, 32, 36, '#9c927a'); r(30, 26, 2, 36, '#7d745f');
  r(0, 20, 32, 7, '#d8cdb0'); r(0, 20, 32, 1, '#ece4cc'); r(0, 26, 32, 1, '#a89a78');
  speckle(r, rnd, 0, 21, 32, 5, 14, ['#c8bd9e', '#e8dfc6']);
  for (const dy of [29, 44]) {
    bevel(r, 2, dy, 13, 14, '#a59b83', 0.15); bevel(r, 16, dy, 13, 14, '#a59b83', 0.15);
    r(12, dy + 6, 1, 3, '#d8cdb0'); r(18, dy + 6, 1, 3, '#d8cdb0');
  }
  r(0, 61, 32, 1, '#6e6553');
  // coffee maker with a full pot
  r(2, 2, 14, 19, '#2a2a2a'); r(2, 2, 14, 2, '#444'); r(3, 4, 1, 15, '#3a3a3a');
  r(4, 12, 9, 8, '#b8d0d8'); r(4, 12, 9, 1, '#d8eef8');
  r(5, 15, 7, 5, '#4a2410'); r(5, 15, 7, 1, '#7a4a28');
  r(13, 14, 2, 4, '#222');
  r(2, 20, 14, 1, '#111'); r(13, 6, 1, 1, '#f33');
  // pink box of donuts
  r(18, 13, 13, 7, '#f0a0b8'); r(18, 13, 13, 1, '#f8c8d8'); r(30, 14, 1, 6, '#c07088');
  r(20, 15, 3, 2, '#c89048'); r(24, 15, 3, 2, '#e85a8a'); r(21, 15, 1, 1, '#f0d8a0');
}

function table(r: R) {
  floorShadow(r, 0, 32, 128, 8);
  r(0, 10, 128, 16, '#9a8f7a'); r(0, 10, 128, 1, '#b3a991'); r(0, 25, 128, 1, '#c3b9a1');
  r(0, 26, 128, 8, '#7b715f'); r(0, 33, 128, 1, '#5a5242');
  r(2, 34, 4, 5, '#5a5242'); r(122, 34, 4, 5, '#5a5242');
  for (const tx of [8, 48, 88]) {
    // wooden letter tray
    r(tx, 4, 32, 14, '#8a754f');
    r(tx + 1, 5, 30, 11, '#c9b38a'); r(tx + 2, 6, 28, 8, '#b39c72');
    r(tx, 4, 32, 1, '#dcc89c'); r(tx, 17, 32, 2, '#6b5a3a');
    r(tx + 12, 15, 8, 2, '#f4f1e6');
  }
  // the red OUT plaque
  r(52, 27, 24, 7, '#8a1f1f'); r(52, 27, 24, 6, '#c0392b'); r(52, 27, 24, 1, '#e06050');
  text(r, 58, 28, 'OUT', '#f4f1e6');
}

function buildFurniture(scene: Phaser.Scene) {
  for (let v = 0; v < DESK_VARIANTS; v++) single(scene, `desk${v}`, DESK_W, DESK_H, (r) => desk(r, v), { outline: true });
  single(scene, 'chair', 40, 44, chair, { outline: true });
  single(scene, 'bossdesk', BOSS_W, BOSS_H, bossdesk, { outline: true });
  single(scene, 'bosschair', 32, 36, bosschair, { outline: true });
  single(scene, 'shelf', SHELF_W, SHELF_H, (r) => shelf(r, 11), { outline: true });
  single(scene, 'shelf2', SHELF_W, SHELF_H, (r) => shelf(r, 31), { outline: true });
  single(scene, 'cabinet', 28, 56, cabinet, { outline: true });
  const rackFrames = ['a', 'b', 'c'];
  sheet(scene, 'rack', 32, 80, rackFrames, (r, _f, i) => rack(r, i), { outline: true });
  sheet(scene, 'tape', 32, 80, rackFrames, (r, _f, i) => tape(r, i), { outline: true });
  loop(scene, 'rack-blink', 'rack', rackFrames, 3);
  loop(scene, 'tape-spin', 'tape', rackFrames, 4);
  single(scene, 'cooler', 20, 52, cooler, { outline: true });
  single(scene, 'plant', 32, 56, (r) => plant(r, 5), { outline: true });
  single(scene, 'plant2', 32, 56, (r) => plant(r, 23), { outline: true });
  single(scene, 'copier', 48, 44, copier, { outline: true });
  single(scene, 'counter', 32, 64, counter, { outline: true });
  single(scene, 'table', 128, 40, table, { outline: true });

  single(scene, 'paper', 24, 6, (r) => {
    r(1, 1, 22, 5, '#cfc8b3');
    r(0, 0, 22, 4, '#fbf9f2');
    r(2, 1, 9, 1, '#b0b0c0'); r(2, 2, 14, 1, '#c0c0cc');
  }, { outline: true });

  // the big sign on the owner's office wall: gold letters on dark wood
  const big = OWNER.toUpperCase().slice(0, 10);
  const sw = bigTextWidth(big, 4) + 36, sh = 50;
  single(scene, 'officesign', sw, sh, (r) => {
    r(2, 4, sw - 4, sh - 4, 'rgba(0,0,0,0.35)'); // shadow on the wall
    r(0, 0, sw - 2, sh - 4, '#5a2a18'); r(0, 0, sw - 2, 2, '#8a4a2a'); r(0, sh - 6, sw - 2, 2, '#3a160a');
    r(4, 4, sw - 10, sh - 12, '#c9a227'); r(6, 6, sw - 14, sh - 16, '#3a1a0e');
    bigText(r, 18 + 2, 11 + 2, big, '#1a0a04', 4);
    bigText(r, 18, 11, big, '#f0c040', 4);
    r(sw / 2 - 1 - 14, 0, 2, 2, '#f0d060'); r(sw / 2 - 1 + 14, 0, 2, 2, '#f0d060');
  });

  // brass name plaque beside the owner's door
  const plate = OWNER.toUpperCase().slice(0, 8);
  const pw = plate.length * 4 + 7;
  single(scene, 'plaque', pw, 11, (r) => {
    r(0, 0, pw, 11, '#6a4a10'); r(1, 1, pw - 2, 9, '#c9a227'); r(1, 1, pw - 2, 1, '#f0d060');
    text(r, 4, 3, plate, '#3a2a08');
  });

  // one half of the brushed-steel elevator door
  single(scene, 'door', 24, 36, (r) => {
    r(0, 0, 24, 36, '#a8acb0');
    for (const [x, c] of [[2, '#c8ccd0'], [3, '#d8dce0'], [4, '#d0d4d8'], [9, '#b8bcc0'], [16, '#989ca0'], [18, '#90949a']] as const) r(x, 0, 1, 36, c);
    r(0, 0, 1, 36, '#e0e4e8'); r(23, 0, 1, 36, '#6a6e74');
    r(0, 0, 24, 1, '#6a6e74');
  });

  // selection ring drawn as a pixel ellipse
  single(scene, 'ring', 40, 16, (r) => {
    for (let a = 0; a < Math.PI * 2; a += 0.015) {
      const x = Math.round(19.5 + Math.cos(a) * 18.5), y = Math.round(7.5 + Math.sin(a) * 6.5);
      r(x, y, 1, 1, '#ffe14d');
      r(x, y + 1, 1, 1, Math.sin(a) > 0 ? '#c9a227' : '#ffe14d');
    }
  });
}

export const SCREEN_FRAMES = ['off', 'desktop', 'code0', 'code1', 'code2', 'code3', 'saver0', 'saver1', 'saver2', 'run0', 'run1', 'alert0', 'alert1'] as const;

function desktop(r: R) {
  r(0, 0, 24, 18, '#008080');
  // My Computer, a folder, the recycle bin
  r(2, 2, 4, 3, '#c0c0c0'); r(3, 3, 2, 1, '#000080'); r(2, 5, 4, 1, '#808080');
  r(2, 7, 4, 3, '#e8c040'); r(2, 7, 2, 1, '#f8e070');
  r(3, 11, 3, 3, '#c0c0c0'); r(3, 11, 3, 1, '#e0e0e0');
  r(1, 6, 6, 1, '#7fd0d0'); r(1, 10, 6, 1, '#7fd0d0');
  // taskbar
  r(0, 16, 24, 2, '#c0c0c0'); r(0, 16, 24, 1, '#fff');
  r(1, 17, 4, 1, '#000'); r(1, 17, 1, 1, '#f00'); r(2, 17, 1, 1, '#0a0'); r(3, 17, 1, 1, '#00f');
  r(19, 17, 4, 1, '#808080');
}

function crtCorners(r: R) {
  for (const [x, y] of [[0, 0], [23, 0], [0, 17], [23, 17]]) r(x, y, 1, 1, BEZEL);
}

function buildScreens(scene: Phaser.Scene) {
  const rnd = rng(99);
  const KW = '#ffff55', TXT = '#e8e8e8', CMT = '#55ffff', STR = '#ff55ff';
  const lines = Array.from({ length: 16 }, () => {
    const indent = Math.floor(rnd() * 3) * 2;
    const parts: [number, string][] = [];
    let len = 0;
    const max = 20 - indent;
    while (len < max - 3 && rnd() < 0.8) {
      const w = 2 + Math.floor(rnd() * 5);
      parts.push([Math.min(w, max - len), parts.length === 0 && rnd() < 0.5 ? KW : pick(rnd, [TXT, TXT, CMT, STR])]);
      len += w + 1;
    }
    return { indent, parts };
  });
  sheet(scene, 'screen', SCREEN_W, SCREEN_H, SCREEN_FRAMES, (r, frame, i) => {
    if (frame === 'off') {
      r(0, 0, 24, 18, '#0e1410');
      for (let k = 0; k < 5; k++) r(3 + k, 2 + k, 1, 1, '#1e2a24');
      r(2, 2, 3, 1, '#26342c');
    } else if (frame === 'desktop') desktop(r);
    else if (frame.startsWith('code')) {
      // a blue-screen DOS editor scrolling through source
      r(0, 0, 24, 18, '#0000a8');
      r(0, 0, 24, 1, '#a8a8a8'); r(1, 0, 1, 1, '#000'); r(4, 0, 2, 1, '#000'); r(8, 0, 2, 1, '#000');
      const f = i - 2;
      for (let row = 0; row < 7; row++) {
        const l = lines[(f * 2 + row) % lines.length];
        let x = 1 + l.indent;
        for (const [w, c] of l.parts) { r(x, 2 + row * 2, w, 1, c); x += w + 1; }
      }
      if (f % 2 === 0) r(14, 14, 2, 1, '#fff'); // cursor
      r(0, 17, 24, 1, '#00a8a8'); r(16, 17, 6, 1, '#000');
    } else if (frame.startsWith('saver')) {
      // starfield flying outward
      r(0, 0, 24, 18, '#000');
      const s = rng(321), f = i - 6;
      for (let k = 0; k < 14; k++) {
        const a = s() * Math.PI * 2, d0 = s();
        const d = ((d0 + f / 3) % 1) * 13;
        const x = Math.round(12 + Math.cos(a) * d), y = Math.round(9 + Math.sin(a) * d * 0.75);
        if (x >= 0 && x < 24 && y >= 0 && y < 18) r(x, y, 1, 1, d > 8 ? '#fff' : d > 4 ? '#aaa' : '#555');
      }
    } else if (frame.startsWith('run')) {
      r(0, 0, 24, 18, '#000');
      r(1, 1, 2, 1, '#aaa'); r(4, 1, 9, 1, '#ccc');
      r(1, 3, 12, 1, '#888'); r(1, 5, 8, 1, '#888'); r(1, 7, 14, 1, '#888');
      r(1, 11, 22, 4, '#555'); r(2, 12, 20, 2, '#111');
      const fill = frame === 'run0' ? 8 : 15;
      for (let x = 0; x < fill; x += 2) r(2 + x, 12, 1, 2, '#3c3');
      if (frame === 'run1') r(1, 16, 3, 1, '#ccc');
    } else {
      desktop(r);
      // modal error dialog
      r(3, 3, 18, 12, '#c0c0c0'); r(3, 3, 18, 1, '#fff'); r(3, 3, 1, 12, '#fff'); r(20, 4, 1, 11, '#404040'); r(4, 14, 17, 1, '#404040');
      r(4, 4, 16, 2, '#000080'); r(5, 4, 6, 1, '#fff'); r(18, 4, 1, 1, '#c0c0c0');
      if (frame === 'alert0') { disc(r, 7, 9, 2, '#d32'); r(6, 9, 3, 1, '#fff'); }
      else { r(7, 7, 1, 1, '#ec0'); r(6, 8, 3, 2, '#ec0'); r(5, 10, 5, 1, '#ec0'); r(7, 8, 1, 1, '#000'); }
      r(11, 7, 8, 1, '#000'); r(11, 9, 6, 1, '#000');
      r(9, 11, 7, 3, '#c0c0c0'); r(9, 11, 7, 1, '#fff'); r(15, 11, 1, 3, '#404040'); r(9, 13, 7, 1, '#404040'); r(11, 12, 3, 1, '#000');
    }
    crtCorners(r);
    r(1, 1, 1, 1, 'rgba(255,255,255,0.25)'); // glare on the curved glass
  });
  loop(scene, 'scr-code', 'screen', ['code0', 'code1', 'code2', 'code3'], 4);
  loop(scene, 'scr-saver', 'screen', ['saver0', 'saver1', 'saver2'], 4);
  loop(scene, 'scr-run', 'screen', ['run0', 'run1'], 3);
  loop(scene, 'scr-alert', 'screen', ['alert0', 'alert1'], 2);
}

export const BUBBLE_FRAMES = ['idle', 'thinking', 'reading', 'writing', 'running', 'awaiting', 'talking', 'done', 'queued', 'pitching', 'standby'] as const;

function buildBubbles(scene: Phaser.Scene) {
  sheet(scene, 'bubble', 26, 24, BUBBLE_FRAMES, (r, frame) => {
    const ink = '#222';
    const bg = frame === 'awaiting' ? '#ffef7a' : '#fff';
    r(2, 0, 22, 1, ink); r(2, 18, 22, 1, ink); r(0, 2, 1, 15, ink); r(25, 2, 1, 15, ink);
    r(1, 1, 1, 1, ink); r(24, 1, 1, 1, ink); r(1, 17, 1, 1, ink); r(24, 17, 1, 1, ink);
    r(2, 1, 22, 17, bg); r(1, 2, 24, 15, bg);
    r(2, 16, 22, 1, shade(bg, -0.12)); r(23, 3, 1, 13, shade(bg, -0.08));
    // tail
    r(10, 18, 5, 1, bg); r(11, 19, 3, 1, bg); r(12, 20, 1, 1, bg);
    r(9, 18, 1, 1, ink); r(15, 18, 1, 1, ink); r(10, 19, 1, 1, ink); r(14, 19, 1, 1, ink); r(11, 20, 1, 1, ink); r(13, 20, 1, 1, ink); r(12, 21, 1, 1, ink);
    switch (frame) {
      case 'idle':
        mug(r, 9, 8, '#c33');
        r(10, 3, 1, 2, '#aaa'); r(11, 5, 1, 1, '#aaa'); r(12, 2, 1, 2, '#ccc'); r(13, 4, 1, 1, '#ccc');
        break;
      case 'thinking':
        for (const x of [5, 11, 17]) { r(x, 8, 4, 3, '#555'); r(x + 1, 7, 2, 5, '#555'); r(x + 1, 8, 1, 1, '#999'); }
        break;
      case 'reading':
        r(3, 5, 9, 10, '#2d5fa8'); r(14, 5, 9, 10, '#2d5fa8');
        r(4, 4, 8, 10, '#f4f1e6'); r(14, 4, 8, 10, '#f4f1e6'); r(12, 4, 2, 11, '#1d3c70');
        for (let y = 6; y < 13; y += 2) { r(5, y, 6, 1, '#aab'); r(15, y, 6, 1, '#aab'); }
        break;
      case 'writing':
        r(4, 3, 12, 13, '#f4f1e6'); r(4, 3, 12, 1, '#ccc');
        for (let y = 6; y < 15; y += 2) r(6, y, y === 14 ? 4 : 8, 1, '#2e7d32');
        for (let k = 0; k < 7; k++) { r(19 - k, 4 + k, 2, 2, '#f1c40f'); }
        r(19, 3, 2, 2, '#e88'); r(12, 11, 1, 1, '#333');
        break;
      case 'running':
        r(3, 3, 20, 13, '#888'); r(3, 3, 20, 2, '#000080'); r(4, 5, 18, 10, '#111');
        r(5, 7, 1, 1, '#3f3'); r(6, 8, 1, 1, '#3f3'); r(5, 9, 1, 1, '#3f3'); r(8, 9, 4, 1, '#3f3');
        r(5, 12, 10, 1, '#2a5'); r(16, 12, 2, 1, '#3f3');
        break;
      case 'awaiting':
        r(11, 3, 4, 9, '#d32'); r(12, 3, 1, 8, '#f66'); r(11, 13, 4, 3, '#d32');
        break;
      case 'talking':
        r(4, 5, 17, 2, '#555'); r(4, 9, 13, 2, '#555'); r(4, 13, 15, 2, '#555');
        break;
      case 'queued':
      case 'standby':
        // hourglass
        r(8, 2, 10, 2, '#7a5a2a'); r(8, 14, 10, 2, '#7a5a2a');
        for (let k = 0; k < 5; k++) { r(9 + k, 4 + k, 8 - k * 2, 1, '#cfe8f4'); r(9 + k, 13 - k, 8 - k * 2, 1, '#cfe8f4'); }
        r(11, 5, 4, 2, '#e8c070'); r(12, 9, 2, 2, '#e8c070'); r(10, 11, 6, 2, '#e8c070');
        break;
      case 'pitching':
        // light bulb: an idea
        disc(r, 13, 7, 4, '#ffe14d'); r(11, 4, 2, 2, '#fff8c0');
        r(11, 11, 5, 2, '#c9a227'); r(11, 13, 5, 1, '#8a8a8a'); r(12, 14, 3, 1, '#6a6a6a');
        r(5, 6, 3, 1, '#f0c040'); r(19, 6, 3, 1, '#f0c040'); r(7, 2, 2, 1, '#f0c040'); r(17, 2, 2, 1, '#f0c040');
        break;
      case 'done':
        for (const [x, y] of [[5, 9], [6, 10], [7, 11], [8, 12], [9, 11], [10, 10], [11, 9], [12, 8], [13, 7], [14, 6], [15, 5], [16, 4]]) {
          r(x, y, 3, 3, '#2e9d4a'); r(x, y, 1, 1, '#5fd07a');
        }
        break;
    }
  });
}

function buildFloors(scene: Phaser.Scene) {
  // 90s commercial carpet: dusty teal with a faint diamond weave and confetti flecks
  single(scene, 'carpet', 64, 64, (r) => {
    r(0, 0, 64, 64, '#2f4f5a');
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const dx = Math.abs(((x + 8) % 32) - 16), dy = Math.abs(((y + 8 + (Math.floor((x + 8) / 32) % 2) * 16) % 32) - 16);
      if (dx + dy === 10) r(x, y, 1, 1, '#355865');
      else if (dx + dy < 3) r(x, y, 1, 1, '#2a4752');
    }
    const rnd = rng(7);
    speckle(r, rnd, 0, 0, 64, 64, 380, ['#3c6470', '#3c6470', '#26414a', '#26414a', '#26414a', '#34555f']);
    speckle(r, rnd, 0, 0, 64, 64, 26, ['#7a3e6e', '#4f8a94', '#8a7a3e']);
  });
  // kitchenette linoleum: two-tone squares with a fleck and grout lines
  single(scene, 'lino', 32, 32, (r) => {
    const rnd = rng(17);
    for (const [x, y, c] of [[0, 0, '#c7bea8'], [16, 0, '#ddd6c4'], [0, 16, '#ddd6c4'], [16, 16, '#c7bea8']] as const) {
      r(x, y, 16, 16, c);
      r(x, y, 16, 1, shade(c, 0.12)); r(x, y, 1, 16, shade(c, 0.08));
      speckle(r, rnd, x + 1, y + 1, 14, 14, 14, [shade(c, -0.1), shade(c, 0.1), mix(c, '#7a8a70', 0.25)]);
      r(x, y + 15, 16, 1, '#b0a790'); r(x + 15, y, 1, 16, '#b0a790');
    }
  });
}

export function buildProps(scene: Phaser.Scene) {
  buildFurniture(scene);
  buildScreens(scene);
  buildBubbles(scene);
  buildFloors(scene);
}

