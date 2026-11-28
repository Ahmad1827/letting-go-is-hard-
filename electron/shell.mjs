import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import { settings } from './settings.mjs';

/**
 * The real shell in the terminal view: bash in WSL (on Windows) or on this
 * machine, in a proper pseudo-terminal, so cd, ls, vim, top and Claude Code
 * itself all work as they would in Windows Terminal.
 *
 * Node has no pseudo-terminals without a native module, so a small Python
 * helper on the Linux side makes one (Python 3 comes with WSL's Ubuntu) and
 * relays bytes both ways over its stdin/stdout. Control messages ride in the
 * same stdin: a NUL, a letter, JSON, newline; a NUL that was typed is sent as
 * two NULs.
 *
 * The shell gets a `claude` command of its own:
 * - `claude <name>` (someone in the office, or a team) prints an escape
 *   sequence the page picks up to show that person's terminal in the tab,
 *   then waits; Ctrl+C there ends it and drops back to the prompt.
 * - `claude` with anything else runs Claude Code itself in the current
 *   folder. It doesn't end by exiting (it picks the conversation back up):
 *   only Ctrl+C in the tab ends it, which the page sends as a "stop" message.
 */

const RC = String.raw`
if [ -f ~/.profile ]; then . ~/.profile; elif [ -f ~/.bashrc ]; then . ~/.bashrc; fi
_lgih_norm() { printf '%s' "$*" | tr '[:upper:]' '[:lower:]' | tr -d ' _-'; }
claude() {
  local want; want=$(_lgih_norm "$@")
  if [ -n "$want" ] && grep -qxF -- "$want" "$LGIH_NAMES" 2>/dev/null; then
    printf '\033]7337;attach;%s\007' "$want"
    sleep infinity
    printf '\n'
    return 0
  fi
  rm -f "$LGIH_STOP"
  printf '\033]7337;cli;1\007'
  local first=1 start
  while :; do
    start=$SECONDS
    if [ $first = 1 ]; then command claude "$@"; else command claude --continue; fi
    if [ -e "$LGIH_STOP" ]; then rm -f "$LGIH_STOP"; break; fi
    # gone straight away: something's wrong, don't spin
    if [ $((SECONDS - start)) -lt 3 ]; then break; fi
    first=0
    printf '\n\033[2m(Claude Code exited, picking the conversation back up. Ctrl+C ends the session.)\033[0m\n'
  done
  printf '\033]7337;cli;0\007'
}
`;

const HELPER = String.raw`
import os, pty, sys, json, signal, struct, fcntl, termios, select, tempfile, base64
base = os.path.join(tempfile.gettempdir(), 'lgih-shell-%d' % os.getpid())
names, stop, rc = base + '.names', base + '.stop', base + '.rc'
open(names, 'w').close()
with open(rc, 'w') as f:
    f.write(base64.b64decode(RC64).decode())
env = dict(os.environ, LGIH_NAMES=names, LGIH_STOP=stop, TERM='xterm-256color', COLORTERM='truecolor')
for k in [k for k in env if k.startswith(('CLAUDECODE', 'CLAUDE_CODE_')) or k == 'ELECTRON_RUN_AS_NODE']:
    env.pop(k)
pid, fd = pty.fork()
if pid == 0:
    try:
        os.chdir(os.path.expanduser('~'))
    except Exception:
        pass
    os.execvpe('bash', ['bash', '--rcfile', rc, '-i'], env)

def resize(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

def control(kind, body):
    msg = json.loads(body or '{}')
    if kind == 'R':
        resize(int(msg['cols']), int(msg['rows']))
    elif kind == 'N':
        with open(names + '.tmp', 'w') as f:
            f.write('\n'.join(msg['names']) + '\n')
        os.replace(names + '.tmp', names)
    elif kind == 'S':
        open(stop, 'w').close()
        try:
            os.killpg(os.tcgetpgrp(fd), signal.SIGTERM)
        except Exception:
            pass

pending = b''
def feed(data):
    global pending
    buf = pending + data
    out = bytearray()
    i = 0
    while i < len(buf):
        b = buf[i]
        if b != 0:
            out.append(b)
            i += 1
            continue
        if i + 1 >= len(buf):
            break
        if buf[i + 1] == 0:
            out.append(0)
            i += 2
            continue
        end = buf.find(b'\n', i)
        if end < 0:
            break
        try:
            control(chr(buf[i + 1]), buf[i + 2:end].decode())
        except Exception:
            pass
        i = end + 1
    pending = bytes(buf[i:])
    if out:
        os.write(fd, bytes(out))

try:
    while True:
        r, _, _ = select.select([fd, 0], [], [])
        if fd in r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break
            os.write(1, data)
        if 0 in r:
            data = os.read(0, 65536)
            if not data:
                break
            feed(data)
finally:
    for p in (names, stop, rc):
        try:
            os.remove(p)
        except Exception:
            pass
    try:
        os.kill(pid, signal.SIGHUP)
    except Exception:
        pass
`;

