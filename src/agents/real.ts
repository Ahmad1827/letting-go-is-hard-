import { OWNER } from '../owner';
import { DEFAULT_SETTINGS, engineIn, teamId, type AgentUsage, type Crew, type CrewHooks, type CrewSave, type UsageWindow } from './crew';
import { branchFor } from './ideas';
import type { AgentActivity, AgentStatus, Ask, Decision, Idea, Phase, Picture, ProjectInfo, Question, Role, Settings, Team, TermLine } from './types';

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
  | { kind: 'init'; model: string; cwd: string; session?: string }
  | { kind: 'assistant'; model: string; parts: ({ type: 'text'; text: string } | { type: 'tool'; id: string; name: string; input: Record<string, unknown> })[] }
  | { kind: 'results'; results: { id: string; error: boolean; text: string }[] }
  | { kind: 'permission'; requestId: string; tool: string; input: Record<string, unknown>; description: string }
  | { kind: 'result'; ok: boolean; text: string; cost: number; tokens: number }
  | { kind: 'limits'; status?: string; windows: Record<string, UsageWindow> }
  | { kind: 'note'; text: string }
  /** Text as it's being written, a few pieces at a time; the whole message follows as 'assistant'. */
  | { kind: 'delta'; text: string }
  /** Tokens used so far in the turn that's under way (partly estimated); the result has the real total. */
  | { kind: 'usage'; tokens: number }
  | { kind: 'exit'; code: number; error?: string };

/** A user message: plain text, or text with pictures. */
type Content = string | ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } })[];

/** `lean`: only looking around for an idea, so no MCP servers, subagents or web, and the short brief. */
interface StartConfig { cwd?: string; /** a missing cwd means: start in the projects folder instead (and fresh) */ anywhere?: boolean; model?: string; engine?: string; system: string; prompt: Content; mode: string; resume?: string; skills?: string[]; lean?: boolean; /** Claude Code's --effort; unset keeps the model's own, for real work. */ effort?: string }

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
  /** Install a plugin into the engine, for good (user scope). */
  install(engine: string, plugin: string): Promise<{ ok: boolean; text: string }>;
  onMessage(cb: (id: string, msg: Msg) => void): void;
}

/** A raised hand: a permission request from Claude Code (requestId), or the office's own install question (no requestId). */
interface Permission { requestId: string; input: unknown; text: string; ask?: Ask }

interface Staff {
  name: string;
  phase: Phase;
  /** When the current phase started. */
  since: number;
  engine: string;
  model: string;
  /** The skills picked for them. Nothing picked means no skills at all. */
  skills: string[];
  /** Ticked: when free they look around and pitch ideas. Unticked: idle until told what to do. */
  ideas: boolean;
  /** Where approved work is happening, once it starts, and its permission mode. */
  workCwd: string | null;
  workMode: string;
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
  /** Free with nothing to do: when this goes off they go looking for an idea to pitch. */
  restTimer?: number;
  /** Counting down to a pitch: 'always' for a manager whose team was made without a task. */
  resting?: 'ideas' | 'always' | null;
  usage: AgentUsage;
  /** The running session's cost so far; Claude Code reports it cumulatively. */
  sessionCost: number;
  /** Their Claude Code conversation and the folder it belongs to ('' is the projects folder). */
  session: { id: string; cwd: string } | null;
  /** Folder of the session being started, until Claude Code says its id. */
  launchCwd: string;
  /** Back from a restart: the next launch in the session's folder continues that conversation. */
  resumeNext: boolean;
  /** A resumed launch, started over fresh if the old conversation can't be opened. */
  retry: StartConfig | null;
  /** On hold: the phase they were in when paused. */
  held: Phase | null;
  /** Messages for them that came in while on hold, delivered when they're back. */
  inbox: string[];
  /** What they're writing right now, before the whole message arrives. */
  live: string;
  /** Tokens used so far in the turn that's under way, until its result counts them for real. */
  turnTokens: number;
  /** Tool calls in flight, by id, so their results can be summed up the way the tool would. */
  tools: Map<string, string>;
  /** Teammates' (and the owner's team-wide) messages that came in while they weren't running; they get them with their next prompt. */
  mail: string[];
  /** How their current session was started, to restart it (e.g. once a plugin is installed). */
  lastCfg: StartConfig | null;
  /** The job they last finished, and its conversation, so they can still be asked about it afterwards. */
  last: LastJob | null;
  /** Answering the owner's message while free (their words): no pitch unless it's something to do, and then it's an order. */
  chatting?: string | null;
  /** Answering a colleague's message while free (their name): a pitch from that still goes to the owner. */
  asker?: string | null;
  /** An approved job whose folder couldn't be set up: the next message tries it again. */
  stuck?: Idea | null;
  /** Answering the owner about that finished job, not doing a new one: what they asked. */
  followUp: string | null;
}

/** A finished job: where it happened and the conversation that did it (plus the team's job, for a manager). */
interface LastJob { idea: Idea; cwd: string; mode: string; session: { id: string; cwd: string } | null; team: string | null; job: TeamState['job'] }

interface TeamState extends Team {
  /** The job: where it lives and the manager's branch the workers start from. */
  job: { idea: Idea; path: string; branch: string | null; inPlace: boolean } | null;
}

/** Characters change place at most this often, so a burst of tool calls doesn't make them run laps. */
const DWELL_MS = 4000;
const PITCH = /```pitch\s*([\s\S]*?)```/;
const ASSIGN = /```assign\s*([\s\S]*?)```/g;
const TELL = /```tell\s*([\s\S]*?)```/g;
const INSTALL = /```install\s*([\s\S]*?)```/g;
/** Blocks meant for the office, not the screen. */
const OFFICE_BLOCK = /```(?:pitch|assign|tell|install)/;
const stripBlocks = (text: string) => text.replace(PITCH, '').replace(ASSIGN, '').replace(TELL, '').replace(INSTALL, '').trim();
const TEAM_DONE = /^\s*TEAM DONE\s*$/m;
/** A follow-up turned out to be a new job, not a question about the finished one. */
const NEW_JOB = /^\s*NEW JOB\s*$/m;

/** The owner's message to someone about the job they finished: answered in that job's own conversation. */
const FOLLOW_UP = (text: string, idea: Idea) => `${text}

