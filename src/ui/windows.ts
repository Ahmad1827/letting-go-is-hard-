import { bus } from '../bus';
import { DEFAULT_SETTINGS, engineIn, modelLabel } from '../agents/crew';
import type { EngineConfig, Phase, Settings, Team } from '../agents/types';
import { OWNER } from '../owner';
import { byId, el } from './dom';
import { DOT, LABEL, type AgentView } from './hud';

/**
 * The bigger windows: Settings (AI engines and how agents behave) and the
 * Work Board in the owner's office.
 */

type Bridge = { settings?: { testEngine(e: EngineConfig): Promise<{ ok: boolean; text: string }> } };
const office = () => (window as { office?: Bridge }).office;

let settings: Settings = DEFAULT_SETTINGS;
let agents: AgentView[] = [];
let teams: Team[] = [];

function popup(id: string) {
  const pop = byId(id);
  const show = () => {
    for (const other of document.querySelectorAll<HTMLElement>('.popup')) if (other !== pop) other.hidden = true;
    pop.hidden = false;
  };
  byId(`${id}-close`).onclick = () => (pop.hidden = true);
  return { pop, body: byId(`${id}-body`), show, hide: () => (pop.hidden = true) };
}

// ------------------------------------------------------------------ Settings

const envText = (env: Record<string, string>) => Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
const parseEnv = (text: string) =>
  Object.fromEntries(text.split('\n').map((l) => l.trim()).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const modelsText = (models: EngineConfig['models']) => models.map((m) => (m.id ? `${m.id} | ${m.label}` : `| ${m.label}`)).join('\n');
const parseModels = (text: string) => {
  const list = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [id, label] = l.includes('|') ? l.split('|').map((x) => x.trim()) : [l, l];
    return { id, label: label || id || 'Default' };
  });
  return list.some((m) => !m.id) ? list : [{ id: '', label: 'Default' }, ...list];
};

