import { bus } from '../bus';
import { MODELS, type AgentUsage, type Limits } from '../agents/crew';
import type { AgentActivity, Decision, Idea, ProjectInfo } from '../agents/types';
import { OWNER } from '../owner';

export interface AgentView {
  id: string;
  name: string;
  activity: AgentActivity;
  detail: string;
  task: string;
  avatar: string;
  log: string[];
  model: string;
  /** A real Claude Code session rather than a simulated one. */
  real: boolean;
  usage: AgentUsage | null;
}

export interface ApprovalView { id: string; name: string; detail: string }

export interface PitchView { id: string; name: string; avatar: string; idea: Idea }

const LABEL: Record<AgentActivity, string> = {
  idle: 'On break',
  thinking: 'Thinking',
  reading: 'Reading files',
  writing: 'Writing code',
  running: 'Running commands',
  awaiting: 'Needs your OK',
  talking: 'Talking',
  done: 'Shipping',
  queued: 'Waiting to pitch',
  pitching: 'Pitching an idea',
};

const DOT: Record<AgentActivity, string> = {
  idle: '#808080',
  thinking: '#8e5cc4',
  reading: '#3b6fc2',
  writing: '#2e9d4a',
  running: '#e08a1e',
  awaiting: '#d32f2f',
  talking: '#1fa3a3',
  done: '#c9a227',
  queued: '#b0703a',
  pitching: '#f0b020',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const byId = (id: string) => document.getElementById(id)!;

let audio: AudioContext | null = null;

/** Elevator ding, played from the Hire click so the browser allows audio. */
function ding() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    for (const [freq, delay] of [[1318.5, 0], [1046.5, 0.2]]) {
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.12, t + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.7);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.75);
    }
  } catch {
    // no audio, no ding
  }
}

/** The owner's office panel: the pitch on the table, the decision buttons, and who's waiting outside. */
function initOffice() {
  const box = byId('pitch');
  const waiting = byId('waiting');
  let pitch: PitchView | null = null;
  let projects: ProjectInfo[] = [];
  byId('office-title').textContent = `${OWNER}'s Office`;

  const decide = (decision: Decision) => pitch && bus.emit('pitch:decide', { id: pitch.id, decision });

  const redirectForm = (p: PitchView) => {
    const form = el('form', 'redirect');
    const select = el('select');
    for (const proj of projects) {
      const o = el('option', undefined, proj.name);
      o.value = proj.name;
      o.selected = proj.name === p.idea.project;
      select.append(o);
    }
    const fresh = el('option', undefined, '(new project...)');
    fresh.value = '';
    select.append(fresh);
    const name = el('input');
    name.placeholder = 'new-project-name';
    name.hidden = true;
    select.onchange = () => (name.hidden = select.value !== '');
    const text = el('textarea');
    text.rows = 3;
    text.placeholder = 'What should they do? Leave empty to let them find their own idea there.';
    const send = el('button', undefined, 'Send');
    send.type = 'submit';
    const cancel = el('button', undefined, 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => render();
    form.onsubmit = (e) => {
      e.preventDefault();
      const isNew = select.value === '';
      const project = isNew ? name.value.trim().replace(/\s+/g, '-') : select.value;
      if (isNew && !project) return name.focus();
      decide({ kind: 'redirect', project, newProject: isNew, instruction: text.value.trim() || undefined });
    };
    const row = el('div', 'buttons');
    row.append(send, cancel);
    form.append(el('label', undefined, 'Project'), select, name, el('label', undefined, 'Instructions'), text, row);
    return form;
  };

  const render = () => {
    if (!pitch) {
      box.replaceChildren(el('p', 'hint', `Nobody in ${OWNER}'s office right now.`));
      return;
    }
    const p = pitch;
    const who = el('div', 'who small');
    const img = el('img');
    img.src = p.avatar;
    img.alt = p.name;
    const info = el('div');
    info.append(el('b', undefined, `${p.name} has an idea`), el('div', 'task', p.idea.path ? p.idea.project : `${p.idea.project} (new)`));
    who.append(img, info);
    const steps = el('ol', 'steps');
    steps.append(...p.idea.steps.map((t) => el('li', undefined, t)));
    const buttons = el('div', 'buttons');
    const yes = el('button', undefined, 'Approve');
    const no = el('button', undefined, 'Pass');
    const other = el('button', undefined, 'Redirect...');
    yes.onclick = () => decide({ kind: 'approve' });
    no.onclick = () => decide({ kind: 'reject' });
    buttons.append(yes, no, other);
    const card = el('div', 'card');
    card.append(who, el('h4', undefined, p.idea.title), el('p', undefined, p.idea.summary), steps, el('code', undefined, p.idea.branch), buttons);
    other.onclick = () => buttons.replaceWith(redirectForm(p));
    box.replaceChildren(card);
  };

  bus.on('pitch', (view: PitchView | null) => {
    pitch = view;
    render();
  });
  bus.on('projects', (list: ProjectInfo[]) => (projects = list));
  bus.on('queue', (names: string[]) => {
    const outside = names.slice(1); // the first in line is in the office or on the way in
    waiting.textContent = outside.length ? `Waiting: ${outside.join(', ')}` : 'Nobody waiting.';
  });
  render();
}

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : `${n}`);
const dollars = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;

