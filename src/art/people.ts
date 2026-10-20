import Phaser from 'phaser';
import { loop, shade, sheet, type R } from './draw';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: 'short' | 'long' | 'bald' | 'big';
  shirt: string;
  jacket: string | null;
  tie: string | null;
  pants: string;
  shoes: string;
  pads: boolean;
  glasses: boolean;
}

/** The office staff. Each one becomes a texture `person<i>`. */
export const CAST: { name: string; look: Look }[] = [
  { name: 'Dana', look: { skin: '#f1c27d', hair: '#5a3825', hairStyle: 'big', shirt: '#f4f4f4', jacket: '#7a2e4a', tie: null, pants: '#2d3142', shoes: '#1a1a1a', pads: true, glasses: false } },
  { name: 'Rick', look: { skin: '#e0ac69', hair: '#2b1d14', hairStyle: 'short', shirt: '#a9c6e8', jacket: '#2d3a5c', tie: '#b32d2d', pants: '#2d3a5c', shoes: '#3b2414', pads: false, glasses: false } },
  { name: 'Sharon', look: { skin: '#8d5524', hair: '#1a1a1a', hairStyle: 'long', shirt: '#e8d9a9', jacket: '#2e6b5a', tie: null, pants: '#2d3142', shoes: '#1a1a1a', pads: true, glasses: false } },
  { name: 'Gary', look: { skin: '#ffdbac', hair: '#8c8c8c', hairStyle: 'bald', shirt: '#f4f4f4', jacket: null, tie: '#d4a017', pants: '#5a4a3a', shoes: '#3b2414', pads: false, glasses: true } },
  { name: 'Tina', look: { skin: '#ffdbac', hair: '#e6c36a', hairStyle: 'big', shirt: '#c94c4c', jacket: null, tie: null, pants: '#2d3142', shoes: '#1a1a1a', pads: true, glasses: false } },
  { name: 'Marcus', look: { skin: '#6b4423', hair: '#1a1a1a', hairStyle: 'short', shirt: '#f4f4f4', jacket: '#3d3d45', tie: '#6a2d8f', pants: '#3d3d45', shoes: '#1a1a1a', pads: false, glasses: true } },
  { name: 'Linda', look: { skin: '#e0ac69', hair: '#b5651d', hairStyle: 'long', shirt: '#a9c6e8', jacket: '#9c8458', tie: null, pants: '#5a4a3a', shoes: '#3b2414', pads: true, glasses: false } },
  { name: 'Raj', look: { skin: '#c68642', hair: '#2b1d14', hairStyle: 'short', shirt: '#e8e0d0', jacket: null, tie: '#2e6b3a', pants: '#3a4560', shoes: '#1a1a1a', pads: false, glasses: false } },
];

export const FRAME_W = 16;
export const FRAME_H = 24;

type Dir = 'down' | 'up' | 'side';
type Pose = 'stand' | 'typeA' | 'typeB' | 'raise0' | 'raise1';

const FRAMES: [string, Dir, 0 | 1 | 2, Pose][] = [
  ['down0', 'down', 0, 'stand'], ['down1', 'down', 1, 'stand'], ['down2', 'down', 2, 'stand'],
  ['up0', 'up', 0, 'stand'], ['up1', 'up', 1, 'stand'], ['up2', 'up', 2, 'stand'],
  ['side0', 'side', 0, 'stand'], ['side1', 'side', 1, 'stand'], ['side2', 'side', 2, 'stand'],
  ['typeA', 'up', 0, 'typeA'], ['typeB', 'up', 0, 'typeB'],
  ['raise0', 'down', 0, 'raise0'], ['raise1', 'down', 0, 'raise1'],
];

const EYE = '#2a1d18';

function drawHair(r: R, dir: Dir, style: Look['hairStyle'], h: string) {
  if (dir === 'down') {
    if (style === 'short') { r(5, 2, 6, 2, h); r(5, 4, 1, 1, h); r(10, 4, 1, 1, h); }
    if (style === 'long') { r(5, 2, 6, 2, h); r(4, 3, 1, 8, h); r(11, 3, 1, 8, h); r(5, 4, 1, 2, h); r(10, 4, 1, 2, h); }
    if (style === 'bald') { r(5, 4, 1, 2, h); r(10, 4, 1, 2, h); }
    if (style === 'big') { r(4, 1, 8, 3, h); r(4, 4, 1, 6, h); r(11, 4, 1, 6, h); }
  } else if (dir === 'up') {
    if (style === 'short') r(5, 2, 6, 6, h);
    if (style === 'long') r(4, 2, 8, 10, h);
    if (style === 'bald') r(5, 5, 6, 2, h);
    if (style === 'big') r(4, 1, 8, 9, h);
  } else {
    if (style === 'short') { r(5, 2, 6, 2, h); r(5, 4, 2, 3, h); }
    if (style === 'long') { r(5, 2, 6, 2, h); r(4, 3, 3, 9, h); }
    if (style === 'bald') r(5, 4, 2, 2, h);
    if (style === 'big') { r(4, 1, 8, 3, h); r(4, 4, 4, 6, h); }
  }
}

