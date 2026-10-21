// The only bridge between the office page and the machine. Kept small on purpose.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (next) => ipcRenderer.invoke('settings:set', next),
    testEngine: (engine) => ipcRenderer.invoke('engine:test', engine),
  },
  /** The staff and teams from last time, and saving them for next time. */
  memory: {
    load: () => ipcRenderer.invoke('memory:load'),
    save: (data) => ipcRenderer.send('memory:save', data),
  },
  app: {
    /** Close like the window's X button would (with the background question and the goodbye). */
    close: () => ipcRenderer.send('app:close'),
    /** The window is closing: play the goodbye, then call done(). */
    onClosing: (cb) => ipcRenderer.on('app:closing', () => cb(() => ipcRenderer.send('app:close-ready'))),
    /** Main asks how many agents are mid-job; answer with count(). */
    onWorkingQuery: (count) => ipcRenderer.on('app:working?', () => ipcRenderer.send('app:working', count())),
    /** The window was hidden to let agents finish (true) or brought back (false). */
    onBackground: (cb) => ipcRenderer.on('app:background', (_e, on) => cb(on)),
    /** Everyone has finished while in the background. */
    allDone: () => ipcRenderer.send('app:all-done'),
  },
  agents: {
    start: (id, cfg) => ipcRenderer.invoke('agent:start', id, cfg),
    send: (id, text) => ipcRenderer.send('agent:send', id, text),
    setModel: (id, model) => ipcRenderer.send('agent:model', id, model),
    interrupt: (id) => ipcRenderer.send('agent:interrupt', id),
    stop: (id) => ipcRenderer.send('agent:stop', id),
    answer: (id, requestId, allow, input, message) => ipcRenderer.send('agent:answer', id, requestId, allow, input, message),
    prepareWork: (req) => ipcRenderer.invoke('work:prepare', req),
    onMessage: (cb) => ipcRenderer.on('agent:msg', (_e, id, msg) => cb(id, msg)),
  },
});
