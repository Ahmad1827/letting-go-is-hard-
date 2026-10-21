import { bus } from '../bus';
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

export function initHud() {
  initOffice();
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

  const renderInspect = () => {
    const a = agents.find((x) => x.id === selected);
    if (!a) {
      inspect.replaceChildren(el('p', 'hint', 'Click an employee to see what they are up to.'));
      return;
    }
    const who = el('div', 'who');
    const img = el('img');
    img.src = a.avatar;
    img.alt = a.name;
    const info = el('div');
    info.append(el('b', undefined, a.name), el('div', undefined, LABEL[a.activity]), el('div', 'task', a.task || '—'));
    who.append(img, info);
    const log = el('pre', 'log', a.log.slice(-40).join('\n'));
    const parts: HTMLElement[] = [who];
    if (approvals.some((p) => p.id === a.id)) parts.push(decision(a.id));
    parts.push(log);
    inspect.replaceChildren(...parts);
    log.scrollTop = log.scrollHeight;
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
