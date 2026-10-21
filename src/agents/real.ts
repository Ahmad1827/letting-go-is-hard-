import { OWNER } from '../owner';
import { DEFAULT_SETTINGS, engineIn, teamId, type AgentUsage, type Crew, type CrewHooks, type UsageWindow } from './crew';
import { branchFor } from './ideas';
import type { AgentActivity, AgentStatus, Decision, Idea, Phase, Picture, ProjectInfo, Role, Settings, Team } from './types';

/**
 * Real agents: each employee is a headless Claude Code session started by the
 * Electron main process (see electron/agents.mjs).
 *
 * On their own they loop: research -> queue -> pitch -> work on a branch -> break.
 * In a team, the manager does the researching and pitching (or takes the owner's
 * task), then hands pieces to the workers, who each build on their own branch,
 * and merges their work.
 */

type Msg =
  | { kind: 'init'; model: string; cwd: string }
  | { kind: 'assistant'; model: string; parts: ({ type: 'text'; text: string } | { type: 'tool'; name: string; input: Record<string, unknown> })[] }
  | { kind: 'permission'; requestId: string; tool: string; input: Record<string, unknown>; description: string }
  | { kind: 'result'; ok: boolean; text: string; cost: number; tokens: number }
  | { kind: 'limits'; status?: string; windows: Record<string, UsageWindow> }
  | { kind: 'exit'; code: number; error?: string };

/** A user message: plain text, or text with pictures. */
type Content = string | ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } })[];

interface StartConfig { cwd?: string; model?: string; engine?: string; system: string; prompt: Content; mode: string }

interface WorkRequest { project: string; projectPath: string | null; branch: string; isNew: boolean; base?: string; inPlace?: boolean }
interface WorkPlace { cwd: string; path: string; mode: string; branch?: string; note: string }

export interface AgentBridge {
  start(id: string, cfg: StartConfig): Promise<void>;
  send(id: string, content: Content): void;
  setModel(id: string, model: string): void;
  interrupt(id: string): void;
  stop(id: string): void;
  answer(id: string, requestId: string, allow: boolean, input: unknown, message?: string): void;
  prepareWork(req: WorkRequest): Promise<WorkPlace>;
  onMessage(cb: (id: string, msg: Msg) => void): void;
}

interface Permission { requestId: string; input: unknown; text: string }

interface Staff {
  name: string;
  phase: Phase;
  /** When the current phase started. */
  since: number;
  engine: string;
  model: string;
  /** Where approved work is happening, once it starts. */
  workCwd: string | null;
  idea: Idea | null;
  seen: Set<string>;
  alive: boolean;
  /** Asked once already to finish with a pitch block. */
  nudged: boolean;
  permissions: Permission[];
  place: number;
  /** Standing in the office with the pitch on the table. */
  pitched: boolean;
  /** The owner said "do this instead" (or gave the team a task); the next pitch block is the job, no pitching. */
  orders: string | null;
  /** Pictures that came with those orders. */
  ordersPictures: Picture[];
  team: string | null;
  role: Role | null;
  /** Worker: the manager's task being worked on. */
  assignment: string | null;
  /** Worker: their worktree and branch, kept between assignments on the same job. */
  desk: WorkPlace | null;
  activity: AgentActivity;
  lastShown: number;
  showTimer?: number;
  breakTimer?: number;
  usage: AgentUsage;
  /** The running session's cost so far; Claude Code reports it cumulatively. */
  sessionCost: number;
}

interface TeamState extends Team {
  /** The job: where it lives and the manager's branch the workers start from. */
  job: { idea: Idea; path: string; branch: string | null; inPlace: boolean } | null;
}

/** Characters change place at most this often, so a burst of tool calls doesn't make them run laps. */
const DWELL_MS = 4000;
const PITCH = /```pitch\s*([\s\S]*?)```/;
const ASSIGN = /```assign\s*([\s\S]*?)```/g;
const TEAM_DONE = /^\s*TEAM DONE\s*$/m;

const PITCH_FORMAT = `\`\`\`pitch
{"project": "<sub-folder name, or a short new folder name for a new project>", "title": "<short title>", "summary": "<2-3 sentences: what and why>", "steps": ["<step>", "<step>", "<step>"]}
\`\`\``;

const COMMIT_RULES = 'commit with clear messages using the repository\'s configured git user, and never add Co-Authored-By lines or mention Claude or AI in commits; never push';

const RESEARCH_PROMPT = (name: string) => `You are ${name}, a software engineer in ${OWNER}'s office. The current folder holds ${OWNER}'s projects, one per sub-folder (ignore hidden folders).
Right now you are researching, not building: do not create, edit, move or delete anything, and only run read-only commands. Look around with Glob, Grep and Read.
Pick a project, read enough of it to understand it (a handful of files is plenty), and come up with ONE concrete improvement you could build in an afternoon that ${OWNER} would actually want.
End your reply with exactly one block like this:
${PITCH_FORMAT}
${OWNER} may also message you directly. Answer briefly and stay in character.`;

