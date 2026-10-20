/**
 * What an agent is doing right now. This is the contract between whatever
 * drives the agents (the simulator today, real Claude agents later) and the office.
 */
export type AgentActivity = 'idle' | 'thinking' | 'reading' | 'writing' | 'running' | 'awaiting' | 'talking' | 'done';

export interface AgentEvent {
  agentId: string;
  activity: AgentActivity;
  /** One line for the log, e.g. "Read src/login.ts" or "$ npm test". */
  detail?: string;
  /** The task the agent is working on. */
  task?: string;
}
