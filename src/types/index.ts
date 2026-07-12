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

export interface ElectronAPI {
  openFolder:    () => Promise<string | null>
  openFiles:     () => Promise<string[]>
  scanFolder:    (path: string) => Promise<{ path: string; name: string; mtimeMs: number }[]>
  parseMetadata: (path: string) => Promise<Omit<Song, 'id' | 'path'>>
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
  minimize:      () => void
  maximize:      () => void
  close:         () => void
  isMaximized:   () => Promise<boolean>
  onMaximized:   (cb: (v: boolean) => void) => void
}

declare global {
  interface Window { electronAPI: ElectronAPI }
}
