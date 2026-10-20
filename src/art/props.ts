import Phaser from 'phaser';
import { disc, loop, pick, rng, shade, sheet, single, type R } from './draw';

const BEIGE = '#e0d8c0';
const BEIGE_SHADE = '#b8ae94';
const BEIGE_DARK = '#8a8270';

/** A beige CRT with its 12x9 screen at (sx, sy). The screen itself is a separate animated sprite. */
function crt(r: R, sx: number, sy: number) {
  r(sx - 3, sy - 3, 18, 14, BEIGE);
  r(sx + 13, sy - 3, 2, 14, BEIGE_SHADE);
  r(sx - 3, sy + 10, 18, 1, BEIGE_SHADE);
  r(sx - 1, sy - 1, 14, 11, BEIGE_DARK);
  r(sx, sy, 12, 9, '#101510');
  r(sx + 3, sy + 11, 6, 2, BEIGE_SHADE);
  r(sx + 12, sy + 9, 1, 1, '#5f5');
}

function buildFurniture(scene: Phaser.Scene) {
  // Cubicle desk: fabric partition behind, laminate desktop, CRT, keyboard.
  single(scene, 'desk', 48, 32, (r) => {
    r(0, 0, 48, 13, '#4c5a6e');
    r(1, 1, 46, 11, '#6d7f99');
    const rnd = rng(3);
    for (let i = 0; i < 40; i++) r(1 + Math.floor(rnd() * 46), 1 + Math.floor(rnd() * 11), 1, 1, '#647590');
    r(4, 3, 7, 6, '#f2f0ea'); r(4, 3, 7, 2, '#c0392b'); // wall calendar
    r(38, 3, 5, 5, '#f5ec9a'); r(39, 5, 3, 1, '#c9b84a'); // sticky note
    r(0, 12, 48, 12, '#c8bfa8');
    r(0, 12, 48, 1, '#ddd5bf');
    r(0, 24, 48, 7, '#9c927a');
    r(0, 31, 48, 1, '#6e6553');
    r(36, 24, 10, 7, '#8e846d'); r(40, 26, 2, 1, '#5a5242'); r(40, 29, 2, 1, '#5a5242');
    crt(r, 18, 6);
    r(16, 19, 16, 3, BEIGE);
    for (let x = 17; x < 31; x += 2) r(x, 20, 1, 1, BEIGE_SHADE);
    r(36, 18, 3, 3, '#c33'); r(39, 19, 1, 1, '#c33'); // mug
    r(4, 16, 8, 6, '#f4f1e6'); r(5, 18, 6, 1, '#bbb'); r(5, 20, 4, 1, '#bbb'); // papers
    r(42, 15, 4, 4, '#333'); r(43, 15, 2, 1, '#999'); // floppy
  });

  // Office chair seen from behind, so it covers the seated agent's lower half.
  single(scene, 'chair', 14, 14, (r) => {
    r(2, 0, 10, 7, '#3a3f4a'); r(3, 1, 8, 1, '#545a68');
    r(1, 7, 12, 3, '#2e323b');
    r(6, 10, 2, 2, '#222');
    r(2, 12, 10, 1, '#222');
    r(2, 13, 1, 1, '#111'); r(11, 13, 1, 1, '#111'); r(6, 13, 2, 1, '#111');
  });

  // Your desk: mahogany, banker's lamp, phone, nameplate.
  single(scene, 'bossdesk', 56, 30, (r) => {
    r(0, 8, 56, 12, '#7d3a26'); r(0, 8, 56, 1, '#9b5238');
    r(0, 20, 56, 10, '#5a2618'); r(3, 22, 14, 6, '#4a1f13'); r(39, 22, 14, 6, '#4a1f13');
    r(0, 29, 56, 1, '#3a170d');
    crt(r, 23, 2);
    r(5, 14, 4, 2, '#c9a227'); r(6, 9, 1, 5, '#c9a227'); r(2, 6, 10, 4, '#1f6b3a'); r(3, 6, 8, 1, '#3a9a5a');
    r(42, 12, 9, 5, BEIGE); r(42, 11, 9, 2, '#cfc6ac'); r(44, 14, 1, 1, '#777'); r(46, 14, 1, 1, '#777'); r(48, 14, 1, 1, '#777');
    r(13, 13, 5, 4, '#333'); r(14, 12, 3, 2, '#eee'); // rolodex
    r(21, 17, 14, 3, '#c9a227'); r(23, 18, 10, 1, '#6b5410'); // nameplate
  });

  single(scene, 'bosschair', 16, 18, (r) => {
    r(1, 0, 14, 10, '#4a1a14'); r(2, 1, 12, 1, '#6a2a20');
    for (let x = 3; x < 14; x += 3) for (let y = 3; y < 9; y += 3) r(x, y, 1, 1, '#2f0f0b');
    r(0, 10, 16, 4, '#3d150f'); r(7, 14, 2, 2, '#222'); r(2, 16, 12, 1, '#222'); r(2, 17, 12, 1, '#111');
  });

  // Archive: bookshelf full of binders, filing cabinets.
  single(scene, 'shelf', 32, 40, (r) => {
    r(0, 0, 32, 40, '#6b4a2e'); r(2, 2, 28, 37, '#3e2a1a');
    const rnd = rng(11);
    const binders = ['#2d5fa8', '#c0392b', '#f1c40f', '#27ae60', '#ecf0f1', '#34495e', '#8e44ad'];
    for (const shelfY of [11, 21, 31]) {
      r(0, shelfY, 32, 2, '#7a5a3a');
      let x = 3;
      while (x < 28) {
        const w = 2 + Math.floor(rnd() * 2), h = 6 + Math.floor(rnd() * 3);
        const col = pick(rnd, binders);
        r(x, shelfY - h, w, h, col); r(x, shelfY - h + 2, w, 1, shade(col, 0.3));
        x += w + (rnd() < 0.15 ? 2 : 0);
      }
    }
    r(0, 38, 32, 2, '#4a321f');
  });

  single(scene, 'cabinet', 14, 28, (r) => {
    r(0, 0, 14, 28, '#b5b09a'); r(0, 0, 14, 1, '#d3cfbb'); r(13, 0, 1, 28, '#8a8572');
    for (let y = 2; y < 26; y += 6) {
      r(1, y + 5, 12, 1, '#8a8572');
      r(5, y + 1, 4, 1, '#f4f1e6');
      r(5, y + 3, 4, 1, '#e6e1cc');
    }
  });

  // The mainframe corner: racks with blinking lights and tape drives.
  const rackFrames = ['a', 'b', 'c'];
  sheet(scene, 'rack', 16, 40, rackFrames, (r, _f, i) => {
    r(1, 0, 14, 40, '#1c1e22'); r(2, 1, 12, 38, '#2b2e33'); r(2, 1, 12, 1, '#454a52');
    const rnd = rng(20 + i);
    for (let y = 3; y < 37; y += 5) {
      r(3, y + 3, 10, 1, '#3a3e45');
      for (let x = 9; x < 13; x += 2) r(x, y + 1, 1, 1, rnd() < 0.5 ? pick(rnd, ['#3f3', '#3f3', '#fa3', '#f33']) : '#0d2a0d');
      r(3, y + 1, 4, 1, '#22252a');
    }
  });
  sheet(scene, 'tape', 16, 40, rackFrames, (r, _f, i) => {
    r(1, 0, 14, 40, '#9d9886'); r(2, 1, 12, 38, '#c9c5b6'); r(2, 1, 12, 1, '#e0dccd');
    r(3, 3, 10, 22, '#6f7a80'); r(3, 3, 10, 1, '#8e9aa0');
    for (const cy of [8, 19]) {
      disc(r, 8, cy, 4, '#2a2a2a');
      disc(r, 8, cy, 1, '#9a9a9a');
      const a = (i * Math.PI * 2) / 3 + (cy === 19 ? 1 : 0);
      r(8 + Math.round(Math.cos(a) * 3), cy + Math.round(Math.sin(a) * 3), 1, 1, '#777');
    }
    r(3, 28, 10, 8, '#3a3e45');
    const rnd = rng(40 + i);
    for (let x = 4; x < 12; x += 2) r(x, 30, 1, 1, rnd() < 0.5 ? '#3f3' : '#0d2a0d');
    r(4, 33, 8, 1, '#22252a');
  });
  loop(scene, 'rack-blink', 'rack', rackFrames, 3);
  loop(scene, 'tape-spin', 'tape', rackFrames, 4);

  single(scene, 'cooler', 10, 26, (r) => {
    r(2, 0, 6, 9, '#8cc0e6'); r(3, 1, 1, 7, '#c2e2f7'); r(4, 0, 2, 1, '#2d5fa8');
    r(1, 9, 8, 16, '#e8e4d8'); r(8, 9, 1, 16, '#bdb8a8');
    r(3, 12, 1, 1, '#d33'); r(6, 12, 1, 1, '#33d');
    r(2, 15, 6, 1, '#999');
    r(1, 25, 8, 1, '#8a8572');
  });

  single(scene, 'plant', 16, 28, (r) => {
    r(7, 12, 2, 8, '#5a3d22');
    const rnd = rng(5);
    const greens = ['#2e7d32', '#43a047', '#1b5e20', '#66bb6a'];
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
      r(Math.round(8 + Math.cos(a) * d * 7) - 1, Math.round(10 + Math.sin(a) * d * 9) - 1, 2, 2, pick(rnd, greens));
    }
    r(3, 19, 10, 2, '#c97a35'); r(4, 21, 8, 7, '#b5651d'); r(11, 21, 1, 7, '#8a4a14');
  });

  single(scene, 'copier', 24, 22, (r) => {
    r(2, 0, 18, 5, '#bfbaa9'); r(2, 0, 18, 1, '#d6d2c4');
    r(0, 5, 24, 4, '#e6e2d4');
    r(0, 9, 24, 13, '#d6d2c4'); r(23, 9, 1, 13, '#a9a596');
    r(17, 6, 6, 3, '#3a4a55'); r(18, 7, 1, 1, '#3f3');
    r(2, 12, 20, 1, '#a9a596'); r(2, 16, 20, 1, '#a9a596');
    r(9, 13, 6, 2, '#f4f4f4');
  });

  // Kitchenette counter with a coffee maker.
  single(scene, 'counter', 16, 32, (r) => {
    r(0, 8, 16, 24, '#9c927a'); r(15, 8, 1, 24, '#7d745f'); r(0, 31, 16, 1, '#6e6553');
    r(0, 8, 16, 3, '#d8cdb0');
    r(2, 18, 12, 1, '#7d745f'); r(6, 21, 4, 1, '#c9c5b6');
    r(3, 0, 9, 10, '#2a2a2a'); r(4, 1, 7, 1, '#444');
    r(5, 5, 5, 4, '#5a3216'); r(5, 5, 5, 1, '#8a6a50');
    r(10, 2, 1, 1, '#f33');
    r(12, 7, 3, 3, '#f4f4f4');
  });

  // Outbox table where finished work gets dropped.
  single(scene, 'table', 64, 20, (r) => {
    r(0, 4, 64, 8, '#9a8f7a'); r(0, 4, 64, 1, '#b3a991');
    r(0, 12, 64, 6, '#7b715f'); r(0, 17, 64, 1, '#5a5242');
    for (const tx of [4, 24, 44]) {
      r(tx, 1, 16, 6, '#c9b38a'); r(tx + 1, 2, 14, 4, '#b39c72'); r(tx, 6, 16, 1, '#8a754f');
    }
    r(26, 14, 12, 2, '#c0392b'); // red "OUT" label
  });

  single(scene, 'paper', 12, 3, (r) => {
    r(0, 0, 12, 2, '#f4f1e6');
    r(0, 2, 12, 1, '#cfc8b3');
  });

  single(scene, 'door', 8, 16, (r) => {
    r(0, 0, 8, 16, '#b8923a');
    r(1, 0, 1, 16, '#e0c070');
    r(7, 0, 1, 16, '#7a5e22');
  });

  // Selection ring drawn as a pixel ellipse.
  single(scene, 'ring', 16, 7, (r) => {
    for (let a = 0; a < Math.PI * 2; a += 0.05) r(Math.round(7.5 + Math.cos(a) * 7.4), Math.round(3 + Math.sin(a) * 3), 1, 1, '#ffe14d');
  });
}

