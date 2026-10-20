import Phaser from 'phaser';
import { mix, rng, shade, single } from './draw';

export type Phase = 'day' | 'dusk' | 'night';

/** The view outside follows the player's real clock. */
export function currentPhase(hour = new Date().getHours()): Phase {
  if (hour >= 7 && hour < 17) return 'day';
  if ((hour >= 17 && hour < 20) || (hour >= 5 && hour < 7)) return 'dusk';
  return 'night';
}

const THEMES: Record<Phase, { sky: string[]; far: string; water: string; bld: string; lit: string; litP: number; tower: string; stars: number }> = {
  day: { sky: ['#4a86c8', '#8fc1ea', '#d4ebf7'], far: '#8a9bb0', water: '#4f7aa8', bld: '#6f7c8e', lit: '#d8e2ea', litP: 0.04, tower: '#b9c2cc', stars: 0 },
  dusk: { sky: ['#2a1f4f', '#7a4278', '#e9805e', '#f7c46c'], far: '#4a3550', water: '#8a5a7a', bld: '#3b3150', lit: '#ffd97a', litP: 0.25, tower: '#c08a86', stars: 0 },
  night: { sky: ['#03050d', '#0a1128', '#1a2550'], far: '#141a2e', water: '#121a33', bld: '#121625', lit: '#ffe08a', litP: 0.35, tower: '#262b38', stars: 60 },
};

function gradient(stops: string[], t: number): string {
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  return mix(stops[seg], stops[seg + 1], t * (stops.length - 1) - seg);
}

export const BAND_H = 64;

/**
 * The top wall: the Manhattan skyline seen through narrow floor-to-ceiling
 * windows between steel columns, with the other tower filling the right side.
 */
export function buildBand(scene: Phaser.Scene, width: number, phase: Phase) {
  const th = THEMES[phase];
  single(scene, 'band', width, BAND_H, (r) => {
    const rnd = rng(1973);
    for (let y = 8; y < 56; y++) r(0, y, width, 1, gradient(th.sky, Math.min(1, (y - 8) / 38)));
    for (let i = 0; i < th.stars; i++) r(Math.floor(rnd() * width), 8 + Math.floor(rnd() * 26), 1, 1, rnd() < 0.3 ? '#fff' : '#8890a8');

    // far shore and river
    for (let x = 0; x < width; x++) {
      const h = 1 + Math.floor(rnd() * 3);
      r(x, 46 - h, 1, h, th.far);
    }
    r(0, 46, width, 6, th.water);
    for (let i = 0; i < 30; i++) r(Math.floor(rnd() * width), 47 + Math.floor(rnd() * 4), 2, 1, shade(th.water, 0.25));

    // a famous art-deco silhouette uptown
    const deco = shade(th.bld, 0.15);
    r(250, 30, 14, 28, deco); r(253, 22, 8, 8, deco); r(255, 16, 4, 6, deco); r(256, 8, 2, 8, deco);
    if (phase !== 'day') { r(255, 16, 4, 1, th.lit); r(256, 8, 2, 1, '#f55'); }

    // nearby rooftops with lit windows
    let x = 0;
    while (x < width - 70) {
      const w = 6 + Math.floor(rnd() * 12), top = 36 + Math.floor(rnd() * 16);
      r(x, top, w, 58 - top, shade(th.bld, (rnd() - 0.5) * 0.25));
      for (let yy = top + 2; yy < 56; yy += 3)
        for (let xx = x + 1; xx < x + w - 1; xx += 2) if (rnd() < th.litP) r(xx, yy, 1, 1, th.lit);
      x += w + (rnd() < 0.3 ? 1 : 0);
    }

    // the other tower, right next door
    const tx = width - 76;
    r(tx, 0, 76, 58, th.tower);
    for (let xx = tx + 1; xx < width; xx += 3) {
      r(xx, 0, 1, 58, shade(th.tower, -0.25));
      if (phase === 'night') for (let yy = 10; yy < 56; yy += 4) if (rnd() < 0.3) r(xx + 1, yy, 1, 2, th.lit);
    }
    r(tx, 0, 1, 58, shade(th.tower, 0.25));

    // window frame: ceiling soffit, sill, and the famously narrow steel columns
    r(0, 0, width, 8, '#d8cdb0'); r(0, 7, width, 1, '#a89a78');
    r(0, 56, width, 2, '#ece6d2'); r(0, 58, width, 6, '#d8cdb0'); r(0, 63, width, 1, '#a89a78');
    for (let x0 = 0; x0 < width; x0 += 10) {
      r(x0, 8, 4, 48, '#b9bec4'); r(x0, 8, 1, 48, '#e3e6ea'); r(x0 + 3, 8, 1, 48, '#80878f');
      r(x0 + 4, 8, 6, 48, 'rgba(170,210,240,0.08)');
      if ((x0 / 10) % 7 === 3) for (let i = 0; i < 7; i++) r(x0 + 4 + (i % 6), 10 + i * 6, 1, 3, 'rgba(255,255,255,0.14)');
    }
  });
}