const MANAGER_RESEARCH_PROMPT = (name: string, workers: string[]) => `You are ${name}, a manager in ${OWNER}'s office leading a team: ${workers.join(', ')}. The current folder holds ${OWNER}'s projects, one per sub-folder (ignore hidden folders).
Right now you are researching, not building: do not create, edit, move or delete anything, and only run read-only commands. Look around with Glob, Grep and Read.
Pick a project, read enough to understand it, and come up with ONE improvement that ${OWNER} would want and that is big enough for your team of ${workers.length + 1}: it should split into independent pieces people can build in parallel in an afternoon.
End your reply with exactly one block like this:
${PITCH_FORMAT}
${OWNER} may also message you directly. Answer briefly and stay in character.`;

const ORDERS_PROMPT = (text: string, forTeam: boolean) => `${OWNER} wants ${forTeam ? 'your team' : 'you'} to do this: "${text}"
Work out which project folder it is about (or pick a short folder name if it's a new project) and reply with only a pitch block describing the job. Don't explore much; you'll start right away.
${PITCH_FORMAT}`;

const WORK_PROMPT = (name: string, isNew: boolean) => `You are ${name}, a software engineer in ${OWNER}'s office. ${OWNER} approved this work and you are now building it${isNew ? ', starting a brand-new project in this folder' : ' in a git worktree on its own branch'}.
Rules: stay inside the current folder; keep changes focused; ${COMMIT_RULES}; never switch branches.
When you're done, reply with a short summary of what you changed and anything ${OWNER} should check.
${OWNER} may message you while you work; answer briefly and take it into account.`;

const MANAGER_WORK_PROMPT = (name: string, workers: string[], branch: string | null) => `You are ${name}, leading a team in ${OWNER}'s office: ${workers.join(', ')}. ${OWNER} approved the work below and you are in the project${branch ? ` on the team branch ${branch}` : ''}.
How your team works:
- Plan first, then hand each worker an independent piece by writing a block like this (one per assignment; you can assign more later):
\`\`\`assign
{"worker": "<name>", "task": "<what to build, which files, how to check it>"}
\`\`\`
- Each worker builds on their own branch started from yours and commits. Their summary comes back to you as a message naming their branch.
- Review their work (git log, git diff), merge it into your branch (git merge <branch>), fix conflicts, and run the checks. You can build parts yourself too.
- Stay inside the project; ${COMMIT_RULES}; never switch branches.
- When everything is merged and working, reply with a short summary for ${OWNER} and end with a line that says only: TEAM DONE
${OWNER} may message you; answer briefly and take it into account.`;

const WORKER_PROMPT = (name: string, manager: string, inPlace: boolean) => `You are ${name}, a software engineer on ${manager}'s team in ${OWNER}'s office. ${inPlace ? 'You are working in the project folder, which teammates share, so only touch what your task needs.' : 'You are on your own branch in a git worktree, started from the team branch.'}
Rules: do only the task ${manager} gives you; stay inside the current folder; ${COMMIT_RULES}; don't merge and never switch branches.
When you finish a task, reply with a short summary for ${manager}: what you changed and how to check it.
${OWNER} or ${manager} may message you; answer briefly.`;

