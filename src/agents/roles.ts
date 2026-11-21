import { bus } from '../bus';
import type { Role, Team } from './types';

/**
 * Who should be what, said in plain words: "Dana you're the manager, Bob and Sam are workers",
 * "make Lee a worker", "Kim is on her own now". Turned into team changes by `planRoles`.
 */
export interface RoleWish { id: string; role: Role | null }

/** A team change for the office to make. */
export type RoleOp =
  | { kind: 'create'; name: string; manager: string; workers: string[] }
  | { kind: 'join'; id: string; team: string; role: Role }
  | { kind: 'leave'; id: string };

interface Person { id: string; name: string }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SELF = ['you', 'u', 'yourself'];
const REST = ['the rest', 'rest', 'everyone else', 'everybody else', 'the others', 'others', 'all the others'];
const MANAGER = /^(?:managers?|boss|lead|leader|head)$/i;
const WORKER = /^(?:workers?|engineers?|devs?|developers?|members?)$/i;
const ROLE = String.raw`managers?|boss|lead(?:er)?|head|workers?|engineers?|devs?|developers?|members?|solo|nothing|none|free agents?|alone|on (?:your|their|his|her|my) own|(?:in|on) no team|not (?:in|on) (?:a|any|the) team|off (?:the|a|their|your|his|her) team`;
const VERBS = String.raw`(?:you are|you're|youre|you r|u are|u r|ur|are|is|be|becomes?|will be|should be|as|now|just|the|a|an|our|my|team)`;
/** Words that may be left over once the role phrases are taken out. */
const FILLER = new Set(['and', 'also', 'then', 'ok', 'okay', 'so', 'please', 'pls', 'plz', 'now', 'make', 'set', 'put', 'hey', 'alright', 'too', 'as', 'well', 'from', 'here', 'thanks', 'thx', 'cool', 'great', 'guys', 'yes', 'yeah', 'right', 'while', 'meanwhile', 'let', 'lets', "let's", 'to', 'be', 'will', 'you', 'can', 'turn', 'into', 'becomes', 'become']);

/**
 * The role wishes in `text`, or null if it isn't (only) about roles, so a normal message still
 * goes through. `self` is who "you" means: the person whose terminal it is, if any.
 */
