/**
 * What an agent is doing right now. This is the contract between whatever
 * drives the agents (the simulator today, real Claude agents later) and the office.
 */
export type AgentActivity =
  | 'idle' | 'thinking' | 'reading' | 'writing' | 'running' | 'awaiting' | 'talking' | 'done'
  /** Has an idea and is waiting for a turn in the owner's office. */
  | 'queued'
  /** In the owner's office, pitching an idea. */
  | 'pitching'
  /** On a team, at their desk waiting for the manager to hand them something. */
  | 'standby';

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
  /** Set when a team manager pitches for the whole team. */
  team?: string;
  /** The owner's own words, when the work is what they asked for rather than the agent's idea. */
  orders?: string;
  /** Pictures the owner pasted along with those words. */
  pictures?: Picture[];
}

/** The owner's answer to a pitch. */
export type Decision =
  | { kind: 'approve' }
  | { kind: 'reject' }
  /** Not that: do this instead. The agent works out the project from the text and starts right away. */
  | { kind: 'instead'; text: string; pictures?: Picture[] };

/** A picture pasted into a message, as base64. */
export interface Picture { mediaType: string; data: string }

export type Role = 'manager' | 'worker';

/** A group of agents: one manager who plans and merges, workers who each build a piece. */
export interface Team {
  id: string;
  name: string;
  manager: string;
  workers: string[];
  /** The owner's task for the team, if they gave one; otherwise the manager pitches. */
  task?: string;
}

/** A Claude Code-compatible command line the agents can run on. */
export interface EngineConfig {
  id: string;
  name: string;
  command: string;
  /** Extra environment, e.g. ANTHROPIC_BASE_URL for another LLM or CLAUDE_CONFIG_DIR for another account. */
  env: Record<string, string>;
  /** Models offered for this engine; id '' means the engine's own default. */
  models: { id: string; label: string }[];
}

export interface Settings {
  projectsRoot: string;
  engines: EngineConfig[];
  defaultEngine: string;
  defaultModel: string;
  /** 'auto': the engine's auto mode decides what's safe; 'ask': anything that changes files asks first. */
  approvals: 'auto' | 'ask';
  /** On closing with work in progress. */
  onClose: 'ask' | 'finish' | 'stop';
}

/** Where an agent is in its cycle, for the work board. */
export type Phase = 'research' | 'queued' | 'pitching' | 'work' | 'break' | 'standby' | 'home' | 'stopped' | 'held';

export interface AgentStatus {
  phase: Phase;
  /** When the current phase started (ms since epoch). */
  since: number;
  project: string | null;
  branch: string | null;
  engine: string;
}
