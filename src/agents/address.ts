/**
 * Who a message to a team is for, said in plain words: "I only want Linda to respond",
 * "I'm talking to Bob and Sam", "only Lee", "Linda, what do you think?", "@kim @lee ...".
 * Everyone else on the team just takes note and stays quiet.
 */
interface Person { id: string; name: string }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The ids of the people `text` is meant for, or null if it's for the whole team. */
export function addressees(text: string, people: Person[]): string[] | null {
  const named = people.filter((p) => p.name.trim());
  if (!named.length) return null;
  const names = named.map((p) => p.name).sort((a, b) => b.length - a.length).map(esc);
  const one = `@?(?:${names.join('|')})(?:'s)?`;
  const list = `${one}(?:\\s*(?:,|&|\\+|\\band\\b|\\bor\\b)\\s*${one})*`;
  const B = `(?<![\\w@'])`;
  const E = `(?![\\w'])`;
  const patterns = [
    // "only Linda", "just Linda and Bob", "I only want Linda to answer", "only want to hear from Linda"
    `\\b(?:only|just)\\s+(?:want\\s+|need\\s+|let\\s+)?(?:to\\s+hear\\s+from\\s+|from\\s+)?${B}(${list})${E}`,
    // "Linda only", "Linda and Bob only"
    `${B}(${list})\\s+(?:only|alone)\\b`,
    // "I'm talking to Linda", "speaking only to Lee"
    `\\b(?:talking|speaking)\\s+(?:only\\s+|just\\s+)?to\\s+${B}(${list})${E}`,
    // "this is for Bob", "question for Sam", "this one's only for Lee"
    `\\b(?:this|that|it|question|message|one)(?:\\s+is|'s|s)?\\s+(?:only\\s+|just\\s+)?for\\s+${B}(${list})${E}`,
    // "Linda, ..." / "Linda and Bob: ..." at the very start
    `^\\s*(?:hey\\s+|hi\\s+|ok\\s+|okay\\s+)?${B}(${list})\\s*[,:]`,
  ];
  const found = new Set<string>();
  for (const p of patterns) {
    const m = text.match(new RegExp(p, 'i'));
    if (m) pick(m[1], named, found);
  }
  // several @names anywhere: "@linda @bob have a look"
  const ats = text.match(new RegExp(`(?<![\\w])@(?:${names.join('|')})${E}`, 'gi'));
  if (ats) ats.forEach((a) => pick(a, named, found));
  // "everyone else stay quiet" with names in it: those names are who's meant
  if (!found.size && /\b(?:every(?:one|body)\s+else|the\s+rest|(?:the\s+)?others|no\s*(?:one|body)\s+else)\b[^.!?]*\b(?:quiet|silent|shush|hush|don'?t\s+(?:answer|respond|reply))/i.test(text)) {
    pick(text, named, found);
  }
  return found.size ? [...found] : null;
}

/** Every person named in `chunk`, added to `into`. */
function pick(chunk: string, people: Person[], into: Set<string>) {
  for (const p of people) {
    if (new RegExp(`(?<![\\w])@?${esc(p.name)}(?![\\w])`, 'i').test(chunk)) into.add(p.id);
  }
}
