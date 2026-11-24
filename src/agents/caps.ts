import { bus } from '../bus';
import type { Limits } from './crew';

/**
 * Usage caps: "work until the session's usage is at 50%, then stop until I say
 * continue". When the plan's window reaches the cap, whoever it was set for is
 * put on hold, keeping their job and conversation, until told to carry on.
 */
export type CapWindow = 'five_hour' | 'seven_day';
export interface Cap { pct: number; window: CapWindow }

const KEY = 'lgih.caps';
const WINDOW_LABEL: Record<CapWindow, string> = { five_hour: 'session', seven_day: 'weekly' };

/** Who stops at what, and who has been stopped by one and is waiting to be told to continue. */
let caps: Record<string, Cap> = {};
let stopped: string[] = [];
let limits: Limits | null = null;

try {
  const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  if (saved) ({ caps = {}, stopped = [] } = saved);
} catch {
  // nothing saved
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ caps, stopped }));
  } catch {
    // not remembered: fine
  }
}

const used = (w: CapWindow) => limits?.windows[w]?.utilization;
export const capLabel = (c: Cap) => `${c.pct}% of ${WINDOW_LABEL[c.window]} usage`;

/** The cap in `text` ("until usage is at 50%", "stop at 70% of the weekly limit"), or null. */
export function parseCap(text: string): Cap | null {
  const m = text.match(/\b(?:until|till|til|up\s+to|stop(?:ping)?\s+(?:at|when|once|after)|pause\s+(?:at|when|once)|hold\s+(?:at|when|once)|(?:no|not)\s+(?:more|further)\s+than|when(?:ever)?|once)\b([^.!?\n]{0,60}?)\b(\d{1,3})\s*(?:%|percent\b)/i);
  if (!m) return null;
  const pct = Number(m[2]);
  if (!(pct > 0 && pct <= 100)) return null;
  // only about usage: "until 50%" alone counts, "when tests pass 90%" doesn't
  const around = `${m[1]} ${text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40)}`;
  if (m[1].trim() && !/\b(usage|limit|plan|session|week|weekly|quota|tokens?|credits?|used|use)\b/i.test(around)) return null;
  return { pct, window: /\b(week|weekly|7[\s-]?days?)\b/i.test(around) ? 'seven_day' : 'five_hour' };
}

/** "continue", "carry on", "keep going": what releases people a cap stopped. */
export const isContinue = (text: string) =>
  /^(?:ok(?:ay)?|alright|yes|yeah|now|good|great|cool|fine)?[\s,!.]*(?:you\s+can\s+|u\s+can\s+|please\s+|pls\s+)?(?:continue|carry\s+on|keep\s+going|go\s+on|go\s+ahead|resume|get\s+back\s+to\s+(?:it|work)|back\s+to\s+work|start\s+again)\b/i.test(text.trim());

/** Set a cap on these people. Returns what to say about it. */
export function setCap(ids: string[], cap: Cap | null): string {
  if (!cap) {
    ids.forEach((id) => delete caps[id]);
    save();
    return 'no usage cap: they work until they are done';
  }
  const now = used(cap.window);
  if (now !== undefined && now * 100 >= cap.pct) return `${WINDOW_LABEL[cap.window]} usage is already at ${Math.round(now * 100)}%, so a ${cap.pct}% cap would stop them right away. Not set.`;
  ids.forEach((id) => (caps[id] = cap));
  save();
  return `will stop at ${capLabel(cap)}${now !== undefined ? ` (now ${Math.round(now * 100)}%)` : ''}, until you say continue`;
}

export const capOf = (id: string): Cap | undefined => caps[id];
export const stoppedByCap = (ids: string[]) => ids.filter((id) => stopped.includes(id));

/** Let people a cap stopped get back to work. */
export function release(ids: string[]) {
  const back = stoppedByCap(ids);
  if (!back.length) return back;
  stopped = stopped.filter((id) => !back.includes(id));
  save();
  back.forEach((id) => bus.emit('agent:hold', { id, on: false }));
  return back;
}

/** Anyone whose cap is reached goes on hold. */
function check() {
  const hit: { id: string; cap: Cap; now: number }[] = [];
  for (const [id, cap] of Object.entries(caps)) {
    const now = used(cap.window);
    if (now !== undefined && now * 100 >= cap.pct) hit.push({ id, cap, now });
  }
  if (!hit.length) return;
  for (const { id } of hit) {
    delete caps[id];
    if (!stopped.includes(id)) stopped.push(id);
    bus.emit('agent:hold', { id, on: true });
  }
  save();
  bus.emit('cap:hit', hit);
}

bus.on('usage:limits', (l: Limits) => {
  limits = l;
  check();
});
// held some other way and reopened by hand: that counts as "continue"
bus.on('agent:hold', ({ id, on }: { id: string; on: boolean }) => {
  if (on || !stopped.includes(id)) return;
  stopped = stopped.filter((x) => x !== id);
  save();
});
// while a cap is set, look at the numbers more often so it isn't overshot by much
window.setInterval(() => {
  if (Object.keys(caps).length) bus.emit('usage:refresh');
}, 30_000);

/** "Work more efficiently, use less usage": true; "usage doesn't matter, full power": false; otherwise null. */
export function parseFrugal(text: string): boolean | null {
  if (/\b(?:don'?t|do\s+not|no\s+need\s+to)\s+(?:worry|care|bother)\s+about\s+(?:the\s+)?(?:usage|tokens|limits?|cost)|\b(?:usage|tokens|cost)\s+(?:doesn'?t|does\s+not|don'?t)\s+matter|\bfull\s+(?:power|effort|speed)\b|\bstop\s+(?:saving|being\s+frugal)|\bnormal\s+(?:usage|effort|mode)\b/i.test(text)) return false;
  if (/\b(?:less|lower|fewer|low|save|saving|reduce|cut(?:\s+down)?|conserve|minimi[sz]e|easy\s+on(?:\s+the)?|light\s+on(?:\s+the)?)\s+(?:on\s+)?(?:the\s+|my\s+|your\s+)?(?:usage|tokens|credits|limits?|quota)\b|\b(?:usage|tokens)\s+(?:low|down)\b|\bmore\s+efficient(?:ly)?\b|\befficient(?:ly)?\b[^.!?]{0,30}\b(?:usage|tokens)\b|\bfrugal(?:ly)?\b|\b(?:work|be|go)\s+cheap(?:er|ly)?\b/i.test(text)) return true;
  return null;
}

const FILLER = new Set(('and then so ok okay please pls plz now also just but i me my you u your yours we us our guys team everyone all of the a an to at on is it be from for with when until till til up stop stopping pause wait hold ' +
  'continue resume again say tell told back keep work working go going carry usage use using used session current limit limits plan percent week weekly reach reaches reached hits hit gets get is are ' +
  'more less lower efficient efficiently frugal frugally save saving tokens cheap cheaper cheaply full power effort normal mode worry care about doesnt dont matter low down light easy on your this that its im fewer anymore any credits quota reduce minimize minimise conserve cut').split(' '));

/** Whether `text` is only about usage (a cap, or saving usage), with nothing else for them to do. */
export function onlyAboutUsage(text: string) {
  const words = text.toLowerCase().replace(/\d+\s*%|\d+/g, ' ').replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  return words.filter((w) => !FILLER.has(w)).length === 0;
}
