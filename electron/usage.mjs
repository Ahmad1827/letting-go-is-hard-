// The Claude plan's usage, live: the same numbers Claude Code's /usage shows,
// read with the login Claude Code already saved on this machine.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { engine, settings } from './settings.mjs';

const URL = 'https://api.anthropic.com/api/oauth/usage';

/**
 * Where Claude Code keeps its login: the default engine's CLAUDE_CONFIG_DIR, the
 * usual ~/.claude, and the home next to the projects folder (the WSL home, when
 * the app runs on Windows and the projects live in WSL).
 */
function loginFiles() {
  const dirs = [
    engine(settings().defaultEngine).env?.CLAUDE_CONFIG_DIR,
    path.join(os.homedir(), '.claude'),
    path.join(path.dirname(settings().projectsRoot), '.claude'),
  ].filter(Boolean);
  return [...new Set(dirs)].map((d) => path.join(d, '.credentials.json'));
}

/** The first login that hasn't expired. Claude Code renews them itself whenever it runs. */
async function token() {
  let expired = false;
  for (const file of loginFiles()) {
    try {
      const auth = JSON.parse(await fs.readFile(file, 'utf8')).claudeAiOauth;
      if (!auth?.accessToken) continue;
      if (auth.expiresAt && auth.expiresAt < Date.now() + 60_000) {
        expired = true;
        continue;
      }
      return auth.accessToken;
    } catch {
      // not there or unreadable: try the next place
    }
  }
  throw new Error(expired ? 'Claude Code’s login has expired; it renews the next time an agent works.' : 'No Claude Code login found on this machine.');
}

/** The plan's windows (five_hour, seven_day, ...) as fractions of the limit, with resets in unix seconds. */
export async function planUsage() {
  try {
    const res = await fetch(URL, {
      headers: { Authorization: `Bearer ${await token()}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Claude answered ${res.status}`);
    const body = await res.json();
    const windows = {};
    for (const [k, w] of Object.entries(body)) {
      if (!/^(five_hour|seven_day)/.test(k) || typeof w?.utilization !== 'number') continue;
      windows[k] = { utilization: w.utilization / 100, resetsAt: Math.round(Date.parse(w.resets_at) / 1000) };
    }
    return { windows, at: Date.now() };
  } catch (e) {
    return { error: e.message };
  }
}
