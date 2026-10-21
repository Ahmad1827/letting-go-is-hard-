import Phaser from 'phaser';
import { limb, loop, mix, oval, rows, shade, sheet, type R } from './draw';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bald' | 'big' | 'bob' | 'bun' | 'flattop';
  shirt: string;
  jacket: string | null;
  tie: string | null;
  pants: string;
  shoes: string;
  pads: boolean;
  glasses: boolean;
  lips?: string;
  skirt?: boolean;
  mustache?: boolean;
  /** Leg length in pixels relative to average, roughly -3..3. */
  tall?: number;
  /** Extra shoulder/waist width, 0..3. */
  build?: number;
}

/** The office staff. Each one becomes a texture `person<i>`. */
export const CAST: { name: string; look: Look }[] = [
  { name: 'Dana', look: { skin: '#f1c27d', hair: '#5a3825', hairStyle: 'big', shirt: '#f4f4f4', jacket: '#7a2e4a', tie: null, pants: '#2d3142', shoes: '#1a1a1a', pads: true, glasses: false, lips: '#b8404a', skirt: true, tall: -1 } },
  { name: 'Rick', look: { skin: '#e0ac69', hair: '#2b1d14', hairStyle: 'short', shirt: '#a9c6e8', jacket: '#2d3a5c', tie: '#b32d2d', pants: '#2d3a5c', shoes: '#3b2414', pads: false, glasses: false, tall: 2, build: 1 } },
  { name: 'Sharon', look: { skin: '#8d5524', hair: '#1a1a1a', hairStyle: 'long', shirt: '#e8d9a9', jacket: '#2e6b5a', tie: null, pants: '#2d3142', shoes: '#1a1a1a', pads: true, glasses: false, lips: '#7a2a30', skirt: true } },
  { name: 'Gary', look: { skin: '#ffdbac', hair: '#8c8c8c', hairStyle: 'bald', shirt: '#f4f4f4', jacket: null, tie: '#d4a017', pants: '#5a4a3a', shoes: '#3b2414', pads: false, glasses: true, mustache: true, tall: -2, build: 3 } },
  { name: 'Tina', look: { skin: '#ffdbac', hair: '#e6c36a', hairStyle: 'big', shirt: '#c94c4c', jacket: null, tie: null, pants: '#2d3142', shoes: '#1a1a1a', pads: true, glasses: false, lips: '#c0405a', tall: 0 } },
  { name: 'Marcus', look: { skin: '#6b4423', hair: '#1a1a1a', hairStyle: 'flattop', shirt: '#f4f4f4', jacket: '#3d3d45', tie: '#6a2d8f', pants: '#3d3d45', shoes: '#1a1a1a', pads: false, glasses: true, tall: 3, build: 2 } },
  { name: 'Linda', look: { skin: '#e0ac69', hair: '#b5651d', hairStyle: 'bun', shirt: '#a9c6e8', jacket: '#9c8458', tie: null, pants: '#5a4a3a', shoes: '#3b2414', pads: true, glasses: true, lips: '#a8404a', skirt: true, tall: 1 } },
  { name: 'Raj', look: { skin: '#c68642', hair: '#2b1d14', hairStyle: 'short', shirt: '#e8e0d0', jacket: null, tie: '#2e6b3a', pants: '#3a4560', shoes: '#1a1a1a', pads: false, glasses: false, mustache: true, tall: 1 } },
  { name: 'Bev', look: { skin: '#f3d0b0', hair: '#c8c8d0', hairStyle: 'bob', shirt: '#e8c8e0', jacket: '#4a5a8a', tie: null, pants: '#2d3142', shoes: '#4a2a2a', pads: true, glasses: true, lips: '#b04a6a', skirt: true, tall: -2, build: 1 } },
  { name: 'Doug', look: { skin: '#e8b88a', hair: '#a0522d', hairStyle: 'flattop', shirt: '#f4f0e0', jacket: '#6a5a3a', tie: '#2d4a8a', pants: '#4a3a2a', shoes: '#3b2414', pads: false, glasses: false, tall: 0, build: 2 } },
  { name: 'Keisha', look: { skin: '#5a3420', hair: '#141010', hairStyle: 'bun', shirt: '#f0e0a0', jacket: '#8a2a2a', tie: null, pants: '#1e1e28', shoes: '#1a1a1a', pads: true, glasses: false, lips: '#6a1a28', tall: 2 } },
  { name: 'Tom', look: { skin: '#f0c8a0', hair: '#d8b060', hairStyle: 'short', shirt: '#c8d8c0', jacket: null, tie: '#8a2a4a', pants: '#2a3a4a', shoes: '#1a1a1a', pads: false, glasses: false, tall: -1 } },
];

