// Looks through the projects folder so agents have something real to pitch on.
// Read-only: lists folders, samples their files, and reads a little git metadata.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROJECTS_ROOT = path.join(os.homedir(), 'proiecte');

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'release', 'venv', '.venv', '__pycache__', 'target', '.next', 'out', 'coverage']);
const LANGS = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.cs': 'C#', '.cpp': 'C++', '.c': 'C',
  '.html': 'HTML', '.css': 'CSS', '.gd': 'GDScript', '.swift': 'Swift', '.dart': 'Dart', '.rb': 'Ruby', '.php': 'PHP',
};
const MAX_FILES = 1500;

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 3000 }, (err, stdout) => resolve(err ? '' : stdout.trim()));
  });
}

async function walk(dir, root, out, depth) {
  if (depth > 4 || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) await walk(full, root, out, depth + 1);
    } else if (e.isFile()) {
      let size = 0;
      try {
        size = (await fs.stat(full)).size;
      } catch {
        // unreadable file, count it anyway
      }
      out.push({ rel: path.relative(root, full), size });
    }
  }
}

async function describe(dir) {
  const files = [];
  await walk(dir, dir, files, 0);
  const counts = {};
  for (const f of files) {
    const lang = LANGS[path.extname(f.rel).toLowerCase()];
    if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
  }
  const languages = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const source = files.filter((f) => LANGS[path.extname(f.rel).toLowerCase()] && !/\.(html|css)$/i.test(f.rel));
  const biggest = source.sort((a, b) => b.size - a.size)[0]?.rel ?? null;
  const hasTests = files.some((f) => /(^|\/)(tests?|__tests__|spec)\//i.test(f.rel) || /\.(test|spec)\.\w+$/i.test(f.rel) || /(^|\/)test_\w+\.py$/.test(f.rel));
  const readmeFile = files.find((f) => /^readme(\.\w+)?$/i.test(f.rel));
  let readme = null;
  if (readmeFile) {
    try {
      const text = await fs.readFile(path.join(dir, readmeFile.rel), 'utf8');
      readme = text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find((l) => l.length > 3)?.slice(0, 160) ?? null;
    } catch {
      // leave it null
    }
  }
  const isGit = await fs.access(path.join(dir, '.git')).then(() => true, () => false);
  const lastCommit = isGit ? await git(dir, ['log', '-1', '--format=%s']) : '';
  return {
    name: path.basename(dir),
    path: dir,
    languages,
    files: files.length,
    biggest,
    hasTests,
    hasReadme: !!readmeFile,
    readme,
    isGit,
    lastCommit: lastCommit || null,
    hasCi: files.some((f) => f.rel.startsWith('.github/workflows/')),
  };
}

/** Every sub-folder of the projects root, newest first. */
export async function listProjects(root = PROJECTS_ROOT) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(root, e.name));
  const withTimes = await Promise.all(dirs.map(async (d) => ({ d, t: (await fs.stat(d)).mtimeMs })));
  withTimes.sort((a, b) => b.t - a.t);
  return Promise.all(withTimes.map(({ d }) => describe(d)));
}
