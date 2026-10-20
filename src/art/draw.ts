import Phaser from 'phaser';

/** Draws a filled rectangle, already offset to the current frame. */
export type R = (x: number, y: number, w: number, h: number, color: string) => void;

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb color. amt is in -1..1. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(Math.max(0, Math.min(255, v + amt * (amt > 0 ? 255 - v : v))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
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

/** A canvas texture with one named frame per entry in `frames`, laid out left to right. */
export function sheet(
  scene: Phaser.Scene,
  key: string,
  fw: number,
  fh: number,
  frames: readonly string[],
  draw: (r: R, frame: string, index: number) => void,
) {
  const tex = scene.textures.createCanvas(key, fw * frames.length, fh)!;
  const c = tex.context;
  frames.forEach((name, i) => {
    const ox = i * fw;
    draw((x, y, w, h, color) => {
      c.fillStyle = color;
      c.fillRect(ox + x, y, w, h);
    }, name, i);
    tex.add(name, 0, ox, 0, fw, fh);
  });
  tex.refresh();
}

export function single(scene: Phaser.Scene, key: string, w: number, h: number, draw: (r: R) => void) {
  const tex = scene.textures.createCanvas(key, w, h)!;
  const c = tex.context;
  draw((x, y, rw, rh, color) => {
    c.fillStyle = color;
    c.fillRect(x, y, rw, rh);
  });
  tex.refresh();
}

export function loop(scene: Phaser.Scene, key: string, texture: string, frames: string[], frameRate: number) {
  scene.anims.create({ key, frames: frames.map((frame) => ({ key: texture, frame })), frameRate, repeat: -1 });
}
