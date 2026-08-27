const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder:    ()       => ipcRenderer.invoke('dialog:openFolder'),
  openFiles:     ()       => ipcRenderer.invoke('dialog:openFiles'),
  scanFolder:    (p)      => ipcRenderer.invoke('fs:scanFolder', p),
  // Drag-and-drop: resolves a mix of dropped file/folder paths into a flat
  // list of audio files (recursing into any dropped folders).
  resolveDroppedPaths: (paths) => ipcRenderer.invoke('fs:resolveDroppedPaths', paths),
  savePlaylistFile: (defaultName) => ipcRenderer.invoke('dialog:savePlaylistFile', defaultName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('fs:writeTextFile', filePath, content),
  showItemInFolder: (filePath) => ipcRenderer.send('shell:showItemInFolder', filePath),
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
  // Global media keys (hardware Play/Pause/Next/Previous) and Windows
  // taskbar thumbnail controls both funnel through this one channel.
  onMediaCommand: (cb) => {
    const listener = (_e, command) => cb(command)
    ipcRenderer.on('media:command', listener)
    return () => ipcRenderer.removeListener('media:command', listener)
  },
  // Lets main process keep the taskbar thumbnail's Play/Pause icon accurate.
  syncPlaybackState: (isPlaying) => ipcRenderer.send('player:state-sync', { isPlaying }),
})