const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export class RealCrew implements Crew {
  readonly real = true;
  autoApprove = false;
  settings: Settings = DEFAULT_SETTINGS;
  /** The window is hidden: finish approved jobs, start nothing new. */
  private background = false;
  projects: ProjectInfo[] = [];
  private staff = new Map<string, Staff>();
  private teams = new Map<string, TeamState>();
  private line: string[] = [];

  constructor(private readonly bridge: AgentBridge, private readonly hooks: CrewHooks) {
    bridge.onMessage((id, msg) => this.onMessage(id, msg));
  }

  begin(agentId: string, name: string) {
    this.staff.set(agentId, {
      name, phase: 'research', since: Date.now(), engine: this.settings.defaultEngine, model: this.settings.defaultModel, workCwd: null, idea: null, seen: new Set(), alive: false, nudged: false, permissions: [], place: 0,
      pitched: false, orders: null, ordersPictures: [], team: null, role: null, assignment: null, desk: null,
      activity: 'idle', lastShown: 0, usage: { tokens: 0, cost: 0 }, sessionCost: 0,
    });
    this.research(agentId);
  }

  settled(agentId: string) {
    const s = this.staff.get(agentId);
    if (!s || s.phase !== 'queued' || this.line[0] !== agentId || !s.idea || s.pitched) return;
    s.pitched = true;
    this.hooks.pitch(agentId, s.idea);
    if (this.autoApprove) window.setTimeout(() => this.decide(agentId, { kind: 'approve' }), 1500);
  }

  resolve(agentId: string, approved: boolean) {
    const s = this.staff.get(agentId);
    const p = s?.permissions.shift();
    if (!s || !p) return;
    this.bridge.answer(agentId, p.requestId, approved, p.input, approved ? undefined : `${OWNER} said no. Find another way or ask.`);
    this.note(agentId, approved ? `${OWNER} approved: ${p.text}` : `${OWNER} denied: ${p.text}`);
    if (s.permissions.length) this.emitNow(agentId, 'awaiting', s.permissions[0].text);
    else this.show(agentId, 'thinking');
  }

  decide(agentId: string, d: Decision) {
    const s = this.staff.get(agentId);
    if (!s || this.line[0] !== agentId || !s.idea) return;
    this.leaveLine(agentId);
    const idea = s.idea;
    s.seen.add(idea.title);
    if (d.kind === 'approve') {
      this.note(agentId, `${OWNER} approved "${idea.title}"`);
      void this.startWork(agentId, idea);
    } else if (d.kind === 'reject') {
      this.note(agentId, `${OWNER} passed on "${idea.title}"`);
      this.backToResearch(agentId, `${OWNER} passed on that idea. Pitch a different one, maybe in another project.`);
    } else {
      this.note(agentId, `${OWNER}: not that. ${d.text}${pictureNote(d.pictures)}`);
      s.orders = d.text;
      s.ordersPictures = d.pictures ?? [];
      this.backToResearch(agentId, content(ORDERS_PROMPT(d.text, s.role === 'manager'), s.ordersPictures));
    }
  }

  say(agentId: string, text: string, pictures: Picture[] = []) {
    const s = this.staff.get(agentId);
    if (!s) return;
    // talking to someone mid-pitch means "not that, do this instead"
    if (s.pitched) return this.decide(agentId, { kind: 'instead', text, pictures });
    this.note(agentId, `${OWNER}: ${text}${pictureNote(pictures)}`);
    const message = content(text, pictures);
    if (s.phase === 'break') {
      // still chatting about the finished work: keep that session
      window.clearTimeout(s.breakTimer);
      this.setPhase(s, 'work');
    }
    if (s.alive) this.bridge.send(agentId, message);
    else if (s.role === 'worker' && !s.desk) {
      // workers take their tasks from the manager: pass it up
      const manager = this.teamOf(s)?.manager;
      this.note(agentId, `${s.name} takes tasks from ${this.nameOf(manager ?? '')}; passed it on`);
      if (manager) this.say(manager, `(for ${s.name}) ${text}`, pictures);
    } else if (s.role === 'worker' && s.desk) this.launch(agentId, { cwd: s.desk.cwd, system: this.workerSystem(s), prompt: message, mode: this.workMode(s.desk.mode) });
    else this.research(agentId, `${OWNER} says: ${text}`, pictures);
  }

  setModel(agentId: string, model: string) {
    const s = this.staff.get(agentId);
    if (!s) return;
    s.model = model;
    if (s.alive && model) this.bridge.setModel(agentId, model);
    this.note(agentId, `Model: ${model || 'Claude Code default'}${s.alive && !model ? ' (from the next task)' : ''}`);
  }

  modelOf(agentId: string) {
    return this.staff.get(agentId)?.model ?? '';
  }

  usageOf(agentId: string) {
    return this.staff.get(agentId)?.usage ?? null;
  }

  setEngine(agentId: string, engine: string) {
    const s = this.staff.get(agentId);
    if (!s || s.engine === engine) return;
    s.engine = engine;
    s.model = '';
    this.note(agentId, `Engine: ${engineIn(this.settings, engine).name}${s.alive ? ' (from the next task)' : ''}`);
  }

  statusOf(agentId: string): AgentStatus {
    const s = this.staff.get(agentId)!;
    const working = s.phase === 'work' || s.phase === 'break';
    return {
      phase: s.pitched ? 'pitching' : s.phase,
      since: s.since,
      project: s.idea?.project ?? null,
      branch: working ? s.desk?.branch ?? s.idea?.branch ?? null : null,
      engine: s.engine,
    };
  }

  workingCount() {
    return [...this.staff.values()].filter((s) => s.phase === 'work').length;
  }

  setBackground(on: boolean) {
    this.background = on;
    for (const [id, s] of this.staff) {
      if (on && s.phase !== 'work' && !(s.role === 'worker' && this.teamOf(s)?.job)) this.goHome(id);
      if (!on && s.phase === 'home') {
        this.note(id, 'Back at the office');
        this.research(id);
      }
    }
    this.checkAllDone();
  }

  /** Finished (or not needed) while the window is hidden: stop and go home. */
  private goHome(agentId: string) {
    const s = this.staff.get(agentId)!;
    if (s.phase === 'home') return;
    this.reset(agentId);
    this.setPhase(s, 'home');
    this.note(agentId, 'Went home');
    this.emitNow(agentId, 'idle', 'Gone home');
  }

  private checkAllDone() {
    if (this.background && !this.workingCount()) this.hooks.allDone();
  }

  private setPhase(s: Staff, phase: Phase) {
    if (s.phase === phase) return;
    s.phase = phase;
    s.since = Date.now();
  }

  /** Permission mode for approved work: auto mode, or the place's own (acceptEdits in a worktree, ask in place). */
  private workMode(placeMode: string) {
    return this.settings.approvals === 'auto' ? 'auto' : placeMode;
  }

  interrupt(agentId: string) {
    const s = this.staff.get(agentId);
    if (!s?.alive) return;
    this.bridge.interrupt(agentId);
    this.note(agentId, `${OWNER} told them to stop`);
  }

  // ---------------------------------------------------------------- teams

  createTeam(t: Omit<Team, 'id'>, pictures: Picture[] = []) {
    const team: TeamState = { ...t, id: teamId(), job: null };
    const members = [t.manager, ...t.workers];
    for (const id of members) {
      const s = this.staff.get(id);
      if (!s) return;
      if (s.team) this.removeFromTeam(id);
      this.reset(id);
    }
    this.teams.set(team.id, team);
    for (const id of members) {
      const s = this.staff.get(id)!;
      s.team = team.id;
      s.role = id === t.manager ? 'manager' : 'worker';
      this.note(id, `Joined ${team.name} as ${s.role === 'manager' ? 'the manager' : `a worker under ${this.nameOf(t.manager)}`}`);
    }
    for (const w of t.workers) this.standby(w);
    const m = this.staff.get(t.manager)!;
    if (t.task?.trim()) {
      m.orders = t.task.trim();
      m.ordersPictures = pictures;
      this.research(t.manager, ORDERS_PROMPT(m.orders, true), pictures);
    } else this.research(t.manager);
    this.pushTeams();
  }

  disbandTeam(teamId: string) {
    const team = this.teams.get(teamId);
    if (!team) return;
    this.teams.delete(teamId);
    [team.manager, ...team.workers].forEach((id, i) => {
      const s = this.staff.get(id);
      if (!s) return;
      this.reset(id);
      s.team = s.role = null;
      this.note(id, `${team.name} was disbanded; back to working solo`);
      window.setTimeout(() => this.research(id), i * 1500);
    });
    this.pushTeams();
  }

  private removeFromTeam(agentId: string) {
    const s = this.staff.get(agentId)!;
    const team = s.team && this.teams.get(s.team);
    if (!team) return;
    if (team.manager === agentId) this.disbandTeam(team.id);
    else team.workers = team.workers.filter((w) => w !== agentId);
    s.team = s.role = null;
  }

  /** Drop whatever they were doing: session, line, pending prompts, timers. */
  private reset(agentId: string) {
    const s = this.staff.get(agentId)!;
    this.bridge.stop(agentId);
    s.alive = false;
    window.clearTimeout(s.breakTimer);
    s.permissions = [];
    s.assignment = null;
    s.desk = null;
    s.workCwd = null;
    s.orders = null;
    s.ordersPictures = [];
    s.idea = null;
    if (this.line.includes(agentId)) this.leaveLine(agentId);
  }

  private pushTeams() {
    this.hooks.teams([...this.teams.values()].map(({ job: _job, ...t }) => t));
  }

  private teamOf(s: Staff) {
    return s.team ? this.teams.get(s.team) ?? null : null;
  }

  private nameOf(id: string) {
    return this.staff.get(id)?.name ?? id;
  }

  // ---------------------------------------------------------------- phases

  private research(agentId: string, prompt?: string, pictures: Picture[] = []) {
    const s = this.staff.get(agentId)!;
    if (s.role === 'worker') return this.standby(agentId);
    if (this.background) return this.goHome(agentId);
    this.setPhase(s, 'research');
    s.idea = null;
    s.nudged = false;
    s.pitched = false;
    s.permissions = [];
    const team = this.teamOf(s);
    const system = team ? MANAGER_RESEARCH_PROMPT(s.name, team.workers.map((w) => this.nameOf(w))) : RESEARCH_PROMPT(s.name);
    const avoid = s.seen.size ? ` Don't re-pitch these: ${[...s.seen].join('; ')}.` : '';
    this.launch(agentId, { model: s.model || undefined, system, prompt: content((prompt ?? 'Have a look around and pitch one idea.') + avoid, pictures), mode: 'default' });
    this.note(agentId, s.orders ? 'Working out what that means' : 'Looking through the projects for something to improve');
    this.emitNow(agentId, 'thinking');
  }

  private backToResearch(agentId: string, message: Content) {
    const s = this.staff.get(agentId)!;
    this.setPhase(s, 'research');
    s.idea = null;
    s.nudged = false;
    s.pitched = false;
    this.emitNow(agentId, 'thinking');
    if (s.alive) this.bridge.send(agentId, message);
    else if (typeof message === 'string') this.research(agentId, message);
    else this.research(agentId, ORDERS_PROMPT(s.orders ?? '', s.role === 'manager'), s.ordersPictures);
  }

  private standby(agentId: string) {
    const s = this.staff.get(agentId)!;
    this.setPhase(s, 'standby');
    s.assignment = null;
    this.emitNow(agentId, 'standby', `Waiting for ${this.nameOf(this.teamOf(s)?.manager ?? '')}`);
  }

  private startWork(agentId: string, idea: Idea) {
    const s = this.staff.get(agentId)!;
    const team = this.teamOf(s);
    return team && s.role === 'manager' ? this.teamWork(team, idea) : this.soloWork(agentId, idea);
  }

  private async soloWork(agentId: string, idea: Idea) {
    const s = this.staff.get(agentId)!;
    this.setPhase(s, 'work');
    s.idea = idea;
    s.permissions = [];
    this.emitNow(agentId, 'running', `Setting up ${idea.path ? `branch ${idea.branch}` : `new project ${idea.project}`}`);
    try {
      const place = await this.bridge.prepareWork({ project: idea.project, projectPath: idea.path, branch: idea.branch, isNew: !idea.path });
      idea.branch = place.branch ?? idea.branch;
      this.note(agentId, place.note);
      s.workCwd = place.cwd;
      this.launch(agentId, { cwd: place.cwd, model: s.model || undefined, system: WORK_PROMPT(s.name, !idea.path), prompt: content(jobBrief(idea), idea.pictures), mode: this.workMode(place.mode) });
    } catch (e) {
      this.note(agentId, `Couldn't set up the work: ${(e as Error).message}`);
      this.research(agentId);
    }
  }

  private async teamWork(team: TeamState, idea: Idea) {
    const s = this.staff.get(team.manager)!;
    this.setPhase(s, 'work');
    s.idea = idea;
    s.permissions = [];
    idea.team = team.name;
    const branch = `team/${slug(team.name)}-${slug(idea.title)}`;
    this.emitNow(team.manager, 'running', `Setting up the team's ${idea.path ? `branch ${branch}` : `new project ${idea.project}`}`);
    try {
      // a new project's lead works in the folder itself; workers branch off it
      const place = await this.bridge.prepareWork({ project: idea.project, projectPath: idea.path, branch, isNew: !idea.path, inPlace: !idea.path });
      idea.branch = place.branch ?? 'the main branch';
      team.job = { idea, path: place.path, branch: place.branch ?? null, inPlace: place.mode === 'default' };
      this.note(team.manager, place.note);
      for (const w of team.workers) this.note(w, `${team.name} is starting on "${idea.title}" (${idea.project})`);
      const workers = team.workers.map((w) => this.nameOf(w));
      s.workCwd = place.cwd;
      this.launch(team.manager, { cwd: place.cwd, model: s.model || undefined, system: MANAGER_WORK_PROMPT(s.name, workers, team.job.branch), prompt: content(jobBrief(idea), idea.pictures), mode: this.workMode(place.mode) });
    } catch (e) {
      this.note(team.manager, `Couldn't set up the team's work: ${(e as Error).message}`);
      this.research(team.manager);
    }
  }

  /** The manager handed a worker a task. */
  private async assign(team: TeamState, workerId: string, task: string) {
    const w = this.staff.get(workerId)!;
    const job = team.job;
    if (!job) return;
    this.note(workerId, `Task from ${this.nameOf(team.manager)}: ${task}`);
    this.note(team.manager, `Assigned ${w.name}: ${short(task)}`);
    const busy = w.assignment !== null;
    w.assignment = busy ? `${w.assignment}; ${task}` : task;
    this.setPhase(w, 'work');
    w.idea = job.idea;
    if (busy && w.alive) return this.bridge.send(workerId, `Another task from ${this.nameOf(team.manager)}: ${task}`);
    this.emitNow(workerId, 'thinking');
    try {
      if (!w.desk) {
        const branch = `${job.branch ?? `team/${slug(team.name)}`}--${slug(w.name)}`;
        w.desk = await this.bridge.prepareWork({ project: job.idea.project, projectPath: job.path, branch, isNew: false, base: job.branch ?? undefined, inPlace: job.inPlace });
        w.workCwd = w.desk.cwd;
        this.note(workerId, w.desk.note);
      }
      const prompt = `Task from ${this.nameOf(team.manager)}: ${task}\n\nThe team's job, for context:\n${jobBrief(job.idea)}`;
      if (w.alive) this.bridge.send(workerId, prompt);
      else this.launch(workerId, { cwd: w.desk.cwd, model: w.model || undefined, system: this.workerSystem(w), prompt, mode: this.workMode(w.desk.mode) });
    } catch (e) {
      this.note(workerId, `Couldn't set up: ${(e as Error).message}`);
      this.bridge.send(team.manager, `${w.name} couldn't start their task: ${(e as Error).message}`);
      this.standby(workerId);
    }
  }

  private workerSystem(w: Staff) {
    const team = this.teamOf(w);
    return WORKER_PROMPT(w.name, this.nameOf(team?.manager ?? ''), !!team?.job?.inPlace);
  }

  /** The manager says the team's job is merged and done. */
  private teamDone(team: TeamState, summary: string) {
    for (const w of team.workers) {
      const s = this.staff.get(w)!;
      this.bridge.stop(w);
      s.alive = false;
      s.desk = null;
      this.note(w, `${team.name} finished "${team.job?.idea.title}"`);
      if (this.background) this.goHome(w);
      else this.standby(w);
    }
    team.job = null;
    this.finishWork(team.manager, summary.replace(TEAM_DONE, '').trim());
  }

  private launch(agentId: string, cfg: StartConfig) {
    const s = this.staff.get(agentId)!;
    s.alive = true;
    s.sessionCost = 0;
    this.bridge.start(agentId, { ...cfg, engine: s.engine, model: cfg.model ?? (s.model || undefined) }).catch((e: Error) => {
      s.alive = false;
      this.note(agentId, `Couldn't start Claude Code: ${e.message}`);
    });
  }

  private finishWork(agentId: string, summary: string) {
    const s = this.staff.get(agentId)!;
    this.setPhase(s, 'break');
    const idea = s.idea;
    this.emitNow(agentId, 'done', idea?.path ? `${idea.branch} is ready for review` : `${idea?.project} is ready`);
    if (summary) this.note(agentId, `Summary: ${short(summary, 600)}`);
    if (this.background) {
      // nobody to pitch to: call it a day
      this.goHome(agentId);
      return this.checkAllDone();
    }
    s.breakTimer = window.setTimeout(() => {
      this.emitNow(agentId, 'idle', 'Coffee break');
      s.breakTimer = window.setTimeout(() => s.phase === 'break' && this.research(agentId), 15000);
    }, 4000);
  }

  // ---------------------------------------------------------------- events from Claude Code

  private onMessage(agentId: string, msg: Msg) {
    const s = this.staff.get(agentId);
    if (!s) return;
    const busy = s.phase === 'research' || s.phase === 'work';
    switch (msg.kind) {
      case 'init':
        s.alive = true;
        break;
      case 'assistant':
        for (const part of msg.parts) {
          if (part.type === 'text') {
            const shown = part.text.replace(PITCH, '').replace(ASSIGN, '').trim();
            if (shown) this.note(agentId, `${s.name}: ${shown}`);
            const idea = this.parsePitch(s, part.text);
            if (idea && (s.phase === 'research' || s.phase === 'queued')) {
              s.idea = idea;
              this.note(agentId, `${s.orders ? 'Got it' : 'Pitch ready'}: "${idea.title}" (${idea.project})`);
            }
            const team = this.teamOf(s);
            if (team && s.role === 'manager' && s.phase === 'work') this.parseAssignments(team, part.text);
            if (busy) this.show(agentId, 'thinking');
          } else {
            const [activity, text] = describe(part.name, part.input, this.root());
            this.note(agentId, text);
            if (busy) this.show(agentId, activity);
          }
        }
        break;
      case 'permission': {
        const text = permissionText(msg.tool, msg.input, this.root());
        if ((s.phase === 'research' || s.phase === 'queued') && readOnlyCommand(msg.tool, msg.input)) {
          this.bridge.answer(agentId, msg.requestId, true, msg.input);
        } else if (s.phase === 'research' || s.phase === 'queued') {
          this.bridge.answer(agentId, msg.requestId, false, msg.input, `You're only researching right now. Don't change anything; pitch the idea to ${OWNER} first.`);
          this.note(agentId, `(tried to ${text} while researching; told no)`);
        } else if (this.autoApprove) {
          this.bridge.answer(agentId, msg.requestId, true, msg.input);
          this.note(agentId, `Auto-approved: ${text}`);
        } else if (this.background) {
          // nobody to ask: fine inside their own branch folder, not anywhere else
          const isolated = !!s.workCwd?.replace(/\\/g, '/').includes('/.letting-go/worktrees/');
          this.bridge.answer(agentId, msg.requestId, isolated, msg.input, isolated ? undefined : `${OWNER} is away. Skip anything that needs approval and mention it in your summary.`);
          this.note(agentId, `${isolated ? 'Allowed (own branch, while away)' : 'Skipped (needs approval, Ahmad is away)'}: ${text}`);
        } else {
          s.permissions.push({ requestId: msg.requestId, input: msg.input, text });
          if (s.permissions.length === 1) this.emitNow(agentId, 'awaiting', text);
        }
        break;
      }
      case 'limits':
        this.hooks.limits({ status: msg.status, windows: msg.windows, at: Date.now() });
        break;
      case 'result':
        s.usage.tokens += msg.tokens;
        s.usage.cost += Math.max(0, msg.cost - s.sessionCost);
        s.sessionCost = msg.cost;
        this.onTurnEnd(agentId, s, msg);
        break;
      case 'exit':
        s.alive = false;
        if (msg.error) this.note(agentId, `Claude Code stopped: ${msg.error}`);
        if (s.phase === 'research' || s.phase === 'work') {
          this.setPhase(s, 'stopped');
          this.emitNow(agentId, 'idle', 'Not running. Message them to start again.');
          this.checkAllDone();
        }
        break;
    }
  }

  private onTurnEnd(agentId: string, s: Staff, msg: Extract<Msg, { kind: 'result' }>) {
    const team = this.teamOf(s);
    if (s.phase === 'research') {
      if (s.idea && s.orders) {
        // the owner's own request: no pitching, straight to work
        s.idea.orders = s.orders;
        s.idea.pictures = s.ordersPictures;
        s.orders = null;
        s.ordersPictures = [];
        void this.startWork(agentId, s.idea);
      } else if (s.idea) {
        this.setPhase(s, 'queued');
        s.place = 0;
        this.line.push(agentId);
        this.note(agentId, `Has an idea for ${s.idea.project}, waiting to see ${OWNER}`);
        this.refreshLine();
      } else if (msg.ok && !s.nudged) {
        s.nudged = true;
        this.bridge.send(agentId, 'Please wrap up now and end with the ```pitch block.');
      } else if (msg.ok) {
        this.note(agentId, "Couldn't come up with a pitch; taking a break");
        this.emitNow(agentId, 'idle');
      } else this.emitNow(agentId, 'idle', 'Stopped');
      return;
    }
    if (s.phase !== 'work') return;
    if (!msg.ok) return this.emitNow(agentId, 'idle', 'Stopped. Message them to continue.');
    if (team && s.role === 'worker') {
      // report back to the manager and wait for the next piece
      const done = s.assignment ?? 'their task';
      this.bridge.send(team.manager, `${s.name} finished "${short(done, 200)}" on branch ${s.desk?.branch ?? 'the shared folder'}:\n${msg.text}`);
      this.note(team.manager, `${s.name} reported back`);
      this.note(agentId, `Reported to ${this.nameOf(team.manager)}`);
      this.standby(agentId);
    } else if (team && s.role === 'manager') {
      if (TEAM_DONE.test(msg.text)) this.teamDone(team, msg.text);
      else this.show(agentId, team.workers.some((w) => this.staff.get(w)?.assignment) ? 'standby' : 'thinking');
    } else this.finishWork(agentId, msg.text);
  }

  private parsePitch(s: Staff, text: string): Idea | null {
    const m = PITCH.exec(text);
    if (!m) return null;
    try {
      const raw = JSON.parse(m[1]) as { project?: string; title?: string; summary?: string; steps?: string[] };
      if (!raw.project || !raw.title) return null;
      const known = this.projects.find((p) => p.name === raw.project);
      const team = this.teamOf(s);
      return {
        project: raw.project,
        path: known?.path ?? null,
        title: raw.title,
        summary: raw.summary ?? '',
        steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
        branch: branchFor(s.name, raw.title),
        team: team?.name,
      };
    } catch {
      return null;
    }
  }

  private parseAssignments(team: TeamState, text: string) {
    for (const m of text.matchAll(ASSIGN)) {
      try {
        const raw = JSON.parse(m[1]) as { worker?: string; task?: string };
        const worker = team.workers.find((w) => this.nameOf(w).toLowerCase() === String(raw.worker ?? '').trim().toLowerCase());
        if (worker && raw.task) void this.assign(team, worker, raw.task);
        else this.bridge.send(team.manager, `Couldn't hand that out: "${raw.worker}" isn't on your team (${team.workers.map((w) => this.nameOf(w)).join(', ')}).`);
      } catch {
        this.bridge.send(team.manager, 'One of your assign blocks was not valid JSON. Please write it again.');
      }
    }
  }

  private root() {
    const p = this.projects[0]?.path;
    return p ? p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))) : '';
  }

  // ---------------------------------------------------------------- the office

  private leaveLine(agentId: string) {
    const s = this.staff.get(agentId)!;
    const wasFirst = this.line[0] === agentId;
    this.line = this.line.filter((id) => id !== agentId);
    if (wasFirst && s.pitched) this.hooks.pitch(null, null);
    s.pitched = false;
    s.place = 0;
    this.refreshLine();
  }

  /** Move everyone in line up a place; the one at the front walks into the office. */
  private refreshLine() {
    this.line.forEach((id, idx) => {
      const s = this.staff.get(id)!;
      if (s.place === idx + 1) return;
      s.place = idx + 1;
      if (idx === 0) this.emitNow(id, 'pitching', `Pitching "${s.idea?.title}"`);
      else this.hooks.emit({ agentId: id, activity: 'queued', queue: idx, task: s.idea?.title });
    });
    this.hooks.queue([...this.line]);
  }

  /** Walk somewhere for this activity, but not more often than DWELL_MS. */
  private show(agentId: string, activity: AgentActivity) {
    const s = this.staff.get(agentId)!;
    if (s.permissions.length) return; // stays put with a hand up until answered
    s.activity = activity;
    const wait = s.lastShown + DWELL_MS - Date.now();
    if (wait <= 0) return this.emitNow(agentId, activity);
    if (s.showTimer === undefined)
      s.showTimer = window.setTimeout(() => {
        s.showTimer = undefined;
        if ((s.phase === 'research' || s.phase === 'work') && !s.permissions.length) this.emitNow(agentId, s.activity);
      }, wait);
  }

  private emitNow(agentId: string, activity: AgentActivity, detail?: string) {
    const s = this.staff.get(agentId)!;
    window.clearTimeout(s.showTimer);
    s.showTimer = undefined;
    s.activity = activity;
    s.lastShown = Date.now();
    this.hooks.emit({ agentId, activity, detail, task: s.idea?.title });
  }

  private note(agentId: string, text: string) {
    this.hooks.note(agentId, text);
  }
}

