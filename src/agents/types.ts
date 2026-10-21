/**
 * What an agent is doing right now. This is the contract between whatever
 * drives the agents (the simulator today, real Claude agents later) and the office.
 */
export type AgentActivity =
  | 'idle' | 'thinking' | 'reading' | 'writing' | 'running' | 'awaiting' | 'talking' | 'done'
  /** Has an idea and is waiting for a turn in the owner's office. */
  | 'queued'
  /** In the owner's office, pitching an idea. */
  | 'pitching';

export interface AgentEvent {
  agentId: string;
  activity: AgentActivity;
  /** One line for the log, e.g. "Read src/login.ts" or "$ npm test". */
  detail?: string;
  /** The task the agent is working on. */
  task?: string;
  /** For 'queued': place in line, 1 = next to go in. */
  queue?: number;
}

/** A folder in the projects root, as the machine described it. */
export interface ProjectInfo {
  name: string;
  path: string;
  languages: string[];
  files: number;
  /** Largest source file, relative to the project. */
  biggest: string | null;
  hasTests: boolean;
  hasReadme: boolean;
  /** First meaningful line of the README. */
  readme: string | null;
  isGit: boolean;
  lastCommit: string | null;
  hasCi: boolean;
}

/** What an agent brings to the owner's office. */
export interface Idea {
  project: string;
  /** Absolute folder, or null for a project that doesn't exist yet. */
  path: string | null;
  title: string;
  summary: string;
  steps: string[];
  /** The git branch the work will happen on. */
  branch: string;
}

/** The owner's answer to a pitch. */
export type Decision =
  | { kind: 'approve' }
  | { kind: 'reject' }
  /** Go work on something else: an existing project, a brand new one, and/or a specific instruction. */
  | { kind: 'redirect'; project: string | null; newProject?: boolean; instruction?: string };