export const SCREEN_FRAMES = ['off', 'desktop', 'code0', 'code1', 'code2', 'code3', 'saver0', 'saver1', 'saver2', 'run0', 'run1', 'alert0', 'alert1'] as const;

function desktop(r: R) {
  r(0, 0, 12, 9, '#008080');
  r(1, 1, 2, 2, '#fff'); r(1, 4, 2, 2, '#ff6');
  r(0, 8, 12, 1, '#c0c0c0'); r(0, 8, 2, 1, '#080');
}

function buildScreens(scene: Phaser.Scene) {
  const rnd = rng(99);
  const lines = Array.from({ length: 12 }, () => ({ indent: Math.floor(rnd() * 3), len: 2 + Math.floor(rnd() * 7), col: pick(rnd, ['#33ff66', '#33ff66', '#7fd7ff', '#ffe066']) }));
  sheet(scene, 'screen', 12, 9, SCREEN_FRAMES, (r, frame, i) => {
    if (frame === 'off') { r(0, 0, 12, 9, '#101510'); r(1, 1, 2, 1, '#26302a'); return; }
    if (frame === 'desktop') return desktop(r);
    if (frame.startsWith('code')) {
      r(0, 0, 12, 9, '#0b1a12');
      const f = i - 2;
      for (let row = 0; row < 4; row++) {
        const l = lines[(f + row) % lines.length];
        r(1 + l.indent, 1 + row * 2, Math.min(l.len, 10 - l.indent), 1, l.col);
      }
      if (f % 2 === 0) r(10, 7, 1, 1, '#33ff66'); // cursor
      return;
    }
    if (frame.startsWith('saver')) {
      r(0, 0, 12, 9, '#000');
      const s = rng(200 + i);
      for (let k = 0; k < 6; k++) r(Math.floor(s() * 12), Math.floor(s() * 9), 1, 1, k % 2 ? '#fff' : '#888');
      return;
    }
    if (frame.startsWith('run')) {
      r(0, 0, 12, 9, '#000');
      r(1, 1, 7, 1, '#ccc'); r(1, 3, 5, 1, '#ccc');
      r(1, 6, 10, 2, '#333'); r(1, 6, frame === 'run0' ? 4 : 8, 2, '#3c3');
      return;
    }
    desktop(r);
    r(2, 2, 8, 5, '#c0c0c0'); r(2, 2, 8, 1, '#000080');
    r(3, 4, 2, 2, frame === 'alert0' ? '#d32' : '#ff6'); r(6, 4, 3, 1, '#000'); r(6, 5, 2, 1, '#000');
  });
  loop(scene, 'scr-code', 'screen', ['code0', 'code1', 'code2', 'code3'], 4);
  loop(scene, 'scr-saver', 'screen', ['saver0', 'saver1', 'saver2'], 2);
  loop(scene, 'scr-run', 'screen', ['run0', 'run1'], 3);
  loop(scene, 'scr-alert', 'screen', ['alert0', 'alert1'], 2);
}