function initSettings() {
  const w = popup('settings-pop');

  const open = () => {
    const draft: Settings = structuredClone(settings);
    const form = el('form', 'settings-form');

    // projects folder
    const root = el('input');
    root.value = draft.projectsRoot;

    // engines
    const engineBox = el('div', 'engines');
    const renderEngines = () => {
      engineBox.replaceChildren(
        ...draft.engines.map((eng, i) => {
          const box = el('fieldset', 'engine');
          const builtIn = eng.id === 'claude-code';
          box.append(el('legend', undefined, builtIn ? `${eng.name} (built in)` : eng.name));
          const name = el('input');
          name.value = eng.name;
          name.oninput = () => (eng.name = name.value);
          const cmd = el('input');
          cmd.value = eng.command;
          cmd.oninput = () => (eng.command = cmd.value);
          const env = el('textarea');
          env.rows = 2;
          env.value = envText(eng.env);
          env.placeholder = 'KEY=value, one per line';
          env.oninput = () => (eng.env = parseEnv(env.value));
          const models = el('textarea');
          models.rows = 3;
          models.value = modelsText(eng.models);
          models.placeholder = 'model-id | Label, one per line';
          models.oninput = () => (eng.models = parseModels(models.value));
          const result = el('span', 'hint');
          const test = el('button', undefined, 'Test');
          test.type = 'button';
          test.onclick = async () => {
            result.textContent = 'Testing...';
            const r = await office()?.settings?.testEngine(eng);
            result.textContent = r ? (r.ok ? `OK: ${r.text}` : `Failed: ${r.text}`) : 'Only in the desktop app.';
            result.className = r?.ok ? 'hint ok' : 'hint error';
          };
          const row = el('div', 'buttons');
          row.append(test);
          if (!builtIn) {
            const remove = el('button', undefined, 'Remove');
            remove.type = 'button';
            remove.onclick = () => {
              draft.engines.splice(i, 1);
              if (draft.defaultEngine === eng.id) draft.defaultEngine = 'claude-code';
              renderEngines();
              renderDefaults();
            };
            row.append(remove);
          }
          row.append(result);
          box.append(el('label', undefined, 'Name'), name, el('label', undefined, 'Command'), cmd, el('label', undefined, 'Environment'), env, el('label', undefined, 'Models'), models, row);
          return box;
        }),
      );
    };
    const add = el('button', undefined, 'Add engine...');
    add.type = 'button';
    add.onclick = () => {
      draft.engines.push({
        id: `engine-${Date.now().toString(36)}`,
        name: 'My LLM',
        command: 'claude',
        env: { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' },
        models: [{ id: '', label: 'Default' }],
      });
      renderEngines();
      renderDefaults();
    };

    // defaults for new hires
    const defEngine = el('select');
    const defModel = el('select');
    const renderDefaults = () => {
      defEngine.replaceChildren(...draft.engines.map((e) => Object.assign(el('option', undefined, e.name), { value: e.id })));
      defEngine.value = engineIn(draft, draft.defaultEngine).id;
      defModel.replaceChildren(...engineIn(draft, defEngine.value).models.map((m) => Object.assign(el('option', undefined, m.label), { value: m.id })));
      defModel.value = draft.defaultModel;
    };
    defEngine.onchange = () => {
      draft.defaultEngine = defEngine.value;
      draft.defaultModel = '';
      renderDefaults();
    };
    defModel.onchange = () => (draft.defaultModel = defModel.value);

    const radios = <T extends string>(name: string, value: T, options: [T, string][], set: (v: T) => void) => {
      const box = el('div', 'radios');
      for (const [v, label] of options) {
        const l = el('label', 'check');
        const r = el('input');
        r.type = 'radio';
        r.name = name;
        r.checked = v === value;
        r.onchange = () => set(v);
        l.append(r, label);
        box.append(l);
      }
      return box;
    };

    renderEngines();
    renderDefaults();
    const save = el('button', undefined, 'Save');
    save.type = 'submit';
    const cancel = el('button', undefined, 'Cancel');
    cancel.type = 'button';
    cancel.onclick = w.hide;
    const buttons = el('div', 'buttons');
    buttons.append(save, cancel);
    form.onsubmit = (e) => {
      e.preventDefault();
      draft.projectsRoot = root.value.trim() || draft.projectsRoot;
      bus.emit('settings:save', draft);
      w.hide();
    };
    form.append(
      el('h4', undefined, 'Projects'),
      el('label', undefined, 'Folder whose sub-folders are your projects'),
      root,
      el('h4', undefined, 'AI engines'),
      el('p', 'hint', 'Agents run on Claude Code-compatible command lines. Point Claude Code at another LLM with ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, or at another account with CLAUDE_CONFIG_DIR.'),
      engineBox,
      add,
      el('h4', undefined, 'New hires use'),
      rowOf(defEngine, defModel),
      el('h4', undefined, 'Approvals'),
      radios('approvals', draft.approvals, [['auto', 'Auto mode: agents decide what is safe; only risky things ask'], ['ask', 'Ask me before anything changes files']], (v) => (draft.approvals = v)),
      el('h4', undefined, 'Closing with work in progress'),
      radios('onclose', draft.onClose, [['ask', 'Ask me'], ['finish', 'Let them finish in the background'], ['stop', 'Stop them and close']], (v) => (draft.onClose = v)),
      buttons,
    );
    w.body.replaceChildren(form);
    w.show();
  };

  bus.on('settings:open', open);
}

function rowOf(...items: HTMLElement[]) {
  const row = el('div', 'row pair');
  row.append(...items);
  return row;
}

// ------------------------------------------------------------------ Work board

const STAGES: [string, Phase[]][] = [
  ['Research', ['research']],
  ['In line', ['queued']],
  ['Pitch', ['pitching']],
  ['Working', ['work', 'standby']],
  ['Done', ['break']],
];

const PHASE_NOTE: Partial<Record<Phase, string>> = { home: 'Gone home', stopped: 'Stopped', held: 'On hold' };

function since(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const shortTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

/** Hold (stop where they are) or reopen one person or a whole team. */
function holdButton(event: 'agent:hold' | 'team:hold', id: string, held: boolean, who = '') {
  const b = el('button', 'small hold', held ? `Reopen${who}` : `Hold${who}`);
  b.title = held ? 'Pick up exactly where they stopped' : 'Stop them where they are, job and all, until you reopen them';
  b.onclick = (e) => {
    e.stopPropagation();
    bus.emit(event, { id, on: !held });
  };
  return b;
}

function card(a: AgentView, close: () => void) {
  const held = a.status.phase === 'held';
  const c = el('div', `board-card${held ? ' held' : ''}`);
  c.onclick = () => {
    bus.emit('select', a.id);
    bus.emit('focus', a.id);
    close();
  };
  const img = el('img');
  img.src = a.avatar;
  img.alt = a.name;
  const info = el('div', 'board-info');
  const head = el('div', 'board-head');
  head.append(el('b', undefined, a.name));
  if (a.role) head.append(el('span', `role ${a.role}`, a.role === 'manager' ? 'Manager' : 'Worker'));
  head.append(el('span', 'hint', modelLabel(settings, a.status.engine, a.model)), holdButton('agent:hold', a.id, held));

  // where they are in the cycle
  const track = el('div', 'track');
  const special = PHASE_NOTE[a.status.phase];
  STAGES.forEach(([label, phases], i) => {
    const here = phases.includes(a.status.phase);
    const pill = el('span', `stage${here ? ' here' : ''}`, here && a.status.phase === 'standby' ? 'Waiting' : label);
    if (here) pill.style.background = DOT[a.activity];
    track.append(pill);
    if (i < STAGES.length - 1) track.append(el('span', 'arrow', '›'));
  });
  if (special) track.append(el('span', 'stage here off', special));

  const now = el('div', 'board-now');
  const dot = el('span', 'dot');
  dot.style.background = DOT[a.activity];
  now.append(dot, el('span', undefined, LABEL[a.activity]), el('span', 'hint', ` for ${since(a.status.since)}`));

  info.append(head, track, now);
  if (a.task) info.append(el('div', 'task', a.task));
  const where = [a.status.project, a.status.branch].filter(Boolean).join(' · ');
  if (where) info.append(el('code', 'where', where));
  const last = a.log[a.log.length - 1];
  if (last) info.append(el('div', 'board-last', last.replace(/^\S+ \S+\s+/, '')));
  if (a.usage) info.append(el('div', 'hint', `${shortTokens(a.usage.tokens)} tokens`));
  c.append(img, info);
  return c;
}

function initBoard() {
  const w = popup('board-pop');
  // the board redraws every second; not while a button is held down, or the click would be lost
  let pressing = false;
  w.body.addEventListener('pointerdown', () => (pressing = true));
  window.addEventListener('pointerup', () => window.setTimeout(() => (pressing = false)));
  const render = () => {
    if (w.pop.hidden || pressing) return;
    const byId = new Map(agents.map((a) => [a.id, a]));
    const count = (p: Phase[]) => agents.filter((a) => p.includes(a.status.phase)).length;
    const summary = el('div', 'board-summary');
    for (const [n, label] of [
      [agents.length, agents.length === 1 ? 'person' : 'people'],
      [count(['work']), 'working'],
      [count(['research']), 'researching'],
      [count(['queued', 'pitching']), `waiting for ${OWNER}`],
      [count(['held']), 'on hold'],
      [teams.length, teams.length === 1 ? 'team' : 'teams'],
    ] as [number, string][])
      summary.append(el('span', 'chip', `${n} ${label}`));
    const parts: HTMLElement[] = [summary];
    if (!agents.length) parts.push(el('p', 'hint', 'Nobody hired yet. Use Hire agent in the Staff panel.'));
    const inTeam = new Set<string>();
    for (const t of teams) {
      const box = el('fieldset', 'board-group');
      const manager = byId.get(t.manager);
      const job = manager?.status.phase === 'work' ? manager.task : manager?.status.phase === 'research' ? 'looking for an idea' : '';
      const legend = el('legend', undefined, `${t.name}${job ? ` · ${job}` : ''}`);
      const allHeld = [t.manager, ...t.workers].every((id) => byId.get(id)?.status.phase === 'held');
      legend.append(holdButton('team:hold', t.id, allHeld, ' team'));
      box.append(legend);
      for (const id of [t.manager, ...t.workers]) {
        const a = byId.get(id);
        if (a) box.append(card(a, w.hide));
        inTeam.add(id);
      }
      parts.push(box);
    }
    const solo = agents.filter((a) => !inTeam.has(a.id));
    if (solo.length) {
      const box = el('fieldset', 'board-group');
      box.append(el('legend', undefined, teams.length ? 'On their own' : 'Everyone'));
      for (const a of solo) box.append(card(a, w.hide));
      parts.push(box);
    }
    const scroll = w.body.scrollTop;
    w.body.replaceChildren(...parts);
    w.body.scrollTop = scroll;
  };
  bus.on('board:open', () => {
    w.show();
    render();
  });
  bus.on('agents', render);
  // keep the "for 2m 10s" timers moving
  window.setInterval(render, 1000);
}

export function initWindows() {
  bus.on('settings', (s: Settings) => (settings = s));
  bus.on('agents', (views: AgentView[]) => (agents = views));
  bus.on('teams', (list: Team[]) => (teams = list));
  initSettings();
  initBoard();
}
