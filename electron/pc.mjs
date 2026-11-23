// A map of this PC for the agents: where the owner's stuff lives (home,
// Desktop, Documents, Downloads, every drive), so they can find a file or
// folder by name themselves instead of asking where it is.
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { settings } from './settings.mjs';

const win = process.platform === 'win32';
const wsl = !win && /microsoft/i.test(os.release());

/** Drives that exist: C:\, D:\... on Windows; /mnt/c, /mnt/d... inside WSL. */
function drives() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  if (win) return letters.map((l) => `${l}:\\`).filter((d) => existsSync(d));
  if (wsl) return letters.map((l) => `/mnt/${l.toLowerCase()}`).filter((d) => existsSync(d));
  return ['/'];
}

/** The owner's usual folders, the ones that exist (OneDrive often holds Desktop and Documents on Windows). */
function folders() {
  const home = os.homedir();
  const roots = [home, ...(win && process.env.OneDrive ? [process.env.OneDrive] : [])];
  const names = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Videos', 'Music'];
  const out = [];
  for (const r of roots) for (const n of names) {
    const p = path.join(r, n);
    if (existsSync(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

let cached = null;

export function pcBrief() {
  if (!cached) {
    const d = drives();
    const where = win ? 'Windows' : wsl ? 'Linux inside WSL on Windows (Windows drives are under /mnt)' : process.platform;
    cached = [
      `This PC (${where}) is yours to look through: you know it like its owner does. Home: ${os.homedir()}. Usual folders: ${folders().join(', ') || 'none found'}. Drives: ${d.join(', ')}.`,
      `When you're told about a file, folder, project or app without being told where it is, find it yourself and never ask where it is. Look where it's likely first (the projects folder, Desktop, Documents, Downloads), then the whole home folder, then the other drives. Search by name with the Glob tool (a pattern like **/*name* with path set to the folder) and inside files with Grep; skip node_modules, .git, AppData and other caches. Reading and searching anywhere is fine; only change files inside your own working folder unless you're asked to.`,
    ].join('\n');
  }
  return `${cached}\nThe projects folder: ${settings().projectsRoot}.`;
}
