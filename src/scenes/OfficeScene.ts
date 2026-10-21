import Phaser from 'phaser';
import { bus } from '../bus';
import { buildPeople, CAST } from '../art/people';
import { buildProps } from '../art/props';
import { buildRooms } from '../art/rooms';
import { buildBand, GLASS_TOP, MULLION_STEP, MULLION_W, SILL } from '../art/skyline';
import { Agent } from '../agents/Agent';
import { DEFAULT_SETTINGS, type Crew, type CrewHooks, type CrewSave } from '../agents/crew';
import { RealCrew, type AgentBridge } from '../agents/real';
import { Sim } from '../agents/sim';
import type { AgentEvent, Decision, Idea, Picture, ProjectInfo, Settings, Team } from '../agents/types';
import type { AgentView, ApprovalView, PitchView } from '../ui/hud';
import {
  BAND_ROWS, BOSS_MONITOR, COLS, ELEVATORS, HEIGHT, OUTBOX, ROWS, TILE, WIDTH, desks, props, rooms, spots, walls,
  type Tile,
} from '../world/map';

const MAX_PAPERS = 12;

/** What the preload script exposes (see electron/preload.cjs). */
interface OfficeBridge {
  listProjects(): Promise<ProjectInfo[]>;
  agents?: AgentBridge;
  settings?: { get(): Promise<Settings>; set(next: Settings): Promise<Settings> };
  memory?: { load(): Promise<OfficeSave | null>; save(data: OfficeSave): void };
  app?: {
    close(): void;
    onWorkingQuery(count: () => number): void;
    onBackground(cb: (on: boolean) => void): void;
    allDone(): void;
  };
}

/** The office as remembered between runs: who sits where, their logs, and the crew's own state. */
interface OfficeSave {
  v: 1;
  shipped: number;
  agents: { id: string; name: string; cast: number; desk: number; log: string[] }[];
  crew: CrewSave;
}

const SAVE_KEY = 'lgih.office';
/** Log lines kept per person between runs. */
const SAVED_LOG = 120;

/** Merge tiles into rectangles [x, y, w, h]: runs along each row, stacked where rows match. */
function mergeTiles(tiles: [number, number][]): [number, number, number, number][] {
  const rows = new Map<number, number[]>();
  for (const [x, y] of tiles) rows.set(y, [...(rows.get(y) ?? []), x]);
  const out: [number, number, number, number][] = [];
  const open = new Map<string, [number, number, number, number]>();
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = rows.get(y)!.sort((a, b) => a - b);
    const runs: [number, number][] = [];
    for (const x of xs) {
      const last = runs[runs.length - 1];
      if (last && x === last[0] + last[1]) last[1]++;
      else runs.push([x, 1]);
    }
    const next = new Map<string, [number, number, number, number]>();
    for (const [x, w] of runs) {
      const key = `${x},${w}`, prev = open.get(key);
      if (prev && prev[1] + prev[3] === y) {
        prev[3]++;
        next.set(key, prev);
      } else {
        const rect: [number, number, number, number] = [x, y, w, 1];
        out.push(rect);
        next.set(key, rect);
      }
    }
    open.clear();
    next.forEach((v, k) => open.set(k, v));
  }
  return out;
}