export const FRAME_W = 48;
export const FRAME_H = 96;
/** The row the feet rest on, used as the sprite origin. */
export const FEET_Y = 92;

type Dir = 'down' | 'up' | 'side';
type Pose = 'stand' | 'typeA' | 'typeB' | 'raise0' | 'raise1';
type Leg = 0 | 1 | 2;

const FRAMES: [string, Dir, Leg, Pose][] = [
  ['down0', 'down', 0, 'stand'], ['down1', 'down', 1, 'stand'], ['down2', 'down', 2, 'stand'],
  ['up0', 'up', 0, 'stand'], ['up1', 'up', 1, 'stand'], ['up2', 'up', 2, 'stand'],
  ['side0', 'side', 0, 'stand'], ['side1', 'side', 1, 'stand'], ['side2', 'side', 2, 'stand'],
  ['typeA', 'up', 0, 'typeA'], ['typeB', 'up', 0, 'typeB'],
  ['raise0', 'down', 0, 'raise0'], ['raise1', 'down', 0, 'raise1'],
];

const CX = 24;
const FOOT = 91;
const EYE = '#1e1418';
const WHITE = '#f4f0ea';

/** Key heights and widths for one person, derived from their build. */
interface Body {
  hip: number; // first row of the legs
  sh: number; // shoulder row
  head: number; // top row of the skull
  shw: number; // shoulder half-width
  ww: number; // waist half-width
}

function body(look: Look): Body {
  const legLen = 30 + (look.tall ?? 0);
  const hip = FOOT - 4 - legLen;
  const sh = hip - 26;
  const b = look.build ?? 0;
  return { hip, sh, head: sh - 20, shw: 10 + b + (look.pads ? 2 : 0), ww: 8 + Math.ceil(b / 2) };
}

const ramp = (c: string) => ({ c, d: shade(c, -0.22), dd: shade(c, -0.38), l: shade(c, 0.16) });

// ------------------------------------------------------------------ head & hair

function headSpan(H: number, side = false) {
  return (y: number): [number, number] | null => {
    const k = y - H;
    const hw = k === 0 ? 4 : k === 1 ? 6 : k < 13 ? 7 : k === 13 ? 6 : k === 14 ? 5 : k === 15 ? 4 : k === 16 ? 3 : -1;
    if (hw < 0) return null;
    const shift = side ? 1 : 0;
    return [CX - hw + shift, CX + hw + shift];
  };
}

