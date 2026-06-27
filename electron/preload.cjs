const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder:    ()       => ipcRenderer.invoke('dialog:openFolder'),
  scanFolder:    (p)      => ipcRenderer.invoke('fs:scanFolder', p),
  parseMetadata: (p)      => ipcRenderer.invoke('fs:parseMetadata', p),
  minimize:      ()       => ipcRenderer.send('window:minimize'),
  maximize:      ()       => ipcRenderer.send('window:maximize'),
  close:         ()       => ipcRenderer.send('window:close'),
  isMaximized:   ()       => ipcRenderer.invoke('window:isMaximized'),
  onMaximized:   (cb)     => ipcRenderer.on('window:maximized', (_e, v) => cb(v)),
})