/** Text plus any pasted pictures, in the shape Claude Code takes as a user message. */
function content(text: string, pictures: Picture[] = []): Content {
  if (!pictures.length) return text;
  return [
    ...pictures.map((p) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: p.mediaType, data: p.data } })),
    { type: 'text' as const, text },
  ];
}

const pictureNote = (pictures?: Picture[]) => (pictures?.length ? ` [${pictures.length} picture${pictures.length > 1 ? 's' : ''}]` : '');

/** What the agent is told when the work starts. */
function jobBrief(idea: Idea) {
  const plan = idea.steps.length ? `\n\nPlan:\n${idea.steps.map((t) => `- ${t}`).join('\n')}` : '';
  const orders = idea.orders ? `\n\n${OWNER}'s own words: "${idea.orders}"` : '';
  return `Job: ${idea.title} (${idea.project})\n${idea.summary}${plan}${orders}`;
}

function rel(p: unknown, root: string) {
  const s = String(p ?? '');
  return root && (s.startsWith(root + '/') || s.startsWith(root + '\\')) ? s.slice(root.length + 1).replace(/^\.letting-go[\\/]worktrees[\\/]/, '') : s;
}

/**
 * A shell command that only looks around (ls, cat, git log...). Claude Code
 * already allows these itself on most systems, but asks on some (Windows).
 */
