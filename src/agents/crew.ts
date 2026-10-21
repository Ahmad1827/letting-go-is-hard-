import type { AgentEvent, AgentStatus, Decision, Idea, Picture, ProjectInfo, Settings, Team } from './types';

/** One of the plan's usage windows, as Claude Code reports it. */
export interface UsageWindow { utilization: number; resetsAt: number }
/** The plan's usage windows (e.g. five_hour, seven_day) and when they were last reported. */
export interface Limits { status?: string; windows: Record<string, UsageWindow>; at: number }
/** What one agent has used so far: tokens, and what that would cost at API prices. */
export interface AgentUsage { tokens: number; cost: number }

/** What the office needs to hear from whoever runs the agents. */
export interface CrewHooks {
  emit(ev: AgentEvent): void;
  note(agentId: string, text: string): void;
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
  /** The character reached the place for its current activity. */
  settled(agentId: string): void;
  /** Answer a pending permission request. */
  resolve(agentId: string, approved: boolean): void;
  /** Answer the pitch currently in the office. */
  decide(agentId: string, d: Decision): void;
  /** A message from the owner, typed in the Properties panel. */
  say(agentId: string, text: string, pictures?: Picture[]): void;
  setModel(agentId: string, model: string): void;
  modelOf(agentId: string): string;
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
  approvals: 'auto',
  onClose: 'ask',
};

export const engineIn = (s: Settings, id: string) => s.engines.find((e) => e.id === id) ?? s.engines[0];

export const modelLabel = (s: Settings, engine: string, model: string) => engineIn(s, engine).models.find((m) => m.id === model)?.label ?? (model || 'default');

/** One-off id for a new team. */
export const teamId = () => `team-${Date.now().toString(36)}`;