function drawHair(r: R, look: Look, dir: Dir, H: number, front: boolean) {
  const { c, d, dd, l } = ramp(look.hair);
  const s = look.hairStyle;
  const span = (y0: number, y1: number, f: (y: number) => [number, number] | null) => rows(r, y0, y1, f, c, d, l);
  const sx = dir === 'side' ? 1 : 0;

  // the cap of hair over the top of the skull, common to most styles
  const cap = (extra = 0) => span(H - 2 - extra, H + 4, (y) => {
    const k = y - (H - 2 - extra);
    const hw = Math.min(8 + (extra > 0 ? 1 : 0), 3 + k * 2);
    return [CX - hw + sx, CX + hw + sx];
  });

  if (s === 'bald') {
    if (dir === 'up') span(H + 6, H + 13, () => [CX - 8, CX + 8]);
    else if (dir === 'down') { span(H + 5, H + 11, () => [CX - 8, CX - 6]); span(H + 5, H + 11, () => [CX + 6, CX + 8]); }
    else span(H + 5, H + 12, () => [CX - 7, CX - 1]);
    if (dir !== 'up') r(CX - 3 + sx, H + 1, 3, 1, shade(look.skin, 0.3));
    return;
  }
  if (!front && (s === 'long' || s === 'big')) {
    // the part that hangs behind the shoulders
    const len = s === 'long' ? 30 : 24, hw = s === 'big' ? 11 : 9;
    span(H + 4, H + len, (y) => {
      const k = y - H;
      const w = s === 'big' ? hw - Math.max(0, k - 20) : hw;
      return dir === 'side' ? [CX - w + 1, CX + 2] : [CX - w, CX + w];
    });
    if (s === 'long') for (let y = H + 8; y < H + len - 2; y += 3) r(CX - 2, y, 1, 2, dd);
    return;
  }
  if (!front) return;

  if (s === 'big') {
    span(H - 5, H + 4, (y) => {
      const k = y - (H - 5);
      const hw = Math.min(11, 4 + k * 2);
      return [CX - hw + sx, CX + hw + sx];
    });
    if (dir === 'down') for (const x of [-7, -4, 2, 5]) r(CX + x, H + 4, 3, 1, c); // teased bangs
    for (const [x, y] of [[-6, -3], [-2, -4], [3, -3], [-8, 0], [6, 0], [-9, 3], [8, 3], [0, -1], [-4, 1], [3, 1]]) { r(CX + x + sx, H + y, 2, 1, l); r(CX + x + sx + 1, H + y + 1, 1, 1, d); }
  } else if (s === 'flattop') {
    span(H - 5, H + 4, (y) => [CX - (y - H < -4 ? 6 : 8) + sx, CX + (y - H < -4 ? 6 : 8) + sx]);
    r(CX - 6 + sx, H - 5, 12, 1, l);
  } else if (s === 'bun') {
    cap();
    if (dir === 'up') { span(H - 6, H - 1, () => [CX - 4, CX + 4]); r(CX - 2, H - 5, 3, 1, l); }
    else if (dir === 'side') span(H - 4, H + 2, () => [CX - 9, CX - 3]);
    else { span(H - 6, H - 2, () => [CX - 3, CX + 3]); }
  } else if (s === 'bob') {
    cap(1);
  } else {
    cap();
  }

  // the sides and fringe, which depend on which way the head is turned
  if (dir === 'down') {
    if (s === 'short' || s === 'flattop') {
      span(H + 4, H + 9, () => [CX - 8, CX - 6]); span(H + 4, H + 9, () => [CX + 6, CX + 8]);
      r(CX - 6, H + 4, 5, 1, c); r(CX + 1, H + 4, 4, 1, c); r(CX - 5, H + 5, 2, 1, d);
    } else if (s === 'bob') {
      span(H + 3, H + 16, () => [CX - 9, CX - 5]); span(H + 3, H + 16, () => [CX + 5, CX + 9]);
      span(H + 3, H + 6, () => [CX - 7, CX + 7]); r(CX - 9, H + 16, 4, 1, d); r(CX + 5, H + 16, 4, 1, d);
    } else if (s === 'long' || s === 'big') {
      const w = s === 'big' ? 11 : 9;
      span(H + 3, H + 22, () => [CX - w, CX - 5]); span(H + 3, H + 22, () => [CX + 5, CX + w]);
      r(CX - 7, H + 4, 6, 1, c); r(CX + 2, H + 4, 5, 1, c); r(CX - 6, H + 5, 3, 1, c); r(CX - 1, H + 3, 2, 2, dd);
    } else if (s === 'bun') {
      span(H + 3, H + 8, () => [CX - 8, CX - 6]); span(H + 3, H + 8, () => [CX + 6, CX + 8]);
      r(CX - 6, H + 3, 12, 1, c);
    }
  } else if (dir === 'up') {
    const len = s === 'bob' ? 16 : s === 'long' || s === 'big' ? 18 : 13;
    span(H + 3, H + 3 + len, (y) => {
      const k = y - H;
      const hw = s === 'bob' ? 9 : s === 'big' ? 11 : s === 'long' ? 9 : k > 13 ? 6 : 8;
      return [CX - hw, CX + hw];
    });
    if (s === 'short' || s === 'flattop' || s === 'bun') r(CX - 5, H + 15, 10, 1, dd);
  } else {
    // profile facing right: hair covers the back half of the head
    if (s === 'bob') span(H + 3, H + 16, () => [CX - 8, CX + 2]);
    else if (s === 'long' || s === 'big') span(H + 3, H + 10, () => [CX - (s === 'big' ? 11 : 8), CX + 2]);
    else span(H + 3, H + 13, (y) => [CX - 7, CX + (y - H < 6 ? 3 : 0)]);
    r(CX + 2, H + 4, 6, 1, c); r(CX + 5, H + 3, 3, 1, c);
  }
}