/** At their PC: how they sit (typing or not) and what their screen shows, per activity. */
const AT_PC: Record<Exclude<AgentEvent['activity'], 'queued' | 'pitching'>, ['stand' | 'type', string]> = {
  thinking: ['stand', 'desktop'],
  reading: ['type', 'scr-code'],
  writing: ['type', 'scr-code'],
  running: ['type', 'scr-run'],
  awaiting: ['stand', 'scr-alert'],
  talking: ['stand', 'desktop'],
  standby: ['stand', 'desktop'],
  done: ['stand', 'desktop'],
  idle: ['stand', 'scr-saver'],
};

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
  /** Fired staff on their way to the elevator. */
  private leaving = new Set<Agent>();
  private saveTimer?: number;
  /** Closing: what's on screen now is what gets remembered. */
  private frozen = false;
  /** agent id -> desk id, including agents still in the elevator */
  private hired = new Map<string, number>();
  private arrivals: { at: number; then: () => void }[] = [];
  private nextElevator = 0;
  private crew!: Crew;
  private screens: Phaser.GameObjects.Sprite[] = [];
  private bossScreen!: Phaser.GameObjects.Sprite;
  private racks: Phaser.GameObjects.Sprite[] = [];
  private doors: [Phaser.GameObjects.Image, Phaser.GameObjects.Image][] = [];
  private ring!: Phaser.GameObjects.Image;
  private pending = new Map<string, string>();
  private papers: Phaser.GameObjects.Image[] = [];
  private shipped = 0;
  private selected: string | null = null;
  private dirty = true;
  private lastPush = 0;
  private avatars = new Map<string, string>();
  private teamList: Team[] = [];
  private keys!: Record<'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd', Phaser.Input.Keyboard.Key>;
  private drag: { x: number; y: number; sx: number; sy: number } | null = null;

  constructor() {
    super('office');
  }

  create() {
    buildPeople(this);
    buildProps(this);
    buildRooms(this);
    buildBand(this, WIDTH, 'night'); // always after hours: the city at night, 1990s style
    this.drawRoom();

    for (const p of props) {
      const s = this.add.sprite(p.x, p.y, p.key).setOrigin(0.5, 1).setDepth(p.depth ?? p.y);
      if (p.key === 'workboard') {
        s.setInteractive({ useHandCursor: true }).on('pointerup', () => bus.emit('board:open'));
        s.on('pointerover', () => s.setTint(0xfff2c0)).on('pointerout', () => s.clearTint());
      }
      if (p.anim) {
        s.play({ key: p.anim, startFrame: Math.floor(Math.random() * 3) });
        this.racks.push(s);
      }
    }
    this.screens = desks.map((d) => this.add.sprite(d.screen.x, d.screen.y, 'screen', 'off').setOrigin(0).setDepth(d.screen.depth));
    this.bossScreen = this.add.sprite(BOSS_MONITOR.x, BOSS_MONITOR.y, 'screen', 'desktop').setOrigin(0).setDepth(BOSS_MONITOR.depth);
    this.ring = this.add.image(0, 0, 'ring').setVisible(false);
    this.tweens.add({ targets: this.ring, alpha: 0.35, duration: 500, yoyo: true, repeat: -1 });

    const hooks: CrewHooks = {
      emit: (ev) => this.apply(ev),
      note: (id, text) => this.note(id, text),
      pitch: (id, idea) => this.showPitch(id, idea),
      queue: (ids) => bus.emit('queue', ids.map((id) => this.agents.get(id)?.name ?? id)),
      limits: (l) => bus.emit('usage:limits', l),
      teams: (list) => {
        this.teamList = list;
        this.dirty = true;
        bus.emit('teams', list);
      },
      allDone: () => {
        // the app quits right after this: remember that everyone went home
        this.save();
        this.office()?.app?.allDone();
      },
    };
    // inside the desktop app the staff are real Claude Code sessions; in a plain browser they're simulated
    const bridge = this.office()?.agents;
    this.crew = bridge ? new RealCrew(bridge, hooks) : new Sim(this.time, hooks);
    bus.emit('crew', this.crew.real);
    void this.loadSettings()
      .then(() => this.loadProjects())
      .then(() => this.loadStaff());
    // closing with work in progress: Electron asks how many are mid-job, and may hide the window
    this.office()?.app?.onWorkingQuery(() => this.crew.workingCount());
    this.office()?.app?.onBackground((on) => {
      this.crew.setBackground(on);
      this.dirty = true;
    });
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
    bus.on('shutdown', (done: () => void) => {
      this.save();
      this.frozen = true;
      this.lightsOut(done);
    });
    bus.on('agent:fire', (id: string) => this.fire(id));
    bus.on('approval:resolve', ({ id, ok }: { id: string; ok: boolean }) => this.resolve(id, ok));
    bus.on('pitch:decide', ({ id, decision }: { id: string; decision: Decision }) => this.crew.decide(id, decision));
    bus.on('agent:say', ({ id, text, pictures }: { id: string; text: string; pictures?: Picture[] }) => this.crew.say(id, text, pictures));
    bus.on('agent:model', ({ id, model }: { id: string; model: string }) => {
      this.crew.setModel(id, model);
      this.dirty = true;
    });
    bus.on('agent:stop', (id: string) => this.crew.interrupt(id));
    bus.on('agent:engine', ({ id, engine }: { id: string; engine: string }) => {
      this.crew.setEngine(id, engine);
      this.dirty = true;
    });
    bus.on('settings:save', async (next: Settings) => {
      const saved = (await this.office()?.settings?.set(next)) ?? next;
      this.crew.settings = saved;
      bus.emit('settings', saved);
      void this.loadProjects();
    });
    bus.on('app:close', () => this.office()?.app?.close());
    bus.on('team:create', ({ pictures, ...t }: Omit<Team, 'id'> & { pictures?: Picture[] }) => this.crew.createTeam(t, pictures));
    bus.on('team:disband', (id: string) => this.crew.disbandTeam(id));
    bus.on('autoapprove', (on: boolean) => {
      this.crew.autoApprove = on;
      if (on) for (const id of [...this.pending.keys()]) this.resolve(id, true);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => bus.removeAllListeners());
  }

  update(time: number, delta: number) {
    for (const a of this.agents.values()) a.update(time, delta);
    for (const a of this.leaving) a.update(time, delta);
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
    cam.setZoom(Math.max(1, this.fitZoom())).centerOn(19.5 * TILE, 17 * TILE);

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
    // a bigger window (fullscreen, maximised) never shows past the edge of the floor
    this.scale.on('resize', () => {
      if (cam.zoom < this.fitZoom()) this.zoomTo(this.fitZoom());
      else this.emitZoom();
    });
    this.emitZoom();
  }

  /** As far out as it goes: the floor fills the window both ways, so there's never empty space around it. */
  private fitZoom() {
    const cam = this.cameras.main;
    return Math.max(cam.width / WIDTH, cam.height / HEIGHT);
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

  // ---------------------------------------------------------------- closing time

  /**
   * Closing the app: pull back to the whole floor, switch the lights off room by
   * room (Ahmad's office last), leave the CRTs glowing, fade out, say goodbye.
   */
  private lightsOut(done: () => void) {
    const cam = this.cameras.main, T = TILE;
    this.input.enabled = false;
    cam.pan(WIDTH / 2, HEIGHT / 2, 700, 'Sine.easeInOut');
    cam.zoomTo(this.fitZoom(), 700, 'Sine.easeInOut');
    // screens keep glowing after the lights go out
    for (const s of [...this.screens, this.bossScreen]) s.setDepth(20001);
    const order = ['Mail room', 'Lobby', 'Break room', 'Cubicles', 'Archive', 'Conference', 'Mainframe', 'Corner office'];
    const zones = order.map((name) => rooms.findIndex((r) => r.name === name)).filter((i) => i >= 0);
    // each room goes dark together with its walls (a wall belongs to the room it faces)
    const roomAt = (x: number, y: number) => rooms.findIndex((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
    const owner = (x: number, y: number) => {
      for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const i = roomAt(x + dx, y + dy);
        if (i >= 0) return i;
      }
      return rooms.findIndex((r) => r.name === 'Cubicles');
    };
    const tiles = new Map<number, [number, number][]>();
    for (let y = BAND_ROWS; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const i = owner(x, y);
        tiles.set(i, [...(tiles.get(i) ?? []), [x, y]]);
      }
    const dark = (g: Phaser.GameObjects.Graphics) => {
      g.setAlpha(0.8);
      this.time.delayedCall(70, () => g.setAlpha(0.25));
      this.time.delayedCall(140, () => g.setAlpha(0.84));
    };
    const overlays: Phaser.GameObjects.Graphics[] = [];
    // the office sign hangs over the glass: it goes dark in one piece, not striped by the window columns behind it
    const signProp = props.find((p) => p.key === 'officesign');
    const signImg = signProp && this.textures.get('officesign').getSourceImage();
    const sign = signProp && signImg ? { x0: signProp.x - signImg.width / 2, x1: signProp.x + signImg.width / 2, y0: signProp.y - signImg.height, y1: signProp.y } : null;
    const frame = (g: Phaser.GameObjects.Graphics, x0: number, x1: number) => {
      g.fillRect(x0, 0, x1 - x0, GLASS_TOP).fillRect(x0, SILL, x1 - x0, BAND_ROWS * T - SILL);
      for (let mx = Math.ceil(x0 / MULLION_STEP) * MULLION_STEP; mx < x1; mx += MULLION_STEP) {
        if (sign && mx + MULLION_W > sign.x0 && mx < sign.x1) {
          // above and below the sign, plus any bit of the column sticking out beside it
          g.fillRect(mx, GLASS_TOP, MULLION_W, sign.y0 - GLASS_TOP).fillRect(mx, sign.y1, MULLION_W, SILL - sign.y1);
          if (mx < sign.x0) g.fillRect(mx, sign.y0, sign.x0 - mx, sign.y1 - sign.y0);
          if (mx + MULLION_W > sign.x1) g.fillRect(sign.x1, sign.y0, mx + MULLION_W - sign.x1, sign.y1 - sign.y0);
        } else g.fillRect(mx, GLASS_TOP, MULLION_W, SILL - GLASS_TOP);
      }
      if (sign && sign.x0 < x1 && sign.x1 > x0) g.fillRect(sign.x0, sign.y0, sign.x1 - sign.x0, sign.y1 - sign.y0);
    };
    zones.forEach((zone, n) =>
      this.time.delayedCall(900 + n * 350, () => {
        const g = this.add.graphics().setDepth(20000).setAlpha(0);
        overlays.push(g);
        g.fillStyle(0x050818);
        const mine = tiles.get(zone) ?? [];
        // as few rectangles as possible: tile-sized ones leave seams when zoomed out
        for (const [x, y, w, h] of mergeTiles(mine)) g.fillRect(x * T, y * T, w * T, h * T);
        // rooms along the windows also take their stretch of the window frame; the glass stays lit
        const top = mine.filter(([, y]) => y === BAND_ROWS).map(([x]) => x);
        if (top.length) frame(g, Math.min(...top) * T, (Math.max(...top) + 1) * T);
        dark(g);
      }),
    );
    const lastAt = 900 + zones.length * 350;
    // once everything is off, one seamless sheet of dark replaces the per-room ones
    this.time.delayedCall(lastAt + 200, () => {
      const g = this.add.graphics().setDepth(20000).setAlpha(0.84);
      g.fillStyle(0x050818).fillRect(0, BAND_ROWS * T, WIDTH, HEIGHT - BAND_ROWS * T);
      frame(g, 0, WIDTH);
      overlays.forEach((o) => o.destroy());
    });
    this.time.delayedCall(lastAt + 900, () => {
      cam.fadeOut(900, 0, 0, 0);
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        bus.emit('goodbye');
        this.time.delayedCall(2600, done);
      });
    });
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
  private openElevator(then: () => void, at?: number) {
    this.arrivals.push({ at: at ?? this.nextElevator, then });
    if (at === undefined) this.nextElevator = (this.nextElevator + 1) % ELEVATORS.length;
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
      this.crew.begin(id, name);
    });
  }

  /** Last time's staff walk back in: already at their desks, picking up where they left off. */
  private async loadStaff() {
    const save = await this.loadSave();
    if (!save?.agents.length) {
      // simulated staff show up on their own; real ones are hired one by one, since each runs Claude Code
      if (!this.crew.real) [300, 2600, 4900].forEach((ms) => this.time.delayedCall(ms, () => this.hire()));
      return;
    }
    const placed = new Set<string>();
    for (const saved of save.agents) {
      const taken = new Set(this.hired.values());
      const desk = desks.find((d) => d.id === saved.desk && !taken.has(d.id)) ?? desks.find((d) => !taken.has(d.id));
      if (!desk || !CAST[saved.cast] || this.hired.has(saved.id)) continue;
      this.hired.set(saved.id, desk.id);
      this.screens[desk.id].setFrame('desktop');
      const a = new Agent(this, saved.id, saved.name, `person${saved.cast}`, desk, desk.seat);
      a.goTo(desk.seat);
      a.log = [...saved.log];
      this.agents.set(saved.id, a);
      placed.add(saved.id);
    }
    if (this.hired.size >= Math.min(desks.length, CAST.length)) bus.emit('hire:full');
    this.shipped = save.shipped;
    bus.emit('shipped', this.shipped);
    for (let i = 0; i < Math.min(this.shipped, MAX_PAPERS); i++) this.addPaper();
    this.crew.restore({ staff: save.crew.staff.filter((p) => placed.has(p.id)), teams: save.crew.teams });
    this.dirty = true;
  }

  private async loadSave(): Promise<OfficeSave | null> {
    try {
      const memory = this.office()?.memory;
      const save = memory ? await memory.load() : (JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as OfficeSave | null);
      return save?.v === 1 ? save : null;
    } catch {
      return null;
    }
  }

  /** Remember the office a moment after it changes. */
  private saveSoon() {
    if (this.frozen) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 1500);
  }

  private save() {
    if (this.frozen) return;
    window.clearTimeout(this.saveTimer);
    const castOf = (tex: string) => Number(tex.replace('person', ''));
    const data: OfficeSave = {
      v: 1,
      shipped: this.shipped,
      agents: [...this.agents.values()].map((a) => ({ id: a.id, name: a.name, cast: castOf(a.tex), desk: a.desk.id, log: a.log.slice(-SAVED_LOG) })),
      crew: this.crew.snapshot(),
    };
    const memory = this.office()?.memory;
    if (memory) memory.save(data);
    else {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {
        // no storage: this browser session just won't be remembered
      }
    }
  }

  /** Let someone go: they stop, walk to the elevator and leave, and their desk is free again. */
  private fire(id: string) {
    const a = this.agents.get(id);
    if (!a) return;
    // off the books first, so nothing the crew says on the way out moves them
    this.agents.delete(id);
    this.hired.delete(id);
    if (this.pending.delete(id)) this.pushApprovals();
    this.crew.fire(id);
    this.screens[a.desk.id].stop().setFrame('off');
    if (this.selected === id) this.selected = null;
    bus.emit('hire:open');
    a.sprite.disableInteractive();
    a.activity = 'idle';
    a.setPose('stand');
    const at = ELEVATORS.reduce((best, e, i) => (Math.abs(e.x - a.tile.x) < Math.abs(ELEVATORS[best].x - a.tile.x) ? i : best), 0);
    this.leaving.add(a);
    a.goTo({ ...ELEVATORS[at], face: 'down' }, () =>
      this.openElevator(() => {
        this.leaving.delete(a);
        a.destroy();
      }, at),
    );
    this.dirty = true;
    this.save();
  }

  /** React to an agent event: send the character to the right part of the office. */
  private apply(ev: AgentEvent) {
    const a = this.agents.get(ev.agentId);
    if (!a) return;
    const settle = () => this.crew.settled(a.id);
    const screen = this.screens[a.desk.id];

    // a hand raised for permission comes down once they've moved on
    if (a.activity === 'awaiting' && ev.activity !== 'awaiting' && this.pending.delete(a.id)) this.pushApprovals();
    a.setWander(null);
    a.activity = ev.activity;
    a.detail = ev.detail ?? '';
    a.task = ev.task ?? a.task;
    if (ev.detail) this.note(a.id, ev.detail);
    if (ev.activity === 'awaiting') {
      this.pending.set(a.id, ev.detail ?? 'Permission needed');
      this.pushApprovals();
    }

    // People only ever go to two places: the owner's office to pitch, and their own PC.
    if (ev.activity === 'queued') {
      // the first few wait in line outside the owner's door, the rest at their desks
      const place = ev.queue ?? 1;
      a.goTo(place <= spots.line.length ? spots.line[place - 1] : a.desk.seat, settle);
    } else if (ev.activity === 'pitching') {
      a.goTo(spots.pitch, settle);
    } else {
      const [pose, show] = AT_PC[ev.activity];
      a.goTo(a.desk.seat, () => {
        a.setPose(pose);
        if (show.startsWith('scr-')) screen.play(show, true);
        else screen.stop().setFrame(show);
        if (ev.activity === 'done') this.ship();
        settle();
      });
    }
    this.racks.forEach((r) => (r.anims.timeScale = this.count('running') ? 3 : 1));
    this.dirty = true;
  }

  private resolve(id: string, ok: boolean) {
    if (!this.pending.delete(id)) return;
    this.pushApprovals();
    this.crew.resolve(id, ok);
  }

  private ship() {
    this.shipped++;
    bus.emit('shipped', this.shipped);
    this.addPaper();
  }

  /** One more finished job on the pile in the outbox. */
  private addPaper() {
    if (this.papers.length >= MAX_PAPERS) this.papers.shift()?.destroy();
    const n = this.papers.length;
    const tray = n % 3, height = Math.floor(n / 3);
    this.papers.push(
      this.add.image(OUTBOX.left + 24 + tray * 40, OUTBOX.top + 16 - height * 3, 'paper').setOrigin(0.5, 1).setDepth(OUTBOX.top + 41 + n * 0.01),
    );
  }

  // ---------------------------------------------------------------- places

  private count(activity: Agent['activity']) {
    return [...this.agents.values()].filter((a) => a.activity === activity).length;
  }

  // ---------------------------------------------------------------- HUD

  /** The bridge to the machine; only there inside the desktop app. */
  private office() {
    return (window as { office?: OfficeBridge }).office;
  }

  private async loadSettings() {
    const s = (await this.office()?.settings?.get()) ?? DEFAULT_SETTINGS;
    this.crew.settings = s;
    bus.emit('settings', s);
  }

  /** Projects come from the machine through Electron; in a plain browser there's a sample instead. */
  private async loadProjects() {
    const office = this.office();
    const list = office ? await office.listProjects().catch(() => []) : SAMPLE_PROJECTS;
    this.crew.projects = list;
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
    if (a.log.length > 300) a.log.shift();
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
      model: this.crew.modelOf(a.id),
      usage: this.crew.usageOf(a.id),
      status: this.crew.statusOf(a.id),
      ...this.roleOf(a.id),
      real: this.crew.real,
    }));
    bus.emit('agents', views);
    this.saveSoon();
  }

  private roleOf(id: string): { team?: string; role?: 'manager' | 'worker' } {
    const t = this.teamList.find((x) => x.manager === id || x.workers.includes(id));
    return t ? { team: t.name, role: t.manager === id ? 'manager' : 'worker' } : {};
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
