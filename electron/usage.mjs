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

/** Where Claude Code renews its login, and who it says it is when it does. */
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const fresh = (auth) => auth?.accessToken && (!auth.expiresAt || auth.expiresAt > Date.now() + 60_000);

async function readLogin(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** Write the whole file in one go, so Claude Code never reads half of it. */
async function writeLogin(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
  await fs.rename(tmp, file);
}

/**
 * Renew an expired login the way Claude Code does. Renewal codes only work once,
 * so the new one is saved straight back for Claude Code; if Claude Code renewed
 * it in the meantime, its login is used instead of asking again.
 */
async function renew(file) {
  const before = (await readLogin(file)).claudeAiOauth;
  if (fresh(before)) return before.accessToken;
  if (!before?.refreshToken) throw new Error('expired');
  if (before.refreshTokenExpiresAt && before.refreshTokenExpiresAt < Date.now()) throw new Error('expired');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: before.refreshToken, client_id: CLIENT_ID, scope: (before.scopes ?? []).join(' ') }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    // most likely Claude Code used that code a moment ago: take what it saved
    const now = (await readLogin(file)).claudeAiOauth;
    if (fresh(now)) return now.accessToken;
    throw new Error(`renewing answered ${res.status}`);
  }
  const t = await res.json();
  if (!t.access_token) throw new Error('renewing gave no login');
  // the latest file, so anything else Claude Code keeps in it stays as it is
  const data = await readLogin(file);
  data.claudeAiOauth = {
    ...data.claudeAiOauth,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? before.refreshToken,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
    ...(t.scope ? { scopes: t.scope.split(' ') } : {}),
  };
  await writeLogin(file, data);
  return t.access_token;
}

/** One renewal at a time, however many times the usage is asked for meanwhile. */
let renewing = null;

/** The first login that hasn't expired; if they all have, the first one renewed. */
async function token() {
  const expired = [];
  for (const file of loginFiles()) {
    try {
      const auth = (await readLogin(file)).claudeAiOauth;
      if (!auth?.accessToken) continue;
      if (fresh(auth)) return auth.accessToken;
      expired.push(file);
    } catch {
      // not there or unreadable: try the next place
    }
  }
  if (!expired.length) throw new Error('No Claude Code login found on this machine.');
  renewing ??= (async () => {
    for (const file of expired) {
      try {
        return await renew(file);
      } catch {
        // try the next one
      }
    }
    throw new Error('Claude Code’s login has expired and couldn’t be renewed; it renews the next time an agent works, or log in again with claude.');
  })().finally(() => {
    renewing = null;
  });
  return renewing;
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