function drawFace(r: R, look: Look, H: number) {
  const skin = look.skin, sd = shade(skin, -0.2), brow = shade(look.hair, -0.15);
  const L = CX - 5, Rr = CX + 2; // left edge of each eye pair
  // ears
  r(CX - 8, H + 7, 1, 4, skin); r(CX - 8, H + 8, 1, 2, sd); r(CX + 7, H + 7, 1, 4, sd);
  // brows and eyes
  r(L, H + 6, 3, 1, brow); r(Rr, H + 6, 3, 1, brow);
  r(L, H + 8, 1, 2, WHITE); r(L + 1, H + 8, 2, 2, EYE); r(L + 1, H + 8, 1, 1, '#5a4a52');
  r(Rr, H + 8, 2, 2, EYE); r(Rr + 2, H + 8, 1, 2, WHITE); r(Rr, H + 8, 1, 1, '#5a4a52');
  r(L, H + 10, 3, 1, shade(skin, -0.08)); r(Rr, H + 10, 3, 1, shade(skin, -0.08));
  // nose
  r(CX - 1, H + 9, 1, 3, shade(skin, 0.1)); r(CX, H + 10, 1, 2, sd); r(CX - 1, H + 12, 2, 1, sd);
  // cheeks
  r(CX - 6, H + 11, 2, 1, mix(skin, '#e06070', 0.28)); r(CX + 4, H + 11, 2, 1, mix(skin, '#e06070', 0.28));
  // mouth
  if (look.mustache) { r(CX - 3, H + 13, 6, 1, shade(look.hair, -0.1)); r(CX - 2, H + 14, 4, 1, shade(skin, -0.35)); }
  else if (look.lips) { r(CX - 2, H + 14, 4, 1, look.lips); r(CX - 1, H + 15, 2, 1, shade(look.lips, 0.2)); }
  else { r(CX - 2, H + 14, 4, 1, shade(skin, -0.35)); r(CX - 1, H + 15, 2, 1, shade(skin, -0.1)); }
  if (look.glasses) {
    const f = '#2b2b30';
    for (const gx of [L - 1, Rr - 1]) { r(gx, H + 7, 5, 1, f); r(gx, H + 10, 5, 1, f); r(gx, H + 8, 1, 2, f); r(gx + 4, H + 8, 1, 2, f); }
    r(CX - 1, H + 8, 2, 1, f); r(CX - 8, H + 8, 2, 1, f); r(CX + 6, H + 8, 2, 1, f);
    r(L, H + 8, 1, 1, '#d8eef8'); r(Rr, H + 8, 1, 1, '#d8eef8');
  }
}