function drawPerson(r: R, look: Look, dir: Dir, leg: 0 | 1 | 2, pose: Pose) {
  const torso = look.jacket ?? look.shirt;
  const skin = look.skin;

  // shadow
  r(4, 22, 8, 1, 'rgba(0,0,0,0.25)');
  r(5, 23, 6, 1, 'rgba(0,0,0,0.15)');

  if (dir === 'side') {
    if (leg === 0) {
      r(6, 17, 4, 4, look.pants); r(6, 21, 5, 1, look.shoes);
    } else {
      const back = shade(look.pants, -0.25);
      r(5, 17, 2, 4, leg === 1 ? back : look.pants); r(9, 17, 2, 4, leg === 1 ? look.pants : back);
      r(5, 21, 2, 1, look.shoes); r(9, 21, 3, 1, look.shoes);
    }
    r(5, 10, 6, 7, torso); r(5, 10, 1, 7, shade(torso, -0.18));
    if (look.jacket) r(10, 10, 1, 2, look.shirt);
    if (look.tie) r(10, 11, 1, 3, look.tie);
    r(5, 16, 6, 1, shade(look.pants, -0.1));
    if (leg === 0) { r(7, 11, 2, 5, torso); r(7, 16, 2, 1, skin); }
    if (leg === 1) { r(8, 11, 2, 4, torso); r(9, 15, 2, 1, skin); }
    if (leg === 2) { r(6, 11, 2, 4, torso); r(5, 15, 2, 1, skin); }
    r(7, 9, 2, 1, shade(skin, -0.15));
    r(5, 3, 6, 6, skin); r(11, 6, 1, 1, skin);
    r(9, 6, 1, 1, EYE);
    if (look.glasses) { r(8, 6, 3, 1, '#2b2b2b'); r(9, 6, 1, 1, '#bfe0f0'); }
    drawHair(r, dir, look.hairStyle, look.hair);
    return;
  }

  // legs: lift one foot per walk frame
  const lUp = leg === 1 ? 1 : 0, rUp = leg === 2 ? 1 : 0;
  r(5, 17, 2, 4 - lUp, look.pants); r(5, 21 - lUp, 2, 1, look.shoes);
  r(9, 17, 2, 4 - rUp, look.pants); r(9, 21 - rUp, 2, 1, look.shoes);

  r(4, 10, 8, 7, torso); r(11, 10, 1, 7, shade(torso, -0.18));
  if (look.pads) r(3, 10, 10, 2, torso);
  r(4, 16, 8, 1, shade(look.pants, -0.1));
  if (dir === 'down') {
    if (look.jacket) { r(6, 10, 4, 3, look.shirt); r(7, 13, 2, 1, look.shirt); }
    else { r(6, 10, 1, 1, shade(look.shirt, 0.4)); r(9, 10, 1, 1, shade(look.shirt, 0.4)); }
    if (look.tie) r(7, 10, 2, 5, look.tie);
  }

  // arms
  if (pose === 'typeA' || pose === 'typeB') {
    const a = pose === 'typeA';
    r(3, 11, 1, a ? 3 : 4, torso); r(12, 11, 1, a ? 4 : 3, torso);
  } else if (pose === 'raise0' || pose === 'raise1') {
    r(3, 11, 1, 5, torso); r(3, 16, 1, 1, skin);
    const ax = pose === 'raise0' ? 12 : 13;
    r(12, 9, 1, 2, torso); r(ax, 5, 1, 5, torso); r(ax, 3, 1, 2, skin);
  } else {
    const la = leg === 2 ? 4 : 5, ra = leg === 1 ? 4 : 5;
    r(3, 11, 1, la, torso); r(3, 11 + la, 1, 1, skin);
    r(12, 11, 1, ra, torso); r(12, 11 + ra, 1, 1, skin);
  }

  r(7, 9, 2, 1, shade(skin, -0.15));
  r(5, 3, 6, 6, skin); r(10, 3, 1, 6, shade(skin, -0.1));
  if (dir === 'down') {
    r(6, 6, 1, 1, EYE); r(9, 6, 1, 1, EYE);
    r(7, 8, 2, 1, shade(skin, -0.25));
    if (look.glasses) { r(5, 6, 6, 1, '#2b2b2b'); r(6, 6, 1, 1, '#bfe0f0'); r(9, 6, 1, 1, '#bfe0f0'); }
  }
  drawHair(r, dir, look.hairStyle, look.hair);
}

export function buildPeople(scene: Phaser.Scene) {
  CAST.forEach((member, i) => {
    const key = `person${i}`;
    sheet(scene, key, FRAME_W, FRAME_H, FRAMES.map((f) => f[0]), (r, _name, idx) => {
      const [, dir, leg, pose] = FRAMES[idx];
      drawPerson(r, member.look, dir, leg, pose);
    });
    loop(scene, `${key}-walk-down`, key, ['down1', 'down0', 'down2', 'down0'], 8);
    loop(scene, `${key}-walk-up`, key, ['up1', 'up0', 'up2', 'up0'], 8);
    loop(scene, `${key}-walk-side`, key, ['side1', 'side0', 'side2', 'side0'], 8);
    loop(scene, `${key}-type`, key, ['typeA', 'typeB'], 6);
    loop(scene, `${key}-raise`, key, ['raise0', 'raise1'], 3);
  });
}
