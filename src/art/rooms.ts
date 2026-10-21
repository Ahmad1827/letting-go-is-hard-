import Phaser from 'phaser';
import { text } from './props';
import { bevel, disc, dither, floorShadow, mix, oval, pick, rng, shade, single, speckle, type R } from './draw';

/** Furniture and floors for the rooms beyond the cubicles. */

const BEIGE = '#e0d8c0';
const BEIGE_SHADE = '#b8ae94';
const BEIGE_DARK = '#8a8270';

// ------------------------------------------------------------------ conference room

function conftable(r: R) {
  const W = 280, wood = '#6a3a22', woodL = '#8a5232', woodD = '#4a2414';
  floorShadow(r, 4, 70, W - 8, 14);
  // rounded-end top
  for (let y = 0; y < 60; y++) {
    const inset = y < 6 ? 6 - y : y > 53 ? y - 53 : 0;
    r(inset, y, W - inset * 2, 1, wood);
  }
  r(6, 0, W - 12, 1, woodL); r(2, 4, W - 4, 1, shade(wood, 0.08));
  const rnd = rng(4);
  for (let i = 0; i < 14; i++) r(8 + Math.floor(rnd() * (W - 60)), 4 + Math.floor(rnd() * 50), 20 + Math.floor(rnd() * 40), 1, shade(wood, -0.08));
  r(30, 26, W - 60, 8, shade(wood, 0.12)); r(30, 26, W - 60, 1, woodL); // inlay stripe
  // apron and pedestal legs
  r(0, 60, W, 10, woodD); r(0, 60, W, 1, woodL); r(0, 69, W, 1, '#2a1208');
  r(60, 70, 14, 6, '#2a1208'); r(W - 74, 70, 14, 6, '#2a1208');
  // the speakerphone in the middle
  r(W / 2 - 10, 24, 20, 12, '#2a2a2e'); r(W / 2 - 8, 22, 16, 2, '#2a2a2e'); r(W / 2 - 6, 26, 12, 6, '#3a3a40');
  r(W / 2 - 1, 32, 2, 1, '#3f3');
  // notepads, pens, water glasses and a pitcher
  for (const x of [30, 90, 150, 210]) {
    r(x, 8, 14, 11, '#f4ecb0'); r(x, 8, 14, 2, '#c0392b'); r(x + 2, 12, 9, 1, '#a8a080'); r(x + 2, 15, 7, 1, '#a8a080');
    r(x + 16, 9, 1, 8, '#1d3c70');
    r(x + 6, 41, 12, 11, '#f4ecb0'); r(x + 6, 41, 12, 2, '#c0392b'); r(x + 8, 45, 7, 1, '#a8a080');
    r(x + 22, 42, 4, 6, '#cfe8f4'); r(x + 22, 42, 4, 1, '#ffffff'); r(x + 23, 45, 2, 3, '#a8d0e8');
  }
  r(W / 2 + 24, 20, 7, 12, '#cfe8f4'); r(W / 2 + 24, 20, 7, 2, '#ffffff'); r(W / 2 + 31, 23, 2, 5, '#cfe8f4'); r(W / 2 + 25, 26, 5, 5, '#a8d0e8');
}

/** Leather boardroom chair, from the back (`back`) or the front. */
function cchair(r: R, back: boolean) {
  floorShadow(r, 2, 36, 32, 8);
  const l = '#2a2a30', ll = '#45454f', ld = '#1a1a1e';
  if (back) {
    r(6, 0, 24, 1, l); r(5, 1, 26, 20, l); r(6, 21, 24, 1, l);
    r(6, 1, 24, 1, ll); r(5, 2, 1, 18, ll); r(30, 2, 1, 18, ld);
    for (let y = 5; y < 20; y += 5) r(8, y, 20, 1, ld);
    r(3, 22, 30, 6, ld); r(3, 22, 30, 1, l);
  } else {
    r(6, 0, 24, 1, l); r(5, 1, 26, 14, l); r(6, 1, 24, 1, ll); r(30, 2, 1, 13, ld);
    r(4, 15, 28, 10, ll); r(4, 15, 28, 1, shade(ll, 0.2)); r(4, 24, 28, 1, ld);
    r(2, 10, 4, 12, ld); r(30, 10, 4, 12, ld);
  }
  r(16, 28, 4, 6, '#2a2a2e'); r(16, 28, 1, 6, '#8a8e96');
  r(6, 34, 24, 2, '#26282c'); r(4, 36, 3, 2, '#111'); r(29, 36, 3, 2, '#111'); r(16, 37, 4, 2, '#111');
}

