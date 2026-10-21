import Phaser from 'phaser';
import { disc, mix, oval, rng, shade, single } from './draw';

export type Phase = 'day' | 'dusk' | 'night';

/** The view outside follows the player's real clock. */
export function currentPhase(hour = new Date().getHours()): Phase {
  if (hour >= 7 && hour < 17) return 'day';
  if ((hour >= 17 && hour < 20) || (hour >= 5 && hour < 7)) return 'dusk';
  return 'night';
}

const THEMES: Record<Phase, { sky: string[]; far: string; water: string; bld: string; lit: string; litP: number; tower: string; stars: number; cloud: string | null }> = {
  day: { sky: ['#3f7cc2', '#7fb6e6', '#cfe8f6'], far: '#8a9bb0', water: '#4f7aa8', bld: '#6f7c8e', lit: '#d8e2ea', litP: 0.05, tower: '#b9c2cc', stars: 0, cloud: '#f4f8fc' },
  dusk: { sky: ['#2a1f4f', '#7a4278', '#e9805e', '#f7c46c'], far: '#4a3550', water: '#8a5a7a', bld: '#3b3150', lit: '#ffd97a', litP: 0.28, tower: '#c08a86', stars: 12, cloud: '#e8a0a0' },
  night: { sky: ['#02030c', '#0a0e2c', '#1c1a48', '#3a2450'], far: '#10142a', water: '#0c1230', bld: '#0e1120', lit: '#ffd870', litP: 0.46, tower: '#20242f', stars: 170, cloud: null },
};

function gradient(stops: string[], t: number): string {
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  return mix(stops[seg], stops[seg + 1], t * (stops.length - 1) - seg);
}

export const BAND_H = 144;

/** The window wall's layout: glass between GLASS_TOP and SILL, a steel column every MULLION_STEP px. */
export const GLASS_TOP = 16, SILL = 128, MULLION_STEP = 20, MULLION_W = 8;
const HORIZON = 104, WATER_END = 118;

/**
 * The top wall: the Manhattan skyline seen through narrow floor-to-ceiling
 * windows between steel columns, with the other tower filling the right side.
 */
