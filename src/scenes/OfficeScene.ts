import Phaser from 'phaser';
import { bus } from '../bus';
import { buildPeople, CAST } from '../art/people';
import { buildProps } from '../art/props';
import { buildRooms } from '../art/rooms';
import { buildBand, currentPhase } from '../art/skyline';
import { Agent } from '../agents/Agent';
import { Sim } from '../agents/sim';
import type { AgentEvent, Decision, Idea, ProjectInfo } from '../agents/types';
import type { AgentView, ApprovalView, PitchView } from '../ui/hud';
import {
  BAND_ROWS, BOSS_MONITOR, COLS, ELEVATORS, HEIGHT, OUTBOX, ROWS, TILE, WIDTH, desks, props, randomNear, rooms, spots, walkable, walls,
  type Spot, type Tile,
} from '../world/map';

const MAX_PAPERS = 12;

const SAMPLE_PROJECTS: ProjectInfo[] = [
  { name: 'letting-go-is-hard', path: '~/proiecte/letting-go-is-hard', languages: ['TypeScript'], files: 24, biggest: 'src/art/props.ts', hasTests: false, hasReadme: true, readme: 'Letting Go Is Hard', isGit: true, lastCommit: 'Whole floor with detailed pixel art', hasCi: false },
  { name: 'sample-api', path: '~/proiecte/sample-api', languages: ['Python'], files: 40, biggest: 'app/routes.py', hasTests: true, hasReadme: false, readme: null, isGit: true, lastCommit: 'Add login endpoint', hasCi: false },
];
/** Width of one elevator door leaf. */
const HALF = TILE / 2;
/** Height of a wall's top edge; the rest of the tile is its face. */
const CAP = 12;
/** Zoom steps; above 1x they stay whole numbers so every pixel is the same size. */
const ZOOMS = [0.5, 0.75, 1, 2, 3];

export class OfficeScene extends Phaser.Scene {
  private agents = new Map<string, Agent>();
  /** agent id -> desk id, including agents still in the elevator */
  private hired = new Map<string, number>();
  private arrivals: { at: number; then: () => void }[] = [];
  private nextElevator = 0;
  private sim!: Sim;
  private screens: Phaser.GameObjects.Sprite[] = [];
  private bossScreen!: Phaser.GameObjects.Sprite;
  private racks: Phaser.GameObjects.Sprite[] = [];
  private doors: [Phaser.GameObjects.Image, Phaser.GameObjects.Image][] = [];
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
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private drag: { x: number; y: number; sx: number; sy: number } | null = null;

  constructor() {
    super('office');
  }

  create() {
    buildPeople(this);
    buildProps(this);
    buildRooms(this);
    buildBand(this, WIDTH, currentPhase());
    this.drawRoom();

    for (const p of props) {
      const s = this.add.sprite(p.x, p.y, p.key).setOrigin(0.5, 1).setDepth(p.depth ?? p.y);
      if (p.anim) {
        s.play({ key: p.anim, startFrame: Math.floor(Math.random() * 3) });
        this.racks.push(s);
      }
    }
    this.screens = desks.map((d) => this.add.sprite(d.screen.x, d.screen.y, 'screen', 'off').setOrigin(0).setDepth(d.screen.depth));
    this.bossScreen = this.add.sprite(BOSS_MONITOR.x, BOSS_MONITOR.y, 'screen', 'desktop').setOrigin(0).setDepth(BOSS_MONITOR.depth);
    this.ring = this.add.image(0, 0, 'ring').setVisible(false);
    this.tweens.add({ targets: this.ring, alpha: 0.35, duration: 500, yoyo: true, repeat: -1 });

    this.sim = new Sim(this.time, {
      emit: (ev) => this.apply(ev),
      note: (id, text) => this.note(id, text),
      pitch: (id, idea) => this.showPitch(id, idea),
      queue: (ids) => bus.emit('queue', ids.map((id) => this.agents.get(id)?.name ?? id)),
    });
    this.loadProjects();
    this.setupCamera();

    this.input.on('gameobjectdown', (_p: Phaser.Input.Pointer, obj: Phaser.GameObjects.GameObject) => {
      const id = obj.getData('agent') as string | undefined;
      if (id) bus.emit('select', id);
    });
    bus.on('select', (id: string) => (this.selected = id));
    bus.on('focus', (id: string) => {
      const a = this.agents.get(id);
      if (a) this.cameras.main.pan(a.sprite.x, a.sprite.y - 40, 500, 'Sine.easeInOut');
    });
    bus.on('hire', () => this.hire());
    bus.on('approval:resolve', ({ id, ok }: { id: string; ok: boolean }) => this.resolve(id, ok));
    bus.on('pitch:decide', ({ id, decision }: { id: string; decision: Decision }) => this.sim.decide(id, decision));
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
    this.panWithKeys(delta);
    if (this.dirty && time - this.lastPush > 250) this.pushState(time);
  }

