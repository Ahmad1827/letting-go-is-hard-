import Phaser from 'phaser';
import { bus } from '../bus';
import { buildPeople, CAST } from '../art/people';
import { buildProps } from '../art/props';
import { buildBand, currentPhase } from '../art/skyline';
import { Agent } from '../agents/Agent';
import { Sim } from '../agents/sim';
import type { AgentEvent } from '../agents/types';
import type { AgentView, ApprovalView } from '../ui/hud';
import {
  BOSS_SCREEN, COLS, ELEVATOR, OUTBOX, ROWS, TILE, WIDTH, desks, props, randomNear, spots, walkable,
  type Spot, type Tile,
} from '../world/map';

const MAX_PAPERS = 12;

export class OfficeScene extends Phaser.Scene {
  private agents = new Map<string, Agent>();
  /** agent id -> desk id, including agents still in the elevator */
  private hired = new Map<string, number>();
  private arrivals: (() => void)[] = [];
  private sim!: Sim;
  private screens: Phaser.GameObjects.Sprite[] = [];
  private bossScreen!: Phaser.GameObjects.Sprite;
  private racks: Phaser.GameObjects.Sprite[] = [];
  private doors!: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private ring!: Phaser.GameObjects.Image;
  /** Which spot each agent is holding, so two agents don't stand in the same place. */
  private claims = new Map<string, string>();
  private pending = new Map<string, string>();
  private papers: Phaser.GameObjects.Image[] = [];
  private shipped = 0;
  private selected: string | null = null;
  private dirty = true;
  private lastPush = 0;
  private avatars = new Map<string, string>();

  constructor() {
    super('office');
  }

  create() {
    buildPeople(this);
    buildProps(this);
    buildBand(this, WIDTH, currentPhase());
    this.drawRoom();

    for (const p of props) {
      const s = this.add.sprite(p.x, p.y, p.key).setOrigin(0.5, 1).setDepth(p.y);
      if (p.anim) {
        s.play({ key: p.anim, startFrame: Math.floor(Math.random() * 3) });
        this.racks.push(s);
      }
    }
    this.screens = desks.map((d) => this.add.sprite(d.screen.x, d.screen.y, 'screen', 'off').setOrigin(0).setDepth(d.screen.y + 26.1));
    this.bossScreen = this.add.sprite(BOSS_SCREEN.x, BOSS_SCREEN.y, 'screen', 'desktop').setOrigin(0).setDepth(BOSS_SCREEN.y + 28.1);
    this.ring = this.add.image(0, 0, 'ring').setVisible(false);
    this.tweens.add({ targets: this.ring, alpha: 0.35, duration: 500, yoyo: true, repeat: -1 });

    this.sim = new Sim(this.time, (ev) => this.apply(ev), (id, text) => this.note(id, text));

    this.input.on('gameobjectdown', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      const id = obj.getData('agent') as string | undefined;
      if (id) bus.emit('select', id);
    });
    bus.on('select', (id: string) => (this.selected = id));
    bus.on('hire', () => this.hire());
    bus.on('approval:resolve', ({ id, ok }: { id: string; ok: boolean }) => this.resolve(id, ok));
    bus.on('autoapprove', (on: boolean) => {
      this.sim.autoApprove = on;
      if (on) for (const id of [...this.pending.keys()]) this.resolve(id, true);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.removeAllListeners());

    // first shift arrives
    [300, 2600, 4900].forEach((ms) => this.time.delayedCall(ms, () => this.hire()));
  }

  update(time: number, delta: number) {
    for (const a of this.agents.values()) a.update(time, delta);
    const sel = this.selected && this.agents.get(this.selected);
    this.ring.setVisible(!!sel);
    if (sel) this.ring.setPosition(Math.round(sel.sprite.x), Math.round(sel.sprite.y)).setDepth(sel.sprite.depth - 0.5);
    if (this.dirty && time - this.lastPush > 250) this.pushState(time);
  }

  // ---------------------------------------------------------------- room