export function parseRoles(text: string, people: Person[], self: string | null): RoleWish[] | null {
  const names = people.map((p) => p.name).filter(Boolean);
  const subjects = [...names, ...(self ? SELF : []), ...REST].sort((a, b) => b.length - a.length).map(esc);
  if (!subjects.length) return null;
  const who = `(?:${subjects.join('|')})`;
  const re = new RegExp(String.raw`(?<![\w'])(${who}(?:\s*(?:,|&|\+|\band\b)\s*${who})*)(?:\s*[,:=-]+>?\s*|\s+)(?:${VERBS}\s+)*(${ROLE})(?![\w'])`, 'gi');
  const found: { subject: string; role: string }[] = [];
  const rest = text.replace(re, (_m, subject: string, role: string) => {
    found.push({ subject, role });
    return ' ';
  });
  if (!found.length) return null;
  const left = rest.toLowerCase().replace(/[^\w'\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (left.some((w) => !FILLER.has(w))) return null;

  const byName = new Map(people.map((p) => [p.name.toLowerCase(), p.id]));
  const wishes = new Map<string, Role | null>();
  let restRole: Role | null | undefined;
  for (const f of found) {
    const role: Role | null = MANAGER.test(f.role) ? 'manager' : WORKER.test(f.role) ? 'worker' : null;
    for (const raw of f.subject.split(/\s*(?:,|&|\+|\band\b)\s*/i)) {
      const s = raw.trim().toLowerCase();
      if (!s) continue;
      if (REST.includes(s)) restRole = role;
      else if (SELF.includes(s)) wishes.set(self!, role);
      else if (byName.has(s)) wishes.set(byName.get(s)!, role);
    }
  }
  if (restRole !== undefined) for (const p of people) if (!wishes.has(p.id)) wishes.set(p.id, restRole);
  return [...wishes].map(([id, role]) => ({ id, role }));
}

const TEAM_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima'];

/** A name no team has yet. */
export function nextTeamName(teams: Team[]) {
  const used = new Set(teams.map((t) => t.name));
  return `Team ${TEAM_NAMES.find((n) => !used.has(`Team ${n}`)) ?? teams.length + 1}`;
}

/**
 * What to do to make the wishes true, and a line for each person saying what changes.
 * `here`: the team whose terminal it was said in, the team people join when no manager is named.
 */
export function planRoles(wishes: RoleWish[], teams: Team[], here: string | null, nameOf: (id: string) => string): { ops: RoleOp[]; lines: string[] } | { error: string } {
  const managers = wishes.filter((w) => w.role === 'manager').map((w) => w.id);
  if (managers.length > 1) return { error: `One manager at a time: ${managers.map(nameOf).join(' and ')} can't both lead the same team. Say one, then the other with their own workers.` };
  const teamOf = (id: string, list: Team[]) => list.find((t) => t.manager === id || t.workers.includes(id)) ?? null;
  const ops: RoleOp[] = [];
  const lines: string[] = [];

  // leaving first: a manager leaving breaks their team up
  const solo = wishes.filter((w) => w.role === null).map((w) => w.id);
  for (const id of solo) {
    const t = teamOf(id, teams);
    if (!t) lines.push(`${nameOf(id)}: already on their own`);
    else {
      ops.push({ kind: 'leave', id });
      lines.push(t.manager === id ? `${nameOf(id)}: on their own (${t.name} breaks up)` : `${nameOf(id)}: on their own, off ${t.name}`);
    }
  }
  const live = teams.filter((t) => !solo.includes(t.manager)).map((t) => ({ ...t, workers: t.workers.filter((w) => !solo.includes(w)) }));
  const workers = wishes.filter((w) => w.role === 'worker').map((w) => w.id);
  const from = (id: string) => {
    const t = teamOf(id, live);
    return !t ? '' : t.manager === id ? ` (${t.name} breaks up)` : ` (leaves ${t.name})`;
  };

  let target: (typeof live)[number] | null = null;
  let demoted: string | null = null;
  const m = managers[0];
  if (m) {
    const cur = teamOf(m, live);
    const there = live.find((t) => t.id === here);
    if (cur?.manager === m) {
      target = cur;
      lines.push(`${nameOf(m)}: already the manager of ${cur.name}`);
    } else if (cur || there) {
      target = cur ?? there!;
      demoted = target.manager;
      ops.push({ kind: 'join', id: m, team: target.id, role: 'manager' });
      lines.push(`${nameOf(m)}: manager of ${target.name}${cur ? '' : from(m)} (${nameOf(demoted)} becomes a worker)`);
    } else {
      const name = nextTeamName(teams);
      const ws = workers.filter((w) => w !== m);
      ops.push({ kind: 'create', name, manager: m, workers: ws });
      lines.push(`${nameOf(m)}: manager of the new ${name}`, ...ws.map((w) => `${nameOf(w)}: worker in ${name}${from(w)}`));
      return { ops, lines };
    }
  } else if (workers.length) {
    target = live.find((t) => t.id === here) ?? (live.length === 1 ? live[0] : null);
    if (!target)
      return { error: live.length ? `Which team? Name their manager too, e.g. "${live[0] ? nameOf(live[0].manager) : 'Dana'} is the manager, ${nameOf(workers[0])} is a worker".` : `There's no team yet. Say who manages them, e.g. "Dana is the manager, ${nameOf(workers[0])} is a worker".` };
  }

  for (const w of workers) {
    if (!target) break;
    if (w === demoted || (target.workers.includes(w) && w !== m)) lines.push(`${nameOf(w)}: worker in ${target.name}`);
    else if (target.manager === w) lines.push(`${nameOf(w)} manages ${target.name}: make someone else the manager first`);
    else {
      ops.push({ kind: 'join', id: w, team: target.id, role: 'worker' });
      lines.push(`${nameOf(w)}: worker in ${target.name}${from(w)}`);
    }
  }
  if (!ops.length && !lines.length) return { error: 'Nothing to change.' };
  return { ops, lines };
}

/** Hand the changes to the office. */
export function applyRoleOps(ops: RoleOp[]) {
  for (const op of ops) {
    if (op.kind === 'create') bus.emit('team:create', { name: op.name, manager: op.manager, workers: op.workers });
    else if (op.kind === 'join') bus.emit('team:join', { id: op.id, team: op.team, role: op.role });
    else bus.emit('team:leave', op.id);
  }
}