function flipchart(r: R) {
  floorShadow(r, 4, 82, 40, 8);
  r(6, 30, 2, 56, '#6a6e74'); r(38, 30, 2, 56, '#6a6e74'); r(22, 40, 2, 46, '#55595e');
  r(4, 4, 40, 50, '#f8f8f4'); r(4, 4, 40, 1, '#ffffff'); r(43, 5, 1, 49, '#c8c8c0');
  r(2, 2, 44, 4, '#7a7e84'); r(2, 2, 44, 1, '#a8acb0');
  // a quarterly chart someone drew in marker
  r(9, 10, 24, 2, '#1d3c70'); r(9, 15, 14, 1, '#1d3c70');
  r(10, 22, 1, 26, '#222'); r(10, 47, 28, 1, '#222');
  for (const [x, h, c] of [[13, 8, '#c0392b'], [19, 13, '#c0392b'], [25, 10, '#2e7d32'], [31, 20, '#2e7d32']] as const) r(x, 47 - h, 4, h, c);
  r(29, 22, 7, 1, '#2e7d32'); r(34, 21, 1, 3, '#2e7d32');
  r(4, 54, 40, 3, '#e8e4d8');
}

function tvcart(r: R) {
  floorShadow(r, 2, 76, 46, 8);
  const metal = '#5a5e64';
  r(4, 40, 42, 3, metal); r(4, 62, 42, 3, metal); r(4, 40, 2, 38, '#3a3e44'); r(44, 40, 2, 38, '#3a3e44');
  r(3, 78, 4, 3, '#111'); r(43, 78, 4, 3, '#111');
  // VCR with the clock blinking 12:00
  r(8, 54, 34, 8, '#2a2a2e'); r(8, 54, 34, 1, '#4a4a50'); r(12, 57, 14, 2, '#111'); r(31, 57, 7, 3, '#0a1a0a'); r(32, 58, 5, 1, '#3f6');
  // the TV
  r(6, 6, 38, 34, '#3a3a40'); r(6, 6, 38, 1, '#5a5a62'); r(43, 7, 1, 33, '#1e1e22');
  r(9, 9, 26, 22, '#202428'); r(10, 10, 24, 20, '#283848');
  for (let i = 0; i < 6; i++) r(12 + i, 12 + i, 1, 1, 'rgba(255,255,255,0.15)');
  r(37, 12, 4, 3, '#555'); r(37, 18, 4, 3, '#555'); r(36, 26, 5, 1, '#888'); r(36, 28, 5, 1, '#888');
  r(14, 34, 22, 4, '#2a2a2e');
  r(16, 2, 1, 4, '#888'); r(32, 0, 1, 6, '#888'); // rabbit ears
}

