import Phaser from 'phaser';
import { OWNER } from '../owner';
import type { Crew, CrewHooks } from './crew';
import { ideaFor, ordered } from './ideas';
import type { AgentActivity, Decision, Idea, ProjectInfo } from './types';

/**
 * Fake agents: they produce the same AgentEvents a real agent run will, so the
 * office and the pitch flow can be built before any model is wired in.
 *
 * Each agent loops: research a project -> queue for the owner's office -> pitch
 * -> (approved) work on a branch -> break -> research again.
 */

interface Step {
  activity: AgentActivity;
  min: number;
  max: number;
  detail: string;
  /** Runs when the step starts. */
  enter?: () => void;
}

interface Run {
  name: string;
  steps: Step[];
  i: number;
  settled: boolean;
  timer?: Phaser.Time.TimerEvent;
  idea: Idea | null;
  /** Titles already pitched, so rejected ideas don't come straight back. */
  seen: Set<string>;
  /** Place in line last announced to the office. */
  place: number;
}

const RISKY = (idea: Idea) => [`git push origin ${idea.branch}`, 'rm -rf build/', 'npm install --save-dev vitest', 'git rebase main'];

export class Sim implements Crew {
  readonly real = false;
  autoApprove = false;
  projects: ProjectInfo[] = [];
  private runs = new Map<string, Run>();
  private line: string[] = [];
  private models = new Map<string, string>();

  constructor(private readonly clock: Phaser.Time.Clock, private readonly hooks: CrewHooks) {}

  say(agentId: string, text: string) {
    this.note(agentId, `${OWNER}: ${text}`);
    this.clock.delayedCall(800, () => this.note(agentId, "(Simulated agents can't chat. Open the desktop app for real ones.)"));
  }

  setModel(agentId: string, model: string) {
    this.models.set(agentId, model);
  }

  modelOf(agentId: string) {
    return this.models.get(agentId) ?? '';
  }

  usageOf() {
    return null;
  }

  interrupt() {}

  begin(agentId: string, name: string) {
    this.runs.set(agentId, { name, steps: [], i: -1, settled: false, idea: null, seen: new Set(), place: 0 });
    this.research(agentId);
  }

  /** The office reports the agent reached the place for its current step; the step's clock starts now. */
  settled(agentId: string) {
    const run = this.runs.get(agentId);
    if (!run || run.settled) return;
    run.settled = true;
    const step = run.steps[run.i];
    if (!step || step.activity === 'awaiting' || step.activity === 'queued') return; // wait for the owner
    if (step.activity === 'pitching') {
      this.hooks.pitch(agentId, run.idea);
      if (this.autoApprove) this.clock.delayedCall(1500, () => this.decide(agentId, { kind: 'approve' }));
      return;
    }
    const secs = step.min + Math.random() * (step.max - step.min);
    run.timer = this.clock.delayedCall(secs * 1000, () => this.advance(agentId));
  }

  /** A risky command was approved or denied. */
  resolve(agentId: string, approved: boolean) {
    const run = this.runs.get(agentId);
    if (!run || run.steps[run.i]?.activity !== 'awaiting') return;
    if (approved) this.note(agentId, 'Approved');
    else {
      this.note(agentId, 'Denied, finding another way');
      run.steps.splice(run.i + 1, 0, { activity: 'thinking', min: 3, max: 4, detail: 'Rethinking the approach' });
    }
    this.advance(agentId);
  }

  /** The owner's answer to the pitch currently in the office. */
  decide(agentId: string, d: Decision) {
    const run = this.runs.get(agentId);
    if (!run || this.line[0] !== agentId || !run.idea) return;
    this.line.shift();
    this.hooks.pitch(null, null);
    const idea = run.idea;
    run.seen.add(idea.title);
    if (d.kind === 'approve') {
      this.note(agentId, `${OWNER} approved "${idea.title}"`);
      this.work(agentId, idea);
    } else if (d.kind === 'reject') {
      this.note(agentId, `${OWNER} passed on "${idea.title}"`);
      this.research(agentId);
    } else {
      const known = this.projects.find((p) => p.name === d.project);
      const instruction = d.instruction?.trim();
      if (d.newProject && d.project) {
        this.note(agentId, `${OWNER} wants a new project: ${d.project}`);
        this.work(agentId, ordered(run.name, d.project, null, instruction || `Set up ${d.project}`, true));
      } else if (instruction) {
        const project = known ?? this.projects.find((p) => p.name === idea.project);
        this.note(agentId, `${OWNER}'s orders: ${instruction}`);
        this.work(agentId, ordered(run.name, project?.name ?? idea.project, project?.path ?? idea.path, instruction, false));
      } else {
        this.note(agentId, `${OWNER} sent them to look at ${known?.name ?? 'something else'}`);
        this.research(agentId, known);
      }
    }
    this.refreshLine();
  }

