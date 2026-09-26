// Exposes a small, safe API to the UI as window.desktop.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  // Real on-disk path of a dropped File, so videos are read in place instead of copied.
  pathForFile: (file) => webUtils.getPathForFile(file),
  pickVideos: () => ipcRenderer.invoke('pick-videos'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  showItemInFolder: (p) => ipcRenderer.invoke('show-item', p),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  setUnsaved: (id, value) => ipcRenderer.send('unsaved', id, Boolean(value)),
});
