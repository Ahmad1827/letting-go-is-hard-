// The only bridge between the office page and the machine. Kept tiny on purpose.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('office', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
});
