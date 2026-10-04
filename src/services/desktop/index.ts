// The desktop boundary (Aura 4 §3): the ONLY module in the renderer that
// talks to Tauri. UI components call semantic APIs — desktop.library.*,
// desktop.playback.*, desktop.providers.* — and never invoke raw commands
// themselves. Every command name lives here, typed, in one place.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** Typed invoke: command names stay inside this module. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args)
}

// ── shared shapes (mirror the Rust structs) ─────────────────────────────────

export interface Track {
  id: string
  kind: 'local' | 'remote'
  title: string
  artist: string
  album: string
  durationSecs: number
  path?: string
  sizeBytes?: number
  mtimeMs?: number
  missing?: boolean
  provider?: string
  providerTrackId?: string
  year?: number | null
  genre?: string | null
  trackNumber?: number | null
  artworkUrl?: string | null
  addedAt: number
  updatedAt: number
}

export interface Playlist {
  id: string
  name: string
  songIds: string[]
  createdAt: number
}

export interface SyncResult {
  added: number
  removed: number
  updated: number
  upsertedTracks: Track[]
  removedTrackIds: string[]
  untrackedFolders: string[]
}

export interface CatalogSnapshot {
  tracks: Track[]
  libraryIds: string[]
  favorites: string[]
  playlists: Playlist[]
  musicFolders: string[]
  notes: { trackId: string; text: string; updatedAt: number }[]
  artworkOverrides: { trackId: string; url: string; addedAt: number }[]
  prefs: [string, string][]
}

export interface ScannedFile {
  path: string
  mtimeMs: number
}

export interface PathCheck {
  path: string
  exists: boolean
  sizeBytes: number
  mtimeMs: number
}

export interface FileStats {
  sizeBytes: number
  extension: string
  bitrateKbps: number | null
  sampleRateHz: number | null
  channels: number | null
  codec: string | null
  container: string | null
}

export interface ResolvedSource {
  url: string
  streamCors: boolean
}

export interface HistorySession {
  trackId: string | null
  title: string
  artist: string
  album: string
  startedAt: number
  playedMs: number
  durationSecs: number
  completed: boolean
  skipped: boolean
}

export interface HistoryRow {
  id: number
  trackId: string | null
  title: string
  artist: string
  album: string
  startedAt: number
  playedMs: number
  durationSecs: number
  completed: boolean
  skipped: boolean
}

// ── library ─────────────────────────────────────────────────────────────────

export const library = {
  snapshot: () => call<CatalogSnapshot>('library_get_snapshot'),
  scanFolder: (folder: string) => call<ScannedFile[]>('library_scan_folder', { folder }),
  importFiles: (paths: string[]) =>
    call<SyncResult>('library_import_files', { paths }),
  importDropped: (paths: string[]) =>
    call<SyncResult>('library_import_dropped', { paths }),
  addMusicFolder: (folder: string) => call<void>('library_add_music_folder', { folder }),
  removeMusicFolder: (folder: string) => call<void>('library_remove_music_folder', { folder }),
  syncAll: () => call<SyncResult>('library_sync_all'),
  addToLibrary: (trackIds: string[]) => call<void>('library_add_to_library', { trackIds }),
  removeFromLibrary: (trackIds: string[]) =>
    call<void>('library_remove_from_library', { trackIds }),
  setFavorite: (trackId: string, favorite: boolean) =>
    call<void>('library_set_favorite', { trackId, favorite }),
  fileStats: (path: string) => call<FileStats>('library_file_stats', { path }),
  checkPaths: (paths: string[]) => call<PathCheck[]>('library_check_paths', { paths }),
  resolveDropped: (paths: string[]) =>
    call<{ files: ScannedFile[]; folders: string[] }>('library_resolve_dropped', { paths }),
  localTrackId: (path: string) => call<string>('library_local_track_id', { path }),
  watchFolders: () => call<number>('library_watch_folders'),

  playlists: {
    list: () => call<Playlist[]>('playlists_list'),
    create: (name: string) => call<string>('playlists_create', { name }),
    rename: (playlistId: string, name: string) =>
      call<void>('playlists_rename', { playlistId, name }),
    delete: (playlistId: string) => call<void>('playlists_delete', { playlistId }),
    addItem: (playlistId: string, trackId: string) =>
      call<void>('playlists_add_item', { playlistId, trackId }),
    removeItem: (playlistId: string, trackId: string) =>
      call<void>('playlists_remove_item', { playlistId, trackId }),
  },

  notes: {
    set: (trackId: string, text: string) => call<void>('notes_set', { trackId, text }),
  },

  artwork: {
    setOverride: (trackId: string, url: string) =>
      call<void>('artwork_set_override', { trackId, url }),
    removeOverride: (trackId: string) => call<void>('artwork_remove_override', { trackId }),
    cacheRemote: (url: string) =>
      call<{ url: string | null; message?: string }>('artwork_cache_remote', { url }),
  },

  history: {
    append: (session: HistorySession) => call<number>('history_append', { session }),
    list: (limit: number) => call<HistoryRow[]>('history_list', { limit }),
  },

  prefs: {
    set: (key: string, value: string) => call<void>('prefs_set', { key, value }),
    delete: (key: string) => call<void>('prefs_delete', { key }),
  },
}