  private drawRoom() {
    this.add.tileSprite(TILE, 4 * TILE, (COLS - 2) * TILE, 12 * TILE, 'carpet').setOrigin(0).setDepth(-10);
    this.add.tileSprite(TILE, 9 * TILE, 5 * TILE, 7 * TILE, 'lino').setOrigin(0).setDepth(-9);
    this.add.image(0, 0, 'band').setOrigin(0).setDepth(-5);

    const g = this.add.graphics().setDepth(-9);
    // corner-office rug
    g.fillStyle(0xc9a227).fillRect(22 * TILE + 3, 11 * TILE + 3, 7 * TILE - 6, 5 * TILE - 6);
    g.fillStyle(0x5c1f2a).fillRect(22 * TILE + 4, 11 * TILE + 4, 7 * TILE - 8, 5 * TILE - 8);
    g.fillStyle(0x6e2633).fillRect(22 * TILE + 8, 11 * TILE + 8, 7 * TILE - 16, 5 * TILE - 16);

    const w = this.add.graphics().setDepth(-4);
    const H = ROWS * TILE;
    w.fillStyle(0xbfb393).fillRect(0, 4 * TILE, TILE, H).fillRect(WIDTH - TILE, 4 * TILE, TILE, H);
    w.fillStyle(0xa89a78).fillRect(TILE - 1, 4 * TILE, 1, H).fillRect(WIDTH - TILE, 4 * TILE, 1, H);

    const bottom = this.add.graphics().setDepth(H - 2);
    bottom.fillStyle(0xbfb393).fillRect(0, H - TILE, WIDTH, TILE);
    bottom.fillStyle(0xe0d6bb).fillRect(0, H - TILE, WIDTH, 1);
    const ex = ELEVATOR.x * TILE;
    bottom.fillStyle(0x2a2622).fillRect(ex, H - TILE, TILE, TILE);
    bottom.fillStyle(0x8a7a50).fillRect(ex - 2, H - TILE, 2, TILE).fillRect(ex + TILE, H - TILE, 2, TILE);
    bottom.fillStyle(0xffd060).fillRect(ex + TILE + 4, H - TILE + 4, 2, 2);

    const mask = this.make.graphics({}, false).fillRect(ex, H - TILE, TILE, TILE).createGeometryMask();
    this.doors = [
      this.add.image(ex, H - TILE, 'door').setOrigin(0).setDepth(H + 1).setMask(mask),
      this.add.image(ex + 8, H - TILE, 'door').setOrigin(0).setDepth(H + 1).setMask(mask).setFlipX(true),
    ];
  }

  /** One elevator trip at a time; later arrivals wait their turn. */
  private openElevator(then: () => void) {
    this.arrivals.push(then);
    if (this.arrivals.length === 1) this.elevatorTrip();
  }

  private elevatorTrip() {
    const ex = ELEVATOR.x * TILE;
    const [l, r] = this.doors;
    const slide = (from: number, to: number, delay: number, done: () => void) =>
      this.tweens.addCounter({
        from, to, delay, duration: 350,
        onUpdate: (tw) => {
          const gap = tw.getValue() ?? 0;
          l.x = ex - gap;
          r.x = ex + 8 + gap;
        },
        onComplete: done,
      });
    slide(0, 8, 0, () => {
      this.arrivals[0]();
      slide(8, 0, 1400, () => {
        this.arrivals.shift();
        if (this.arrivals.length) this.elevatorTrip();
      });
    });
  }

  // ---------------------------------------------------------------- staff

  private hire() {
    // desks and people are reserved now; the agent only appears once the doors open
    const taken = new Set(this.hired.values());
    const desk = desks.find((d) => !taken.has(d.id));
    const castIdx = CAST.findIndex((c) => !this.hired.has(c.name.toLowerCase()));
    if (!desk || castIdx < 0) return;
    const { name } = CAST[castIdx];
    const id = name.toLowerCase();
    this.hired.set(id, desk.id);
    if (this.hired.size >= Math.min(desks.length, CAST.length)) bus.emit('hire:full');
    this.screens[desk.id].setFrame('desktop');
    this.openElevator(() => {
      this.agents.set(id, new Agent(this, id, name, `person${castIdx}`, desk, ELEVATOR));
      this.note(id, `${name} arrived on the floor`);
      this.sim.begin(id);
    });
  }