  // ---------------------------------------------------------------- camera

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WIDTH, HEIGHT).setRoundPixels(true);
    cam.setZoom(1).centerOn(19.5 * TILE, 17 * TILE);

    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.zoomStep(dy > 0 ? -1 : 1, p.x, p.y));

    // drag anywhere to pan; a short press still counts as a click
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => (this.drag = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY }));
    this.input.on('pointerup', () => (this.drag = null));
    this.input.on('pointerupoutside', () => (this.drag = null));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      cam.setScroll(this.drag.sx - (p.x - this.drag.x) / cam.zoom, this.drag.sy - (p.y - this.drag.y) / cam.zoom);
    });

    const kb = this.input.keyboard!;
    this.keys = {
      up: kb.addKey('UP', false), down: kb.addKey('DOWN', false), left: kb.addKey('LEFT', false), right: kb.addKey('RIGHT', false),
      w: kb.addKey('W', false), a: kb.addKey('A', false), s: kb.addKey('S', false), d: kb.addKey('D', false),
    };
    kb.on('keydown', (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === '+' || e.key === '=') this.zoomStep(1);
      if (e.key === '-' || e.key === '_') this.zoomStep(-1);
      if (e.key === '0' || e.key === 'f') this.zoomTo(this.fitZoom());
    });
    bus.on('zoom', (how: 'in' | 'out' | 'fit') => (how === 'fit' ? this.zoomTo(this.fitZoom()) : this.zoomStep(how === 'in' ? 1 : -1)));
    this.scale.on('resize', () => this.emitZoom());
    this.emitZoom();
  }

  private fitZoom() {
    const cam = this.cameras.main;
    return Math.min(cam.width / WIDTH, cam.height / HEIGHT);
  }

  /** Step through the zoom levels, keeping the point under the cursor in place. */
  private zoomStep(dir: 1 | -1, px?: number, py?: number) {
    const cam = this.cameras.main;
    const levels = [...new Set([this.fitZoom(), ...ZOOMS])].sort((a, b) => a - b).filter((z) => z >= this.fitZoom() - 1e-6);
    const z = cam.zoom;
    const next = dir > 0 ? levels.find((l) => l > z + 1e-6) : [...levels].reverse().find((l) => l < z - 1e-6);
    if (next !== undefined) this.zoomTo(next, px, py);
  }

  private zoomTo(zoom: number, px = this.cameras.main.width / 2, py = this.cameras.main.height / 2) {
    const cam = this.cameras.main;
    const w = cam.width, h = cam.height;
    const wx = cam.scrollX + w / 2 + (px - w / 2) / cam.zoom;
    const wy = cam.scrollY + h / 2 + (py - h / 2) / cam.zoom;
    cam.setZoom(zoom);
    cam.setScroll(wx - w / 2 - (px - w / 2) / zoom, wy - h / 2 - (py - h / 2) / zoom);
    this.emitZoom();
  }

  private emitZoom() {
    bus.emit('zoom:level', this.cameras.main.zoom);
  }

  private panWithKeys(delta: number) {
    const k = this.keys, cam = this.cameras.main;
    const dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    const dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
    if (!dx && !dy) return;
    const step = (700 * delta) / 1000 / cam.zoom;
    cam.setScroll(cam.scrollX + dx * step, cam.scrollY + dy * step);
  }

  // ---------------------------------------------------------------- room

  private drawRoom() {
    const T = TILE;
    this.add.tileSprite(0, BAND_ROWS * T, WIDTH, HEIGHT - BAND_ROWS * T, 'carpet').setOrigin(0).setDepth(-11);
    for (const room of rooms) {
      const w = (room.x1 - room.x0 + 1) * T, h = (room.y1 - room.y0 + 1) * T;
      this.add.tileSprite(room.x0 * T, room.y0 * T, w, h, room.floor).setOrigin(0).setDepth(-10);
    }
    this.add.image(0, 0, 'band').setOrigin(0).setDepth(-5);

    // soft shadows where floors meet walls
    const sh = this.add.graphics().setDepth(-9);
    for (let y = BAND_ROWS; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        if (walls[y][x]) continue;
        if (y === BAND_ROWS || walls[y - 1][x]) { sh.fillStyle(0x000000, 0.22).fillRect(x * T, y * T, T, 4); sh.fillStyle(0x000000, 0.1).fillRect(x * T, y * T + 4, T, 6); }
        if (x > 0 && walls[y][x - 1]) sh.fillStyle(0x000000, 0.14).fillRect(x * T, y * T, 5, T);
        if (x < COLS - 1 && walls[y][x + 1]) sh.fillStyle(0x000000, 0.08).fillRect(x * T + T - 3, y * T, 3, T);
      }
    // brass thresholds in the doorways: open tiles that belong to no room
    const th = this.add.graphics().setDepth(-9);
    const inRoom = (x: number, y: number) => rooms.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
    for (let y = BAND_ROWS; y < ROWS - 1; y++)
      for (let x = 1; x < COLS - 1; x++)
        if (!walls[y][x] && !inRoom(x, y)) th.fillStyle(0xb8a060).fillRect(x * T, y * T + 22, T, 3).fillStyle(0xe0c880).fillRect(x * T, y * T + 22, T, 1);

    for (let y = BAND_ROWS; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) if (walls[y][x]) this.drawWall(x, y);

    for (const e of ELEVATORS) this.drawElevator(e);
  }

  /** A wall tile seen from above and slightly south: a cap, plus a face if nothing continues below it. */
  private drawWall(x: number, y: number) {
    const T = TILE, px = x * T, py = y * T;
    const g = this.add.graphics().setDepth((y + 1) * T);
    const below = y + 1 < ROWS && walls[y + 1][x];
    const outer = x === 0 || x === COLS - 1;
    if (below) {
      // a wall running north-south: only its top is visible
      const w = outer ? T : 18, ox = outer ? 0 : (T - w) / 2;
      g.fillStyle(0xe4dbc2).fillRect(px + ox, py, w, T);
      g.fillStyle(0xf4eedc).fillRect(px + ox, py, 2, T);
      g.fillStyle(0xa89a78).fillRect(px + ox + w - 2, py, 2, T);
      if (outer) { g.fillStyle(0xcfc4a4).fillRect(px + 6, py, T - 12, T); g.fillStyle(0xbfb393).fillRect(px + 10, py, T - 20, T); }
      return;
    }
    // an east-west wall: top edge and the painted face
    const left = x > 0 && walls[y][x - 1], right = x < COLS - 1 && walls[y][x + 1];
    g.fillStyle(0xe4dbc2).fillRect(px, py, T, CAP);
    g.fillStyle(0xf4eedc).fillRect(px, py, T, 2);
    g.fillStyle(0xa89a78).fillRect(px, py + CAP - 2, T, 2);
    g.fillStyle(0xcfc4a4).fillRect(px, py + CAP, T, T - CAP);
    g.fillStyle(0xd8ceb0).fillRect(px, py + CAP, T, 4);
    for (let i = 0; i < 3; i++) g.fillStyle(0xc6bb9a).fillRect(px + 7 + i * 16, py + CAP + 10 + ((x + i) % 3) * 7, 1, 1);
    g.fillStyle(0x6e6553).fillRect(px, py + T - 6, T, 6);
    g.fillStyle(0x8a8068).fillRect(px, py + T - 6, T, 1);
    // door frames where the wall ends at an opening
    if (!left && x > 0) { g.fillStyle(0x8a6a42).fillRect(px, py + CAP, 4, T - CAP); g.fillStyle(0xaa8a5a).fillRect(px, py + CAP, 1, T - CAP); }
    if (!right && x < COLS - 1) { g.fillStyle(0x8a6a42).fillRect(px + T - 4, py + CAP, 4, T - CAP); g.fillStyle(0x5a4222).fillRect(px + T - 1, py + CAP, 1, T - CAP); }
  }

  private drawElevator(e: Tile) {
    const T = TILE, ex = e.x * T, top = e.y * T + CAP, H = T - CAP;
    const g = this.add.graphics().setDepth((e.y + 1) * T - 1);
    g.fillStyle(0xe4dbc2).fillRect(ex, e.y * T, T, CAP);
    g.fillStyle(0x2a2622).fillRect(ex, top, T, H);
    g.fillStyle(0x6a5a30).fillRect(ex - 6, top - 2, T + 12, 3);
    g.fillStyle(0xc9a227).fillRect(ex - 5, top - 2, T + 10, 2).fillRect(ex - 5, top, 4, H).fillRect(ex + T + 1, top, 4, H);
    g.fillStyle(0xf0d060).fillRect(ex - 5, top, 1, H).fillRect(ex + T + 1, top, 1, H);
    // up/down call buttons
    g.fillStyle(0x8a7a50).fillRect(ex + T + 9, top + 10, 7, 16);
    g.fillStyle(0xffd060).fillRect(ex + T + 11, top + 13, 3, 3);
    g.fillStyle(0xe8e0c8).fillRect(ex + T + 11, top + 20, 3, 3);
    // floor indicator
    g.fillStyle(0x1a1a1a).fillRect(ex + 12, e.y * T + 1, 24, 9);
    g.fillStyle(0xff6030).fillRect(ex + 15, e.y * T + 3, 3, 5).fillRect(ex + 20, e.y * T + 3, 3, 5).fillRect(ex + 28, e.y * T + 4, 4, 3);

    const mask = this.make.graphics({}, false).fillRect(ex, top, T, H).createGeometryMask();
    const depth = (e.y + 1) * T + 1;
    this.doors.push([
      this.add.image(ex, top, 'door').setOrigin(0).setDepth(depth).setMask(mask),
      this.add.image(ex + HALF, top, 'door').setOrigin(0).setDepth(depth).setMask(mask).setFlipX(true),
    ]);
  }

  /** One elevator trip at a time; later arrivals wait their turn. */
  private openElevator(then: () => void) {
    this.arrivals.push({ at: this.nextElevator, then });
    this.nextElevator = (this.nextElevator + 1) % ELEVATORS.length;
    if (this.arrivals.length === 1) this.elevatorTrip();
  }

  private elevatorTrip() {
    const { at, then } = this.arrivals[0];
    const ex = ELEVATORS[at].x * TILE;
    const [l, r] = this.doors[at];
    const slide = (from: number, to: number, delay: number, done: () => void) =>
      this.tweens.addCounter({
        from, to, delay, duration: 350,
        onUpdate: (tw) => {
          const gap = tw.getValue() ?? 0;
          l.x = ex - gap;
          r.x = ex + HALF + gap;
        },
        onComplete: done,
      });
    slide(0, HALF, 0, () => {
      then();
      slide(HALF, 0, 1400, () => {
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
    const at = this.nextElevator;
    this.openElevator(() => {
      this.agents.set(id, new Agent(this, id, name, `person${castIdx}`, desk, ELEVATORS[at]));
      this.note(id, `${name} arrived on the floor`);
      this.sim.begin(id, name);
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
      case 'thinking': {
        const seat = this.tryClaim(a.id, spots.conference);
        if (seat) a.goTo(seat, settle);
        else {
          a.goTo(this.near(a.desk.seat, 3, 'down'), settle);
          a.setWander(a.desk.seat, 3);
        }
        break;
      }
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
        // stands up by their desk with a hand raised until the command is approved
        this.pending.set(a.id, ev.detail ?? 'Permission needed');
        this.pushApprovals();
        a.goTo(this.near(a.desk.seat, 1, 'down'), () => {
          a.setPose('raise');
          settle();
        });
        break;
      case 'queued': {
        // the first few wait in line outside the owner's door, the rest at their desks
        const place = ev.queue ?? 1;
        a.goTo(place <= spots.line.length ? spots.line[place - 1] : a.desk.seat, settle);
        break;
      }
      case 'pitching':
        a.goTo(spots.pitch, settle);
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
      this.add.image(OUTBOX.left + 24 + tray * 40, OUTBOX.top + 16 - height * 3, 'paper').setOrigin(0.5, 1).setDepth(OUTBOX.top + 41 + n * 0.01),
    );
  }

  // ---------------------------------------------------------------- places

  private tryClaim(id: string, group: Spot[]): Spot | null {
    const taken = new Set(this.claims.values());
    const free = group.find((s) => !taken.has(`${s.x},${s.y}`));
    if (free) this.claims.set(id, `${free.x},${free.y}`);
    return free ?? null;
  }

  private claim(id: string, group: Spot[]): Spot {
    return this.tryClaim(id, group) ?? this.near(group[0], 2, group[0].face);
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

  /** Projects come from the machine through Electron; in a plain browser there's a sample instead. */
  private async loadProjects() {
    const office = (window as { office?: { listProjects(): Promise<ProjectInfo[]> } }).office;
    const list = office ? await office.listProjects().catch(() => []) : SAMPLE_PROJECTS;
    this.sim.projects = list;
    bus.emit('projects', list);
  }

  private showPitch(id: string | null, idea: Idea | null) {
    const a = id ? this.agents.get(id) : undefined;
    const view: PitchView | null = a && idea ? { id: a.id, name: a.name, avatar: this.avatar(a.tex), idea } : null;
    bus.emit('pitch', view);
  }

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

  /** Head-and-shoulders portrait for the Properties panel. */
  private avatar(tex: string) {
    if (!this.avatars.has(tex)) {
      const f = this.textures.getFrame(tex, 'down0');
      const c = document.createElement('canvas');
      c.width = c.height = 48;
      c.getContext('2d')!.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY + 2, 48, 48, 0, 0, 48, 48);
      this.avatars.set(tex, c.toDataURL());
    }
    return this.avatars.get(tex)!;
  }
}