function drawProfile(r: R, look: Look, H: number) {
  const skin = look.skin, sd = shade(skin, -0.2);
  r(CX + 8, H + 8, 1, 3, skin); r(CX + 9, H + 9, 1, 2, skin); r(CX + 8, H + 11, 2, 1, sd); // nose
  r(CX + 3, H + 6, 4, 1, shade(look.hair, -0.15));
  r(CX + 4, H + 8, 2, 2, EYE); r(CX + 6, H + 8, 1, 2, WHITE);
  r(CX - 2, H + 7, 3, 4, sd); r(CX - 1, H + 8, 1, 2, shade(skin, -0.35)); // ear
  r(CX + 3, H + 11, 2, 1, mix(skin, '#e06070', 0.28));
  if (look.mustache) r(CX + 5, H + 13, 3, 1, shade(look.hair, -0.1));
  r(CX + 5, H + 14, 3, 1, look.lips ?? shade(skin, -0.35));
  r(CX + 1, H + 15, 5, 2, sd); // jaw shadow
  if (look.glasses) { const f = '#2b2b30'; r(CX + 3, H + 7, 5, 1, f); r(CX + 3, H + 10, 5, 1, f); r(CX + 7, H + 8, 1, 2, f); r(CX, H + 8, 3, 1, f); r(CX + 5, H + 8, 1, 1, '#d8eef8'); }
}

function drawHead(r: R, look: Look, dir: Dir, H: number, backHair: boolean) {
  const skin = look.skin;
  const side = dir === 'side';
  // neck
  rows(r, H + 15, H + 21, () => [CX - 3 + (side ? 1 : 0), CX + 3 + (side ? 1 : 0)], shade(skin, -0.12), shade(skin, -0.3), skin);
  r(CX - 3 + (side ? 1 : 0), H + 16, 6, 1, shade(skin, -0.35));
  if (backHair) drawHair(r, look, dir, H, false);
  rows(r, H, H + 17, headSpan(H, side), skin, shade(skin, -0.14), shade(skin, 0.12));
  if (dir === 'down') drawFace(r, look, H);
  else if (side) drawProfile(r, look, H);
  else { r(CX - 8, H + 7, 1, 4, skin); r(CX + 7, H + 7, 1, 4, shade(skin, -0.2)); }
  drawHair(r, look, dir, H, true);
}

// ------------------------------------------------------------------ body

function legsFront(r: R, look: Look, b: Body, leg: Leg) {
  const p = ramp(look.pants), sh = look.shoes;
  const skirt = look.skirt;
  const legC = skirt ? mix(look.skin, '#3a3040', 0.35) : p.c;
  const legW = skirt ? 5 : 7;
  for (const side of [-1, 1] as const) {
    const lift = (side < 0 && leg === 1) || (side > 0 && leg === 2) ? 3 : 0;
    const x = side < 0 ? CX - 1 - legW : CX + 1;
    const top = skirt ? b.hip + 10 : b.hip;
    rows(r, top, FOOT - 3 - lift, () => [x, x + legW], legC, shade(legC, -0.22), shade(legC, 0.15));
    if (!skirt) r(x + (side < 0 ? 4 : 2), b.hip + 3, 1, FOOT - b.hip - 8 - lift, p.d); // crease
    // shoes
    const sy = FOOT - 4 - lift;
    if (skirt) {
      r(x - 1, sy + 1, legW + 2, 3, sh); r(x, sy + 1, 3, 1, shade(sh, 0.4));
    } else {
      r(x - 1, sy, legW + 2, 5, sh);
      r(x, sy + 1, 4, 1, shade(sh, 0.4)); r(x - 1, sy + 4, legW + 2, 1, shade(sh, -0.3));
    }
  }
  if (!skirt) rows(r, b.hip, b.hip + 3, () => [CX - 8, CX + 8], p.c, p.d, p.l);
}