  /** React to an agent event: send the character to the right part of the office. */
  private apply(ev: AgentEvent) {
    const a = this.agents.get(ev.agentId);
    if (!a) return;
    const settle = () => this.sim.settled(a.id);
    const screen = this.screens[a.desk.id];

    if (a.activity === 'writing') screen.play('scr-saver');
    this.claims.delete(a.id);
    a.setWander(null);
    a.activity = ev.activity;
    a.detail = ev.detail ?? '';
    a.task = ev.task ?? a.task;
    if (ev.detail) this.note(a.id, ev.detail);

    switch (ev.activity) {
      case 'thinking':
        a.goTo(this.near(a.desk.seat, 3, 'down'), settle);
        a.setWander(a.desk.seat, 3);
        break;
      case 'reading':
        a.goTo(this.claim(a.id, spots.archive), settle);
        break;
      case 'writing':
        a.goTo(a.desk.seat, () => {
          a.setPose('type');
          screen.play('scr-code');
          settle();
        });
        break;
      case 'running':
        a.goTo(this.claim(a.id, spots.server), settle);
        break;
      case 'awaiting':
        this.pending.set(a.id, ev.detail ?? 'Permission needed');
        this.pushApprovals();
        a.goTo(this.claim(a.id, spots.approval), () => {
          a.setPose('raise');
          settle();
        });
        break;
      case 'talking':
        this.talk(a, settle);
        break;
      case 'done':
        a.goTo(this.claim(a.id, spots.outbox), () => {
          this.ship();
          settle();
        });
        break;
      case 'idle':
        a.goTo(this.claim(a.id, spots.lounge), settle);
        a.setWander(spots.loungeCenter, 2, 4000);
        break;
    }
    this.racks.forEach((r) => (r.anims.timeScale = this.count('running') ? 3 : 1));
    this.dirty = true;
  }

  private talk(a: Agent, settle: () => void) {
    const others = [...this.agents.values()].filter((o) => o !== a && !o.moving);
    const partner = others[Math.floor(Math.random() * others.length)];
    const spot = partner && this.besides(partner.tile);
    if (!partner || !spot) {
      a.goTo(this.near(a.desk.seat, 3, 'down'), settle);
      return;
    }
    a.detail = `Talking with ${partner.name}`;
    a.goTo(spot, () => {
      a.face(partner.tile);
      partner.face(a.tile);
      partner.flashBubble('talking', 3500);
      settle();
    });
  }

  private resolve(id: string, ok: boolean) {
    if (!this.pending.delete(id)) return;
    this.pushApprovals();
    this.sim.resolve(id, ok);
  }

  private ship() {
    this.shipped++;
    bus.emit('shipped', this.shipped);
    if (this.papers.length >= MAX_PAPERS) this.papers.shift()?.destroy();
    const n = this.papers.length;
    const tray = n % 3, height = Math.floor(n / 3);
    this.papers.push(
      this.add.image(OUTBOX.left + 12 + tray * 20, OUTBOX.top + 6 - height * 2, 'paper').setOrigin(0.5, 1).setDepth(OUTBOX.top + 21 + n * 0.01),
    );
  }

  // ---------------------------------------------------------------- places

  private claim(id: string, group: Spot[]): Spot {
    const taken = new Set(this.claims.values());
    const free = group.find((s) => !taken.has(`${s.x},${s.y}`));
    if (free) {
      this.claims.set(id, `${free.x},${free.y}`);
      return free;
    }
    return this.near(group[0], 2, group[0].face);
  }

  private near(center: Tile, radius: number, face: Spot['face']): Spot {
    const t = randomNear(center, radius) ?? center;
    return { ...t, face };
  }

  private besides(t: Tile): Spot | null {
    for (const [dx, face] of [[-1, 'right'], [1, 'left']] as const)
      if (walkable(t.x + dx, t.y)) return { x: t.x + dx, y: t.y, face };
    for (const [dy, face] of [[1, 'up'], [-1, 'down']] as const)
      if (walkable(t.x, t.y + dy)) return { x: t.x, y: t.y + dy, face };
    return null;
  }

  private count(activity: Agent['activity']) {
    return [...this.agents.values()].filter((a) => a.activity === activity).length;
  }

  // ---------------------------------------------------------------- HUD

  private note(id: string, text: string) {
    const a = this.agents.get(id);
    if (!a) return;
    const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    a.log.push(`${t}  ${text}`);
    if (a.log.length > 60) a.log.shift();
    this.dirty = true;
  }

  private pushApprovals() {
    const list: ApprovalView[] = [...this.pending].map(([id, detail]) => ({ id, name: this.agents.get(id)?.name ?? id, detail }));
    bus.emit('approvals', list);
    if (list.length) this.bossScreen.play('scr-alert', true);
    else this.bossScreen.stop().setFrame('desktop');
  }

  private pushState(time: number) {
    this.dirty = false;
    this.lastPush = time;
    const views: AgentView[] = [...this.agents.values()].map((a) => ({
      id: a.id,
      name: a.name,
      activity: a.activity,
      detail: a.detail,
      task: a.task,
      avatar: this.avatar(a.tex),
      log: a.log,
    }));
    bus.emit('agents', views);
  }

  private avatar(tex: string) {
    if (!this.avatars.has(tex)) this.avatars.set(tex, this.textures.getBase64(tex, 'down0'));
    return this.avatars.get(tex)!;
  }
}