/** The owner's work board: a corkboard on a stand, cards pinned in columns. Click it for the Work Board. */
function workboard(r: R) {
  const W = 92;
  floorShadow(r, 4, 92, W - 8, 8);
  // stand
  r(12, 70, 3, 26, '#5a5e64'); r(W - 15, 70, 3, 26, '#5a5e64'); r(8, 94, 12, 2, '#3a3e44'); r(W - 20, 94, 12, 2, '#3a3e44');
  // frame and cork
  r(0, 0, W, 74, '#7a5232'); r(0, 0, W, 2, '#9a6a42'); r(W - 2, 2, 2, 72, '#5a3a1a'); r(0, 72, W, 2, '#4a2a12');
  r(4, 12, W - 8, 58, '#c8a06a');
  speckle(r, rng(14), 4, 12, W - 8, 58, 120, ['#b8905a', '#d8b07a', '#a8804a']);
  // header strip
  r(4, 3, W - 8, 8, '#1e3a5a');
  text(r, W / 2 - 9, 4, 'TODO', '#f0c040');
  // three columns of cards
  const rnd = rng(15);
  const cards = ['#f8f4d0', '#f7b5c9', '#a8e6cf', '#cfe0f8', '#f5ec9a'];
  for (let col = 0; col < 3; col++) {
    const x = 8 + col * 28;
    r(x + 24, 14, 1, 54, '#a8804a');
    for (let k = 0; k < 3 - (col === 2 ? 1 : 0); k++) {
      const y = 16 + k * 17 + Math.floor(rnd() * 3);
      const c = pick(rnd, cards);
      r(x + 1, y + 1, 20, 13, 'rgba(0,0,0,0.25)');
      r(x, y, 20, 13, c);
      r(x + 2, y + 3, 12 + Math.floor(rnd() * 5), 1, '#888');
      r(x + 2, y + 6, 8 + Math.floor(rnd() * 8), 1, '#aaa');
      r(x + 2, y + 9, 10, 1, '#aaa');
      r(x + 9, y - 1, 2, 2, pick(rnd, ['#d33', '#33d', '#3a3']));
    }
  }
}

// ------------------------------------------------------------------ server room

function console_(r: R) {
  const W = 96;
  floorShadow(r, 0, 56, W, 10);
  r(0, 26, W, 16, '#7a7e84'); r(0, 26, W, 1, '#9a9ea4'); r(0, 41, W, 1, '#5a5e64');
  r(0, 42, W, 16, '#5a5e64'); r(0, 57, W, 1, '#3a3e44');
  r(4, 44, 26, 12, '#4a4e54'); r(66, 44, 26, 12, '#4a4e54');
  // green-screen terminal
  r(8, 0, 40, 30, '#c8c4b0'); r(8, 0, 40, 1, '#e0dccd'); r(47, 1, 1, 29, '#9a9684');
  r(11, 3, 34, 22, '#101810'); r(12, 4, 32, 20, '#0a2a10');
  for (let row = 0; row < 6; row++) r(14, 6 + row * 3, 8 + ((row * 7) % 18), 1, '#3f6');
  r(14, 23, 3, 1, '#9f9');
  r(10, 30, 36, 6, '#d8d4c4'); for (let x = 12; x < 44; x += 2) r(x, 32, 1, 1, '#8a8676');
  // dot-matrix printer with greenbar paper
  r(56, 12, 34, 18, BEIGE); r(56, 12, 34, 1, '#f0e8d0'); r(89, 13, 1, 17, BEIGE_SHADE);
  r(60, 16, 26, 3, '#3a3a3a'); r(80, 22, 6, 2, '#3c3');
  r(60, 4, 26, 9, '#f8f8f0'); for (let y = 5; y < 12; y += 3) r(60, y, 26, 1, '#c8e8c8');
  r(62, 30, 22, 10, '#f8f8f0'); for (let y = 31; y < 40; y += 3) r(62, y, 22, 1, '#c8e8c8');
}

function acunit(r: R) {
  floorShadow(r, 0, 86, 46, 8);
  bevel(r, 1, 0, 44, 88, '#d8d0b8', 0.15);
  r(4, 4, 38, 20, '#c8c0a8');
  for (let y = 6; y < 23; y += 2) r(6, y, 34, 1, '#9a947e');
  r(6, 30, 20, 10, '#2a3a2a'); r(7, 31, 18, 8, '#0a1a0a'); r(9, 33, 8, 2, '#f84'); r(19, 33, 4, 2, '#f84'); r(9, 37, 12, 1, '#3c3');
  r(30, 31, 4, 3, '#c33'); r(36, 31, 4, 3, '#3a3'); r(30, 36, 10, 2, '#888');
  r(4, 46, 38, 38, '#cfc7ae');
  for (let y = 48; y < 82; y += 3) r(6, y, 34, 1, '#a8a088');
  r(8, 84, 30, 1, '#8a8470');
}

// ------------------------------------------------------------------ boss office & lobby

