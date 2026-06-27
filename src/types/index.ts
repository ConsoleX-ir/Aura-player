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
export type VisualizerMode = 'bars' | 'circle' | 'wave' | 'off'
export type AppView = 'library' | 'playlist' | 'favorites' | 'nowplaying'

export interface ElectronAPI {
  openFolder:    () => Promise<string | null>
  scanFolder:    (path: string) => Promise<{ path: string; name: string }[]>
  parseMetadata: (path: string) => Promise<Omit<Song, 'id' | 'path'>>
  minimize:      () => void
  maximize:      () => void
  close:         () => void
  isMaximized:   () => Promise<boolean>
  onMaximized:   (cb: (v: boolean) => void) => void
}

declare global {
  interface Window { electronAPI: ElectronAPI }
}