// ── playback ────────────────────────────────────────────────────────────────

export const playback = {
  resolveSource: (trackId: string) =>
    call<ResolvedSource>('playback_resolve_source', { trackId }),
}

// ── providers (allowlisted ops live on the Rust side) ───────────────────────

export const providers = {
  call: (requestId: string, providerId: string, op: string, params: Record<string, unknown>) =>
    call<unknown>('provider_call', { requestId, providerId, op, params }),
  cancel: (requestId: string) => call<void>('provider_cancel', { requestId }),
  probeOnline: () =>
    call<{ ok: boolean; kind: string; detail?: string | null; latencyMs: number }>(
      'provider_probe_online',
    ),
  findMetadata: (query: { title: string; artist: string; album: string; duration: number }) =>
    call<{ ok: true; candidates: unknown[] } | { ok: false; error: string }>(
      'provider_find_metadata',
      { query },
    ),
}

// ── window / mini player / system ───────────────────────────────────────────

export interface MiniState {
  hasSong: boolean
  title: string
  artist: string
  artworkUrl: string | null
  isPlaying: boolean
  progress: number
  appearance: 'dark' | 'light'
  theme?: string
  accent?: { d1: string; d2: string; d3: string; glow: string; onAccent?: string }
  nextTitle?: string | null
}

export const windows = {
  minimize: () => call<void>('window_minimize'),
  maximize: () => call<void>('window_maximize'),
  close: () => call<void>('window_close'),
  isMaximized: () => call<boolean>('window_is_maximized'),
  emitReady: () => call<void>('window_emit_ready'),

  mini: {
    pushState: (state: MiniState) => call<void>('mini_push_state', { stateSnapshot: state }),
    show: () => call<void>('mini_show'),
    hide: () => call<void>('mini_hide'),
    action: (action: 'togglePlay' | 'next' | 'previous' | 'toggleMute' | 'restore' | 'close') =>
      call<void>('mini_action', { action }),
    seek: (fraction: number) => call<void>('mini_seek', { fraction }),
    setVolume: (volume: number) => call<void>('mini_set_volume', { volume }),
  },
}

export const system = {
  revealPath: (path: string) => call<void>('system_reveal_path', { path }),
  setDefaultPlayer: () =>
    call<{ ok: boolean; openedSettings?: boolean; reason?: string }>('system_set_default_player'),
  exportFile: (path: string, content: string, kind: 'text' | 'image-data-url') =>
    call<boolean>('system_export_file', { path, content, kind }),
}

// ── events (Rust → renderer) ────────────────────────────────────────────────

export const events = {
  onMediaCommand: (cb: (command: 'toggle' | 'next' | 'previous' | 'mute') => void) =>
    listen<string>('media://command', (e) => cb(e.payload as never)) as Promise<UnlistenFn>,
  onMediaSeek: (cb: (fraction: number) => void) =>
    listen<number>('media://seek', (e) => cb(e.payload)) as Promise<UnlistenFn>,
  onMediaVolume: (cb: (volume: number) => void) =>
    listen<number>('media://volume', (e) => cb(e.payload)) as Promise<UnlistenFn>,
  onMiniState: (cb: (state: MiniState) => void) =>
    listen<MiniState>('mini://state', (e) => cb(e.payload)) as Promise<UnlistenFn>,
  onMiniVisibility: (cb: (visible: boolean) => void) =>
    listen<boolean>('mini://visibility', (e) => cb(e.payload)) as Promise<UnlistenFn>,
  onFileOpened: (cb: (path: string) => void) =>
    listen<string>('file://opened', (e) => cb(e.payload)) as Promise<UnlistenFn>,
  onMaximized: (cb: (v: boolean) => void) =>
    listen<boolean>('window://maximized', (e) => cb(e.payload)) as Promise<UnlistenFn>,
  onLibraryChanged: (cb: (result: SyncResult) => void) =>
    listen<SyncResult>('library://changed', (e) => cb(e.payload)) as Promise<UnlistenFn>,
  onScanProgress: (cb: (p: { done: number; total: number }) => void) =>
    listen<{ done: number; total: number }>('library://scan-progress', (e) => cb(e.payload)) as Promise<UnlistenFn>,
}

/** True when running inside the Tauri desktop shell (vs a plain browser). */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// Named namespace export — `import { desktop } from '@/services/desktop'`.
export const desktop = {
  library,
  playback,
  providers,
  windows,
  system,
  events,
  isDesktop,
}

export default desktop