function legsSide(r: R, look: Look, b: Body, leg: Leg) {
  const skirt = look.skirt;
  const legC = skirt ? mix(look.skin, '#3a3040', 0.35) : look.pants;
  const w = skirt ? 5 : 7;
  const hipX = CX;
  const top = skirt ? b.hip + 8 : b.hip + 1;
  const stride = leg === 0 ? 0 : 7;
  const near = leg === 2 ? -1 : 1; // which leg reaches forward
  const legs = leg === 0 ? [[0, legC]] : [[-stride * near, shade(legC, -0.25)], [stride * near, legC]];
  for (const [dx, c] of legs as [number, string][]) {
    limb(r, hipX, top, hipX + dx, FOOT - 4, w, c, shade(c, -0.22), shade(c, 0.15));
    const fx = hipX + dx - Math.floor(w / 2);
    const sc = c === legC ? look.shoes : shade(look.shoes, -0.2);
    r(fx - 1, FOOT - 3, w + 4, 4, sc); r(fx, FOOT - 3, 4, 1, shade(sc, 0.4)); r(fx + w + 2, FOOT - 1, 1, 2, sc);
  }
  if (!skirt) rows(r, b.hip, b.hip + 4, () => [CX - 6, CX + 6], look.pants, shade(look.pants, -0.22), shade(look.pants, 0.15));
}

function torsoSpan(b: Body, side: boolean) {
  return (y: number): [number, number] | null => {
    const k = y - b.sh;
    if (side) {
      const front = k < 2 ? 5 : k < 14 ? 7 : 6;
      return [CX - 6, CX + front];
    }
    const t = Math.min(1, k / 20);
    let hw = Math.round(b.shw + (b.ww - b.shw) * t);
    if (k === 0) hw -= 3;
    if (k === 1) hw -= 1;
    return [CX - hw, CX + hw];
  };
}

function drawTorso(r: R, look: Look, b: Body, dir: Dir) {
  const t = ramp(look.jacket ?? look.shirt);
  const side = dir === 'side';
  const bottom = b.hip + (look.jacket && !side ? 2 : 0);
  rows(r, b.sh, bottom, torsoSpan(b, side), t.c, t.d, t.l);
  if (look.skirt) {
    const sk = ramp(look.pants);
    rows(r, b.hip - 1, b.hip + 11, (y) => {
      const k = y - b.hip;
      const hw = b.ww + 1 + Math.floor(k / 4);
      return side ? [CX - 6 - Math.floor(k / 5), CX + 7 + Math.floor(k / 4)] : [CX - hw, CX + hw];
    }, sk.c, sk.d, sk.l);
    r(CX - b.ww - 3, b.hip + 10, (b.ww + 3) * 2, 1, sk.d);
  }
  const belt = '#2a2420';
  if (!look.skirt && !look.jacket) r(CX - b.ww + (side ? 2 : 0), b.hip - 2, side ? 13 : b.ww * 2, 2, belt);

  if (side) {
    if (look.jacket) { r(CX + 4, b.sh + 1, 3, 9, look.shirt); r(CX + 5, b.sh + 10, 2, 9, t.dd); }
    else r(CX + 5, b.sh + 2, 2, 2, shade(look.shirt, 0.3));
    if (look.tie) { r(CX + 6, b.sh + 2, 1, 14, look.tie); r(CX + 6, b.sh + 2, 1, 2, shade(look.tie, -0.3)); }
    return;
  }
  if (dir === 'up') {
    if (look.jacket) { r(CX - 4, b.sh, 8, 2, look.shirt); r(CX - 4, b.sh + 2, 8, 1, t.d); r(CX, b.sh + 18, 1, bottom - b.sh - 18, t.dd); }
    else { r(CX - 5, b.sh, 10, 2, shade(look.shirt, -0.1)); r(CX - b.shw + 3, b.sh + 8, (b.shw - 3) * 2, 1, t.d); }
    return;
  }
  // front details
  if (!look.skirt && !look.jacket) r(CX - 2, b.hip - 2, 4, 2, '#c9a227');
  if (look.jacket) {
    const s = look.shirt;
    for (let k = 0; k < 14; k++) {
      const hw = Math.max(0, 4 - Math.floor(k / 3));
      if (hw) r(CX - hw, b.sh + k, hw * 2, 1, s);
      r(CX - hw - 1, b.sh + k, 1, 1, t.dd); r(CX + hw, b.sh + k, 1, 1, t.dd);
    }
    // lapels
    r(CX - 7, b.sh + 1, 2, 9, t.l); r(CX + 5, b.sh + 1, 2, 9, t.d);
    r(CX - 1, b.sh + 16, 2, 1, t.dd); r(CX - 1, b.sh + 21, 2, 1, t.dd);
    r(CX, b.sh + 14, 1, bottom - b.sh - 14, t.d);
    r(CX - b.ww + 2, b.sh + 19, 5, 1, t.dd); r(CX + b.ww - 7, b.sh + 19, 5, 1, t.dd); // pocket flaps
    r(CX + b.ww - 7, b.sh + 4, 3, 2, shade(s, -0.05)); // pocket square
  } else {
    const s = shade(look.shirt, 0.35);
    r(CX - 5, b.sh, 4, 2, s); r(CX + 1, b.sh, 4, 2, s); r(CX - 4, b.sh + 2, 2, 1, s); r(CX + 2, b.sh + 2, 2, 1, s);
    r(CX, b.sh + 3, 1, b.hip - b.sh - 5, t.d);
    for (let y = b.sh + 6; y < b.hip - 3; y += 5) r(CX - 1, y, 1, 1, t.dd);
    r(CX + 3, b.sh + 6, 5, 5, shade(look.shirt, -0.06)); r(CX + 3, b.sh + 6, 5, 1, t.d); // pocket
    r(CX + 4, b.sh + 4, 1, 3, '#2d5fa8'); // pen
  }
  if (look.tie) {
    const k = ramp(look.tie);
    r(CX - 2, b.sh + 1, 4, 3, k.d); r(CX - 1, b.sh + 1, 2, 1, k.l);
    rows(r, b.sh + 4, b.sh + 18, (y) => { const q = y - b.sh - 4; const hw = q < 8 ? 1 : 2; return [CX - hw, CX + hw + (q < 8 ? 1 : 0)]; }, k.c, k.d, k.l);
    r(CX - 1, b.sh + 18, 2, 1, k.c);
    for (let y = b.sh + 6; y < b.sh + 17; y += 4) r(CX - 1, y, 2, 1, k.l);
  }
}

