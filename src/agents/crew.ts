import type { AgentEvent, Decision, Idea, Picture, ProjectInfo, Team } from './types';

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
  /** Stop whatever the agent is doing right now. */
  interrupt(agentId: string): void;
  /** Group agents under a manager. With a task they start on it; without one the manager pitches. */
  createTeam(team: Omit<Team, 'id'>, pictures?: Picture[]): void;
  /** Everyone goes back to working on their own. */
  disbandTeam(teamId: string): void;
}

/** Model choices offered in the Properties panel; '' leaves it to Claude Code's default. */
export const MODELS: [string, string][] = [
  ['', 'Claude Code default'],
  ['claude-fable-5-1', 'Fable 5.1'],
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-opus-5', 'Opus 5'],
  ['claude-opus-4-8', 'Opus 4.8'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-haiku-5-5', 'Haiku 5.5'],
  ['claude-haiku-4-5', 'Haiku 4.5'],
];

export const modelName = (id: string) => MODELS.find(([m]) => m === id)?.[1] ?? id;

/** One-off id for a new team. */
export const teamId = () => `team-${Date.now().toString(36)}`;
