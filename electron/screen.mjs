// Letting agents look at the screen: a tiny web server on 127.0.0.1 that only
// the agents know the key to. `curl` it and the app takes a screenshot with
// Electron's own capturer (no extra tools needed on Windows or Linux), saves
// it as a PNG and answers with the path, which the agent opens with Read.
import { app, desktopCapturer, screen } from 'electron';
import { randomBytes } from 'node:crypto';
import { promises as fs, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/**
 * The key and port are kept between runs: a resumed conversation keeps the
 * system prompt it started with, so a new address each run would leave
 * everyone picking a conversation back up with one that no longer works.
 */
const saved = path.join(app.getPath('userData'), 'screen.json');
const kept = (() => {
  try {
    return JSON.parse(readFileSync(saved, 'utf8'));
  } catch {
    return {};
  }
})();
const key = typeof kept.key === 'string' && kept.key.length >= 32 ? kept.key : randomBytes(16).toString('hex');
const shots = path.join(os.tmpdir(), 'letting-go-shots');
/** Screenshots older than this are cleared away when a new one is taken. */
const KEEP_MS = 60 * 60 * 1000;
let base = '';

/** The whole of the biggest display, in real pixels. */
function fullSize() {
  const d = screen.getPrimaryDisplay();
  return { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
}

async function sources(kind, thumbnailSize) {
  return desktopCapturer.getSources({ types: [kind], thumbnailSize, fetchWindowIcons: false });
}

async function tidy() {
  const now = Date.now();
  for (const f of await fs.readdir(shots).catch(() => [])) {
    const p = path.join(shots, f);
    const st = await fs.stat(p).catch(() => null);
    if (st && now - st.mtimeMs > KEEP_MS) await fs.rm(p, { force: true });
  }
}

async function shot(windowTitle) {
  const size = fullSize();
  let found;
  if (windowTitle) {
    const q = windowTitle.toLowerCase();
    found = (await sources('window', size)).find((s) => s.name.toLowerCase().includes(q));
    if (!found) return { status: 404, text: `No window with "${windowTitle}" in its title. GET /windows lists them.` };
  } else {
    const all = await sources('screen', size);
    found = all.find((s) => s.display_id === String(screen.getPrimaryDisplay().id)) ?? all[0];
    if (!found) return { status: 500, text: 'No screen to capture here.' };
  }
  const png = found.thumbnail.toPNG();
  if (!png.length) return { status: 500, text: 'The capture came back empty (the window may be minimized).' };
  await fs.mkdir(shots, { recursive: true });
  void tidy();
  const file = path.join(shots, `shot-${Date.now()}.png`);
  await fs.writeFile(file, png);
  return { status: 200, text: file };
}

export function startScreen() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const reply = (status, text) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`${text}\n`);
    };
    if (url.searchParams.get('key') !== key) return reply(403, 'Wrong key');
    try {
      if (url.pathname === '/shot') {
        const r = await shot(url.searchParams.get('window'));
        return reply(r.status, r.text);
      }
      if (url.pathname === '/windows') {
        const list = await sources('window', { width: 0, height: 0 });
        return reply(200, list.map((s) => s.name).filter(Boolean).join('\n') || '(no windows)');
      }
      reply(404, 'Use /shot or /windows');
    } catch (e) {
      reply(500, `Couldn't capture: ${e.message}`);
    }
  });
  const up = () => {
    const port = server.address().port;
    base = `http://127.0.0.1:${port}`;
    try {
      writeFileSync(saved, JSON.stringify({ key, port }));
    } catch {
      // only means a new address next run
    }
  };
  // last run's port if it's free, any port if not
  server.once('error', () => server.listen(0, '127.0.0.1', up));
  server.listen(Number.isInteger(kept.port) ? kept.port : 0, '127.0.0.1', up);
  return server;
}

/** What agents are told about seeing the screen; empty until the server is up. */
export function screenBrief() {
  if (!base) return '';
  return `Seeing the screen: run \`curl -s "${base}/shot?key=${key}"\` and it prints the path of a fresh PNG screenshot of the whole screen; open it with Read to look. Add \`&window=<part of a window title>\` to capture one window, and \`curl -s "${base}/windows?key=${key}"\` lists the window titles. Use it to check apps you've started.`;
}