function sofa(r: R, w: number, fabric: string) {
  const f = fabric, fl = shade(f, 0.18), fd = shade(f, -0.22), fdd = shade(f, -0.38);
  floorShadow(r, 0, 46, w, 10);
  // back, seat cushions, arms
  r(6, 0, w - 12, 1, fl); r(5, 1, w - 10, 20, f); r(5, 1, w - 10, 1, fl);
  r(5, 20, w - 10, 2, fd);
  const n = Math.max(2, Math.round((w - 20) / 40)), cw = Math.floor((w - 20) / n);
  for (let i = 0; i < n; i++) {
    const x = 10 + i * cw;
    bevel(r, x, 22, cw - 1, 16, f, 0.18);
    r(x + 2, 3, cw - 5, 16, shade(f, 0.05)); r(x + 2, 3, cw - 5, 1, fl);
  }
  r(0, 10, 11, 32, f); r(0, 10, 11, 2, fl); r(10, 12, 1, 30, fd);
  r(w - 11, 10, 11, 32, f); r(w - 11, 10, 11, 2, fl); r(w - 11, 12, 1, 30, fdd);
  r(4, 38, w - 8, 6, fd); r(4, 43, w - 8, 1, fdd);
  r(6, 44, 3, 4, '#3a2414'); r(w - 9, 44, 3, 4, '#3a2414');
}

function coffeetable(r: R) {
  floorShadow(r, 0, 30, 88, 8);
  r(0, 0, 88, 22, '#a8c8d0'); r(0, 0, 88, 1, '#e0f0f4'); r(1, 1, 86, 20, 'rgba(200,230,240,0.6)');
  for (let i = 0; i < 8; i++) r(6 + i * 2, 3 + i, 2, 1, 'rgba(255,255,255,0.5)');
  r(0, 22, 88, 4, '#c9a227'); r(0, 22, 88, 1, '#f0d060');
  r(2, 26, 3, 8, '#8a6a1a'); r(83, 26, 3, 8, '#8a6a1a');
  // magazines
  r(50, 5, 16, 12, '#c0392b'); r(52, 7, 12, 3, '#f4f1e6'); r(54, 4, 18, 12, '#2d5fa8'); r(56, 6, 10, 2, '#f1c40f'); r(56, 10, 12, 1, '#ddd');
}

function reception(r: R) {
  const W = 192;
  floorShadow(r, 0, 74, W, 10);
  // the counter top seen from the front, with a raised transaction ledge
  r(0, 20, W, 10, '#e8e0cc'); r(0, 20, W, 1, '#fffaf0');
  r(4, 0, W - 8, 20, '#c8bfa8'); // work surface behind the ledge
  // things on the desk behind
  r(26, 0, 30, 18, BEIGE); r(29, 3, 24, 12, '#008080'); r(29, 13, 24, 2, '#c0c0c0');
  r(130, 6, 18, 10, '#2a2a2a'); r(132, 4, 14, 3, '#2a2a2a'); r(134, 9, 2, 1, '#777'); r(138, 9, 2, 1, '#777');
  r(84, 12, 10, 6, '#c9a227'); disc(r, 89, 11, 3, '#f0d060'); // service bell
  r(150, 10, 14, 8, '#f4f1e6'); r(152, 12, 8, 1, '#999'); // sign-in book
  r(104, 4, 4, 12, '#2e7d32'); r(100, 2, 12, 6, '#43a047'); r(102, 0, 3, 3, '#e33'); r(108, 1, 3, 3, '#f4c'); // flowers
  // front panel: wood with brass trim and the floor number
  r(0, 30, W, 42, '#7a4a2a'); r(0, 30, W, 2, '#c9a227'); r(0, 70, W, 2, '#3a1a0a');
  for (let x = 8; x < W - 8; x += 46) { bevel(r, x, 36, 38, 30, '#8a5a36', 0.2); r(x + 4, 40, 30, 22, '#7a4a2a'); }
  r(W / 2 - 22, 38, 44, 26, '#1a2a4a'); r(W / 2 - 22, 38, 44, 1, '#c9a227'); r(W / 2 - 22, 63, 44, 1, '#c9a227');
  const big = (x: number, y: number) => { for (let k = 0; k < 2; k++) { r(x + k * 12, y, 9, 2, '#f0d060'); r(x + k * 12, y + 7, 9, 2, '#f0d060'); r(x + k * 12, y + 14, 9, 2, '#f0d060'); r(x + k * 12, y, 2, 16, '#f0d060'); r(x + k * 12 + 7, y, 2, 16, '#f0d060'); } };
  big(W / 2 - 10, 43);
}