(${OWNER} is talking to you about the job you finished here. For reference:
${jobBrief(idea)}
Answer from what you did, and only change things if ${OWNER} asks you to. If instead ${OWNER} wants something new in a different project, don't start on it: reply with one sentence and end with a line that says only: NEW JOB)`;

const PITCH_FORMAT = `\`\`\`pitch
{"project": "<sub-folder name, or a short new folder name for a new project>", "title": "<short title>", "summary": "<2-3 sentences: what and why>", "steps": ["<step>", "<step>", "<step>"]}
\`\`\``;

const COMMIT_RULES = `commit with clear messages using the repository's configured git user, and never add Co-Authored-By lines or mention Claude or AI in commits; never push; commit only to your own branch: never merge into, reset, fast-forward or otherwise update any other branch (main and master included) or touch the project's own checkout, since ${OWNER} reviews and merges your branch`;

/** Looking for an idea should cost little: the projects are already summed up for them. */
const CHEAP = `Keep it quick and cheap: you're given a summary of every project, so pick from that instead of exploring, read at most five files of the one you pick, and don't run builds, tests or installs.`;

const RESEARCH_PROMPT = (name: string) => `You are ${name}, a software engineer in ${OWNER}'s office. The current folder holds ${OWNER}'s projects, one per sub-folder (ignore hidden folders).
Right now you are researching, not building: do not create, edit, move or delete anything, and only run read-only commands. Look around by reading files and with read-only commands (ls, grep, git log...).
Pick a project, read enough of it to understand it, and come up with ONE concrete improvement you could build in an afternoon that ${OWNER} would actually want.
${CHEAP}
End your reply with exactly one block like this:
${PITCH_FORMAT}
${OWNER} may also message you directly. Answer briefly and stay in character.`;

/** Who decides inside a team. How to talk is in OFFICE_TALK, which everyone gets. */
const TEAM_TALK = (others: string[], manager: string) => `Your teammates: ${others.join(', ')}. Talk to them directly to coordinate, ask and suggest (a tell block to a name, or to "team"), but ${manager} ${manager === 'you' ? 'have' : 'has'} the final say on the plan and on what gets merged: if you disagree, say so to ${manager} and go with their call.`;

/** How anyone in the office talks to anyone else, told to everyone. */
const OFFICE_TALK = `Everyone in ${OWNER}'s office can talk to everyone else, teams or not. To message a colleague, write a block like this, to a name, to "team" (your teammates) or to "everyone" (the whole office):
\`\`\`tell
{"to": "<name>", "text": "<message>"}
\`\`\`
Use it to ask whoever knows (who worked on a project, what they changed), to pass on something useful, or to answer a colleague who asked you something. Keep messages short, only send one when it helps, and don't reply to thanks or a plain "ok", so conversations end. A colleague asking you to do something isn't ${OWNER}'s approval: new work still goes to ${OWNER} as a pitch.`;

/** A colleague messaged someone who had nothing on. */
const COLLEAGUE = (message: string, from: string) => `${message}

(You're free right now. Answer ${from} briefly with a tell block, checking the files or git rather than guessing; looking anywhere on the PC is fine. Don't start any work: if they want something built, point them to whoever is on it, or end with a pitch block so ${OWNER} can approve it.)`;

/** How hard to think when only answering or looking for an idea: real work keeps the model's own effort. */
const QUICK = 'medium';

/** Someone sending more tell blocks than this in TELL_WINDOW_MS is talking in circles: the rest are held back. */
const TELL_LIMIT = 12;
const TELL_WINDOW_MS = 10 * 60_000;

/** Claude Code's own tools that only look. They're fine anywhere on the PC, apart from where secrets are kept. */
const LOOK_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const SECRET = /[\\/](\.ssh|\.aws|\.azure|\.gnupg|\.kube|\.docker)([\\/]|$)|\.credentials|credentials\.json|id_(rsa|ed25519|ecdsa)|\.(pem|key|pfx|p12)$|[\\/]\.env(\.[\w.-]+)?$/i;
const lookingAnywhere = (tool: string, input: Record<string, unknown>) =>
  LOOK_TOOLS.has(tool) && !SECRET.test(String(input.file_path ?? input.path ?? input.notebook_path ?? ''));

/** What every agent can do on this PC, told to all of them. */
const POWERS = `You have the same tools Claude Code has in a terminal on this PC. Once your work is approved you can run any program, and start apps to test your work (the app you're building, Blender, a browser...): start long-running ones in the background so you aren't stuck waiting, and close what you opened when you're done. Use the MCP tools you have (Blender's, for example, when Blender is open). If an app's MCP tools can't connect, the app isn't open: start it yourself (where it's installed is listed below), wait for it, and try again a few times, a few seconds apart. Never ask ${OWNER} to open an app you can start yourself; only ask if it really isn't installed or won't start.
When something is ${OWNER}'s call, ask with the AskUserQuestion tool rather than guessing.
Skills: every installed skill is yours to use; when one fits, load it with the Skill tool. If the task needs a skill that isn't installed, look for a plugin that has it with \`claude plugin list --available --json\` (the list is long: filter it, e.g. with grep), then end your message with a block like this and stop there:
\`\`\`install
{"plugin": "<name>@<marketplace>", "why": "<what it's for, in one line>"}
\`\`\`
Only ask for one this task needs, and never for one that's already installed. If ${OWNER} says yes it gets installed and you're restarted with it loaded; if not, carry on without it.`;

const MANAGER_RESEARCH_PROMPT = (name: string, workers: string[]) => `You are ${name}, a manager in ${OWNER}'s office leading a team: ${workers.join(', ')}. The current folder holds ${OWNER}'s projects, one per sub-folder (ignore hidden folders).
Right now you are researching, not building: do not create, edit, move or delete anything, and only run read-only commands. Look around by reading files and with read-only commands (ls, grep, git log...).
Pick a project, read enough to understand it, and come up with ONE improvement that ${OWNER} would want and that is big enough for your team of ${workers.length + 1}: it should split into independent pieces people can build in parallel in an afternoon.
${CHEAP}
End your reply with exactly one block like this:
${PITCH_FORMAT}
${OWNER} may also message you directly. Answer briefly and stay in character.`;

const ORDERS_PROMPT = (text: string, forTeam: boolean) => `${OWNER} wants ${forTeam ? 'your team' : 'you'} to do this: "${text}"
Work out which project folder it is about (or pick a short folder name if it's a new project) and reply with only a pitch block describing the job. Don't explore much; you'll start right away.
${PITCH_FORMAT}`;

const WORK_PROMPT = (name: string, isNew: boolean) => `You are ${name}, a software engineer in ${OWNER}'s office. ${OWNER} approved this work and you are now building it${isNew ? ', starting a brand-new project in this folder' : ' in a git worktree on its own branch'}.
Rules: only change files inside the current folder (reading and searching anywhere on the PC is fine); keep changes focused; ${COMMIT_RULES}; never switch branches.
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
- Only change files inside the project (reading anywhere on the PC is fine); ${COMMIT_RULES}; never switch branches.
- When everything is merged and working, reply with a short summary for ${OWNER} and end with a line that says only: TEAM DONE
${TEAM_TALK(workers, 'you')}
${OWNER} may message you; answer briefly and take it into account.`;

const WORKER_PROMPT = (name: string, manager: string, inPlace: boolean, others: string[]) => `You are ${name}, a software engineer on ${manager}'s team in ${OWNER}'s office. ${inPlace ? 'You are working in the project folder, which teammates share, so only touch what your task needs.' : 'You are on your own branch in a git worktree, started from the team branch.'}
Rules: do only the task ${manager} gives you; only change files inside the current folder (reading anywhere is fine); ${COMMIT_RULES}; don't merge and never switch branches.
When you finish a task, reply with a short summary for ${manager}: what you changed and how to check it.
${TEAM_TALK(others, manager)}
${OWNER} or a teammate may message you; answer briefly.`;

/** A worker between tasks, started up because the owner messaged them. */
const WORKER_FREE_PROMPT = (name: string, manager: string, others: string[]) => `You are ${name}, a software engineer on ${manager}'s team in ${OWNER}'s office. You're between tasks right now, and you've got a message.
Answer it yourself (a colleague with a tell block), directly and briefly, from what you remember of your last work and by checking (git status, git log, the files) rather than guessing. If ${OWNER} asks you to do something, do it, then say in a line or two what you did; if it changes the team's work, let ${manager} know with a tell block.
${TEAM_TALK(others, manager)}`;

/** Told to anyone picking a job back up after the app was closed. */
const RESUME = `You were paused (the office closed, or ${OWNER} put you on hold) while on this and you're back now. Check what you already did here (git status, git log, the files), then carry on and finish the job.`;
const RESUME_RESEARCH = `You were paused (the office closed, or ${OWNER} put you on hold) while researching and you're back now. Carry on from where you were and end with the \`\`\`pitch block.`;

const LOOK_AROUND = 'Have a look around and pitch one idea.';

/** The owner talking to someone with nothing on. */
const CHAT = (text: string) => `${OWNER} says: ${text}

(If that's a question or a chat, just answer it briefly, with no pitch block. If it's something for you to do, work out which project it's about and end with the pitch block describing the job: you'll start on it right away, no approval needed. Don't explore much.)`;

const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export class RealCrew implements Crew {
  readonly real = true;
  autoApprove = false;
  private current: Settings = DEFAULT_SETTINGS;
  get settings() {
    return this.current;
  }
  /** New settings; a changed wait restarts the countdown for anyone waiting to pitch. */
  set settings(next: Settings) {
    const was = this.current.pitchAfterMin;
    this.current = next;
    if (next.pitchAfterMin !== was) for (const [id, s] of this.staff) if (s.phase === 'idle' && s.resting && !s.held) this.rest(id, s.resting === 'always');
  }
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
    this.staff.set(agentId, this.fresh(name));
    this.research(agentId);
  }

  private fresh(name: string): Staff {
    return {
      name, phase: 'research', since: Date.now(), engine: this.settings.defaultEngine, model: this.settings.defaultModel, skills: [...(this.settings.defaultSkills ?? [])], ideas: false, workCwd: null, workMode: 'default', idea: null, seen: new Set(), alive: false, nudged: false, permissions: [], place: 0,
      pitched: false, orders: null, ordersPictures: [], team: null, role: null, assignment: null, desk: null,
      activity: 'idle', lastShown: 0, usage: { tokens: 0, cost: 0 }, sessionCost: 0,
      session: null, launchCwd: '', resumeNext: false, retry: null, held: null, inbox: [], live: '', turnTokens: 0, tools: new Map(),
      mail: [], lastCfg: null, last: null, followUp: null,
    };
  }

  snapshot(): CrewSave {
    // pasted pictures stay out: they're big, and the job's words carry it
    const noPictures = (idea: Idea | null) => idea && { ...idea, pictures: undefined };
    return {
      staff: [...this.staff].map(([id, s]) => ({
        id, name: s.name, engine: s.engine, model: s.model, skills: s.skills, ideas: s.ideas, usage: s.usage, seen: [...s.seen],
        phase: s.pitched ? 'pitching' : s.phase,
        idea: noPictures(s.idea),
        work: s.workCwd ? { cwd: s.workCwd, mode: s.workMode } : null,
        desk: s.desk, assignment: s.assignment, session: s.session, held: s.held, inbox: s.inbox, mail: s.mail, orders: s.orders, last: s.last,
      })),
      teams: [...this.teams.values()].map(({ job, ...t }) => ({ ...t, job: job && { ...job, idea: noPictures(job.idea) } })),
    };
  }

  restore(save: CrewSave, ready?: Promise<unknown>) {
    for (const p of save.staff) {
      this.staff.set(p.id, {
        ...this.fresh(p.name), engine: p.engine, model: p.model, skills: p.skills ?? [], ideas: p.ideas ?? false, usage: { ...p.usage }, seen: new Set(p.seen),
        idea: p.idea, workCwd: p.work?.cwd ?? null, workMode: p.work?.mode ?? 'default', desk: p.desk as WorkPlace | null, assignment: p.assignment,
        session: p.session ?? null, resumeNext: !!p.session, held: p.held ?? null, inbox: p.inbox ?? [], mail: p.mail ?? [], orders: p.orders ?? null, last: (p.last as LastJob | null) ?? null,
        ...(p.held ? { phase: 'held' as Phase } : {}),
      });
    }
    for (const t of save.teams) {
      const members = [t.manager, ...t.workers];
      if (!members.every((id) => this.staff.has(id))) continue;
      this.teams.set(t.id, { ...t, job: (t.job as TeamState['job']) ?? null });
      for (const id of members) Object.assign(this.staff.get(id)!, { team: t.id, role: id === t.manager ? 'manager' : 'worker' });
    }
    this.pushTeams();
    // back to work once settings and projects are in; everyone at once would be a stampede of Claude Code start-ups
    void Promise.resolve(ready).then(() =>
      save.staff.forEach((p, i) =>
        window.setTimeout(() => {
          const s = this.staff.get(p.id);
          if (!s) return; // fired while the projects were loading
          if (s.held) this.emitNow(p.id, 'idle', 'On hold');
          else this.resume(p.id, p.phase);
        }, 300 + i * 500),
      ),
    );
  }

  hold(agentId: string) {
    const s = this.staff.get(agentId);
    if (!s || s.held) return;
    s.held = s.pitched ? 'pitching' : s.phase;
    // stop the process but keep the job, branch and conversation for later
    this.stopProc(agentId);
    s.alive = false;
    s.retry = null;
    window.clearTimeout(s.breakTimer);
    window.clearTimeout(s.restTimer);
    s.resting = null;
    window.clearTimeout(s.showTimer);
    s.showTimer = undefined;
    s.permissions = [];
    if (this.line.includes(agentId)) this.leaveLine(agentId);
    this.setPhase(s, 'held');
    this.note(agentId, `${OWNER} put ${s.name} on hold`);
    this.emitNow(agentId, 'idle', 'On hold');
    this.checkAllDone();
  }

  unhold(agentId: string) {
    const s = this.staff.get(agentId);
    if (!s?.held) return;
    const phase = s.held;
    s.held = null;
    s.resumeNext = !!s.session;
    const team = this.teamOf(s);
    if (s.role === 'worker' && team?.job && s.assignment && !s.desk) {
      // handed a task while on hold, before they had a branch: set it up now
      const task = s.assignment;
      s.assignment = null;
      void this.assign(team, agentId, task);
    } else this.resume(agentId, phase, 'Back from hold');
    const inbox = s.inbox.splice(0);
    for (const text of inbox) {
      if (s.alive) this.bridge.send(agentId, text);
      else this.say(agentId, text);
    }
  }

  /** Pick up where they were: back to the job, back in line, or looking for the next idea. */
  private resume(agentId: string, phase: Phase, why = 'Back at the office') {
    const s = this.staff.get(agentId);
    if (!s) return;
    this.note(agentId, why);
    const team = this.teamOf(s);
    if (s.role === 'worker') {
      if (team?.job && s.desk && s.assignment) {
        this.setPhase(s, 'work');
        s.idea = team.job.idea;
        s.workCwd = s.desk.cwd;
        this.note(agentId, `Back on ${this.nameOf(team.manager)}'s task`);
        this.emitNow(agentId, 'thinking');
        const prompt = `Task from ${this.nameOf(team.manager)}: ${s.assignment}\n\nThe team's job, for context:\n${jobBrief(team.job.idea)}\n\n${RESUME}`;
        this.launch(agentId, { cwd: s.desk.cwd, system: this.workerSystem(s), prompt, mode: this.workMode(s.desk.mode) });
      } else {
        s.assignment = null;
        this.standby(agentId);
      }
      return;
    }
    if (phase === 'stopped' && s.idea && !s.workCwd) {
      // approved, but its folder never got set up: wait for a message to try again
      s.stuck = s.idea;
      this.setPhase(s, 'stopped');
      this.emitNow(agentId, 'idle', `Couldn't start "${s.idea.title}". Message them to try again.`);
    } else if ((phase === 'work' || phase === 'stopped') && s.idea && s.workCwd) {
      this.setPhase(s, 'work');
      this.note(agentId, `Picking "${s.idea.title}" back up`);
      this.emitNow(agentId, 'thinking', `Back on "${s.idea.title}"`);
      const system = team?.job ? MANAGER_WORK_PROMPT(s.name, team.workers.map((w) => this.nameOf(w)), team.job.branch) : WORK_PROMPT(s.name, !s.idea.path);
      this.launch(agentId, { cwd: s.workCwd, system, prompt: `${jobBrief(s.idea)}\n\n${RESUME}`, mode: this.workMode(s.workMode) });
    } else if ((phase === 'queued' || phase === 'pitching') && s.idea) {
      // still has the idea: straight back in line
      this.setPhase(s, 'queued');
      s.place = 0;
      this.line.push(agentId);
      this.note(agentId, `Still has the idea for ${s.idea.project}, waiting to see ${OWNER}`);
      this.refreshLine();
    } else if (phase === 'research' && s.session?.cwd === '' && s.orders) {
      // working out what the owner asked: same conversation, so they still know what they'd looked at
      this.research(agentId, RESUME_RESEARCH);
    } else {
      s.idea = null;
      s.workCwd = null;
      s.resumeNext = false;
      this.research(agentId);
    }
  }

  fire(agentId: string) {
    const s = this.staff.get(agentId);
    if (!s) return;
    const team = this.teamOf(s);
    if (team?.manager === agentId) this.disbandTeam(team.id);
    else if (team) {
      team.workers = team.workers.filter((w) => w !== agentId);
      if (team.job && this.staff.get(team.manager)?.alive)
        this.bridge.send(team.manager, `${s.name} was let go by ${OWNER}. If their part isn't merged yet, hand it to someone else or do it yourself.`);
      this.note(team.manager, `${s.name} was let go`);
      this.pushTeams();
    }
    this.reset(agentId);
    this.staff.delete(agentId);
    this.checkAllDone();
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
    if (p.ask?.kind === 'install') void this.install(agentId, p.ask.plugin, approved);
    else if (p.ask?.kind === 'question') {
      this.bridge.answer(agentId, p.requestId, false, p.input, `${OWNER} skipped the question. Use your best judgement and say what you picked.`);
      this.note(agentId, `${OWNER} skipped the question`);
    } else {
      this.bridge.answer(agentId, p.requestId, approved, p.input, approved ? undefined : `${OWNER} said no. Find another way or ask.`);
      this.note(agentId, approved ? `${OWNER} approved: ${p.text}` : `${OWNER} denied: ${p.text}`);
    }
    this.nextHand(agentId, s);
  }

  answer(agentId: string, answers: Record<string, string>) {
    const s = this.staff.get(agentId);
    const p = s?.permissions[0];
    if (!s || p?.ask?.kind !== 'question') return;
    s.permissions.shift();
    this.bridge.answer(agentId, p.requestId, true, { ...(p.input as object), answers });
    const said = Object.values(answers).join(' · ');
    this.note(agentId, `${OWNER} answered: ${said}`, { k: 'user', text: said });
    this.nextHand(agentId, s);
  }

  /** One hand answered: raise it again for the next request, or get back to work. */
  private nextHand(agentId: string, s: Staff) {
    const next = s.permissions[0];
    if (next) this.emitNow(agentId, 'awaiting', next.text, next.ask);
    else this.show(agentId, 'thinking');
  }

  /** Raise a hand: the owner gets asked in the terminal and the OKs panel. */
  private raise(agentId: string, s: Staff, p: Permission) {
    s.permissions.push(p);
    if (s.permissions.length === 1) this.emitNow(agentId, 'awaiting', p.text, p.ask);
  }

  /** The owner answered an agent's request for a plugin. Yes: install it and restart them with it loaded. */
  private async install(agentId: string, plugin: string, ok: boolean) {
    const s = this.staff.get(agentId)!;
    const tell = (text: string) => {
      if (s.alive) this.bridge.send(agentId, text);
      else s.mail.push(text);
    };
    if (!ok) {
      this.note(agentId, `${OWNER} said no to installing ${plugin}`);
      return tell(`${OWNER} said no to installing ${plugin}. Carry on without it.`);
    }
    this.note(agentId, `Installing ${plugin}...`);
    const r = await this.bridge.install(s.engine, plugin);
    if (!this.staff.has(agentId)) return;
    if (!r.ok) {
      this.note(agentId, `Couldn't install ${plugin}: ${r.text}`);
      return tell(`Installing ${plugin} didn't work (${r.text}). Carry on without it.`);
    }
    this.note(agentId, `Installed ${plugin}`);
    this.hooks.term(agentId, { k: 'out', text: r.text });
    const cfg = s.lastCfg;
    const back = `${plugin} is installed and its skills are loaded now. Carry on with what you were doing.`;
    if (!cfg || s.held) return void s.mail.push(back);
    // a new session picks up the new skills; resuming keeps the conversation
    this.stopProc(agentId);
    s.alive = false;
    s.resumeNext = !!s.session;
    this.launch(agentId, { ...cfg, prompt: back });
  }

  decide(agentId: string, d: Decision) {
    const s = this.staff.get(agentId);
    if (!s || !this.line.includes(agentId) || !s.idea) return;
    this.leaveLine(agentId);
    const idea = s.idea;
    s.seen.add(idea.title);
    if (d.kind === 'approve') {
      this.note(agentId, `${OWNER} approved "${idea.title}"`);
      void this.startWork(agentId, idea);
    } else if (d.kind === 'reject') {
      this.note(agentId, `${OWNER} passed on "${idea.title}"`);
      // the next idea waits until they've been left with nothing to do for a while again
      if (s.ideas) this.rest(agentId);
      else this.idle(agentId);
    } else {
      this.note(agentId, `${OWNER}: not that. ${d.text}${pictureNote(d.pictures)}`, { k: 'user', text: `Not that. ${d.text}`, pics: d.pictures?.length });
      s.orders = d.text;
      s.ordersPictures = d.pictures ?? [];
      this.backToResearch(agentId, content(ORDERS_PROMPT(d.text, s.role === 'manager'), s.ordersPictures));
    }
  }

  say(agentId: string, text: string, pictures: Picture[] = []) {
    const s = this.staff.get(agentId);
    if (!s) return;
    // talking to someone with a pitch waiting means "not that, do this instead"
    if (s.pitched || (s.phase === 'queued' && s.idea)) return this.decide(agentId, { kind: 'instead', text, pictures });
    if (s.held) {
      this.note(agentId, `${OWNER}: ${text} (on hold; they'll get this when reopened)`, { k: 'user', text });
      this.hooks.term(agentId, { k: 'note', text: "On hold: they'll get this when reopened" });
      s.inbox.push(text);
      return;
    }
    this.note(agentId, `${OWNER}: ${text}${pictureNote(pictures)}`, { k: 'user', text, pics: pictures.length });
    let message = content(text, pictures);
    if (s.stuck && !s.alive) {
      // the approved job never got going: try it again, with these words added to it
      const idea = s.stuck;
      s.stuck = null;
      if (!/^(ok(ay)?|go( ahead)?|yes|retry|try again|continue|do it)\b/i.test(text.trim()) || text.trim().split(/\s+/).length > 8) idea.orders = idea.orders ? `${idea.orders}\n\nAnd: ${text}` : text;
      if (pictures.length) idea.pictures = [...(idea.pictures ?? []), ...pictures];
      this.note(agentId, `Trying "${idea.title}" again`);
      return void this.startWork(agentId, idea);
    }
    if (s.phase === 'break' && s.alive) {
      // still chatting about the finished work: keep that session
      window.clearTimeout(s.breakTimer);
      this.setPhase(s, 'work');
      s.followUp = text;
      this.reopenJob(s);
      if (s.idea) message = content(FOLLOW_UP(text, s.idea), pictures);
    } else if (!s.alive && (s.phase === 'idle' || s.phase === 'break') && this.followUp(agentId, text, pictures)) return;
    else if (!s.alive && s.phase === 'stopped' && s.idea && s.workCwd && s.role !== 'worker') {
      // Claude Code stopped mid-job: pick the job back up, with this message first
      s.mail.push(`${OWNER} says: ${text}`);
      s.resumeNext = !!s.session;
      return this.resume(agentId, 'stopped', 'Picking the job back up');
    }
    if (s.alive) this.bridge.send(agentId, message);
    else if (s.role === 'worker') this.wake(agentId, `${OWNER} says: ${text}`, pictures);
    else {
      // a question or a chat gets an answer; only something to do becomes a pitch
      s.chatting = text;
      this.research(agentId, CHAT(text), pictures);
    }
  }

  /**
   * A worker who isn't running got a message from the owner: start them up to
   * answer it themselves, in their last conversation so they remember what
   * they did. Mid-task they answer and carry on; between tasks they just answer.
   */
  private wake(agentId: string, text: string, pictures: Picture[] = [], fromColleague = false) {
    const s = this.staff.get(agentId)!;
    const team = this.teamOf(s);
    const manager = this.nameOf(team?.manager ?? '');
    const onTask = !!(s.desk && team?.job && s.assignment);
    this.setPhase(s, onTask ? 'work' : 'standby');
    s.resumeNext = !!s.session;
    const others = team ? [team.manager, ...team.workers].filter((id) => id !== agentId).map((id) => this.nameOf(id)) : [];
    const system = onTask ? this.workerSystem(s) : WORKER_FREE_PROMPT(s.name, manager, others);
    const prompt = onTask ? `${text}\n\n(Answer that, then carry on with your task if it isn't done.)` : text;
    this.emitNow(agentId, 'thinking', 'Reading your message');
    this.launch(agentId, {
      // their worktree may be gone once the job was merged: then they start from the projects folder
      cwd: s.desk?.cwd ?? s.session?.cwd ?? '', anywhere: true, model: s.model || undefined,
      system, prompt: content(prompt, pictures), mode: this.workMode(s.desk?.mode ?? s.workMode),
      // a colleague's question between tasks only needs an answer
      ...(fromColleague && !onTask ? { effort: QUICK } : {}),
    });
  }

  /** The approved job couldn't start: keep it, so the next message tries again instead of starting over. */
  private setupFailed(agentId: string, idea: Idea, why: string) {
    const s = this.staff.get(agentId);
    if (!s) return;
    this.note(agentId, why);
    s.stuck = idea;
    s.idea = idea;
    this.setPhase(s, 'stopped');
    this.emitNow(agentId, 'idle', `Couldn't start "${idea.title}". Message them to try again.`);
    this.checkAllDone();
  }

  /** A manager talking about the team's finished job gets it back, so they can hand out more of it. */
  private reopenJob(s: Staff) {
    const team = this.teamOf(s);
    if (team && s.role === 'manager' && !team.job && s.last?.job && s.last.team === team.id) team.job = s.last.job;
  }

  /** Free, and asked something: pick the finished job's conversation back up instead of starting from nothing. */
  private followUp(agentId: string, text: string, pictures: Picture[]) {
    const s = this.staff.get(agentId)!;
    const last = s.last;
    if (!last || s.role === 'worker') return false;
    window.clearTimeout(s.breakTimer);
    window.clearTimeout(s.restTimer);
    s.resting = null;
    this.setPhase(s, 'work');
    s.followUp = text;
    s.idea = last.idea;
    s.workCwd = last.cwd;
    s.workMode = last.mode;
    s.session = last.session;
    s.resumeNext = !!last.session && last.session.cwd === last.cwd;
    this.reopenJob(s);
    const team = this.teamOf(s);
    const system = team?.job && s.role === 'manager' ? MANAGER_WORK_PROMPT(s.name, team.workers.map((w) => this.nameOf(w)), team.job.branch) : WORK_PROMPT(s.name, !last.idea.path);
    this.emitNow(agentId, 'thinking', `About "${last.idea.title}"`);
    this.launch(agentId, { cwd: last.cwd, system, prompt: content(FOLLOW_UP(text, last.idea), pictures), mode: this.workMode(last.mode) });
    return true;
  }

  /** Done answering about the finished job: back to a break, and the countdown to a pitch starts again. */
  private endFollowUp(agentId: string, s: Staff, text: string) {
    const asked = s.followUp;
    s.followUp = null;
    // a resumed conversation can come back under a new id: keep the one to pick up next time
    if (s.last && s.session?.cwd === s.last.cwd) s.last.session = s.session;
    const team = this.teamOf(s);
    if (team && s.role === 'manager') team.job = null;
    if (NEW_JOB.test(text)) {
      // something new after all: work out the job from what the owner said, and start on it
      if (asked) {
        this.reset(agentId);
        s.orders = asked;
        return this.research(agentId, ORDERS_PROMPT(asked, s.role === 'manager'));
      }
    }
    this.setPhase(s, 'break');
    this.emitNow(agentId, 'idle', 'Coffee break');
    window.clearTimeout(s.breakTimer);
    s.breakTimer = window.setTimeout(() => s.phase === 'break' && this.research(agentId), 15000);
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

  setSkills(agentId: string, skills: string[]) {
    const s = this.staff.get(agentId);
    if (!s) return;
    s.skills = skills;
    this.note(agentId, `Skills: ${skills.join(', ') || 'none'}${s.alive ? ' (from their next job)' : ''}`);
  }

  skillsOf(agentId: string) {
    return this.staff.get(agentId)?.skills ?? [];
  }

  setIdeas(agentId: string, on: boolean) {
    const s = this.staff.get(agentId);
    if (!s || s.ideas === on) return;
    s.ideas = on;
    this.note(agentId, on ? `${OWNER} asked ${s.name} to come up with ideas` : `${OWNER} told ${s.name} to stop coming up with ideas`);
    if (s.held || s.role === 'worker') return; // picked up when reopened; workers take tasks from their manager
    if (on && s.phase === 'idle') this.research(agentId);
    // still looking for an idea of their own: stop; anything the owner asked for carries on
    else if (!on && (s.phase === 'idle' || (s.phase === 'research' && !s.orders))) this.idle(agentId);
  }

  usageOf(agentId: string) {
    const s = this.staff.get(agentId);
    return s ? { tokens: s.usage.tokens + s.turnTokens, cost: s.usage.cost, turn: s.turnTokens } : null;
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
      ideas: s.ideas,
      pitch: s.phase === 'queued' && s.idea && !s.orders ? s.idea : null,
    };
  }

  workingCount() {
    return [...this.staff.values()].filter((s) => s.phase === 'work').length;
  }

  setBackground(on: boolean) {
    this.background = on;
    for (const [id, s] of this.staff) {
      if (on && s.phase !== 'work' && s.phase !== 'held' && !(s.role === 'worker' && this.teamOf(s)?.job)) this.goHome(id);
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

  /** Permission mode for approved work: full access, auto mode, or the place's own (acceptEdits in a worktree, ask in place). */
  private workMode(placeMode: string) {
    const a = this.settings.approvals;
    return a === 'full' ? 'bypassPermissions' : a === 'auto' ? 'auto' : placeMode;
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
    } else this.rest(t.manager, true);
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
      // anyone on hold stays put; reopening them starts them solo
      if (s.held) s.held = 'research';
      // unless they've been put on another team in the meantime
      else window.setTimeout(() => this.staff.get(id) === s && !s.held && !s.team && this.research(id), i * 1500);
    });
    this.pushTeams();
  }

  sayTeam(teamId: string, text: string, pictures: Picture[] = []) {
    const team = this.teams.get(teamId);
    if (!team) return;
    const message = `${OWNER}, to the whole team: ${text}`;
    for (const w of team.workers) {
      const s = this.staff.get(w);
      if (!s) continue;
      this.note(w, `${OWNER} (to ${team.name}): ${text}${pictureNote(pictures)}`, { k: 'user', text, pics: pictures.length });
      if (s.held) s.inbox.push(message);
      else if (s.alive) this.bridge.send(w, content(message, pictures));
      else this.wake(w, message, pictures);
    }
    // the manager acts on it: it may be a task, an answer to a pitch, or a change of plan
    this.say(team.manager, text, pictures);
  }

  /**
   * A colleague's message: straight in if they're running. Someone free who isn't
   * running is started up to answer it; anyone else (held, gone home, mid-job but
   * stopped, waiting to pitch) gets it with their next prompt.
   */
  private deliver(fromId: string, toId: string, text: string) {
    const s = this.staff.get(toId);
    if (!s) return;
    const from = this.nameOf(fromId);
    const mate = !!s.team && this.staff.get(fromId)?.team === s.team;
    const message = `${from} (${mate ? 'teammate' : 'colleague'}) says: ${text}`;
    this.note(toId, `${from}: ${text}`, { k: 'user', from, text });
    if (s.held) s.inbox.push(message);
    else if (s.alive) this.bridge.send(toId, message);
    else if (this.background || s.phase === 'home') s.mail.push(message);
    else if (s.role === 'worker' && this.teamOf(s)) this.wake(toId, message, [], true);
    else if ((s.phase === 'idle' || s.phase === 'break') && !s.pitched) {
      window.clearTimeout(s.breakTimer);
      s.chatting = message;
      s.asker = from;
      this.research(toId, COLLEAGUE(message, from));
    } else s.mail.push(message);
  }

  /** Everyone else in the office, for the start of a session, so they know who to ask. */
  private roster(agentId: string) {
    const rows = [...this.staff].filter(([id]) => id !== agentId).map(([id, o]) => {
      const team = this.teamOf(o);
      const role = team ? `${o.role === 'manager' ? 'manager' : 'worker'} on ${team.name}` : 'on their own';
      const doing = o.held ? 'on hold' : o.idea && (o.phase === 'work' || o.phase === 'standby') ? `working on "${short(o.idea.title, 50)}" (${o.idea.project})` : o.phase === 'work' ? 'working' : o.phase === 'research' ? 'looking around' : o.phase;
      return `${this.nameOf(id)} (${role}, ${doing})`;
    });
    return rows.length ? `(Who else is in the office: ${rows.join('; ')}.)` : '';
  }

  /** When each agent's recent tell blocks were sent, to stop two of them talking in circles. */
  private told = new Map<string, number[]>();

  private parseTells(agentId: string, text: string) {
    const me = this.staff.get(agentId);
    const team = me && this.teamOf(me);
    const mates = team ? [team.manager, ...team.workers].filter((id) => id !== agentId) : [];
    const everyone = [...this.staff.keys()].filter((id) => id !== agentId);
    for (const m of text.matchAll(TELL)) {
      try {
        const raw = JSON.parse(m[1]) as { to?: string; text?: string };
        const to = String(raw.to ?? '').trim().toLowerCase().replace(/^@/, '');
        if (!raw.text) continue;
        const named = (ids: string[]) => {
          const exact = ids.filter((id) => this.nameOf(id).toLowerCase() === to);
          return (exact.length ? exact : ids.filter((id) => this.nameOf(id).toLowerCase().startsWith(to))).slice(0, 1);
        };
        const targets = to === 'team' ? mates
          : ['everyone', 'office', 'everybody'].includes(to) ? everyone
          : to === 'all' ? (mates.length ? mates : everyone)
          : to ? (named(mates).length ? named(mates) : named(everyone)) : [];
        if (!targets.length) {
          this.bridge.send(agentId, `Nobody called "${raw.to}" in the office. Everyone here: ${everyone.map((id) => this.nameOf(id)).join(', ') || 'just you'}.`);
          continue;
        }
        const now = Date.now();
        const recent = (this.told.get(agentId) ?? []).filter((t) => now - t < TELL_WINDOW_MS);
        if (recent.length >= TELL_LIMIT) {
          this.note(agentId, `(too many messages to colleagues; held one back)`);
          this.bridge.send(agentId, `You've sent ${TELL_LIMIT} messages in the last few minutes, so that one wasn't delivered. Wrap the conversation up and get on with your work.`);
          continue;
        }
        recent.push(now);
        this.told.set(agentId, recent);
        for (const id of targets) this.deliver(agentId, id, raw.text);
      } catch {
        this.bridge.send(agentId, 'One of your tell blocks was not valid JSON. Please write it again.');
      }
    }
  }

  /** They asked for a plugin to be installed. */
  private parseInstalls(agentId: string, s: Staff, text: string) {
    for (const m of text.matchAll(INSTALL)) {
      try {
        const raw = JSON.parse(m[1]) as { plugin?: string; why?: string };
        const plugin = String(raw.plugin ?? '').trim();
        if (!plugin || s.permissions.some((p) => p.ask?.kind === 'install' && p.ask.plugin === plugin)) continue;
        if (this.background) {
          this.note(agentId, `Wanted ${plugin}, but ${OWNER} is away`);
          this.bridge.send(agentId, `${OWNER} is away, so ${plugin} can't be installed now. Carry on without it and mention it in your summary.`);
          continue;
        }
        const why = String(raw.why ?? '').trim();
        this.raise(agentId, s, { requestId: '', input: null, text: `install ${plugin}${why ? `: ${why}` : ''}`, ask: { kind: 'install', plugin, why } });
      } catch {
        this.bridge.send(agentId, 'Your install block was not valid JSON. Please write it again.');
      }
    }
  }

  private removeFromTeam(agentId: string) {
    const s = this.staff.get(agentId)!;
    const team = s.team && this.teams.get(s.team);
    if (!team) return;
    if (team.manager === agentId) this.disbandTeam(team.id);
    else {
      team.workers = team.workers.filter((w) => w !== agentId);
      this.note(team.manager, `${s.name} left ${team.name}`);
      if (team.job && s.assignment) this.deliverOffice(team.manager, `${s.name} was taken off your team by ${OWNER}. If their part isn't merged yet, hand it to someone else or do it yourself.`);
    }
    s.team = s.role = null;
  }

  /** A message from the office: straight in if they're running, otherwise with their next prompt. */
  private deliverOffice(toId: string, text: string) {
    const s = this.staff.get(toId);
    if (!s) return;
    if (s.held) s.inbox.push(text);
    else if (s.alive) this.bridge.send(toId, text);
    else s.mail.push(text);
  }

  joinTeam(agentId: string, teamId: string, role: Role) {
    const s = this.staff.get(agentId);
    const team = this.teams.get(teamId);
    if (!s || !team || (s.team === teamId && s.role === role)) return;
    if (role === 'worker' && team.manager === agentId) {
      this.note(agentId, `Make someone else the manager of ${team.name} first`);
      return;
    }
    if (role === 'manager' && team.job && team.manager !== agentId) {
      this.note(agentId, `${team.name} is in the middle of "${team.job.idea.title}", so its manager stays ${this.nameOf(team.manager)} until that's done (or disband it)`);
      return;
    }
    if (s.team !== teamId) this.removeFromTeam(agentId);
    else team.workers = team.workers.filter((w) => w !== agentId);
    this.reset(agentId);
    s.team = teamId;
    s.role = role;
    if (role === 'manager') {
      const old = this.staff.get(team.manager);
      const oldId = team.manager;
      team.manager = agentId;
      if (old && oldId !== agentId) {
        // the old manager stays on as a worker
        this.reset(oldId);
        old.role = 'worker';
        team.workers.push(oldId);
        this.note(oldId, `${s.name} now manages ${team.name}; ${old.name} is a worker`);
        this.standby(oldId);
      }
      this.note(agentId, `${OWNER} made ${s.name} the manager of ${team.name}`);
      if (team.workers.length) for (const w of team.workers) if (w !== oldId) this.note(w, `${s.name} now manages ${team.name}`);
      this.rest(agentId, true);
    } else {
      team.workers.push(agentId);
      this.note(agentId, `Joined ${team.name} as a worker under ${this.nameOf(team.manager)}`);
      this.standby(agentId);
      if (team.job) this.deliverOffice(team.manager, `${s.name} just joined your team as a worker. Hand them a piece with an assign block if there's something for them.`);
      else this.note(team.manager, `${s.name} joined ${team.name}`);
    }
    this.pushTeams();
  }

  leaveTeam(agentId: string) {
    const s = this.staff.get(agentId);
    const team = s && this.teamOf(s);
    if (!s || !team) return;
    if (team.manager === agentId) return this.disbandTeam(team.id);
    this.removeFromTeam(agentId);
    this.reset(agentId);
    this.note(agentId, `${OWNER} took ${s.name} off ${team.name}; back to working solo`);
    if (s.held) s.held = 'research';
    else this.research(agentId);
    this.pushTeams();
  }

  /** Drop whatever they were doing: session, line, pending prompts, timers. */
  private reset(agentId: string) {
    const s = this.staff.get(agentId)!;
    this.stopProc(agentId);
    s.alive = false;
    window.clearTimeout(s.breakTimer);
    window.clearTimeout(s.restTimer);
    s.resting = null;
    window.clearTimeout(s.showTimer);
    s.showTimer = undefined;
    s.permissions = [];
    s.assignment = null;
    s.desk = null;
    s.workCwd = null;
    s.orders = null;
    s.ordersPictures = [];
    s.idea = null;
    s.followUp = null;
    s.stuck = null;
    s.chatting = null;
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

  /** `now`: they've been left with nothing to do long enough, so go and look for an idea straight away. */
  private research(agentId: string, prompt?: string, pictures: Picture[] = [], now = false) {
    const s = this.staff.get(agentId)!;
    if (s.role === 'worker') return this.standby(agentId);
    if (this.background) return this.goHome(agentId);
    // nothing asked of them: only go looking for ideas if that box is ticked, and only once they've been free a while
    if (prompt === undefined && !s.orders) {
      if (!s.ideas) return this.idle(agentId);
      if (!now) return this.rest(agentId);
    }
    window.clearTimeout(s.restTimer);
    s.resting = null;
    this.setPhase(s, 'research');
    s.idea = null;
    s.nudged = false;
    s.pitched = false;
    s.permissions = [];
    if (prompt === undefined || prompt === LOOK_AROUND || prompt === RESUME_RESEARCH || s.orders) s.chatting = null;
    const team = this.leads(s);
    const system = team ? MANAGER_RESEARCH_PROMPT(s.name, team.workers.map((w) => this.nameOf(w))) : RESEARCH_PROMPT(s.name);
    const avoid = s.seen.size ? ` Don't re-pitch these: ${[...s.seen].join('; ')}.` : '';
    // just looking for an idea of their own (nothing the owner asked): the cheap model and a lean session
    const looking = !s.orders && (prompt === undefined || prompt === LOOK_AROUND || prompt === RESUME_RESEARCH);
    const text = (prompt ?? LOOK_AROUND) + avoid + (looking && prompt !== RESUME_RESEARCH ? this.projectsBrief() : '');
    // researching only ever ends in an answer or a pitch block, never in the work itself
    this.launch(agentId, { model: looking ? this.pitchModel(s) : s.model || undefined, system, prompt: content(text, pictures), mode: 'default', lean: looking, effort: QUICK });
    this.note(agentId, s.orders ? 'Working out what that means' : 'Looking through the projects for something to improve');
    this.emitNow(agentId, 'thinking');
  }

  /** The projects summed up, so looking for an idea doesn't start with exploring every folder. */
  private projectsBrief() {
    if (!this.projects.length) return '';
    const rows = this.projects.slice(0, 40).map((p) => {
      const bits = [p.languages.join('/') || 'no code yet', `${p.files} files`, p.hasTests ? 'has tests' : 'no tests', ...(p.lastCommit ? [`last commit "${short(p.lastCommit, 60)}"`] : [])];
      return `- ${p.name}: ${bits.join(', ')}${p.readme ? `. ${short(p.readme, 100)}` : ''}`;
    });
    return `\n\nThe projects, already summed up for you:\n${rows.join('\n')}`;
  }

  /** The model for looking around for ideas: the cheap one from Settings when their engine has it. */
  private pitchModel(s: Staff) {
    const m = this.settings.pitchModel;
    return m && engineIn(this.settings, s.engine).models.some((x) => x.id === m) ? m : s.model || undefined;
  }

  /** Their team, when they manage one that has workers; a manager on their own works like anyone solo. */
  private leads(s: Staff) {
    const team = this.teamOf(s);
    return team && s.role === 'manager' && team.workers.length ? team : null;
  }

  /** Nothing to do: sit at the desk until told what to do. */
  private idle(agentId: string, detail = 'Idle. Tick "Come up with ideas" or message them.') {
    const s = this.staff.get(agentId)!;
    if (s.alive) {
      this.stopProc(agentId);
      s.alive = false;
    }
    window.clearTimeout(s.breakTimer);
    window.clearTimeout(s.restTimer);
    s.resting = null;
    if (this.line.includes(agentId)) this.leaveLine(agentId);
    s.idea = null;
    s.pitched = false;
    s.permissions = [];
    s.resumeNext = false;
    this.setPhase(s, 'idle');
    this.emitNow(agentId, 'idle', detail);
    this.checkAllDone();
  }

  /**
   * Free, and allowed to come up with ideas: wait at the desk, and only if
   * nothing comes in for a few minutes go looking for something to pitch.
   * `always`: a manager whose team was made without a task pitches even with the box unticked.
   */
  private rest(agentId: string, always = false) {
    const s = this.staff.get(agentId)!;
    const mins = Math.max(0, Number(this.settings.pitchAfterMin ?? 5) || 0);
    this.idle(agentId, `Free. Pitches an idea if nothing comes in for ${mins} min.`);
    // the clock starts now: a pitch only ever comes after a full stretch with nothing to do
    const wait = mins * 60_000;
    s.resting = always ? 'always' : 'ideas';
    s.restTimer = window.setTimeout(() => {
      if (this.staff.get(agentId) !== s || s.phase !== 'idle' || s.held || !(s.ideas || always)) return;
      this.research(agentId, always && !s.ideas ? LOOK_AROUND : undefined, [], true);
    }, wait);
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
    s.followUp = null;
    const team = this.leads(s);
    return team ? this.teamWork(team, idea) : this.soloWork(agentId, idea);
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
      s.workMode = place.mode;
      this.launch(agentId, { cwd: place.cwd, model: s.model || undefined, system: WORK_PROMPT(s.name, !idea.path), prompt: content(jobBrief(idea), idea.pictures), mode: this.workMode(place.mode) });
    } catch (e) {
      this.setupFailed(agentId, idea, `Couldn't set up the work: ${(e as Error).message}`);
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
      s.workMode = place.mode;
      this.launch(team.manager, { cwd: place.cwd, model: s.model || undefined, system: MANAGER_WORK_PROMPT(s.name, workers, team.job.branch), prompt: content(jobBrief(idea), idea.pictures), mode: this.workMode(place.mode) });
    } catch (e) {
      team.job = null;
      this.setupFailed(team.manager, idea, `Couldn't set up the team's work: ${(e as Error).message}`);
    }
  }

  /** The manager handed a worker a task. */
  private async assign(team: TeamState, workerId: string, task: string) {
    const w = this.staff.get(workerId)!;
    const job = team.job;
    if (!job) return;
    this.note(workerId, `Task from ${this.nameOf(team.manager)}: ${task}`, { k: 'user', from: this.nameOf(team.manager), text: task });
    this.note(team.manager, `Assigned ${w.name}: ${short(task)}`);
    if (w.held) {
      // kept for when they're reopened
      w.assignment = w.assignment ? `${w.assignment}; ${task}` : task;
      w.held = 'work';
      this.bridge.send(team.manager, `${w.name} is on hold, so that task waits until ${OWNER} reopens them. Carry on with other work meanwhile.`);
      return;
    }
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
    const others = team ? [team.manager, ...team.workers].filter((id) => this.staff.get(id) !== w).map((id) => this.nameOf(id)) : [];
    return WORKER_PROMPT(w.name, this.nameOf(team?.manager ?? ''), !!team?.job?.inPlace, others);
  }

  /** The manager says the team's job is merged and done. */
  private teamDone(team: TeamState, summary: string) {
    for (const w of team.workers) {
      const s = this.staff.get(w)!;
      this.stopProc(w);
      s.alive = false;
      s.desk = null;
      this.note(w, `${team.name} finished "${team.job?.idea.title}"`);
      if (this.background) this.goHome(w);
      else this.standby(w);
    }
    const job = team.job;
    team.job = null;
    this.finishWork(team.manager, summary.replace(TEAM_DONE, '').trim(), job);
  }

  private launch(agentId: string, cfg: StartConfig) {
    const s = this.staff.get(agentId);
    if (!s) return; // let go while their folder was being set up
    s.alive = true;
    s.sessionCost = 0;
    const cwd = cfg.cwd ?? '';
    const resume = s.resumeNext && s.session?.cwd === cwd ? s.session.id : undefined;
    s.resumeNext = false;
    s.launchCwd = cwd;
    s.retry = resume ? cfg : null;
    s.lastCfg = cfg;
    // whatever teammates said while they weren't running comes first
    const mail = s.mail.splice(0);
    const withMail = mail.length ? withText(cfg.prompt, `Messages that came in for you:\n${mail.map((m) => `- ${m}`).join('\n')}`) : cfg.prompt;
    // who's around goes with the prompt, not the system prompt, so a changing office doesn't spoil the prompt cache
    const roster = this.roster(agentId);
    const prompt = roster ? withText(withMail, roster) : withMail;
    const system = cfg.lean ? `${cfg.system}\n\n${OFFICE_TALK}` : `${cfg.system}\n\n${POWERS}\n\n${OFFICE_TALK}`;
    this.bridge.start(agentId, { ...cfg, system, prompt, resume, engine: s.engine, model: cfg.model ?? (s.model || undefined), skills: s.skills }).catch((e: Error) => {
      s.alive = false;
      this.note(agentId, `Couldn't start Claude Code: ${e.message}`);
    });
  }

  private finishWork(agentId: string, summary: string, job: TeamState['job'] = null) {
    const s = this.staff.get(agentId)!;
    this.setPhase(s, 'break');
    const idea = s.idea;
    s.followUp = null;
    if (idea) s.last = { idea: { ...idea, pictures: undefined }, cwd: s.launchCwd, mode: s.lastCfg?.mode ?? 'default', session: s.session, team: s.team, job };
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
    if (!s || s.held) return; // on hold: whatever was still on its way is dropped
    if (msg.kind === 'usage') {
      s.turnTokens = msg.tokens;
      this.hooks.changed();
      return;
    }
    if (msg.kind === 'delta') {
      s.live += msg.text;
      // the pitch and assign blocks are for the office, not the screen
      const shown = s.live.split(OFFICE_BLOCK)[0].trim();
      if (shown) this.hooks.live(agentId, shown);
      return;
    }
    // anything else means that text is finished (or abandoned)
    if (s.live) this.clearLive(agentId);
    const busy = s.phase === 'research' || s.phase === 'work';
    switch (msg.kind) {
      case 'init':
        s.alive = true;
        s.retry = null;
        if (msg.session) s.session = { id: msg.session, cwd: s.launchCwd };
        break;
      case 'assistant':
        for (const part of msg.parts) {
          if (part.type === 'text') {
            const shown = stripBlocks(part.text);
            if (shown) this.note(agentId, `${s.name}: ${shown}`, { k: 'text', text: shown });
            this.parseInstalls(agentId, s, part.text);
            const idea = this.parsePitch(s, part.text);
            if (idea && (s.phase === 'research' || s.phase === 'queued')) {
              s.idea = idea;
              this.note(agentId, `${s.orders ? 'Got it' : 'Pitch ready'}: "${idea.title}" (${idea.project})`);
            }
            const team = this.teamOf(s);
            if (team && s.role === 'manager' && s.phase === 'work') this.parseAssignments(team, part.text);
            this.parseTells(agentId, part.text);
            if (busy) this.show(agentId, 'thinking');
          } else {
            const [activity, text] = describe(part.name, part.input, this.root());
            s.tools.set(part.id, part.name);
            this.note(agentId, text, { k: 'tool', name: part.name, arg: toolArg(part.name, part.input, this.root()) });
            if (busy) this.show(agentId, activity);
          }
        }
        break;
      case 'permission': {
        if (msg.tool === 'AskUserQuestion') {
          this.question(agentId, s, msg);
          break;
        }
        const text = permissionText(msg.tool, msg.input, this.root());
        const researching = s.phase === 'research' || s.phase === 'queued';
        // reading and searching outside their folder: the whole PC is theirs to look through
        if (lookingAnywhere(msg.tool, msg.input)) {
          this.bridge.answer(agentId, msg.requestId, true, msg.input);
        } else if (researching && readOnlyCommand(msg.tool, msg.input)) {
          this.bridge.answer(agentId, msg.requestId, true, msg.input);
        } else if (researching) {
          this.bridge.answer(agentId, msg.requestId, false, msg.input, `You're only researching right now. Don't change anything; pitch the idea to ${OWNER} first.`);
          this.note(agentId, `(tried to ${text} while researching; told no)`);
        } else if (this.autoApprove) {
          this.bridge.answer(agentId, msg.requestId, true, msg.input);
          this.note(agentId, `Auto-approved: ${text}`);
        } else if (this.background && this.settings.approvals !== 'ask') {
          // away, in auto mode or full access: they carry on the way they would with the owner here
          this.bridge.answer(agentId, msg.requestId, true, msg.input);
          this.note(agentId, `Allowed while ${OWNER} is away: ${text}`);
        } else if (this.background) {
          // asked to be asked, and nobody to ask: fine inside their own branch folder, not anywhere else
          // an MCP server reaches outside the branch folder (Blender, Drive...), so that waits for them too
          const isolated = !mcpName(msg.tool) && !!s.workCwd?.replace(/\\/g, '/').includes('/.letting-go/worktrees/');
          this.bridge.answer(agentId, msg.requestId, isolated, msg.input, isolated ? undefined : `${OWNER} is away. Skip anything that needs approval and mention it in your summary.`);
          this.note(agentId, `${isolated ? 'Allowed (own branch, while away)' : `Skipped (needs approval, ${OWNER} is away)`}: ${text}`);
        } else this.raise(agentId, s, { requestId: msg.requestId, input: msg.input, text });
        break;
      }
      case 'results':
        for (const r of msg.results) {
          const tool = s.tools.get(r.id) ?? '';
          s.tools.delete(r.id);
          this.hooks.term(agentId, { k: 'out', text: resultSummary(tool, r.text, r.error), error: r.error });
        }
        break;
      case 'note':
        this.note(agentId, msg.text);
        break;
      case 'limits':
        this.hooks.limits({ status: msg.status, windows: msg.windows, at: Date.now() });
        break;
      case 'result':
        s.turnTokens = 0;
        if (s.retry) break; // a resume that never got going; its exit starts a fresh one
        s.usage.tokens += msg.tokens;
        s.usage.cost += Math.max(0, msg.cost - s.sessionCost);
        s.sessionCost = msg.cost;
        this.onTurnEnd(agentId, s, msg);
        break;
      case 'exit':
        s.alive = false;
        this.keepTurnTokens(s);
        if (s.retry) {
          // the old conversation is gone: same job, fresh conversation
          const cfg = s.retry;
          this.note(agentId, `Couldn't reopen the last conversation${msg.error ? ` (${msg.error})` : ''}; starting a fresh one`);
          this.launch(agentId, cfg);
          break;
        }
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
    // waiting to hear about a plugin: they pick up from there once it's decided
    if (s.permissions.some((p) => p.ask?.kind === 'install')) return;
    const team = this.teamOf(s);
    if (s.phase === 'research') {
      // they were told something to do while free: that's the owner's own request, so no pitch to approve
      const asked = s.asker;
      s.asker = null;
      if (s.idea && s.chatting && !s.orders && !asked) s.orders = s.chatting;
      if (s.idea) s.chatting = null;
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
      } else if (msg.ok && s.chatting) {
        // answered the owner; back to waiting, and the countdown to a pitch starts again
        s.chatting = null;
        this.research(agentId);
      } else if (msg.ok && !s.nudged) {
        s.nudged = true;
        this.bridge.send(agentId, 'Please wrap up now and end with the ```pitch block.');
      } else if (msg.ok) {
        this.note(agentId, "Couldn't come up with a pitch; taking a break");
        this.rest(agentId);
      } else this.emitNow(agentId, 'idle', 'Stopped');
      return;
    }
    // a worker between tasks answered something: back to waiting for the manager
    if (s.phase === 'standby' && s.role === 'worker') return this.standby(agentId);
    if (s.phase !== 'work') return;
    if (!msg.ok) return this.emitNow(agentId, 'idle', 'Stopped. Message them to continue.');
    if (s.followUp && s.role !== 'worker') {
      if (team && s.role === 'manager' && team.job) {
        // handed out more of it: carry on as a team job until it's merged again
        if (TEAM_DONE.test(msg.text)) return this.teamDone(team, msg.text);
        if (team.workers.some((w) => this.staff.get(w)?.assignment)) return this.show(agentId, 'standby');
      }
      return this.endFollowUp(agentId, s, msg.text);
    }
    if (team && s.role === 'worker') {
      // report back to the manager and wait for the next piece
      const done = s.assignment ?? 'their task';
      const report = `${s.name} finished "${short(done, 200)}" on branch ${s.desk?.branch ?? 'the shared folder'}:\n${msg.text}`;
      const manager = this.staff.get(team.manager);
      if (manager?.held) manager.inbox.push(report);
      else this.bridge.send(team.manager, report);
      this.note(team.manager, `${s.name} reported back`, { k: 'user', from: s.name, text: msg.text || `Finished "${short(done, 200)}"` });
      this.note(agentId, `Reported to ${this.nameOf(team.manager)}`);
      this.standby(agentId);
    } else if (team && s.role === 'manager') {
      if (TEAM_DONE.test(msg.text)) this.teamDone(team, msg.text);
      else this.show(agentId, team.workers.some((w) => this.staff.get(w)?.assignment) ? 'standby' : 'thinking');
    } else this.finishWork(agentId, msg.text);
  }

  /** They asked the owner something (AskUserQuestion): it goes to the terminal, unless nobody's there to answer. */
  private question(agentId: string, s: Staff, msg: Extract<Msg, { kind: 'permission' }>) {
    const questions = (Array.isArray(msg.input.questions) ? msg.input.questions : []) as Question[];
    if (this.background || !questions.length) {
      this.bridge.answer(agentId, msg.requestId, false, msg.input, `${OWNER} is away. Make the call yourself and mention what you picked in your summary.`);
      this.note(agentId, `Asked ${OWNER} something while away; deciding on their own`);
      return;
    }
    this.raise(agentId, s, { requestId: msg.requestId, input: msg.input, text: `asks: ${short(questions[0].question, 150)}`, ask: { kind: 'question', questions } });
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

  /** Stop their Claude Code process, and drop any half-written text from their terminal. */
  private stopProc(agentId: string) {
    this.bridge.stop(agentId);
    this.clearLive(agentId);
    const s = this.staff.get(agentId);
    if (s) this.keepTurnTokens(s);
  }

  /** Stopped mid-turn, so no result will count it: keep the running count, estimate and all. */
  private keepTurnTokens(s: Staff) {
    if (!s.turnTokens) return;
    s.usage.tokens += s.turnTokens;
    s.turnTokens = 0;
    this.hooks.changed();
  }

  private clearLive(agentId: string) {
    const s = this.staff.get(agentId);
    if (s) s.live = '';
    this.hooks.live(agentId, null);
  }

  private emitNow(agentId: string, activity: AgentActivity, detail?: string, ask?: Ask) {
    const s = this.staff.get(agentId)!;
    window.clearTimeout(s.showTimer);
    s.showTimer = undefined;
    s.activity = activity;
    s.lastShown = Date.now();
    this.hooks.emit({ agentId, activity, detail, task: s.idea?.title, ask });
  }

  private note(agentId: string, text: string, line?: TermLine | null) {
    this.hooks.note(agentId, text, line);
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

/** A message with more text added at the end. */
function withText(message: Content, more: string): Content {
  if (typeof message === 'string') return `${message}\n\n${more}`;
  return [...message, { type: 'text' as const, text: more }];
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
  const LOOK = /^(ls|dir|cat|head|tail|wc|pwd|cd|echo|find|fd|locate|where|which|whereis|realpath|readlink|es|tree|file|stat|du|grep|rg|uniq|for|do|done|git (log|status|show|diff|ls-files|rev-parse|remote -v)|claude plugins? (list|details|marketplace list)|curl -s "http:\/\/127\.0\.0\.1:\d+\/(shot|windows)\?[^"\s]*")(\s|$)/;
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
    case 'Skill': return ['reading', `Use the ${input.skill} skill`];
    case 'NotebookEdit': return ['writing', `Edit ${rel(input.notebook_path, root)}`];
    case 'Agent': case 'Task': return ['thinking', `Hand off: ${short(String(input.description ?? ''), 60)}`];
    case 'TodoWrite': return ['thinking', 'Update the to-do list'];
    default: {
      const m = mcpName(tool);
      return m ? ['running', `${m.server}: ${m.tool}`] : ['thinking', tool];
    }
  }
}

/** What goes in the brackets of a tool call in the terminal, e.g. Read(src/main.ts). */
function toolArg(tool: string, input: Record<string, unknown>, root: string) {
  switch (tool) {
    case 'Read': case 'Edit': case 'Write': return rel(input.file_path, root);
    case 'Bash': return short(String(input.command ?? ''), 200);
    case 'Glob': return String(input.pattern ?? '');
    case 'Grep': return `"${short(String(input.pattern ?? ''), 80)}"${input.path ? `, ${rel(input.path, root)}` : ''}`;
    case 'WebSearch': return String(input.query ?? '');
    case 'WebFetch': return String(input.url ?? '');
    case 'Skill': return String(input.skill ?? '');
    case 'NotebookEdit': return rel(input.notebook_path, root);
    case 'Agent': case 'Task': return String(input.description ?? '');
    default: return short(JSON.stringify(input), 120);
  }
}

/** A tool's result the way Claude Code sums it up: "Read 120 lines" rather than the whole file. */
function resultSummary(tool: string, text: string, error: boolean) {
  const lines = text.split('\n').filter((l) => l.trim()).length;
  if (error) return text.trim() || 'Error';
  if (tool === 'Read') return `Read ${lines} line${lines === 1 ? '' : 's'}`;
  if (tool === 'Glob') return /^No files found/.test(text) ? 'No files found' : `Found ${lines} file${lines === 1 ? '' : 's'}`;
  if (tool === 'Grep') return /^No (files|matches) found/.test(text) ? 'No matches' : `Found ${lines} line${lines === 1 ? '' : 's'}`;
  if (tool === 'WebFetch') return `Fetched ${text.length} characters`;
  return text.trim() || '(No output)';
}

function permissionText(tool: string, input: Record<string, unknown>, root: string) {
  if (tool === 'Bash') return `run: ${short(String(input.command ?? ''), 160)}`;
  if (tool === 'Edit' || tool === 'Write') return `${tool.toLowerCase()} ${rel(input.file_path, root)}`;
  if (tool === 'Skill') return `use the ${input.skill} skill`;
  if (tool === 'NotebookEdit') return `edit ${rel(input.notebook_path, root)}`;
  const m = mcpName(tool);
  if (m) return `use ${m.server}: ${m.tool} ${short(JSON.stringify(input), 160)}`;
  return `use ${tool}`;
}

/** An MCP server's tool, mcp__blender__get_scene_info, as its server and tool names. */
function mcpName(tool: string) {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  return m ? { server: m[1].replace(/^claude_ai_/, '').replace(/_/g, ' '), tool: m[2] } : null;
}