function hand(r: R, look: Look, x: number, y: number) {
  r(x - 2, y, 5, 4, look.skin); r(x - 2, y, 5, 1, shade(look.skin, -0.12)); r(x + 2, y + 1, 1, 3, shade(look.skin, -0.25)); r(x - 1, y + 4, 3, 1, look.skin);
}

function arm(r: R, look: Look, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) {
  const t = ramp(look.jacket ?? look.shirt);
  limb(r, x0, y0, x1, y1, 5, t.c, t.d, t.l);
  limb(r, x1, y1, x2, y2, 5, t.c, t.d, t.l);
  if (look.jacket) limb(r, x2 - (x2 - x1) * 0.15, y2 - 1, x2, y2, 5, look.shirt, shade(look.shirt, -0.2));
}

function drawArms(r: R, look: Look, b: Body, dir: Dir, leg: Leg, pose: Pose, layer: 'back' | 'front') {
  const lx = CX - b.shw + 2, rx = CX + b.shw - 2, sy = b.sh + 2;
  if (dir === 'side') {
    const swing = leg === 0 ? 0 : leg === 1 ? 7 : -7;
    if (layer === 'back') {
      // the far arm, mostly hidden behind the body
      if (leg) { arm(r, { ...look, jacket: shade(look.jacket ?? look.shirt, -0.25) }, CX, sy, CX - swing / 2, sy + 12, CX - swing, b.hip); hand(r, { ...look, skin: shade(look.skin, -0.2) }, CX - swing, b.hip); }
      return;
    }
    arm(r, look, CX, sy, CX + swing / 2, sy + 12, CX + swing, b.hip);
    hand(r, look, CX + swing, b.hip);
    return;
  }
  if (pose === 'typeA' || pose === 'typeB') {
    // seen from behind at the keyboard: forearms disappear in front of the body
    const a = pose === 'typeA' ? 1 : 0;
    const t = ramp(look.jacket ?? look.shirt);
    if (layer === 'back') {
      limb(r, lx - 1, sy + 12 - a, lx + 6, sy + 9 - a, 5, t.d, t.dd);
      limb(r, rx + 1, sy + 12 - (1 - a), rx - 6, sy + 9 - (1 - a), 5, t.d, t.dd);
      return;
    }
    limb(r, lx, sy - a, lx - 1, sy + 13 - a, 5, t.c, t.d, t.l);
    limb(r, rx, sy - (1 - a), rx + 1, sy + 13 - (1 - a), 5, t.c, t.d, t.l);
    return;
  }
  if (layer === 'back') return;
  if (pose === 'raise0' || pose === 'raise1') {
    arm(r, look, lx, sy, lx - 2, sy + 12, lx - 1, b.hip);
    hand(r, look, lx - 1, b.hip);
    const hx = pose === 'raise0' ? rx + 4 : rx + 7;
    arm(r, look, rx, sy, rx + 5, sy - 8, hx, sy - 17);
    const hy = sy - 23;
    r(hx - 2, hy, 6, 6, look.skin); r(hx - 2, hy - 2, 1, 3, look.skin); r(hx, hy - 3, 1, 3, look.skin); r(hx + 2, hy - 2, 1, 2, look.skin);
    r(hx + 3, hy + 1, 1, 5, shade(look.skin, -0.25)); r(hx - 3, hy + 3, 1, 2, look.skin);
    return;
  }
  // walking, seen from the front or back: hands bob as the arms swing
  const lUp = leg === 1 ? -3 : leg === 2 ? 1 : 0, rUp = leg === 2 ? -3 : leg === 1 ? 1 : 0;
  arm(r, look, lx, sy, lx - 2, sy + 12, lx - 1, b.hip + lUp);
  hand(r, look, lx - 1, b.hip + lUp);
  arm(r, look, rx, sy, rx + 2, sy + 12, rx + 1, b.hip + rUp);
  hand(r, look, rx + 1, b.hip + rUp);
}

