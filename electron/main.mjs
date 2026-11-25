import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, shell } from 'electron';
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAgents } from './agents.mjs';
import { findApps } from './apps.mjs';
import { startScreen } from './screen.mjs';
import { listProjects } from './projects.mjs';
import { loadSettings, saveSettings, settings, testEngine } from './settings.mjs';
import { planUsage } from './usage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.VITE_DEV_SERVER_URL;

// one office at a time: opening the app again brings back the existing window
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
/** The window is hidden while agents finish their jobs. */
let inBackground = false;
let closing = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    title: 'Letting Go Is Hard',
    icon: path.join(here, '../build/icon.png'),
    backgroundColor: '#008080',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(here, 'preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required',
      // agents keep working while the window is hidden
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // the office is the whole app: links open in the real browser, the window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('close', (e) => {
    if (closing) return;
    e.preventDefault();
    void requestClose();
  });

  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(here, '../dist/index.html'));
}

/** Ask the page how many agents are mid-job, so closing can offer to let them finish. */
function workingCount() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(0), 1500);
    ipcMain.once('app:working', (_e, n) => {
      clearTimeout(timer);
      resolve(n);
    });
    win.webContents.send('app:working?');
  });
}

async function requestClose() {
  const n = await workingCount();
  let choice = settings().onClose;
  if (n > 0 && choice === 'ask') {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Letting Go Is Hard',
      message: `${n} ${n === 1 ? 'agent is' : 'agents are'} still working.`,
      detail: 'Let them finish their approved jobs in the background? They stay on their own branches, nobody starts anything new, and the app closes by itself when they are done. Open the app again to check in.',
      buttons: ['Finish in the background', 'Stop them and close', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    choice = ['finish', 'stop', 'cancel'][response];
  }
  if (choice === 'cancel') return;
  if (n > 0 && choice === 'finish') {
    inBackground = true;
    win.hide();
    win.webContents.send('app:background', true);
    return;
  }
  goodbye();
}

/** Lights out: stop the agents, play the goodbye, then quit. */
function goodbye() {
  closing = true;
  agents.stopAll();
  if (!win.isVisible()) return win.destroy();
  win.webContents.send('app:closing');
  setTimeout(() => !win.isDestroyed() && win.destroy(), 12000); // in case the page never answers
}

Menu.setApplicationMenu(null);

ipcMain.handle('projects:list', () => listProjects());
ipcMain.handle('settings:get', () => settings());
ipcMain.handle('settings:set', (_e, next) => saveSettings(next));
ipcMain.handle('engine:test', (_e, engine) => testEngine(engine));
ipcMain.handle('usage:get', () => planUsage());
// pictures for messages: a screenshot on the system clipboard (the page's paste event can miss it),
// and an image dragged in from a web browser, which arrives as a link rather than a file
ipcMain.handle('picture:clipboard', () => {
  const img = clipboard.readImage();
  return img.isEmpty() ? null : img.toPNG();
});
ipcMain.handle('picture:fetch', async (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(15000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > 25_000_000 ? null : { type, bytes };
  } catch {
    return null;
  }
});
// who works here, remembered between runs; written synchronously so it lands even while quitting
const memoryFile = () => path.join(app.getPath('userData'), 'office.json');
ipcMain.handle('memory:load', () => {
  try {
    return JSON.parse(readFileSync(memoryFile(), 'utf8'));
  } catch {
    return null;
  }
});
ipcMain.on('memory:save', (_e, data) => {
  try {
    // an office going empty keeps the last staff in office.bak.json, in case that wasn't meant
    if (!data.agents?.length && existsSync(memoryFile()) && JSON.parse(readFileSync(memoryFile(), 'utf8')).agents?.length)
      copyFileSync(memoryFile(), memoryFile().replace(/\.json$/, '.bak.json'));
    writeFileSync(`${memoryFile()}.tmp`, JSON.stringify(data));
    renameSync(`${memoryFile()}.tmp`, memoryFile());
  } catch (e) {
    console.error('Could not save the office:', e.message);
  }
});
ipcMain.on('app:close', () => win?.close());
ipcMain.on('app:close-ready', () => win && !win.isDestroyed() && win.destroy());
// everyone finished while the window was hidden: time to go home
ipcMain.on('app:all-done', () => {
  if (inBackground) goodbye();
});
const agents = setupAgents(ipcMain, () => win);
app.on('before-quit', () => agents.stopAll());

app.on('second-instance', () => {
  if (!win) return;
  if (inBackground) {
    inBackground = false;
    win.webContents.send('app:background', false);
  }
  win.show();
  win.focus();
});

app.whenReady().then(async () => {
  await loadSettings();
  // agents' screenshots, taken by the app itself
  startScreen();
  // where Blender and co. are, so agents can open them themselves
  void findApps();
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