export const BUBBLE_FRAMES = ['idle', 'thinking', 'reading', 'writing', 'running', 'awaiting', 'talking', 'done'] as const;

function buildBubbles(scene: Phaser.Scene) {
  sheet(scene, 'bubble', 13, 12, BUBBLE_FRAMES, (r, frame) => {
    const b = '#222';
    r(1, 1, 11, 8, frame === 'awaiting' ? '#ffef7a' : '#fff');
    r(1, 0, 11, 1, b); r(1, 9, 11, 1, b); r(0, 1, 1, 8, b); r(12, 1, 1, 8, b);
    r(5, 10, 2, 1, b); r(5, 11, 1, 1, b);
    switch (frame) {
      case 'idle':
        r(4, 4, 4, 4, '#c33'); r(8, 5, 1, 2, '#c33'); r(5, 2, 1, 1, '#aaa'); r(6, 1, 1, 1, '#aaa');
        break;
      case 'thinking':
        r(3, 4, 1, 1, '#555'); r(6, 4, 1, 1, '#555'); r(9, 4, 1, 1, '#555');
        break;
      case 'reading':
        r(2, 3, 4, 5, '#3b6fc2'); r(7, 3, 4, 5, '#3b6fc2'); r(6, 3, 1, 5, '#1d3c70');
        r(3, 4, 2, 1, '#fff'); r(8, 4, 2, 1, '#fff');
        break;
      case 'writing':
        r(3, 2, 5, 1, '#2e7d32'); r(4, 4, 5, 1, '#2e7d32'); r(4, 6, 3, 1, '#2e7d32'); r(3, 7, 6, 1, '#2e7d32');
        break;
      case 'running':
        r(2, 2, 9, 6, '#111'); r(3, 3, 1, 1, '#3f3'); r(4, 4, 1, 1, '#3f3'); r(3, 5, 1, 1, '#3f3'); r(5, 6, 3, 1, '#3f3');
        break;
      case 'awaiting':
        r(6, 2, 1, 4, '#d32'); r(6, 7, 1, 1, '#d32');
        break;
      case 'talking':
        r(3, 3, 7, 1, '#555'); r(3, 5, 5, 1, '#555'); r(3, 7, 6, 1, '#555');
        break;
      case 'done':
        for (const [x, y] of [[3, 5], [4, 6], [5, 7], [6, 6], [7, 5], [8, 4], [9, 3]]) r(x, y, 1, 2, '#2e9d4a');
        break;
    }
  });
}

function buildFloors(scene: Phaser.Scene) {
  // 90s commercial carpet: dusty teal with confetti specks.
  single(scene, 'carpet', 32, 32, (r) => {
    r(0, 0, 32, 32, '#2f4f5a');
    const rnd = rng(7);
    for (let i = 0; i < 60; i++)
      r(Math.floor(rnd() * 32), Math.floor(rnd() * 32), 1, 1, pick(rnd, ['#3c6470', '#3c6470', '#3c6470', '#26414a', '#26414a', '#26414a', '#7a3e6e', '#4f8a94']));
  });
  single(scene, 'lino', 16, 16, (r) => {
    r(0, 0, 16, 16, '#d9d2c0');
    r(0, 0, 8, 8, '#c7bea8');
    r(8, 8, 8, 8, '#c7bea8');
  });
}

export function buildProps(scene: Phaser.Scene) {
  buildFurniture(scene);
  buildScreens(scene);
  buildBubbles(scene);
  buildFloors(scene);
}