function readOnlyCommand(tool: string, input: Record<string, unknown>) {
  if (tool !== 'Bash') return false;
  const cmd = String(input.command ?? '').replace(/\d?>\s*\/dev\/null/g, '');
  if (/[>`]|\$\(|-exec|-delete|-fprint|--output/.test(cmd)) return false;
  const LOOK = /^(ls|cat|head|tail|wc|pwd|cd|echo|find|tree|file|stat|du|grep|rg|uniq|for|do|done|git (log|status|show|diff|ls-files|rev-parse|remote -v))(\s|$)/;
  return cmd.split(/&&|\|\||[;|\n]/).every((part) => !part.trim() || LOOK.test(part.trim()));
}

/** Where a tool call sends the character, and a log line for it. */
function describe(tool: string, input: Record<string, unknown>, root: string): [AgentActivity, string] {
  switch (tool) {
    case 'Read': return ['reading', `Read ${rel(input.file_path, root)}`];
    case 'Glob': return ['reading', `Look for ${input.pattern}`];
    case 'Grep': return ['reading', `Search for "${short(String(input.pattern ?? ''), 60)}"`];
    case 'Edit': return ['writing', `Edit ${rel(input.file_path, root)}`];
    case 'Write': return ['writing', `Write ${rel(input.file_path, root)}`];
    case 'Bash': return ['running', `$ ${short(String(input.command ?? ''))}`];
    case 'WebSearch': return ['reading', `Search the web: ${input.query}`];
    case 'WebFetch': return ['reading', `Fetch ${input.url}`];
    default: return ['thinking', tool];
  }
}

function permissionText(tool: string, input: Record<string, unknown>, root: string) {
  if (tool === 'Bash') return `run: ${short(String(input.command ?? ''), 160)}`;
  if (tool === 'Edit' || tool === 'Write') return `${tool.toLowerCase()} ${rel(input.file_path, root)}`;
  return `use ${tool}`;
}
