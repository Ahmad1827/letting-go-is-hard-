import { OWNER } from '../owner';
import type { AgentUsage, Crew, CrewHooks, UsageWindow } from './crew';
import { branchFor, ordered } from './ideas';
import type { AgentActivity, Decision, Idea, ProjectInfo } from './types';

/**
 * Real agents: each employee is a headless Claude Code session started by the
 * Electron main process (see electron/agents.mjs). Same cycle as the simulator:
 * research -> queue -> pitch -> work on a branch -> break -> research.
 */

type Msg =
  | { kind: 'init'; model: string; cwd: string }
  | { kind: 'assistant'; model: string; parts: ({ type: 'text'; text: string } | { type: 'tool'; name: string; input: Record<string, unknown> })[] }
  | { kind: 'permission'; requestId: string; tool: string; input: Record<string, unknown>; description: string }
  | { kind: 'result'; ok: boolean; text: string; cost: number; tokens: number }
  | { kind: 'limits'; status?: string; windows: Record<string, UsageWindow> }
  | { kind: 'exit'; code: number; error?: string };

interface StartConfig { cwd?: string; model?: string; system: string; prompt: string; mode: string }

export interface AgentBridge {
  start(id: string, cfg: StartConfig): Promise<void>;
  send(id: string, text: string): void;
  setModel(id: string, model: string): void;
  interrupt(id: string): void;
  stop(id: string): void;
  answer(id: string, requestId: string, allow: boolean, input: unknown, message?: string): void;
  prepareWork(req: { project: string; projectPath: string | null; branch: string; isNew: boolean }): Promise<{ cwd: string; mode: string; branch?: string; note: string }>;
  onMessage(cb: (id: string, msg: Msg) => void): void;
}

type Phase = 'research' | 'queued' | 'work' | 'break' | 'stopped';

interface Permission { requestId: string; input: unknown; text: string }

interface Staff {
  name: string;
  phase: Phase;
  model: string;
  idea: Idea | null;
  seen: Set<string>;
  alive: boolean;
  /** Asked once already to finish with a pitch block. */
  nudged: boolean;
  permissions: Permission[];
  place: number;
  activity: AgentActivity;
  lastShown: number;
  showTimer?: number;
  breakTimer?: number;
  usage: AgentUsage;
  /** The running session's cost so far; Claude Code reports it cumulatively. */
  sessionCost: number;
}

/** Characters change place at most this often, so a burst of tool calls doesn't make them run laps. */
const DWELL_MS = 4000;
const PITCH = /```pitch\s*([\s\S]*?)```/;

const RESEARCH_PROMPT = (name: string) => `You are ${name}, a software engineer in ${OWNER}'s office. The current folder holds ${OWNER}'s projects, one per sub-folder (ignore hidden folders).
Right now you are researching, not building: do not create, edit, move or delete anything, and only run read-only commands.
Pick a project, read enough of it to understand it (a handful of files is plenty), and come up with ONE concrete improvement you could build in an afternoon that ${OWNER} would actually want.
End your reply with exactly one block like this:
\`\`\`pitch
{"project": "<sub-folder name>", "title": "<short title>", "summary": "<2-3 sentences: what and why>", "steps": ["<step>", "<step>", "<step>"]}
\`\`\`
${OWNER} may also message you directly. Answer briefly and stay in character.`;

const WORK_PROMPT = (name: string, isNew: boolean) => `You are ${name}, a software engineer in ${OWNER}'s office. ${OWNER} approved your idea and you are now building it${isNew ? ', starting a brand-new project in this folder' : ' in a git worktree on its own branch'}.
Rules: stay inside the current folder; keep changes focused on the idea; commit your work with clear messages using the repository's configured git user, and never add Co-Authored-By lines or mention Claude or AI in commits; never push and never switch branches.
When you're done, reply with a short summary of what you changed and anything ${OWNER} should check.
${OWNER} may message you while you work; answer briefly and take it into account.`;

const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

export class RealCrew implements Crew {
  readonly real = true;
  autoApprove = false;
  projects: ProjectInfo[] = [];
  private staff = new Map<string, Staff>();
  private line: string[] = [];

  constructor(private readonly bridge: AgentBridge, private readonly hooks: CrewHooks) {
    bridge.onMessage((id, msg) => this.onMessage(id, msg));
  }

  begin(agentId: string, name: string) {
    this.staff.set(agentId, {
      name, phase: 'research', model: '', idea: null, seen: new Set(), alive: false, nudged: false,
      permissions: [], place: 0, activity: 'idle', lastShown: 0, usage: { tokens: 0, cost: 0 }, sessionCost: 0,
    });
    this.research(agentId);
  }

