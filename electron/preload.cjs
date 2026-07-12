const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder:    ()       => ipcRenderer.invoke('dialog:openFolder'),
  openFiles:     ()       => ipcRenderer.invoke('dialog:openFiles'),
  scanFolder:    (p)      => ipcRenderer.invoke('fs:scanFolder', p),
  parseMetadata: (p)      => ipcRenderer.invoke('fs:parseMetadata', p),
  parseMetadataBatch: (paths) => ipcRenderer.invoke('fs:parseMetadataBatch', paths),
  onMetadataProgress: (cb) => {
    const listener = (_e, done, total) => cb(done, total)
    ipcRenderer.on('metadata:progress', listener)
    return () => ipcRenderer.removeListener('metadata:progress', listener)
  },
  // Fired when Aura is launched or focused via double-clicking an
  // associated audio file in Explorer (Task 3 — Windows file association).
  onFileOpened: (cb) => {
    const listener = (_e, filePath) => cb(filePath)
    ipcRenderer.on('file:opened', listener)
    return () => ipcRenderer.removeListener('file:opened', listener)
  },
  minimize:      ()       => ipcRenderer.send('window:minimize'),
  maximize:      ()       => ipcRenderer.send('window:maximize'),
  close:         ()       => ipcRenderer.send('window:close'),
  isMaximized:   ()       => ipcRenderer.invoke('window:isMaximized'),
  onMaximized:   (cb)     => ipcRenderer.on('window:maximized', (_e, v) => cb(v)),
})