// ------------------------------------------------------------------ break room

function kitchen(r: R) {
  const W = 192, H = 96;
  const rnd = rng(19);
  floorShadow(r, 0, H - 8, W, 8);
  // upper cabinets hung on the wall
  for (let x = 2; x < W - 40; x += 32) { bevel(r, x, 0, 30, 26, '#c8b890', 0.18); r(x + 24, 12, 2, 5, '#8a7a50'); }
  r(0, 26, W, 2, '#8a7a50');
  // backsplash tiles
  r(0, 28, W, 18, '#e8ecee');
  for (let x = 0; x < W; x += 8) r(x, 28, 1, 18, '#c8d0d4');
  for (let y = 28; y < 46; y += 6) r(0, y, W, 1, '#c8d0d4');
  // countertop
  r(0, 46, W, 8, '#d8cdb0'); r(0, 46, W, 1, '#f0e8d0'); r(0, 53, W, 1, '#a89a78');
  speckle(r, rnd, 0, 47, W, 6, 50, ['#c8bd9e', '#e8dfc6']);
  // base cabinets
  r(0, 54, W, H - 54 - 6, '#a89870');
  for (let x = 2; x < W; x += 32) { bevel(r, x, 57, 30, H - 66, '#b8a880', 0.15); r(x + 14, 62, 2, 6, '#6a5a3a'); }
  r(0, H - 6, W, 4, '#5a4a32');
  // sink with a faucet
  r(70, 47, 34, 6, '#a8b0b8'); r(72, 48, 30, 4, '#7a848c'); r(86, 38, 2, 10, '#c0c8d0'); r(84, 37, 8, 2, '#c0c8d0');
  // coffee maker with a full pot
  r(10, 26, 18, 21, '#2a2a2a'); r(10, 26, 18, 2, '#444'); r(12, 36, 12, 9, '#b8d0d8'); r(13, 39, 10, 6, '#4a2410'); r(24, 30, 1, 1, '#f33');
  // microwave
  r(120, 28, 40, 18, '#e8e4d8'); r(120, 28, 40, 1, '#ffffff'); r(123, 31, 26, 12, '#2a2a2e'); r(124, 32, 8, 4, 'rgba(255,255,255,0.15)');
  r(151, 31, 7, 3, '#0a1a0a'); r(152, 32, 5, 1, '#3f6'); for (let y = 36; y < 44; y += 2) r(152, y, 5, 1, '#999');
  // pink donut box and stacked mugs
  r(34, 40, 22, 7, '#f0a0b8'); r(34, 40, 22, 1, '#f8c8d8'); r(38, 42, 4, 3, '#c89048'); r(44, 42, 4, 3, '#e85a8a');
  for (const [x, c] of [[168, '#c33'], [176, '#2d5fa8'], [172, '#f4f1e6']] as const) { r(x, 40, 6, 7, c); r(x + 6, 42, 2, 3, c); }
  r(170, 33, 6, 7, '#2e7d32');
}

function fridge(r: R) {
  floorShadow(r, 0, 92, 46, 8);
  const c = '#e8dcc0';
  bevel(r, 1, 0, 44, 94, c, 0.15);
  r(1, 34, 44, 2, '#a89a78');
  r(36, 10, 3, 18, '#b8ab88'); r(36, 42, 3, 22, '#b8ab88');
  // magnets, a takeout menu and a kid's drawing
  r(8, 8, 10, 13, '#f8f8f0'); r(9, 10, 8, 1, '#c33'); r(9, 13, 6, 1, '#888'); r(9, 15, 7, 1, '#888'); r(12, 7, 2, 2, '#2d5fa8');
  r(8, 44, 16, 12, '#ffffff'); r(10, 46, 4, 4, '#f1c40f'); r(15, 50, 7, 1, '#27ae60'); r(12, 52, 2, 3, '#c0392b'); r(15, 43, 2, 2, '#c33');
  r(26, 58, 4, 4, '#27ae60'); r(20, 66, 4, 4, '#f1c40f');
  r(2, 92, 42, 2, '#5a5a5a');
}

