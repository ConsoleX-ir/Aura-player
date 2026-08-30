export interface Song {
  id: string
  path: string
  title: string
  artist: string
  album: string
  duration: number
  coverArt: string | null
  year?: number | null
  genre?: string | null
  trackNumber?: number | null
  // File modification time at the point this song was last (re-)imported —
  // lets Folder Sync detect changed files with a cheap stat instead of
  // re-parsing every file's metadata on every sync.
  mtimeMs?: number
}

export interface Playlist {
  id: string
  name: string
  songIds: string[]
  createdAt: number
}

export type RepeatMode = 'none' | 'one' | 'all'
export type AppView = 'library' | 'playlist' | 'favorites' | 'nowplaying' | 'settings'

// Technical file properties, fetched on demand by the Properties dialog.
export interface SongFileStats {
  sizeBytes: number
  extension: string
  bitrateKbps: number | null
  sampleRateHz: number | null
  channels: number | null
  codec: string | null
  container: string | null
}

// One de-duplicated candidate returned by the keyless "Find Info Online"
// lookup (Deezer + iTunes + MusicBrainz merged — see net:findMetadata in
// main.cjs). `sources` holds which of the three found this candidate, e.g.
// ['deezer','itunes'].
export interface OnlineMatch {
  title: string | null
  artist: string | null
  album: string | null
  year: number | null
  genre: string | null
  durationSec: number | null
  artworkUrl: string | null
  sources: string[]
  links: string[]
  score: number
}

export type FindMetadataQuery = {
  title: string
  artist: string
  album: string
  duration: number
}

export interface ElectronAPI {
  openFolder:    () => Promise<string | null>
  openFiles:     () => Promise<string[]>
  scanFolder:    (path: string) => Promise<{ path: string; name: string; mtimeMs: number }[]>
  resolveDroppedPaths: (paths: string[]) => Promise<{
    files: { path: string; name: string; mtimeMs: number }[]
    folders: string[]
  }>
  // Playlist export (M3U) — shows a native save dialog, returns the chosen
  // path (or null if cancelled), then writeTextFile actually writes it.
  savePlaylistFile: (defaultName: string) => Promise<string | null>
  writeTextFile: (filePath: string, content: string) => Promise<boolean>
  showItemInFolder: (filePath: string) => void
  parseMetadata: (path: string) => Promise<Omit<Song, 'id' | 'path'>>
  // Technical file properties for the Properties dialog — fetched on demand.
  getFileStats: (path: string) => Promise<SongFileStats>
  // Keyless online metadata lookup (Deezer + iTunes + MusicBrainz — no API
  // key, text queries only). Resolves to { ok:true, candidates } — candidates
  // sorted best-first — or { ok:false, error } on a total network failure.
  findMetadata: (query: FindMetadataQuery) => Promise<{ ok: true; candidates: OnlineMatch[] } | { ok: false; error: string }>
  // Downloads a remote artwork image into Aura's covers cache; returns a
  // persistent aura:// URL, or null if the download failed.
  cacheArtwork: (url: string) => Promise<string | null>
  // Parses many files with limited concurrency in the main process — used instead
  // of calling parseMetadata in a loop, which is slow due to per-call IPC overhead.
  // Progress arrives separately via onMetadataProgress since callbacks can't cross
  // the context bridge — only serializable data can.
  parseMetadataBatch: (paths: string[]) => Promise<Omit<Song, 'id' | 'path'>[]>
  onMetadataProgress: (cb: (done: number, total: number) => void) => () => void
  // Task 3 — fired when Aura is opened via a file association (double-clicking
  // an audio file in Explorer), whether that's the launch itself or a second
  // launch attempt routed to the already-running instance.
  onFileOpened: (cb: (filePath: string) => void) => () => void
  // Global media keys and Windows taskbar thumbnail controls both arrive here.
  onMediaCommand: (cb: (command: 'toggle' | 'next' | 'previous') => void) => () => void
  syncPlaybackState: (isPlaying: boolean) => void
  minimize:      () => void
  maximize:      () => void
  close:         () => void
  isMaximized:   () => Promise<boolean>
  onMaximized:   (cb: (v: boolean) => void) => void
}

declare global {
  interface Window { electronAPI: ElectronAPI }
}
