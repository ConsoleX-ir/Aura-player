// Desktop bridge: implements the `window.electronAPI` contract (src/types) on
// top of Wails bindings, so the React renderer keeps one platform API and the
// Electron-era call sites need no rewrite.
//
// Anything the Go backend does not provide yet is listed in
// NOT_IMPLEMENTED_NATIVE and fails LOUDLY (rejects / logs) — never a silent
// fake success.

import type { ElectronAPI } from '@/types'
import { emit, listenerCount, on } from './events'

/** The subset of Wails-generated bindings and runtime the bridge needs. */
export interface WailsDeps {
  library: {
    ScanFolder(root: string): Promise<{ path: string; name: string; mtimeMs: number }[]>
    ResolveDroppedPaths(paths: string[]): Promise<{ files: { path: string; name: string; mtimeMs: number }[]; folders: string[] }>
    CheckPaths(paths: string[]): Promise<{ path: string; exists: boolean; sizeBytes: number; mtimeMs: number }[]>
  }
  // The generated binding types are structurally looser than the renderer's
  // Song-based contract (e.g. `coverArt?: string` vs `coverArt: string | null`);
  // the JSON payloads are what matters, so deps stay loose and the bridge casts.
  metadata: {
    ParseMetadata(path: string): Promise<unknown>
    ParseMetadataBatch(paths: string[]): Promise<unknown>
    GetFileStats(path: string): Promise<unknown>
  }
  net: {
    ProviderRequest(requestId: string, providerId: string, op: string, params: Record<string, unknown>): Promise<unknown>
    ProviderCancel(requestId: string): Promise<void>
    ProbeOnline(): Promise<unknown>
    FindMetadata(query: import('@/types').FindMetadataQuery): Promise<unknown>
    CacheArtwork(url: string): Promise<string | null>
  }
  watcher: {
    WatchFolders(folders: string[]): Promise<number>
  }
  sys: {
    SyncPlaybackState(isPlaying: boolean): Promise<void>
  }
  dialogs: {
    OpenFolder(): Promise<string>
    OpenFiles(): Promise<string[]>
    SavePlaylistFile(defaultName: string): Promise<string>
    WriteTextFile(path: string, content: string): Promise<boolean>
    SaveImageFile(defaultName: string, dataUrl: string): Promise<string>
  }
  window: {
    Minimize(): Promise<void>
    ToggleMaximize(): Promise<void>
    IsMaximized(): Promise<boolean>
    Close(): Promise<void>
    SetMiniVisible(visible: boolean): Promise<void>
    RestoreFromMini(): Promise<void>
  }
  fileopen: { TakeLaunchFile(): Promise<string> }
  lifecycle: { NotifyShutdownComplete(): Promise<void> }
  shell: {
    ShowItemInFolder(path: string): Promise<void>
    SetAsDefaultMusicPlayer(): Promise<{ ok: boolean; openedSettings?: boolean; reason?: string }>
  }
  /** Wails runtime EventsOn: returns an unsubscribe function. */
  eventsOn(name: string, cb: (...data: unknown[]) => void): () => void
}

/** electronAPI members that still have no Go backend (see docs/CURRENT_STATE_AUDIT.md).
 *  After the Stage-2 bridge completion this list is EMPTY: every contract
 *  member is mapped onto a Go service. The loud-failure machinery is kept for
 *  any future contract addition that has not landed in Go yet. */
export const NOT_IMPLEMENTED_NATIVE = [] as const

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))
const orNull = (s: string): string | null => (s ? s : null)

