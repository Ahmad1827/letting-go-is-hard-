import type { AgentEvent, AgentStatus, Decision, Idea, Phase, Picture, ProjectInfo, Role, Settings, Team, TermLine } from './types';

/** One of the plan's usage windows, as Claude Code reports it. */
export interface UsageWindow { utilization: number; resetsAt: number }
/** The plan's usage windows (e.g. five_hour, seven_day) and when they were last reported. */
export interface Limits { status?: string; windows: Record<string, UsageWindow>; at: number }
/** What one agent has used so far: tokens, and what that would cost at API prices. */
export interface AgentUsage {
  tokens: number;
  cost: number;
  /** Of those tokens, how many the turn under way has used so far (partly estimated until it ends). */
  turn?: number;
}

/** One employee as remembered between runs. */
export interface StaffSave {
  id: string;
  name: string;
  engine: string;
  model: string;
  /** The skills picked for them; none if they were saved before skills existed. */
  skills?: string[];
  /** Comes up with ideas on their own when there's nothing to do. */
  ideas?: boolean;
  usage: AgentUsage;
  seen: string[];
  phase: Phase;
  idea: Idea | null;
  /** Where their approved work was happening, and the permission mode it ran in. */
  work: { cwd: string; mode: string } | null;
  /** Worker: their branch folder and the manager's task. */
  desk: unknown;
  assignment: string | null;
  /** Their Claude Code conversation, to pick back up ('' cwd is the projects folder). */
  session?: { id: string; cwd: string } | null;
  /** On hold: what they were doing when the owner paused them. */
  held?: Phase | null;
  /** The job they last finished and its conversation, to be asked about later. */
  last?: unknown;
  /** What the owner asked of them, while they were still working out the job. */
  orders?: string | null;
  /** Messages that came in while on hold. */
  inbox?: string[];
  /** Teammates' messages waiting for their next session. */
  mail?: string[];
}

/** A team as remembered, with its job if it had one going. */
export interface TeamSave extends Team { job?: unknown }

/** Everything the crew needs to pick up where it left off. */
export interface CrewSave { staff: StaffSave[]; teams: TeamSave[] }

/** What the office needs to hear from whoever runs the agents. */
export interface CrewHooks {
  emit(ev: AgentEvent): void;
  /** A line for the agent's log. It shows in their terminal too: as `line` if given, as a dim note if not, nowhere if null. */
  note(agentId: string, text: string, line?: TermLine | null): void;
  /** A line for the agent's terminal only. */
  term(agentId: string, line: TermLine): void;
  /** Something shown in the panels changed (e.g. the running token count). */
  changed(): void;
  /** What they're writing right now, shown at the bottom of their terminal as it grows; null once it's done. */
  live(agentId: string, text: string | null): void;
  /** The agent at the front of the line has reached the office (or null once it's decided). */
  pitch(agentId: string | null, idea: Idea | null): void;
  /** Everyone waiting to pitch, front of the line first. */
  queue(agentIds: string[]): void;
  /** Fresh numbers for the plan's usage windows. */
  limits(l: Limits): void;
  /** The teams changed. */
  teams(list: Team[]): void;
  /** Working in the background and everyone has finished. */
  allDone(): void;
}

/** The staff, simulated or real. The office drives both the same way. */
export interface Crew {
  readonly real: boolean;
  autoApprove: boolean;
  projects: ProjectInfo[];
  begin(agentId: string, name: string): void;
  /** What to remember about everyone, for next time. */
  snapshot(): CrewSave;
  /** Bring back the staff from last time; their characters are already at their desks. They get back to work once `ready` settles. */
  restore(save: CrewSave, ready?: Promise<unknown>): void;
  /** Let someone go for good: stop them, take them off their team and out of the line. */
  fire(agentId: string): void;
  /** Put someone on hold: they stop where they are, keeping their job, until reopened. */
  hold(agentId: string): void;
  /** Off hold: pick up exactly where they stopped. */
  unhold(agentId: string): void;
  /** The character reached the place for its current activity. */
  settled(agentId: string): void;
  /** Answer a pending permission request. */
  resolve(agentId: string, approved: boolean): void;
  /** Answer the questions they asked: the chosen option (or typed answer) for each question, by its text. */
  answer(agentId: string, answers: Record<string, string>): void;
  /** Answer someone's pitch: the one in the office, or anyone's waiting in line (from their terminal). */
  decide(agentId: string, d: Decision): void;
  /** A message from the owner, typed in the Properties panel. */
  say(agentId: string, text: string, pictures?: Picture[]): void;
  setModel(agentId: string, model: string): void;
  modelOf(agentId: string): string;
  /** Choose which installed skills this agent may use. */
  setSkills(agentId: string, skills: string[]): void;
  skillsOf(agentId: string): string[];
  /** Tick on: when free they look around and pitch ideas. Off: they sit idle until given something. */
  setIdeas(agentId: string, on: boolean): void;
  /** Null for simulated agents, which use nothing. */
  usageOf(agentId: string): AgentUsage | null;
  setEngine(agentId: string, engine: string): void;
  statusOf(agentId: string): AgentStatus;
  /** Settings from the Settings window: engines, defaults, approvals. */
  settings: Settings;
  /** Agents in the middle of an approved job. */
  workingCount(): number;
  /** The window is hidden: finish current jobs, start nothing new (true), or carry on as normal (false). */
  setBackground(on: boolean): void;
  /** Stop whatever the agent is doing right now. */
  interrupt(agentId: string): void;
  /** Group agents under a manager. With a task they start on it; without one the manager pitches. */
  createTeam(team: Omit<Team, 'id'>, pictures?: Picture[]): void;
  /** Everyone goes back to working on their own. */
  disbandTeam(teamId: string): void;
  /** Put someone on a team: as a worker, or as its manager (the old manager becomes a worker). */
  joinTeam(agentId: string, teamId: string, role: Role): void;
  /** Back to working on their own. A manager leaving breaks the team up. */
  leaveTeam(agentId: string): void;
  /** A message from the owner to everyone on a team; the manager decides what happens next. */
  sayTeam(teamId: string, text: string, pictures?: Picture[]): void;
}

/** Claude Code's models, for the built-in engine. */
export const CLAUDE_MODELS = [
  { id: '', label: 'Claude Code default' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

/** What a plain browser gets: the built-in engine and nothing else (the desktop app loads the real settings). */
export const DEFAULT_SETTINGS: Settings = {
  projectsRoot: '~/proiecte',
  engines: [{ id: 'claude-code', name: 'Claude Code', command: 'claude', env: {}, models: CLAUDE_MODELS }],
  defaultEngine: 'claude-code',
  defaultModel: '',
  defaultSkills: [],
  approvals: 'auto',
  pitchAfterMin: 5,
  pitchModel: 'claude-haiku-5-5',
  onClose: 'ask',
};

export const engineIn = (s: Settings, id: string) => s.engines.find((e) => e.id === id) ?? s.engines[0];

export const modelLabel = (s: Settings, engine: string, model: string) => engineIn(s, engine).models.find((m) => m.id === model)?.label ?? (model || 'default');

/** One-off id for a new team. */
export const teamId = () => `team-${Date.now().toString(36)}`;
