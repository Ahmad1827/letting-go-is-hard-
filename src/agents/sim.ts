import Phaser from 'phaser';
import type { AgentActivity, AgentEvent } from './types';

/**
 * Fake agents for step 1: produces the same AgentEvents a real agent run will,
 * so the office can be built and tuned before any model is wired in.
 */

interface Task { title: string; files: [string, string]; build: string; test: string; risky: string }

const TASKS: Task[] = [
  { title: 'Fix Y2K date rollover in billing', files: ['billing/dates.c', 'billing/invoice.c'], build: 'make billing', test: 'make test-y2k', risky: 'rm -rf build/' },
  { title: 'Add CSV export to quarterly report', files: ['reports/quarterly.pl', 'lib/Csv.pm'], build: 'perl -c reports/quarterly.pl', test: 'prove t/reports', risky: 'scp report.csv mainframe:/exports' },
  { title: 'Port intranet homepage to HTML 3.2', files: ['www/index.html', 'www/nav.html'], build: 'weblint www/', test: 'lynx -dump intranet/', risky: 'ftp put www/ intranet:/' },
  { title: 'Speed up dial-up sync', files: ['sync/modem.c', 'sync/queue.c'], build: 'make sync', test: './sync --dry-run', risky: 'kill -9 syncd' },
  { title: 'Write tests for payroll module', files: ['payroll/CALC.cob', 'payroll/TESTCALC.cob'], build: 'cobc payroll/CALC.cob', test: './run_tests payroll', risky: 'db2 update payroll.rates' },
  { title: 'Refactor the fax gateway', files: ['fax/gateway.cpp', 'fax/queue.h'], build: 'nmake fax', test: 'faxtest --loopback', risky: 'net stop faxsvc' },
  { title: 'Document the mainframe API', files: ['docs/mainframe.txt', 'api/cics.h'], build: 'grep -r CICS api/', test: 'spell docs/mainframe.txt', risky: 'cvs commit -m "docs"' },
  { title: 'Patch the Netscape login form', files: ['cgi-bin/login.cgi', 'www/login.html'], build: 'perl -wc cgi-bin/login.cgi', test: 'lynx -dump localhost/login', risky: 'chmod 755 cgi-bin/' },
];

interface Step { activity: AgentActivity; min: number; max: number; detail: string }

function plan(t: Task): Step[] {
  const steps: Step[] = [
    { activity: 'thinking', min: 3, max: 5, detail: `Planning: ${t.title}` },
    { activity: 'reading', min: 3, max: 5, detail: `Read ${t.files[0]}` },
  ];
  if (Math.random() < 0.5) steps.push({ activity: 'reading', min: 2, max: 4, detail: `Read ${t.files[1]}` });
  steps.push(
    { activity: 'writing', min: 5, max: 8, detail: `Edit ${t.files[0]}` },
    { activity: 'running', min: 3, max: 5, detail: `$ ${t.build}` },
  );
  if (Math.random() < 0.6) steps.push({ activity: 'awaiting', min: 0, max: 0, detail: `$ ${t.risky}` });
  steps.push({ activity: 'writing', min: 3, max: 6, detail: `Edit ${t.files[1]}` });
  if (Math.random() < 0.5) steps.push({ activity: 'talking', min: 3, max: 4, detail: 'Asking a colleague to review' });
  steps.push(
    { activity: 'running', min: 2, max: 4, detail: `$ ${t.test}` },
    { activity: 'done', min: 2, max: 2, detail: `Shipped: ${t.title}` },
    { activity: 'idle', min: 6, max: 10, detail: 'Coffee break' },
  );
  return steps;
}

interface Run { task: Task; steps: Step[]; i: number; settled: boolean; timer?: Phaser.Time.TimerEvent }

export class Sim {
  autoApprove = false;
  private runs = new Map<string, Run>();

  constructor(
    private readonly clock: Phaser.Time.Clock,
    private readonly emit: (ev: AgentEvent) => void,
    private readonly note: (agentId: string, text: string) => void,
  ) {}

  begin(agentId: string) {
    this.assign(agentId);
  }

  /** The office reports the agent reached the place for its current step; the step's clock starts now. */
  settled(agentId: string) {
    const run = this.runs.get(agentId);
    if (!run || run.settled) return;
    run.settled = true;
    const step = run.steps[run.i];
    if (step.activity === 'awaiting') return; // waits for resolve()
    const secs = step.min + Math.random() * (step.max - step.min);
    run.timer = this.clock.delayedCall(secs * 1000, () => this.advance(agentId));
  }

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

  private assign(agentId: string): void {
    const task = TASKS[Math.floor(Math.random() * TASKS.length)];
    this.runs.set(agentId, { task, steps: plan(task), i: -1, settled: false });
    this.note(agentId, `New task: ${task.title}`);
    this.advance(agentId);
  }

  private advance(agentId: string): void {
    const run = this.runs.get(agentId);
    if (!run) return;
    run.timer?.remove();
    run.i++;
    if (run.i >= run.steps.length) return this.assign(agentId);
    const step = run.steps[run.i];
    if (step.activity === 'awaiting' && this.autoApprove) {
      this.note(agentId, `Auto-approved ${step.detail}`);
      return this.advance(agentId);
    }
    run.settled = false;
    this.emit({ agentId, activity: step.activity, detail: step.detail, task: run.task.title });
  }
}