export function createDesktopApi(d: WailsDeps): ElectronAPI {
  // ── window state ──────────────────────────────────────────────────────────
  let maximized = false
  const refreshMaximized = async (): Promise<boolean> => {
    try {
      const v = await d.window.IsMaximized()
      if (v !== maximized) { maximized = v; emit('window:maximized', v) }
    } catch { /* window going away */ }
    return maximized
  }

  // Wails has no maximize/restore event; the webview resizes when it changes.
  if (typeof window !== 'undefined') {
    let t: ReturnType<typeof setTimeout> | undefined
    window.addEventListener('resize', () => {
      clearTimeout(t)
      t = setTimeout(() => { void refreshMaximized() }, 120)
    })
  }

  // ── Go → renderer events, forwarded into the local bus ───────────────────
  d.eventsOn('mini:visibility', (v) => emit('mini:visibility', !!v))
  d.eventsOn('media:command', (c) => emit('media:command', c))
  d.eventsOn('watch:changed', (c) => emit('watch:changed', c))
  d.eventsOn('drag:dropped', (paths) => emit('drag:dropped', paths))

  // The launch file (Explorer double-click) is held until a listener exists.
  let pendingLaunch: string | null = null
  void d.fileopen.TakeLaunchFile().then((p) => {
    if (!p) return
    pendingLaunch = p
    flushLaunch()
  }).catch(() => { /* no launch file */ })
  const flushLaunch = () => {
    // Keep it pending until someone is listening: emitting into the void would
    // silently drop the Explorer double-click that launched the app.
    if (pendingLaunch === null || listenerCount('file:opened') === 0) return
    const p = pendingLaunch
    pendingLaunch = null
    emit('file:opened', p)
  }
  d.eventsOn('file:opened', (p) => emit('file:opened', String(p)))

  const unsub = (name: string, cb: (v: never) => void, opts?: { replay?: boolean }) =>
    on(name, cb as (v: unknown) => void, opts)

  return {
    // dialogs + filesystem
    openFolder: () => d.dialogs.OpenFolder().then(orNull),
    openFiles: () => d.dialogs.OpenFiles(),
    scanFolder: (p) => d.library.ScanFolder(p),
    resolveDroppedPaths: (paths) => d.library.ResolveDroppedPaths(paths),
    checkPaths: (paths) => d.library.CheckPaths(paths),
    savePlaylistFile: (name) => d.dialogs.SavePlaylistFile(name).then(orNull),
    writeTextFile: (p, c) => d.dialogs.WriteTextFile(p, c),
    saveImageFile: (name, dataUrl) => d.dialogs.SaveImageFile(name, dataUrl).then(orNull, () => null),
    showItemInFolder: (p) => { d.shell.ShowItemInFolder(p).catch((e) => console.error('[aura] showItemInFolder', e)) },
    setAsDefaultMusicPlayer: () => d.shell.SetAsDefaultMusicPlayer(),

    // ── metadata (Go: internal/metadata, replaces music-metadata) ──────────
    parseMetadata: (path) => d.metadata.ParseMetadata(path) as Promise<Omit<import('@/types').Song, 'id' | 'path'>>,
    parseMetadataBatch: (paths) => d.metadata.ParseMetadataBatch(paths) as Promise<Omit<import('@/types').Song, 'id' | 'path'>[]>,
    getFileStats: (path) => d.metadata.GetFileStats(path) as Promise<import('@/types').SongFileStats>,

    // ── online layer (Go: internal/providers — the allowlist dispatcher) ───
    providerRequest: (requestId, providerId, op, params) => d.net.ProviderRequest(requestId, providerId, op, params),
    providerCancel: (requestId) => { void d.net.ProviderCancel(requestId) },
    probeOnline: () => d.net.ProbeOnline() as Promise<boolean | { ok: boolean; kind: string; detail?: string; latencyMs: number }>,
    findMetadata: (query) => d.net.FindMetadata(query) as Promise<{ ok: true; candidates: import('@/types').OnlineMatch[] } | { ok: false; error: string }>,
    cacheArtwork: (url) => d.net.CacheArtwork(url),

    // ── live library (Go: internal/watcher, 1.2 s per-folder debounce) ─────
    watchFolders: (folders) => d.watcher.WatchFolders(folders),
    onMetadataProgress: (cb) => d.eventsOn('metadata:progress', (...args) => {
      const [done, total] = args as [number, number]
      cb(Number(done) || 0, Number(total) || 0)
    }),
    onWatchChange: (cb) => unsub('watch:changed', cb),

    // Drag-and-drop from the OS arrives through Wails OnFileDrop → Go filters
    // audio files → 'drag:dropped'. (Electron's File.path does not exist in
    // WebView2 — this is the replacement path.)
    onDragDropped: (cb) => {
      const handler = (paths: unknown): void => {
        if (Array.isArray(paths) && paths.length > 0) cb(paths as string[])
      }
      return on('drag:dropped', handler as (v: unknown) => void)
    },

    syncPlaybackState: (isPlaying) => { void d.sys.SyncPlaybackState(isPlaying) },

    // events
    onFileOpened: (cb) => {
      const off = unsub('file:opened', cb)
      flushLaunch()
      return off
    },
    onMediaCommand: (cb) => unsub('media:command', cb),
    onMediaSeek: (cb) => unsub('media:seek', cb),
    onMediaVolume: (cb) => unsub('media:volume', cb),

    // window chrome
    minimize: () => { void d.window.Minimize() },
    maximize: () => { void d.window.ToggleMaximize().then(refreshMaximized) },
    close: () => { void d.window.Close() },
    isMaximized: refreshMaximized,
    onMaximized: (cb) => { unsub('window:maximized', cb) },

    // coordinated shutdown
    onShutdown: (cb) => d.eventsOn('app:shutdown', () => { Promise.resolve(cb()).catch(() => {}) }),
    notifyShutdownComplete: () => { void d.lifecycle.NotifyShutdownComplete() },

    // mini player: single window, so state/actions travel on the in-process bus
    pushMiniState: (state) => emit('mini:state', state, { remember: true }),
    onMiniState: (cb) => unsub('mini:state', cb, { replay: true }),
    onMiniVisibility: (cb) => unsub('mini:visibility', cb),
    setMiniVisible: (visible) => { void d.window.SetMiniVisible(!!visible) },
    miniAction: (action) => {
      switch (action) {
        case 'togglePlay': emit('media:command', 'toggle'); break
        case 'next': emit('media:command', 'next'); break
        case 'previous': emit('media:command', 'previous'); break
        case 'toggleMute': emit('media:command', 'mute'); break
        case 'restore': void d.window.RestoreFromMini(); break
        case 'close': void d.window.SetMiniVisible(false); break
      }
    },
    miniSeek: (fraction) => { if (Number.isFinite(fraction)) emit('media:seek', clamp01(fraction)) },
    setMiniVolume: (volume) => { if (Number.isFinite(volume)) emit('media:volume', clamp01(volume)) },
  }
}
