import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAgents } from './agents.mjs';
import { listProjects } from './projects.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    title: 'Letting Go Is Hard',
    icon: path.join(here, '../build/icon.png'),
    backgroundColor: '#008080',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(here, 'preload.cjs'), autoplayPolicy: 'no-user-gesture-required' },
  });
  win.once('ready-to-show', () => win.show());

  // the office is the whole app: links open in the real browser, the window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // closing plays the lights-out goodbye first; the page says when it's done
  let closing = false;
  win.on('close', (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    agents.stopAll();
    win.webContents.send('app:closing');
    setTimeout(() => !win.isDestroyed() && win.destroy(), 12000); // in case the page never answers
  });
  ipcMain.once('app:close-ready', () => !win.isDestroyed() && win.destroy());

  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(here, '../dist/index.html'));
}

Menu.setApplicationMenu(null);

ipcMain.handle('projects:list', () => listProjects());
const agents = setupAgents(ipcMain, () => BrowserWindow.getAllWindows()[0]);
app.on('before-quit', () => agents.stopAll());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
