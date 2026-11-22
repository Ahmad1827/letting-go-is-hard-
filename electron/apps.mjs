// Apps the agents may need to open themselves (Blender for its MCP server).
// Where they're installed is looked up once at startup, so an agent is told
// the exact path instead of hunting through drives and giving up.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** What to look for: the name in Windows' installed-programs list, and the program inside its folder. */
const APPS = [
  { name: 'Blender', match: 'blender', exe: 'blender.exe', bin: 'blender', note: "its MCP server starts with it, on port 9876, about 10-20 s after launch; Blender's MCP tools work once it's up" },
];

/** name -> full path of the program, for the ones found. */
const found = new Map();

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 20000, windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

/** Every installed program's name and folder, from the registry Windows' "Apps" list reads. */
async function installed() {
  const ps = `$k='Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; Get-ItemProperty "HKLM:\\$k","HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKCU:\\$k" -ErrorAction SilentlyContinue | ? DisplayName | % { "$($_.DisplayName)|$($_.InstallLocation)|$($_.DisplayIcon)" }`;
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [name, loc, icon] = l.split('|');
    return { name: name ?? '', loc: loc ?? '', icon: (icon ?? '').replace(/^"|"?,\d+$|"$/g, '') };
  });
}

/** The usual places, for portable copies and ones the installer didn't register. */
function usual(app) {
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const drives = 'CDEFGH'.split('').map((d) => `${d}:\\`);
  return [
    ...pf.map((p) => path.join(p, `${app.name} Foundation`)),
    ...pf.map((p) => path.join(p, app.name)),
    ...drives.map((d) => path.join(d, app.name)),
    ...drives,
    ...drives.map((d) => path.join(d, 'SteamLibrary', 'steamapps', 'common', app.name)),
    path.join('C:\\Program Files (x86)', 'Steam', 'steamapps', 'common', app.name),
  ];
}

export async function findApps() {
  try {
    if (process.platform !== 'win32') {
      for (const app of APPS) {
        const p = (await run('which', [app.bin])).trim();
        if (p) found.set(app.name, p);
      }
      return;
    }
    const list = await installed();
    for (const app of APPS) {
      const candidates = [];
      for (const e of list.filter((e) => e.name.toLowerCase().includes(app.match))) {
        if (e.icon.toLowerCase().endsWith(app.exe)) candidates.push(e.icon);
        if (e.loc) candidates.push(path.join(e.loc, app.exe));
      }
      // Blender's installer keeps each version in its own sub-folder
      for (const dir of usual(app)) candidates.push(path.join(dir, app.exe));
      const hit = candidates.find((c) => existsSync(c));
      if (hit) found.set(app.name, hit);
    }
  } catch {
    // not knowing where an app is only means the agents look for it themselves
  }
}

/** Told to every agent: where the apps are and that opening them is their job. */
export function appsBrief() {
  const win = process.platform === 'win32';
  const lines = APPS.map((app) => {
    const p = found.get(app.name);
    if (!p) return `- ${app.name}: not found in the usual places. If you need it, look for it yourself (${win ? "Windows' installed-programs registry, the root and Program Files of every drive" : 'PATH, /opt, ~/.local'}) before asking.`;
    const start = win ? `powershell -NoProfile -Command "Start-Process '${p}'"` : `nohup '${p}' >/dev/null 2>&1 &`;
    return `- ${app.name} is at ${p}. Start it with \`${start}\`; ${app.note}.`;
  });
  return `Apps on this PC you can open yourself:\n${lines.join('\n')}`;
}
