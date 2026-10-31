// Skills: what the engine has installed, and how to limit an agent to the ones picked for them.
import { spawn } from 'node:child_process';
import readline from 'node:readline';

/** How long a look at the engine's skills stays good; each one starts the engine. */
const FRESH_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;

/** "(claude.ai sync)" and friends at the end of a description say where the skill came from. */
const SOURCE = /\s*\(([^()]+)\)\s*$/;

/** A synced skill is listed by its short name, but agents call it by its full one, which is an alias. */
const fullName = (c) => c.aliases?.find((a) => a.includes(':')) ?? c.name;

/** Sort the engine's commands into the owner's skills (offered in the picker) and everything else. */
export function parseCommands(commands) {
  const skills = [];
  for (const c of commands) {
    if (c.builtin) continue;
    const source = SOURCE.exec(c.description ?? '')?.[1] ?? '';
    skills.push({ id: fullName(c), name: c.name, description: (c.description ?? '').replace(SOURCE, ''), source });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { skills, all: commands.map(fullName) };
}

/**
 * Ask the engine what it has. The initialize request is answered without
 * talking to the model, so this costs a start-up and no tokens.
 */
export function probeCommands({ file, pre = [], env, cwd }) {
  return new Promise((resolve, reject) => {
    const args = [...pre, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', 'Skill', '--strict-mcp-config'];
    const p = spawn(file, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const finish = (fn, value) => {
      clearTimeout(timer);
      p.kill();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('The engine took too long to list its skills')), PROBE_TIMEOUT_MS);
    p.on('error', (e) => finish(reject, e));
    p.on('exit', (code) => finish(reject, new Error(`The engine stopped before listing its skills (exit ${code})`)));
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.type !== 'control_response') return;
      if (m.response?.subtype !== 'success') return finish(reject, new Error(m.response?.error || 'The engine refused to list its skills'));
      finish(resolve, parseCommands(m.response.response?.commands ?? []));
    });
    p.stdin.on('error', () => {}); // an engine that died is reported by 'exit'
    p.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'skills', request: { subtype: 'initialize' } })}\n`);
  });
}

const cache = new Map();

/** The engine's skills, from a recent look if there was one. A failed look is never kept. */
export function catalog(key, launch, { fresh = false } = {}) {
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < FRESH_MS) return hit.result;
  const result = probeCommands(launch);
  cache.set(key, { at: Date.now(), result });
  result.catch(() => cache.get(key)?.result === result && cache.delete(key));
  return result;
}

/**
 * Settings that leave an agent with only the picked skills. Hiding takes a
 * skill out of what the agent is told about, and the deny rules also stop the
 * ones hiding can't reach, such as plugin skills.
 */
export function skillSettings(all, picked) {
  const hidden = all.filter((id) => !picked.includes(id));
  return {
    disableBundledSkills: true,
    skillOverrides: { ...Object.fromEntries(hidden.map((id) => [id, 'off'])), ...Object.fromEntries(picked.map((id) => [id, 'on'])) },
    permissions: { deny: hidden.map((id) => `Skill(${id})`) },
  };
}

export const skillPrompt = (picked) => `Your skills: ${picked.join(', ')}. When one fits what you're doing, load it with the Skill tool and follow it.`;
