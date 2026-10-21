import Phaser from 'phaser';
import { findPath, randomNear, TILE, type Desk, type Facing, type Spot, type Tile } from '../world/map';
import { FEET_Y, FRAME_H } from '../art/people';
import type { AgentActivity } from './types';

const SPEED = 120; // px per second
const centerX = (t: Tile) => t.x * TILE + TILE / 2;
const feetY = (t: Tile) => t.y * TILE + 36;
const FACES: Facing[] = ['down', 'up', 'left', 'right'];

export type Pose = 'stand' | 'type' | 'raise';

/** One office worker on screen: walks the floor plan, animates, shows a status bubble. */
export class Agent {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly bubble: Phaser.GameObjects.Sprite;

  activity: AgentActivity = 'idle';
  detail = '';
  task = '';
  log: string[] = [];
  tile: Tile;

  private path: Tile[] = [];
  private dest: Spot | null = null;
  private onArrive: (() => void) | null = null;
  private facing: Facing = 'up';
  private pose: Pose = 'stand';
  private wander: { around: Tile; radius: number; every: number } | null = null;
  private nextWander = 0;
  private flash: { frame: string; until: number } | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly id: string,
    readonly name: string,
    readonly tex: string,
    readonly desk: Desk,
    start: Tile,
  ) {
    this.tile = { ...start };
    this.sprite = scene.add.sprite(centerX(start), feetY(start), tex, 'up0').setOrigin(0.5, FEET_Y / FRAME_H);
    this.sprite.setInteractive({ useHandCursor: true }).setData('agent', id);
    this.bubble = scene.add.sprite(0, 0, 'bubble', 'idle').setOrigin(0.5, 1).setDepth(10000).setVisible(false);
  }

  get moving() {
    return this.path.length > 0;
  }

  goTo(spot: Spot, onArrive?: () => void) {
    this.dest = spot;
    this.onArrive = onArrive ?? null;
    this.pose = 'stand';
    this.path = findPath(this.tile, spot) ?? [];
    if (!this.path.length) this.arrive();
  }

  setPose(pose: Pose) {
    this.pose = pose;
    if (!this.moving) this.rest();
  }

  /** Keep drifting to random tiles near `around` every few seconds once arrived. */
  setWander(around: Tile | null, radius = 3, every = 2500) {
    this.wander = around && { around, radius, every };
    this.nextWander = this.scene.time.now + every;
  }

  /** Show a bubble frame for a moment, e.g. when someone comes over to chat. */
  flashBubble(frame: string, ms: number) {
    this.flash = { frame, until: this.scene.time.now + ms };
  }

  face(toward: Tile) {
    const dx = toward.x - this.tile.x, dy = toward.y - this.tile.y;
    this.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    if (!this.moving && this.pose === 'stand') this.rest();
  }

  update(time: number, delta: number) {
    const s = this.sprite;
    if (this.path.length) {
      const next = this.path[0];
      const dx = centerX(next) - s.x, dy = feetY(next) - s.y;
      const dist = Math.hypot(dx, dy), step = (SPEED * delta) / 1000;
      if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
      else if (dy !== 0) this.facing = dy > 0 ? 'down' : 'up';
      if (dist <= step) {
        s.setPosition(centerX(next), feetY(next));
        this.tile = next;
        this.path.shift();
        if (!this.path.length) this.arrive();
      } else {
        s.x += (dx / dist) * step;
        s.y += (dy / dist) * step;
        const dir = this.facing === 'left' || this.facing === 'right' ? 'side' : this.facing;
        s.setFlipX(this.facing === 'left').play(`${this.tex}-walk-${dir}`, true);
      }
    } else if (this.wander && time >= this.nextWander) {
      this.nextWander = time + this.wander.every * (0.6 + Math.random() * 0.8);
      const t = randomNear(this.wander.around, this.wander.radius);
      if (t) this.goTo({ ...t, face: FACES[Math.floor(Math.random() * FACES.length)] });
    }
    s.setDepth(s.y);

    if (this.flash && time >= this.flash.until) this.flash = null;
    const frame = this.flash?.frame ?? this.activity;
    this.bubble
      .setFrame(frame)
      .setVisible(true)
      .setPosition(Math.round(s.x), Math.round(s.y) - 92 - (Math.floor(time / 400) % 2) * 2);
  }

  destroy() {
    this.sprite.destroy();
    this.bubble.destroy();
  }

  private arrive() {
    const d = this.dest;
    if (d) {
      this.facing = d.face;
      this.sprite.y = feetY(d) + (d.dy ?? 0);
    }
    this.rest();
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.();
  }

  private rest() {
    const s = this.sprite;
    s.setFlipX(this.facing === 'left');
    if (this.pose === 'type') s.play(`${this.tex}-type`, true);
    else if (this.pose === 'raise') s.setFlipX(false).play(`${this.tex}-raise`, true);
    else s.stop().setFrame(this.facing === 'down' ? 'down0' : this.facing === 'up' ? 'up0' : 'side0');
  }
}
