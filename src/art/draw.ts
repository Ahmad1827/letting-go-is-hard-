import Phaser from 'phaser';

/** Draws a filled rectangle, already offset to the current frame. */
export type R = (x: number, y: number, w: number, h: number, color: string) => void;

/** Parses #rgb or #rrggbb. */
function rgb(hex: string): number {
  const h = hex.slice(1);
  return parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
}

/** Lighten (amt > 0) or darken (amt < 0) a hex color. amt is in -1..1. */
export function shade(hex: string, amt: number): string {
  const n = rgb(hex);
  const ch = (v: number) => Math.round(Math.max(0, Math.min(255, v + amt * (amt > 0 ? 255 - v : v))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

/** Deterministic RNG so the art looks the same on every load. */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T,>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length)];

export function disc(r: R, cx: number, cy: number, rad: number, color: string) {
  for (let y = -rad; y <= rad; y++)
    for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad * 0.8) r(cx + x, cy + y, 1, 1, color);
}

/** Filled ellipse inside the box (x, y, w, h). */
export function oval(r: R, x: number, y: number, w: number, h: number, color: string) {
  const rx = w / 2, ry = h / 2;
  for (let j = 0; j < h; j++) {
    const dy = (j + 0.5 - ry) / ry;
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - dy * dy)));
    if (half > 0) r(x + Math.round(rx) - half, y + j, half * 2, 1, color);
  }
}

/**
 * A rounded limb from (x0, y0) to (x1, y1), `w` pixels thick, lit from the left:
 * the right edge gets `dark`, the left edge `light`.
 */
export function limb(r: R, x0: number, y0: number, x1: number, y1: number, w: number, base: string, dark: string, light?: string) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const pts = Array.from({ length: steps + 1 }, (_, i) => [Math.round(x0 + ((x1 - x0) * i) / steps - w / 2), Math.round(y0 + ((y1 - y0) * i) / steps)]);
  for (const [x, y] of pts) r(x, y, w, 1, dark);
  for (const [x, y] of pts) r(x, y, w - 1, 1, base);
  if (light) for (const [x, y] of pts) r(x, y, 1, 1, light);
}

/**
 * A body part described row by row: `span(y)` returns [left, right) for that row,
 * or null to skip. Shaded with a highlight on the left and two shadow columns on the right.
 */
export function rows(r: R, y0: number, y1: number, span: (y: number) => [number, number] | null, base: string, dark: string, light: string) {
  for (let y = y0; y < y1; y++) {
    const s = span(y);
    if (!s) continue;
    const [a, b] = s;
    r(a, y, b - a, 1, base);
    r(a, y, 1, 1, light);
    r(b - 2, y, 2, 1, dark);
  }
}

/** A lit box: highlight along the top and left, shadow along the bottom and right. */
export function bevel(r: R, x: number, y: number, w: number, h: number, color: string, depth = 0.25) {
  r(x, y, w, h, color);
  r(x, y, w, 1, shade(color, depth));
  r(x, y + 1, 1, h - 1, shade(color, depth * 0.6));
  r(x, y + h - 1, w, 1, shade(color, -depth));
  r(x + w - 1, y + 1, 1, h - 1, shade(color, -depth * 0.8));
}

/** Checkerboard of two colors, the classic way to fake a third shade. */
export function dither(r: R, x: number, y: number, w: number, h: number, a: string, b: string) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) r(x + i, y + j, 1, 1, (i + j) % 2 ? b : a);
}

/** Sprinkle `n` single pixels of `colors` over a box. */
export function speckle(r: R, rnd: () => number, x: number, y: number, w: number, h: number, n: number, colors: readonly string[]) {
  for (let i = 0; i < n; i++) r(x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 1, 1, pick(rnd, colors));
}

/** Soft drop shadow on the floor under a prop. */
export function floorShadow(r: R, x: number, y: number, w: number, h: number) {
  oval(r, x, y, w, h, 'rgba(10,20,30,0.18)');
  oval(r, x + 2, y + 1, w - 4, h - 2, 'rgba(10,20,30,0.14)');
}

/**
 * Selective outline: every see-through pixel touching a solid one gets a dark
 * version of that neighbor's color, which reads much better than flat black.
 */
function outline(c: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number) {
  const img = c.getImageData(x0, y0, w, h), d = img.data;
  const out = new Uint8ClampedArray(d);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 200;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      let n = -1;
      for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]])
        if (solid(x + dx, y + dy)) { n = ((y + dy) * w + x + dx) * 4; break; }
      if (n < 0) continue;
      const i = (y * w + x) * 4;
      out[i] = d[n] * 0.32; out[i + 1] = d[n + 1] * 0.3; out[i + 2] = d[n + 2] * 0.36 + 8; out[i + 3] = 255;
    }
  c.putImageData(new ImageData(out, w, h), x0, y0);
}

export interface ArtOptions { outline?: boolean }

/** A canvas texture with one named frame per entry in `frames`, laid out left to right. */
export function sheet(
  scene: Phaser.Scene,
  key: string,
  fw: number,
  fh: number,
  frames: readonly string[],
  draw: (r: R, frame: string, index: number) => void,
  opts: ArtOptions = {},
) {
  const tex = scene.textures.createCanvas(key, fw * frames.length, fh)!;
  const c = tex.context;
  frames.forEach((name, i) => {
    const ox = i * fw;
    draw((x, y, w, h, color) => {
      c.fillStyle = color;
      c.fillRect(ox + x, y, w, h);
    }, name, i);
    if (opts.outline) outline(c, ox, 0, fw, fh);
    tex.add(name, 0, ox, 0, fw, fh);
  });
  tex.refresh();
}

export function single(scene: Phaser.Scene, key: string, w: number, h: number, draw: (r: R) => void, opts: ArtOptions = {}) {
  const tex = scene.textures.createCanvas(key, w, h)!;
  const c = tex.context;
  draw((x, y, rw, rh, color) => {
    c.fillStyle = color;
    c.fillRect(x, y, rw, rh);
  });
  if (opts.outline) outline(c, 0, 0, w, h);
  tex.refresh();
}

export function loop(scene: Phaser.Scene, key: string, texture: string, frames: string[], frameRate: number) {
  scene.anims.create({ key, frames: frames.map((frame) => ({ key: texture, frame })), frameRate, repeat: -1 });
}
