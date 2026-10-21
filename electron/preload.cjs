// The only bridge between the office page and the machine. Kept small on purpose.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  /** The window is closing: play the goodbye, then call done(). */
  onClosing: (cb) => ipcRenderer.on('app:closing', () => cb(() => ipcRenderer.send('app:close-ready'))),
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