const WINDOW_NAMES: Record<string, string> = {
  five_hour: '5-hour', seven_day: 'Week', seven_day_opus: 'Week (Opus)', seven_day_sonnet: 'Week (Sonnet)', seven_day_fable: 'Week (Fable)',
};

function resetsAt(unix: number) {
  const d = new Date(unix * 1000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function meter(fraction: number) {
  const bar = el('span', 'meter');
  const fill = el('span');
  const pct = Math.max(0, Math.min(1, fraction));
  fill.style.width = `${pct * 100}%`;
  fill.style.background = pct < 0.6 ? '#2e9d4a' : pct < 0.85 ? '#d8a020' : '#d32f2f';
  bar.append(fill);
  return bar;
}

/**
 * Usage: the plan's windows as Claude Code reports them (5-hour, weekly), plus
 * tokens per agent this session. Lives in the taskbar; click it for details.
 */
function initUsage() {
  const tray = byId('usage');
  const pop = byId('usage-pop');
  const body = byId('usage-body');
  const KEY = 'lgih.limits';
  let limits: Limits | null = null;
  let real = false;
  let staff: AgentView[] = [];
  try {
    limits = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    // no saved numbers, they'll arrive with the first agent turn
  }

  const windows = () => Object.entries(limits?.windows ?? {}).sort(([a], [b]) => (a === 'five_hour' ? -1 : b === 'five_hour' ? 1 : a.localeCompare(b)));

  const renderTray = () => {
    const ws = windows().slice(0, 2);
    if (!ws.length) {
      tray.replaceChildren('Usage');
      return;
    }
    tray.replaceChildren(...ws.flatMap(([k, w]) => [el('span', 'tray-label', WINDOW_NAMES[k] ?? k), meter(w.utilization), el('span', 'tray-pct', `${Math.round(w.utilization * 100)}%`)]));
  };

  const renderPop = () => {
    if (pop.hidden) return;
    const parts: HTMLElement[] = [];
    parts.push(el('b', undefined, 'Your Claude plan'));
    if (windows().length) {
      const table = el('table', 'usage-table');
      for (const [k, w] of windows()) {
        const tr = el('tr');
        const bar = el('td');
        bar.append(meter(w.utilization));
        tr.append(el('td', undefined, WINDOW_NAMES[k] ?? k), bar, el('td', undefined, `${Math.round(w.utilization * 100)}%`), el('td', 'hint', `resets ${resetsAt(w.resetsAt)}`));
        table.append(tr);
      }
      parts.push(table);
      const age = Math.round((Date.now() - limits!.at) / 60000);
      parts.push(el('p', 'hint', `As reported by Claude Code ${age < 1 ? 'just now' : `${age} min ago`}${limits!.status && limits!.status !== 'allowed' ? `, status: ${limits!.status}` : ''}.`));
    } else parts.push(el('p', 'hint', real ? 'No numbers yet. They show up once an agent starts working.' : 'Simulated agents don’t use your plan.'));

    const used = staff.filter((a) => a.usage);
    parts.push(el('b', undefined, 'This session'));
    if (used.length) {
      const table = el('table', 'usage-table');
      const head = el('tr');
      head.append(el('th', undefined, 'Agent'), el('th', undefined, 'Tokens'), el('th', undefined, 'API price'));
      table.append(head);
      let t = 0, c = 0;
      for (const a of used) {
        const tr = el('tr');
        tr.append(el('td', undefined, a.name), el('td', undefined, tokens(a.usage!.tokens)), el('td', undefined, dollars(a.usage!.cost)));
        table.append(tr);
        t += a.usage!.tokens;
        c += a.usage!.cost;
      }
      const total = el('tr', 'total');
      total.append(el('td', undefined, 'Total'), el('td', undefined, tokens(t)), el('td', undefined, dollars(c)));
      table.append(total);
      parts.push(table, el('p', 'hint', 'API price is what these tokens would cost on the API. Your plan covers them; the windows above are what count.'));
    } else parts.push(el('p', 'hint', 'Nobody has used anything yet.'));
    body.replaceChildren(...parts);
  };

  tray.onclick = () => {
    pop.hidden = !pop.hidden;
    renderPop();
  };
  byId('usage-close').onclick = () => (pop.hidden = true);
  bus.on('usage:limits', (l: Limits) => {
    limits = l;
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
    } catch {
      // storage unavailable: fine, it just won't be remembered
    }
    renderTray();
    renderPop();
  });
  bus.on('crew', (isReal: boolean) => {
    real = isReal;
    renderPop();
  });
  bus.on('agents', (views: AgentView[]) => {
    staff = views;
    renderPop();
  });
  renderTray();
}

export function initHud() {
  initOffice();
  initUsage();
  const list = byId('agent-list');
  const requests = byId('requests');
  const inspect = byId('inspect');
  const shipped = byId('shipped');
  const hire = byId('hire') as HTMLButtonElement;
  const auto = byId('auto') as HTMLInputElement;
  const clock = byId('clock');

  let agents: AgentView[] = [];
  let approvals: ApprovalView[] = [];
  let selected: string | null = null;

  const decision = (id: string) => {
    const row = el('div', 'buttons');
    const yes = el('button', undefined, 'Approve');
    const no = el('button', undefined, 'Deny');
    yes.onclick = () => bus.emit('approval:resolve', { id, ok: true });
    no.onclick = () => bus.emit('approval:resolve', { id, ok: false });
    row.append(yes, no);
    return row;
  };

  const renderList = () => {
    if (!agents.length) {
      list.replaceChildren(el('li', 'empty', 'Nobody in yet...'));
      return;
    }
    list.replaceChildren(
      ...agents.map((a) => {
        const li = el('li', a.id === selected ? 'sel' : undefined);
        const dot = el('span', 'dot');
        dot.style.background = DOT[a.activity];
        li.append(dot, el('b', undefined, a.name), el('span', 'status', LABEL[a.activity]));
        li.onclick = () => {
          bus.emit('select', a.id);
          bus.emit('focus', a.id);
        };
        return li;
      }),
    );
  };

  const renderRequests = () => {
    if (!approvals.length) {
      requests.replaceChildren(el('li', 'empty', 'No pending requests.'));
      return;
    }
    requests.replaceChildren(
      ...approvals.map((p) => {
        const li = el('li');
        li.append(el('b', undefined, `${p.name} wants to run`), el('code', undefined, p.detail.replace(/^\$ /, '')), decision(p.id));
        return li;
      }),
    );
  };

  /** Built once per selected agent, then updated in place so typing isn't wiped by refreshes. */
  let panel: { id: string; status: HTMLElement; task: HTMLElement; usage: HTMLElement; decision: HTMLElement; log: HTMLElement; model: HTMLSelectElement; shown: string } | null = null;

  const buildInspect = (a: AgentView) => {
    const who = el('div', 'who');
    const img = el('img');
    img.src = a.avatar;
    img.alt = a.name;
    const info = el('div');
    const status = el('div');
    const task = el('div', 'task');
    const usage = el('div', 'hint');
    info.append(el('b', undefined, a.name), status, task, usage);
    who.append(img, info);

    const controls = el('div', 'row controls');
    const model = el('select');
    for (const [value, label] of MODELS) {
      const o = el('option', undefined, label);
      o.value = value;
      model.append(o);
    }
    model.value = a.model;
    model.onchange = () => bus.emit('agent:model', { id: a.id, model: model.value });
    const stop = el('button', undefined, 'Stop');
    stop.title = 'Interrupt what they are doing right now';
    stop.onclick = () => bus.emit('agent:stop', a.id);
    const label = el('label', 'check', 'Model ');
    label.append(model);
    controls.append(label, stop);

    const decisionSlot = el('div');
    const log = el('pre', 'log');
    const chat = el('form', 'chat');
    const input = el('input');
    input.placeholder = `Message ${a.name}...`;
    const send = el('button', undefined, 'Send');
    send.type = 'submit';
    chat.append(input, send);
    chat.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      bus.emit('agent:say', { id: a.id, text });
      input.value = '';
    };
    inspect.replaceChildren(who, controls, decisionSlot, log, chat);
    panel = { id: a.id, status, task, usage, decision: decisionSlot, log, model, shown: '' };
  };

  const renderInspect = () => {
    const a = agents.find((x) => x.id === selected);
    if (!a) {
      panel = null;
      inspect.replaceChildren(el('p', 'hint', 'Click an employee to see what they are up to.'));
      return;
    }
    if (panel?.id !== a.id) buildInspect(a);
    const p = panel!;
    p.status.textContent = LABEL[a.activity];
    p.task.textContent = a.task || '—';
    p.usage.textContent = a.usage ? `${tokens(a.usage.tokens)} tokens · ${dollars(a.usage.cost)} at API prices` : '';
    if (document.activeElement !== p.model) p.model.value = a.model;
    const waiting = approvals.some((x) => x.id === a.id);
    if (waiting !== !!p.decision.firstChild) p.decision.replaceChildren(...(waiting ? [decision(a.id)] : []));
    const key = `${a.log.length}|${a.log[a.log.length - 1] ?? ''}`;
    if (p.shown !== key) {
      const atBottom = p.log.scrollHeight - p.log.scrollTop - p.log.clientHeight < 30;
      p.log.textContent = a.log.slice(-150).join('\n');
      p.shown = key;
      if (atBottom) p.log.scrollTop = p.log.scrollHeight;
    }
  };

  bus.on('agents', (views: AgentView[]) => {
    agents = views;
    renderList();
    renderInspect();
  });
  bus.on('approvals', (list: ApprovalView[]) => {
    approvals = list;
    renderRequests();
    renderInspect();
  });
  bus.on('select', (id: string) => {
    selected = id;
    renderList();
    renderInspect();
  });
  bus.on('shipped', (n: number) => (shipped.textContent = `Shipped: ${n}`));
  bus.on('hire:full', () => {
    hire.disabled = true;
    hire.textContent = 'Floor is full';
  });

  hire.onclick = () => {
    ding();
    bus.emit('hire');
  };
  auto.onchange = () => bus.emit('autoapprove', auto.checked);

  byId('zoom-in').onclick = () => bus.emit('zoom', 'in');
  byId('zoom-out').onclick = () => bus.emit('zoom', 'out');
  byId('zoom-fit').onclick = () => bus.emit('zoom', 'fit');
  bus.on('zoom:level', (z: number) => (byId('zoom-level').textContent = `${Math.round(z * 100)}%`));

  const tick = () => (clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  tick();
  setInterval(tick, 10_000);

  renderList();
  renderRequests();
  renderInspect();
}