  // ---------------------------------------------------------------- phases

  private research(agentId: string, focus?: ProjectInfo) {
    const run = this.runs.get(agentId)!;
    const project = focus ?? this.projects[Math.floor(Math.random() * this.projects.length)];
    if (!project) {
      this.start(agentId, [{ activity: 'idle', min: 8, max: 12, detail: 'No projects found to look at' }], () => this.research(agentId));
      return;
    }
    const steps: Step[] = [
      { activity: 'thinking', min: 3, max: 5, detail: focus ? `Studying ${project.name}` : 'Looking through the projects for something to improve' },
      { activity: 'reading', min: 3, max: 5, detail: `Read ${project.name}/${project.hasReadme ? 'README' : '(file list)'}` },
    ];
    if (project.biggest) steps.push({ activity: 'reading', min: 2, max: 4, detail: `Read ${project.name}/${project.biggest}` });
    steps.push(
      { activity: 'thinking', min: 3, max: 4, detail: `Drafting a pitch for ${project.name}`, enter: () => (run.idea = ideaFor(run.name, project, run.seen)) },
      { activity: 'queued', min: 0, max: 0, detail: '', enter: () => this.line.push(agentId) },
    );
    this.start(agentId, steps);
  }

  private work(agentId: string, idea: Idea) {
    const run = this.runs.get(agentId)!;
    run.idea = idea;
    const where = idea.path ? idea.project : `new project ${idea.project}`;
    const steps: Step[] = [
      { activity: 'running', min: 2, max: 3, detail: idea.path ? `$ git switch -c ${idea.branch}` : `$ mkdir ${idea.project} && git init` },
      { activity: 'reading', min: 3, max: 5, detail: `Read ${where}: ${idea.steps[0]}` },
      { activity: 'writing', min: 5, max: 8, detail: `Edit ${where}: ${idea.steps[1] ?? idea.title}` },
      { activity: 'running', min: 3, max: 5, detail: '$ build' },
    ];
    if (Math.random() < 0.6) {
      const risky = RISKY(idea);
      steps.push({ activity: 'awaiting', min: 0, max: 0, detail: `$ ${risky[Math.floor(Math.random() * risky.length)]}` });
    }
    steps.push({ activity: 'writing', min: 3, max: 6, detail: `Edit ${where}: ${idea.steps[2] ?? 'finishing touches'}` });
    if (Math.random() < 0.5) steps.push({ activity: 'talking', min: 3, max: 4, detail: 'Asking a colleague to review' });
    steps.push(
      { activity: 'running', min: 2, max: 4, detail: '$ run the checks' },
      { activity: 'done', min: 2, max: 2, detail: `Branch ${idea.branch} is ready for review` },
      { activity: 'idle', min: 6, max: 10, detail: 'Coffee break' },
    );
    this.start(agentId, steps, () => this.research(agentId));
  }

  // ---------------------------------------------------------------- plumbing

  private next = new Map<string, () => void>();

  private start(agentId: string, steps: Step[], after?: () => void) {
    const run = this.runs.get(agentId)!;
    run.timer?.remove();
    run.steps = steps;
    run.i = -1;
    if (after) this.next.set(agentId, after);
    else this.next.delete(agentId);
    this.advance(agentId);
  }

  private advance(agentId: string): void {
    const run = this.runs.get(agentId);
    if (!run) return;
    run.timer?.remove();
    run.i++;
    if (run.i >= run.steps.length) return this.next.get(agentId)?.();
    const step = run.steps[run.i];
    step.enter?.();
    if (step.activity === 'awaiting' && this.autoApprove) {
      this.note(agentId, `Auto-approved ${step.detail}`);
      return this.advance(agentId);
    }
    run.settled = false;
    if (step.activity === 'queued') {
      run.place = 0;
      this.note(agentId, `Has an idea for ${run.idea?.project}, waiting to see ${OWNER}`);
      this.refreshLine();
      return;
    }
    this.hooks.emit({ agentId, activity: step.activity, detail: step.detail, task: run.idea?.title });
  }

  /** Move everyone in line up a place; the one at the front walks into the office. */
  private refreshLine() {
    this.line.forEach((id, idx) => {
      const run = this.runs.get(id)!;
      if (run.place === idx + 1) return;
      run.place = idx + 1;
      run.settled = false;
      if (idx === 0) {
        run.steps[run.i] = { activity: 'pitching', min: 0, max: 0, detail: '' };
        this.hooks.emit({ agentId: id, activity: 'pitching', detail: `Pitching "${run.idea?.title}"`, task: run.idea?.title });
      } else this.hooks.emit({ agentId: id, activity: 'queued', queue: idx, task: run.idea?.title });
    });
    this.hooks.queue([...this.line]);
  }

  private note(agentId: string, text: string) {
    this.hooks.note(agentId, text);
  }
}