const code = () => {
  const src = HELPER.replace('RC64', JSON.stringify(Buffer.from(RC).toString('base64')));
  // through wsl.exe the program text travels as one argument: base64 keeps it free of quotes and newlines
  return `import base64;exec(base64.b64decode('${Buffer.from(src).toString('base64')}').decode())`;
};

/**
 * Which WSL system to open: the one the projects folder lives in, or else the
 * first that isn't Docker Desktop's (which is often the default, and has no
 * Python or bash).
 */
async function distro() {
  const m = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)/i.exec(settings().projectsRoot ?? '');
  if (m) return m[1];
  const list = await new Promise((resolve) =>
    execFile('wsl.exe', ['-l', '-q'], { encoding: 'utf16le', timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? '' : out)));
  return list.split(/\r?\n/).map((d) => d.replace(/\0/g, '').trim()).find((d) => d && !d.startsWith('docker-desktop')) ?? null;
}

/** wsl.exe complains about every Windows PATH entry it can't map (a missing D: drive...): not worth showing. */
const noise = /^wsl: Failed to translate .*$\r?\n?/gm;
/** Text from outside the terminal has bare newlines; a terminal needs \r\n. */
const crlf = (s) => s.replace(noise, '').replace(/\r?\n/g, '\r\n');

const frame = (kind, msg) => Buffer.from(`\0${kind}${JSON.stringify(msg)}\n`);

export function setupShell(ipcMain, getWin) {
  const shells = new Map();
  const send = (...args) => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(...args);
  };

  ipcMain.handle('shell:start', async (_e, id, cols, rows) => {
    shells.get(id)?.kill();
    const win = process.platform === 'win32';
    const d = win ? await distro() : null;
    if (win && !d) return { ok: false, error: 'no Linux system found in WSL (only Docker Desktop\'s). Install Ubuntu with: wsl --install' };
    const [file, args] = win
      ? ['wsl.exe', ['-d', d, '--cd', '~', '-e', '/usr/bin/env', 'python3', '-u', '-c', code()]]
      : ['python3', ['-u', '-c', code()]];
    let p;
    try {
      p = spawn(file, args, { cwd: os.homedir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    shells.set(id, p);
    p.stdin.write(frame('R', { cols, rows }));
    p.stdout.on('data', (b) => send('shell:data', id, new Uint8Array(b)));
    p.stderr.on('data', (b) => {
      const text = crlf(b.toString());
      if (text) send('shell:data', id, new TextEncoder().encode(text));
    });
    p.on('error', (e) => send('shell:data', id, new TextEncoder().encode(`\r\n${e.message}\r\n`)));
    p.on('exit', (code) => {
      if (shells.get(id) === p) shells.delete(id);
      send('shell:exit', id, code);
    });
    p.stdin.on('error', () => {});
    return { ok: true };
  });
  ipcMain.on('shell:input', (_e, id, text) => {
    // a typed NUL is doubled so it isn't read as a control message
    shells.get(id)?.stdin.write(Buffer.from(String(text).replace(/\0/g, '\0\0')));
  });
  ipcMain.on('shell:resize', (_e, id, cols, rows) => shells.get(id)?.stdin.write(frame('R', { cols, rows })));
  ipcMain.on('shell:names', (_e, id, names) => shells.get(id)?.stdin.write(frame('N', { names })));
  ipcMain.on('shell:stop', (_e, id) => shells.get(id)?.stdin.write(frame('S', {})));
  return { stopAll: () => shells.forEach((p) => p.kill()) };
}