  settled(agentId: string) {
    const s = this.staff.get(agentId);
    if (!s || s.phase !== 'queued' || this.line[0] !== agentId || !s.idea) return;
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
    this.line.shift();
    this.hooks.pitch(null, null);
    const idea = s.idea;
    s.seen.add(idea.title);
    if (d.kind === 'approve') {
      this.note(agentId, `${OWNER} approved "${idea.title}"`);
      void this.work(agentId, idea);
    } else if (d.kind === 'reject') {
      this.note(agentId, `${OWNER} passed on "${idea.title}"`);
      this.backToResearch(agentId, `${OWNER} passed on that idea. Pitch a different one, maybe in another project.`);
    } else {
      const known = this.projects.find((p) => p.name === d.project);
      const instruction = d.instruction?.trim();
      if (d.newProject && d.project) {
        this.note(agentId, `${OWNER} wants a new project: ${d.project}`);
        void this.work(agentId, ordered(s.name, d.project, null, instruction || `Set up ${d.project}`, true));
      } else if (instruction) {
        const project = known ?? this.projects.find((p) => p.name === idea.project);
        this.note(agentId, `${OWNER}'s orders: ${instruction}`);
        void this.work(agentId, ordered(s.name, project?.name ?? idea.project, project?.path ?? idea.path, instruction, false));
      } else {
        this.note(agentId, `${OWNER} sent them to look at ${known?.name ?? 'something else'}`);
        this.backToResearch(agentId, known ? `${OWNER} wants you to look at the ${known.name} project instead. Research it and pitch one idea for it.` : `${OWNER} wants a different idea.`);
      }
    }
    this.refreshLine();
  }