function vending(r: R) {
  floorShadow(r, 0, 92, 48, 8);
  r(0, 0, 48, 94, '#a82a2a'); r(0, 0, 48, 2, '#d84a4a'); r(46, 2, 2, 92, '#7a1a1a');
  r(3, 6, 30, 70, '#1a1e24'); r(4, 7, 28, 68, '#2a323a');
  const rnd = rng(77);
  const snacks = ['#f1c40f', '#e67e22', '#c0392b', '#2d5fa8', '#27ae60', '#8e44ad', '#f4f1e6'];
  for (let row = 0; row < 6; row++) {
    const y = 10 + row * 11;
    r(4, y + 8, 28, 1, '#8a9098');
    for (let k = 0; k < 4; k++) { const c = pick(rnd, snacks); r(6 + k * 7, y, 5, 8, c); r(6 + k * 7, y, 5, 1, shade(c, 0.3)); }
  }
  for (let i = 0; i < 10; i++) r(6 + i * 2, 9 + i * 5, 1, 4, 'rgba(255,255,255,0.12)');
  // keypad, coin slot, pickup flap
  r(35, 8, 10, 8, '#0a1a0a'); r(36, 10, 7, 2, '#f84');
  for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) r(36 + j * 3, 20 + k * 3, 2, 2, '#c8c8c8');
  r(37, 36, 6, 2, '#222'); r(37, 42, 6, 6, '#888');
  r(4, 80, 30, 10, '#1a1e24'); r(4, 80, 30, 1, '#5a5e64');
  r(35, 52, 10, 20, '#f4f1e6'); r(36, 54, 8, 2, '#a82a2a'); r(36, 58, 8, 1, '#888'); r(36, 61, 6, 1, '#888');
}

function roundtable(r: R) {
  floorShadow(r, 4, 46, 96, 10);
  // two plastic chairs either side
  for (const x of [0, 76]) {
    r(x + 4, 4, 20, 22, '#c86a2a'); r(x + 4, 4, 20, 2, '#e88a4a'); r(x + 6, 26, 16, 10, '#a85a1a');
    r(x + 6, 36, 2, 14, '#5a5a5a'); r(x + 20, 36, 2, 14, '#5a5a5a');
  }
  oval(r, 18, 16, 64, 28, '#5a4a32');
  oval(r, 18, 14, 64, 28, '#e8e0cc'); oval(r, 22, 16, 56, 22, '#f0eadc');
  r(46, 42, 8, 10, '#5a5a5a'); oval(r, 36, 50, 28, 5, '#3a3a3a');
  r(40, 22, 6, 7, '#c33'); r(46, 24, 2, 3, '#c33'); r(56, 20, 12, 9, '#f4f1e6'); r(58, 22, 8, 1, '#999');
}

// ------------------------------------------------------------------ mail room

function cubbies(r: R) {
  const W = 96, H = 88;
  floorShadow(r, 0, H - 6, W, 8);
  r(0, 0, W, H, '#8a6a42'); r(0, 0, W, 2, '#aa8a5a'); r(W - 2, 2, 2, H - 2, '#5a4222');
  const rnd = rng(55);
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 6; col++) {
      const x = 3 + col * 15, y = 4 + row * 13;
      r(x, y, 14, 12, '#3a2a1a'); r(x, y, 14, 1, '#2a1a0a');
      if (rnd() < 0.7) { const c = pick(rnd, ['#f4f1e6', '#f4f1e6', '#d8c890', '#e8e4f8']); r(x + 2, y + 4 + Math.floor(rnd() * 3), 10, 8 - Math.floor(rnd() * 3), c); }
      r(x + 4, y + 12, 6, 1, '#f4f1e6');
    }
  r(2, 70, W - 4, 16, '#7a5a32'); r(2, 70, W - 4, 1, '#aa8a5a');
  bevel(r, 6, 73, 40, 11, '#8a6a42', 0.2); bevel(r, 50, 73, 40, 11, '#8a6a42', 0.2);
  r(22, 77, 8, 2, '#c9a227'); r(66, 77, 8, 2, '#c9a227');
}

