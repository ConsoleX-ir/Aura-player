import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Song, Playlist, RepeatMode, VisualizerMode, AppView } from '@/types'

interface PlayerState {
  library: Song[]
  setLibrary: (songs: Song[]) => void
  addToLibrary: (songs: Song[]) => void

  playlists: Playlist[]
  createPlaylist: (name: string) => void
  deletePlaylist: (id: string) => void
  renamePlaylist: (id: string, name: string) => void
  addToPlaylist: (playlistId: string, songId: string) => void
  removeFromPlaylist: (playlistId: string, songId: string) => void

  favorites: string[]
  toggleFavorite: (songId: string) => void

  currentSong: Song | null
  queue: Song[]
  queueIndex: number
  isPlaying: boolean
  volume: number
  progress: number
  duration: number
  playSong: (song: Song, queue?: Song[]) => void
  togglePlay: () => void
  setIsPlaying: (v: boolean) => void
  nextSong: () => void
  prevSong: () => void
  seekTo: (v: number) => void
  setVolume: (v: number) => void
  setProgress: (v: number) => void
  setDuration: (v: number) => void

  shuffle: boolean
  repeat: RepeatMode
  toggleShuffle: () => void
  cycleRepeat: () => void

  visualizerMode: VisualizerMode
  setVisualizerMode: (m: VisualizerMode) => void

  activeView: AppView
  setActiveView: (v: AppView) => void
  selectedPlaylistId: string | null
  setSelectedPlaylistId: (id: string | null) => void

  // seekTo trigger watched by audio engine
  seekRequest: number | null
  clearSeekRequest: () => void
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      library: [],
      setLibrary: (songs) => set({ library: songs }),
      addToLibrary: (songs) => set((s) => ({
        library: [...s.library, ...songs.filter((n) => !s.library.find((e) => e.id === n.id))]
      })),

      playlists: [],
      createPlaylist: (name) => set((s) => ({
        playlists: [...s.playlists, { id: crypto.randomUUID(), name, songIds: [], createdAt: Date.now() }]
      })),
      deletePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),
      renamePlaylist: (id, name) => set((s) => ({
        playlists: s.playlists.map((p) => p.id === id ? { ...p, name } : p)
      })),
      addToPlaylist: (pid, sid) => set((s) => ({
        playlists: s.playlists.map((p) =>
          p.id === pid && !p.songIds.includes(sid) ? { ...p, songIds: [...p.songIds, sid] } : p
        )
      })),
      removeFromPlaylist: (pid, sid) => set((s) => ({
        playlists: s.playlists.map((p) =>
          p.id === pid ? { ...p, songIds: p.songIds.filter((id) => id !== sid) } : p
        )
      })),

      favorites: [],
      toggleFavorite: (songId) => set((s) => ({
        favorites: s.favorites.includes(songId)
          ? s.favorites.filter((id) => id !== songId)
          : [...s.favorites, songId]
      })),

      currentSong: null,
      queue: [],
      queueIndex: 0,
      isPlaying: false,
      volume: 0.8,
      progress: 0,
      duration: 0,
      seekRequest: null,

      playSong: (song, queue) => {
        const q = queue ?? get().library
        const idx = q.findIndex((s) => s.id === song.id)
        set({ currentSong: song, queue: q, queueIndex: Math.max(idx, 0), isPlaying: true, progress: 0 })
      },
      togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
      setIsPlaying: (v) => set({ isPlaying: v }),

      nextSong: () => {
        const { queue, queueIndex, shuffle, repeat } = get()
        if (!queue.length) return
        let next: number
        if (shuffle) next = Math.floor(Math.random() * queue.length)
        else if (repeat === 'all') next = (queueIndex + 1) % queue.length
        else next = Math.min(queueIndex + 1, queue.length - 1)
        set({ currentSong: queue[next], queueIndex: next, isPlaying: true, progress: 0 })
      },

      prevSong: () => {
        const { queue, queueIndex, progress, duration } = get()
        if (!queue.length) return
        if (progress * duration > 3) { set({ seekRequest: 0 }); return }
        const prev = Math.max(queueIndex - 1, 0)
        set({ currentSong: queue[prev], queueIndex: prev, isPlaying: true, progress: 0 })
      },

      seekTo: (v) => set({ seekRequest: v }),
      clearSeekRequest: () => set({ seekRequest: null }),
      setVolume: (v) => set({ volume: v }),
      setProgress: (v) => set({ progress: v }),
      setDuration: (v) => set({ duration: v }),

      shuffle: false,
      repeat: 'none',
      toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
      cycleRepeat: () => set((s) => {
        const cycle: RepeatMode[] = ['none', 'all', 'one']
        return { repeat: cycle[(cycle.indexOf(s.repeat) + 1) % cycle.length] }
      }),

      visualizerMode: 'bars',
      setVisualizerMode: (m) => set({ visualizerMode: m }),

      activeView: 'library',
      setActiveView: (v) => set({ activeView: v }),
      selectedPlaylistId: null,
      setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
    }),
    {
      name: 'aura-player',
      partialize: (s) => ({
        library: s.library,
        playlists: s.playlists,
        favorites: s.favorites,
        volume: s.volume,
        shuffle: s.shuffle,
        repeat: s.repeat,
        visualizerMode: s.visualizerMode,
      }),
    }
  )
)