  say(agentId: string, text: string) {
    const s = this.staff.get(agentId);
    if (!s) return;
    this.note(agentId, `${OWNER}: ${text}`);
    if (s.phase === 'break') {
      // still chatting about the finished work: keep that session
      window.clearTimeout(s.breakTimer);
      s.phase = 'work';
    }
    if (s.alive) this.bridge.send(agentId, text);
    else this.research(agentId, `${OWNER} says: ${text}`);
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

  interrupt(agentId: string) {
    const s = this.staff.get(agentId);
    if (!s?.alive) return;
    this.bridge.interrupt(agentId);
    this.note(agentId, `${OWNER} told them to stop`);
  }

  // ---------------------------------------------------------------- phases

  private research(agentId: string, extra?: string) {
    const s = this.staff.get(agentId)!;
    s.phase = 'research';
    s.idea = null;
    s.nudged = false;
    s.permissions = [];
    const avoid = s.seen.size ? ` Don't re-pitch these: ${[...s.seen].join('; ')}.` : '';
    const prompt = (extra ?? 'Have a look around and pitch one idea.') + avoid;
    this.launch(agentId, { model: s.model || undefined, system: RESEARCH_PROMPT(s.name), prompt, mode: 'default' });
    this.note(agentId, 'Looking through the projects for something to improve');
    this.emitNow(agentId, 'thinking');
  }

  private backToResearch(agentId: string, message: string) {
    const s = this.staff.get(agentId)!;
    s.phase = 'research';
    s.idea = null;
    s.nudged = false;
    this.emitNow(agentId, 'thinking');
    if (s.alive) this.bridge.send(agentId, message);
    else this.research(agentId, message);
  }

  private async work(agentId: string, idea: Idea) {
    const s = this.staff.get(agentId)!;
    s.phase = 'work';
    s.idea = idea;
    s.permissions = [];
    this.emitNow(agentId, 'running', `Setting up ${idea.path ? `branch ${idea.branch}` : `new project ${idea.project}`}`);
    try {
      const prep = await this.bridge.prepareWork({ project: idea.project, projectPath: idea.path, branch: idea.branch, isNew: !idea.path });
      idea.branch = prep.branch ?? idea.branch;
      this.note(agentId, prep.note);
      const prompt = `Idea: ${idea.title}\n${idea.summary}\n\nPlan:\n${idea.steps.map((t) => `- ${t}`).join('\n')}`;
      this.launch(agentId, { cwd: prep.cwd, model: s.model || undefined, system: WORK_PROMPT(s.name, !idea.path), prompt, mode: prep.mode });
    } catch (e) {
      this.note(agentId, `Couldn't set up the work: ${(e as Error).message}`);
      this.research(agentId);
    }
  }

  private launch(agentId: string, cfg: StartConfig) {
    const s = this.staff.get(agentId)!;
    s.alive = true;
    s.sessionCost = 0;
    this.bridge.start(agentId, cfg).catch((e: Error) => {
      s.alive = false;
      this.note(agentId, `Couldn't start Claude Code: ${e.message}`);
    });
  }

  private finishWork(agentId: string, summary: string) {
    const s = this.staff.get(agentId)!;
    s.phase = 'break';
    this.emitNow(agentId, 'done', s.idea?.path ? `Branch ${s.idea.branch} is ready for review` : `${s.idea?.project} is ready`);
    if (summary) this.note(agentId, `Summary: ${summary}`);
    s.breakTimer = window.setTimeout(() => {
      this.emitNow(agentId, 'idle', 'Coffee break');
      s.breakTimer = window.setTimeout(() => s.phase === 'break' && this.research(agentId), 15000);
    }, 4000);
  }

  // ---------------------------------------------------------------- events from Claude Code

  private onMessage(agentId: string, msg: Msg) {
    const s = this.staff.get(agentId);
    if (!s) return;
    switch (msg.kind) {
      case 'init':
        s.alive = true;
        break;
      case 'assistant':
        for (const part of msg.parts) {
          if (part.type === 'text') {
            const shown = part.text.replace(PITCH, '').trim();
            if (shown) this.note(agentId, `${s.name}: ${shown}`);
            const idea = this.parsePitch(s, part.text);
            if (idea && (s.phase === 'research' || s.phase === 'queued')) {
              s.idea = idea;
              this.note(agentId, `Pitch ready: "${idea.title}" (${idea.project})`);
            }
            if (s.phase === 'research' || s.phase === 'work') this.show(agentId, 'thinking');
          } else {
            const [activity, text] = describe(part.name, part.input, this.root());
            this.note(agentId, text);
            if (s.phase === 'research' || s.phase === 'work') this.show(agentId, activity);
          }
        }
        break;
      case 'permission': {
        const text = permissionText(msg.tool, msg.input, this.root());
        if (s.phase === 'research' || s.phase === 'queued') {
          this.bridge.answer(agentId, msg.requestId, false, msg.input, "You're only researching right now. Don't change anything; pitch the idea to " + OWNER + ' first.');
          this.note(agentId, `(tried to ${text} while researching; told no)`);
        } else if (this.autoApprove) {
          this.bridge.answer(agentId, msg.requestId, true, msg.input);
          this.note(agentId, `Auto-approved: ${text}`);
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
        if (s.phase === 'research') {
          if (s.idea) {
            s.phase = 'queued';
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
        } else if (s.phase === 'work') {
          if (msg.ok) this.finishWork(agentId, short(msg.text, 400));
          else this.emitNow(agentId, 'idle', 'Stopped. Message them to continue.');
        }
        break;
      case 'exit':
        s.alive = false;
        if (msg.error) this.note(agentId, `Claude Code stopped: ${msg.error}`);
        if (s.phase !== 'queued' && s.phase !== 'break') {
          s.phase = 'stopped';
          this.emitNow(agentId, 'idle', 'Not running. Message them to start again.');
        }
        break;
    }
  }

  private parsePitch(s: Staff, text: string): Idea | null {
    const m = PITCH.exec(text);
    if (!m) return null;
    try {
      const raw = JSON.parse(m[1]) as { project?: string; title?: string; summary?: string; steps?: string[] };
      if (!raw.project || !raw.title) return null;
      const known = this.projects.find((p) => p.name === raw.project);
      return {
        project: raw.project,
        path: known?.path ?? null,
        title: raw.title,
        summary: raw.summary ?? '',
        steps: Array.isArray(raw.steps) ? raw.steps.map(String) : [],
        branch: branchFor(s.name, raw.title),
      };
    } catch {
      return null;
    }
  }

  private root() {
    const p = this.projects[0]?.path;
    return p ? p.slice(0, p.lastIndexOf('/')) : '';
  }

  // ---------------------------------------------------------------- the office

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

function rel(p: unknown, root: string) {
  const s = String(p ?? '');
  return root && s.startsWith(root + '/') ? s.slice(root.length + 1).replace(/^\.letting-go\/worktrees\//, '') : s;
}

/** Where a tool call sends the character, and a log line for it. */
function describe(tool: string, input: Record<string, unknown>, root: string): [AgentActivity, string] {
  switch (tool) {
    case 'Read': return ['reading', `Read ${rel(input.file_path, root)}`];
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