function fax(r: R) {
  floorShadow(r, 2, 54, 44, 8);
  r(6, 26, 36, 4, '#5a5e64'); r(8, 30, 2, 26, '#3a3e44'); r(38, 30, 2, 26, '#3a3e44'); r(8, 46, 32, 2, '#5a5e64');
  r(4, 10, 40, 16, BEIGE); r(4, 10, 40, 1, '#f0e8d0'); r(43, 11, 1, 15, BEIGE_SHADE);
  r(8, 4, 22, 7, '#f8f8f4'); r(10, 6, 14, 1, '#999'); r(10, 8, 10, 1, '#999');
  r(30, 13, 12, 5, '#3a4a3a'); r(31, 14, 8, 2, '#9c9');
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) r(32 + j * 3, 19 + k * 2, 2, 1, '#777');
  r(6, 14, 18, 8, BEIGE_DARK); r(7, 15, 16, 2, '#555'); // handset
  r(10, 26, 20, 4, '#f8f8f4');
}

// ------------------------------------------------------------------ floors

function buildFloors(scene: Phaser.Scene) {
  // conference room: honey oak planks
  single(scene, 'floor-wood', 96, 96, (r) => {
    const rnd = rng(31);
    for (let y = 0; y < 96; y += 8) {
      const off = (y / 8) % 3 * 32;
      for (let x = -off; x < 96; x += 96) {
        const c = pick(rnd, ['#b8864a', '#c08e52', '#ae7e44', '#b48448']);
        for (const px of [x, x + 96]) { r(px, y, 96, 8, c); r(px, y, 96, 1, shade(c, 0.12)); r(px, y + 7, 96, 1, shade(c, -0.25)); r(px + 95, y, 1, 8, shade(c, -0.3)); }
      }
      for (let i = 0; i < 6; i++) r(Math.floor(rnd() * 96), y + 2 + Math.floor(rnd() * 4), 6 + Math.floor(rnd() * 10), 1, '#a0743c');
    }
  });
  // boss office: herringbone parquet
  single(scene, 'floor-parquet', 48, 48, (r) => {
    r(0, 0, 48, 48, '#7a4a28');
    for (let y = -24; y < 48; y += 12)
      for (let x = 0; x < 48; x += 24) {
        r(x, y + (x / 24) * 6, 12, 6, '#8a5a32'); r(x, y + (x / 24) * 6, 12, 1, '#9a6a3e');
        r(x + 12, y + 6 + (x / 24) * 6, 12, 6, '#6e4224'); r(x + 12, y + 6 + (x / 24) * 6, 12, 1, '#7e5030');
      }
  });
  // server room: raised floor panels, some perforated
  single(scene, 'floor-raised', 48, 48, (r) => {
    for (const [x, y] of [[0, 0], [24, 0], [0, 24], [24, 24]]) {
      bevel(r, x, y, 24, 24, '#b8bcc0', 0.12);
      if ((x + y) % 48 === 0) for (let j = 4; j < 21; j += 3) for (let i = 4; i < 21; i += 3) r(x + i, y + j, 1, 1, '#7a7e84');
    }
  });
  // lobby: polished marble with veins
  single(scene, 'floor-marble', 96, 96, (r) => {
    const rnd = rng(12);
    for (const [x, y, c] of [[0, 0, '#e8e2d6'], [48, 0, '#d8d0c0'], [0, 48, '#d8d0c0'], [48, 48, '#e8e2d6']] as const) {
      r(x, y, 48, 48, c);
      let vx = x + rnd() * 48, vy = y;
      for (let k = 0; k < 60; k++) { r(Math.floor(vx), Math.floor(vy), 1, 1, shade(c, -0.15)); vx += rnd() * 2 - 0.6; vy += 0.8; if (vy >= y + 48 || vx >= x + 48 || vx < x) break; }
      speckle(r, rnd, x, y, 48, 48, 30, [shade(c, -0.06), shade(c, 0.08)]);
      r(x, y, 48, 1, '#b8b0a0'); r(x, y, 1, 48, '#b8b0a0');
    }
    r(46, 46, 4, 4, '#2a3a4a'); r(94, 94, 2, 2, '#2a3a4a'); r(0, 0, 2, 2, '#2a3a4a');
  });
  // archive: hard-wearing grey carpet
  single(scene, 'floor-grey', 64, 64, (r) => {
    r(0, 0, 64, 64, '#5a5e66');
    speckle(r, rng(8), 0, 0, 64, 64, 500, ['#50545c', '#646870', '#5e626a', '#4a4e56']);
  });
  // mail room: grey vinyl tiles
  single(scene, 'floor-vinyl', 48, 48, (r) => {
    const rnd = rng(9);
    for (const [x, y, c] of [[0, 0, '#a8aaa4'], [24, 0, '#b8bab4'], [0, 24, '#b8bab4'], [24, 24, '#a8aaa4']] as const) {
      r(x, y, 24, 24, c); speckle(r, rnd, x, y, 24, 24, 20, [shade(c, -0.1), shade(c, 0.1), mix(c, '#5a7a9a', 0.3)]);
      r(x, y + 23, 24, 1, '#8a8c86'); r(x + 23, y, 1, 24, '#8a8c86');
    }
  });
  // boss office rug
  single(scene, 'rug', 288, 192, (r) => {
    const W = 288, H = 192;
    for (let x = 0; x < W; x += 4) { r(x, 0, 2, 4, '#e8d8a8'); r(x, H - 4, 2, 4, '#e8d8a8'); }
    r(0, 4, W, H - 8, '#c9a227');
    r(4, 8, W - 8, H - 16, '#5c1f2a');
    r(12, 16, W - 24, H - 32, '#c9a227'); r(14, 18, W - 28, H - 36, '#6e2633');
    for (let x = 20; x < W - 20; x += 12) { r(x, 10, 6, 3, '#9a3a4a'); r(x, H - 13, 6, 3, '#9a3a4a'); }
    // medallion
    for (let k = 0; k < 4; k++) oval(r, W / 2 - 60 + k * 15, H / 2 - 36 + k * 9, 120 - k * 30, 72 - k * 18, ['#c9a227', '#7e3040', '#c9a227', '#2a4a6a'][k]);
    for (const [x, y] of [[30, 30], [W - 46, 30], [30, H - 46], [W - 46, H - 46]]) { r(x, y + 6, 16, 4, '#c9a227'); r(x + 6, y, 4, 16, '#c9a227'); }
    dither(r, 14, 18, W - 28, 1, '#6e2633', '#5c1f2a');
  });
}

