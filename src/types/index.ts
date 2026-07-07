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
  scanFolder:    (path: string) => Promise<{ path: string; name: string }[]>
  parseMetadata: (path: string) => Promise<Omit<Song, 'id' | 'path'>>
  // Parses many files with limited concurrency in the main process — used instead
  // of calling parseMetadata in a loop, which is slow due to per-call IPC overhead.
  // Progress arrives separately via onMetadataProgress since callbacks can't cross
  // the context bridge — only serializable data can.
  parseMetadataBatch: (paths: string[]) => Promise<Omit<Song, 'id' | 'path'>[]>
  onMetadataProgress: (cb: (done: number, total: number) => void) => () => void
  minimize:      () => void
  maximize:      () => void
  close:         () => void
  isMaximized:   () => Promise<boolean>
  onMaximized:   (cb: (v: boolean) => void) => void
}

declare global {
  interface Window { electronAPI: ElectronAPI }
}