export function buildBand(scene: Phaser.Scene, width: number, phase: Phase) {
  const th = THEMES[phase];
  single(scene, 'band', width, BAND_H, (r) => {
    const rnd = rng(1973);
    // sky, banded the way a 256-color palette would draw it
    for (let y = GLASS_TOP; y < SILL; y++) {
      const t = Math.min(1, (y - GLASS_TOP) / (HORIZON - GLASS_TOP - 6));
      const a = gradient(th.sky, t), b = gradient(th.sky, Math.min(1, t + 0.04));
      for (let x = 0; x < width; x += 2) { r(x, y, 1, 1, a); r(x + 1, y, 1, 1, (y % 2) ? b : a); }
    }
    for (let i = 0; i < th.stars; i++) {
      const sx = Math.floor(rnd() * width), sy = GLASS_TOP + Math.floor(rnd() * 50);
      r(sx, sy, 1, 1, rnd() < 0.25 ? '#fff' : '#8890a8');
    }
    if (phase === 'night') { disc(r, 140, 34, 6, '#f4f0d8'); disc(r, 143, 32, 5, th.sky[1]); }
    if (phase === 'day') { disc(r, 120, 30, 7, '#fff8d8'); disc(r, 120, 30, 5, '#fffef0'); }
    if (th.cloud) {
      for (const [cx, cy, w] of [[60, 40, 40], [330, 30, 56], [620, 50, 34], [900, 36, 46], [1180, 44, 60], [1460, 32, 40]]) {
        oval(r, cx, cy, w, 8, th.cloud); oval(r, cx + w * 0.2, cy - 5, w * 0.5, 9, th.cloud);
        r(cx + 4, cy + 6, w - 8, 1, shade(th.cloud, -0.12));
      }
    }

    // far shore (New Jersey) and the river
    for (let x = 0; x < width; x++) {
      const h = 2 + Math.floor(rnd() * 4) + (Math.sin(x / 17) > 0.7 ? 4 : 0);
      r(x, HORIZON - h, 1, h, th.far);
    }
    for (let y = HORIZON; y < WATER_END; y++) r(0, y, width, 1, shade(th.water, -(y - HORIZON) * 0.015));
    for (let i = 0; i < 80; i++) r(Math.floor(rnd() * width), HORIZON + 1 + Math.floor(rnd() * 10), 2 + Math.floor(rnd() * 4), 1, shade(th.water, 0.22));
    if (phase === 'night') {
      // Jersey City lights across the river, and their reflections in the water
      for (let i = 0; i < 140; i++) {
        const x = Math.floor(rnd() * width), c = rnd() < 0.7 ? '#ffd870' : '#fff2c0';
        r(x, HORIZON - 1 - Math.floor(rnd() * 5), 1, 1, c);
        if (rnd() < 0.5) for (let k = 0; k < 3; k++) r(x, HORIZON + 2 + k * 3 + Math.floor(rnd() * 2), 1, 2, 'rgba(255,216,112,0.35)');
      }
    }
    // a ferry heading for Staten Island
    r(410, HORIZON + 4, 14, 2, '#e8e0c8'); r(413, HORIZON + 2, 7, 2, '#f4c040'); r(410, HORIZON + 6, 14, 1, shade(th.water, -0.3));

    // a famous art-deco silhouette uptown, setbacks and all
    const deco = shade(th.bld, 0.15), decoD = shade(deco, -0.2);
    const ex = 500;
    r(ex, 76, 28, 52, deco); r(ex + 4, 64, 20, 12, deco); r(ex + 8, 54, 12, 10, deco); r(ex + 11, 44, 6, 10, deco); r(ex + 13, 28, 2, 16, deco);
    r(ex + 20, 76, 8, 52, decoD); r(ex + 18, 64, 6, 12, decoD); r(ex + 16, 54, 4, 10, decoD);
    if (phase !== 'day') {
      r(ex + 8, 54, 12, 1, th.lit); r(ex + 11, 44, 6, 1, th.lit); r(ex + 13, 28, 2, 1, '#f55');
      for (let yy = 78; yy < 124; yy += 4) for (let xx = ex + 2; xx < ex + 26; xx += 3) if (rnd() < th.litP) r(xx, yy, 1, 2, th.lit);
    } else for (let yy = 78; yy < 124; yy += 4) r(ex + 2, yy, 24, 1, shade(deco, 0.1));

    // nearby rooftops with water towers and windows
    let x = 0;
    while (x < width - 220) {
      const w = 12 + Math.floor(rnd() * 24), top = 80 + Math.floor(rnd() * 36);
      if (x < ex + 30 && x + w > ex - 2) { x = ex + 30; continue; }
      const c = shade(th.bld, (rnd() - 0.5) * 0.25);
      r(x, top, w, SILL - top, c);
      r(x + w - 3, top, 3, SILL - top, shade(c, -0.18)); r(x, top, w, 1, shade(c, 0.2));
      if (phase === 'night' && rnd() < 0.4) r(x + Math.floor(w / 2), top - 2, 2, 2, '#ff3a30'); // aircraft warning light
      if (rnd() < 0.35) { const tx = x + 3 + Math.floor(rnd() * (w - 10)); r(tx, top - 7, 6, 5, '#6a4a30'); r(tx, top - 8, 6, 1, '#4a3020'); r(tx + 1, top - 2, 1, 2, '#3a2a1a'); r(tx + 4, top - 2, 1, 2, '#3a2a1a'); }
      for (let yy = top + 3; yy < SILL - 1; yy += 4)
        for (let xx = x + 2; xx < x + w - 3; xx += 3) {
          const lit = rnd() < th.litP;
          // at night most windows glow warm, a few flicker blue with a TV or a CRT
          const glow = phase === 'night' ? (rnd() < 0.12 ? '#8ab4ff' : rnd() < 0.3 ? '#fff2c0' : th.lit) : th.lit;
          r(xx, yy, 2, 2, lit ? glow : shade(c, -0.25));
        }
      x += w + (rnd() < 0.3 ? 2 : 0);
    }

    // the other tower, right next door, with its pinstripe of steel
    const tw = 220, tx = width - tw;
    r(tx, 0, tw, SILL, th.tower);
    for (let xx = tx + 2; xx < width; xx += 5) {
      r(xx, 0, 2, SILL, shade(th.tower, -0.22));
      r(xx + 2, 0, 1, SILL, shade(th.tower, 0.08));
      if (phase === 'night') for (let yy = 20; yy < SILL; yy += 6) if (rnd() < 0.3) r(xx + 3, yy, 2, 4, th.lit);
    }
    for (let yy = 30; yy < SILL; yy += 36) r(tx, yy, tw, 2, shade(th.tower, -0.3)); // mechanical floors
    r(tx, 0, 2, SILL, shade(th.tower, 0.3));

    // window frame: ceiling soffit, sill, and the famously narrow steel columns
    r(0, 0, width, GLASS_TOP, '#d8cdb0');
    for (let xx = 0; xx < width; xx += 32) { r(xx, 0, 1, GLASS_TOP - 2, '#c4b898'); r(xx + 12, 4, 8, 6, '#ece6d2'); r(xx + 13, 5, 6, 4, '#f8f4e8'); }
    r(0, GLASS_TOP - 2, width, 1, '#b8ab88'); r(0, GLASS_TOP - 1, width, 1, '#8a7c5c');
    for (let x0 = 0; x0 < width; x0 += MULLION_STEP) {
      r(x0, GLASS_TOP, MULLION_W, SILL - GLASS_TOP, '#b9bec4');
      r(x0, GLASS_TOP, 1, SILL - GLASS_TOP, '#eef0f2'); r(x0 + 1, GLASS_TOP, 2, SILL - GLASS_TOP, '#d3d7dc');
      r(x0 + 6, GLASS_TOP, 1, SILL - GLASS_TOP, '#8a9098'); r(x0 + 7, GLASS_TOP, 1, SILL - GLASS_TOP, '#6a7078');
      r(x0 + 8, GLASS_TOP, 12, SILL - GLASS_TOP, 'rgba(170,210,240,0.08)');
      // glare streaks on every few panes
      if ((x0 / 20) % 5 === 2) for (let i = 0; i < 12; i++) { r(x0 + 9 + (i % 10), GLASS_TOP + 6 + i * 7, 1, 4, 'rgba(255,255,255,0.13)'); r(x0 + 10 + (i % 10), GLASS_TOP + 8 + i * 7, 1, 3, 'rgba(255,255,255,0.08)'); }
    }
    r(0, SILL, width, 3, '#f4efe0'); r(0, SILL + 3, width, 1, '#c8bc9c');
    r(0, SILL + 4, width, BAND_H - SILL - 4, '#d8cdb0');
    for (let xx = 4; xx < width; xx += 20) r(xx, SILL + 7, 10, 2, '#b8ab88'); // radiator grille
    r(0, BAND_H - 2, width, 1, '#a89a78'); r(0, BAND_H - 1, width, 1, '#8a7c5c');
  });
}