function drawPerson(r: R, look: Look, dir: Dir, leg: Leg, pose: Pose) {
  const b = body(look);
  oval(r, 11, FOOT - 3, 26, 8, 'rgba(0,0,0,0.22)');
  if (dir === 'side') legsSide(r, look, b, leg);
  else legsFront(r, look, b, leg);
  drawArms(r, look, b, dir, leg, pose, 'back');
  // long hair hangs behind the shoulders unless we're looking at their back
  if (dir !== 'up') drawHair(r, look, dir, b.head, false);
  drawTorso(r, look, b, dir);
  if (dir === 'up') drawHead(r, look, dir, b.head + (pose === 'typeA' ? 1 : 0), true);
  drawArms(r, look, b, dir, leg, pose, 'front');
  if (dir !== 'up') drawHead(r, look, dir, b.head, false);
}

export function buildPeople(scene: Phaser.Scene) {
  CAST.forEach((member, i) => {
    const key = `person${i}`;
    sheet(scene, key, FRAME_W, FRAME_H, FRAMES.map((f) => f[0]), (r, _name, idx) => {
      const [, dir, leg, pose] = FRAMES[idx];
      drawPerson(r, member.look, dir, leg, pose);
    }, { outline: true });
    loop(scene, `${key}-walk-down`, key, ['down1', 'down0', 'down2', 'down0'], 7);
    loop(scene, `${key}-walk-up`, key, ['up1', 'up0', 'up2', 'up0'], 7);
    loop(scene, `${key}-walk-side`, key, ['side1', 'side0', 'side2', 'side0'], 7);
    loop(scene, `${key}-type`, key, ['typeA', 'typeB'], 6);
    loop(scene, `${key}-raise`, key, ['raise0', 'raise1'], 3);
  });
}
