import type { AgentEvent, Decision, Idea, ProjectInfo } from './types';

/** What the office needs to hear from whoever runs the agents. */
export interface CrewHooks {
  emit(ev: AgentEvent): void;
  note(agentId: string, text: string): void;
  /** The agent at the front of the line has reached the office (or null once it's decided). */
  pitch(agentId: string | null, idea: Idea | null): void;
  /** Everyone waiting to pitch, front of the line first. */
  queue(agentIds: string[]): void;
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
  say(agentId: string, text: string): void;
  setModel(agentId: string, model: string): void;
  modelOf(agentId: string): string;
  /** Stop whatever the agent is doing right now. */
  interrupt(agentId: string): void;
}

/** Model choices offered in the Properties panel; '' leaves it to Claude Code's default. */
export const MODELS: [string, string][] = [['', 'Default'], ['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']];