export function buildRooms(scene: Phaser.Scene) {
  single(scene, 'conftable', 280, 78, conftable, { outline: true });
  single(scene, 'cchair', 36, 40, (r) => cchair(r, true), { outline: true });
  single(scene, 'cchairF', 36, 40, (r) => cchair(r, false), { outline: true });
  single(scene, 'flipchart', 48, 90, flipchart, { outline: true });
  single(scene, 'tvcart', 50, 84, tvcart, { outline: true });
  single(scene, 'console', 96, 66, console_, { outline: true });
  single(scene, 'acunit', 46, 94, acunit, { outline: true });
  single(scene, 'sofa', 136, 56, (r) => sofa(r, 136, '#3a6a6a'), { outline: true });
  single(scene, 'lobbysofa', 136, 56, (r) => sofa(r, 136, '#6a3a5a'), { outline: true });
  single(scene, 'coffeetable', 88, 36, coffeetable, { outline: true });
  single(scene, 'reception', 192, 84, reception, { outline: true });
  single(scene, 'kitchen', 192, 96, kitchen, { outline: true });
  single(scene, 'fridge', 46, 100, fridge, { outline: true });
  single(scene, 'vending', 48, 100, vending, { outline: true });
  single(scene, 'roundtable', 100, 58, roundtable, { outline: true });
  single(scene, 'cubbies', 96, 94, cubbies, { outline: true });
  single(scene, 'fax', 48, 62, fax, { outline: true });
  single(scene, 'workboard', 92, 98, workboard, { outline: true });
  buildFloors(scene);
}
