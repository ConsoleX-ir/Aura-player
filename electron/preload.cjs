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
  // Library Health (Phase 1): batch existence check for every library entry.
  // Per-path exists:false results instead of throws, so one vanished file
  // can't fail a whole health scan.
  checkPaths: (paths)    => ipcRenderer.invoke('fs:checkPaths', paths),
  // ── Provider Core (Phase 3) ──────────────────────────────────────────────
  // One channel for every online music provider. The renderer names a
  // provider id + op (both allowlisted in the main process) and never a URL.
  // Resolves with the op's result, or a { kind, message } payload the
  // renderer turns into a typed ProviderError.
  providerRequest: (requestId, providerId, op, params) =>
    ipcRenderer.invoke('net:providerRequest', String(requestId), String(providerId), String(op), params),
  // Cancels an in-flight provider request by requestId (best-effort).
  providerCancel: (requestId) => ipcRenderer.send('net:providerCancel', String(requestId)),
  // True when the machine can actually reach the internet right now
  // (HEAD request with a 4s cap) — navigator.onLine is only the first hint.
  probeOnline: () => ipcRenderer.invoke('net:probeOnline'),
  // Technical file properties for the Properties dialog (size, codec, bitrate...).
  getFileStats: (p)       => ipcRenderer.invoke('fs:fileStats', p),
  // Keyless "Find Info Online" — searches Deezer, iTunes, and MusicBrainz
  // from the main process (text queries only, no audio upload, no API key)
  // and returns scored, de-duplicated metadata candidates.
  findMetadata: (query)  => ipcRenderer.invoke('net:findMetadata', query),
  // Downloads a remote artwork URL into Aura's local covers cache and returns
  // a persistent aura:// URL for it (or null on failure).
  cacheArtwork: (url)     => ipcRenderer.invoke('net:cacheArtwork', url),
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
  // ── Folder watching (Wave 4) ──────────────────────────────────────────────
  // Sends the FULL desired watch set every time — main replaces its live
  // watchers wholesale, so renderer-side bookkeeping stays trivial.
  watchFolders: (folders) => ipcRenderer.invoke('fs:watchFolders', folders),
  onWatchChange: (cb) => {
    const listener = (_e, change) => cb(change)
    ipcRenderer.on('watch:changed', listener)
    return () => ipcRenderer.removeListener('watch:changed', listener)
  },
  // Rewind share-card export: save dialog + binary PNG write in one hop.
  saveImageFile: (defaultName, dataUrl) => ipcRenderer.invoke('dialog:saveImageFile', defaultName, dataUrl),
  // ── Coordinated shutdown (Wave 0) ─────────────────────────────────────────
  // Main holds the window open once and asks us to flush pending state
  // writes; the renderer resolves (possibly async) then acks, and only
  // then does main let the close proceed. A no-op in plain browsers.
  onShutdown: (cb) => {
    const listener = () => { Promise.resolve(cb()).catch(() => {}) }
    ipcRenderer.on('app:shutdown', listener)
    return () => ipcRenderer.removeListener('app:shutdown', listener)
  },
  notifyShutdownComplete: () => ipcRenderer.send('app:shutdown-complete'),
  // ── Desktop mini player (v2.1.2) ──────────────────────────────────────────
  // The mini player is its own frameless BrowserWindow, NOT a component of
  // the main window. The main renderer pushes tiny state snapshots through
  // pushMiniState; main relays them to the mini window. Actions travel the
  // other way via miniAction (main remaps them onto the existing
  // 'media:command' channel). Both windows share THIS preload — same
  // contextIsolation posture, no new privileged surface.
  pushMiniState: (state) => ipcRenderer.send('mini:state', state),
  setMiniVisible: (visible) => ipcRenderer.send('mini:setVisible', !!visible),
  miniAction: (action) => ipcRenderer.send('mini:action', String(action)),
  onMiniState: (cb) => {
    const listener = (_e, state) => cb(state)
    ipcRenderer.on('mini:state', listener)
    return () => ipcRenderer.removeListener('mini:state', listener)
  },
  // Main → main-window sync so the P key / command palette / pill button
  // reflect the real widget visibility (minimize auto-shows, X hides).
  onMiniVisibility: (cb) => {
    const listener = (_e, visible) => cb(visible)
    ipcRenderer.on('mini:visibility', listener)
    return () => ipcRenderer.removeListener('mini:visibility', listener)
  },
  // Test-mode hooks — main only registers these channels when
  // AURA_USER_DATA_DIR is set (CI/Xvfb has no window manager, so real
  // OS minimize events never fire there). Silent no-op in normal use.
  testEmitWindowEvent: (ev) => ipcRenderer.send(`test:emit${String(ev)}`),
})
