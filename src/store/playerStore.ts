import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Song, Playlist, RepeatMode, AppView } from '@/types'

interface PlayerState {
  library: Song[]
  setLibrary: (songs: Song[]) => void
  addToLibrary: (songs: Song[]) => void
  removeFromLibrary: (songId: string) => void
  clearLibrary: () => void

  playlists: Playlist[]
  createPlaylist: (name: string) => string
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

  // Settings — Performance Mode disables backdrop blur + decorative animations,
  // aimed at weaker systems (older GPUs, integrated graphics, low RAM)
  performanceMode: boolean
  setPerformanceMode: (v: boolean) => void

  theme: 'default' | 'custom'
  setTheme: (t: 'default' | 'custom') => void
  customAccentColor: string
  setCustomAccentColor: (c: string) => void

  crossfade: number
  setCrossfade: (v: number) => void

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
      // Removes a song from the app's index only — the file on disk is never touched.
      // Also cleans it out of every playlist, favorites, and the live queue so nothing
      // is left pointing at a song that no longer exists in the library.
      removeFromLibrary: (songId) => set((s) => {
        const wasCurrentSong = s.currentSong?.id === songId
        return {
          library: s.library.filter((song) => song.id !== songId),
          playlists: s.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => id !== songId) })),
          favorites: s.favorites.filter((id) => id !== songId),
          queue: s.queue.filter((song) => song.id !== songId),
          currentSong: wasCurrentSong ? null : s.currentSong,
          isPlaying: wasCurrentSong ? false : s.isPlaying,
        }
      }),
      clearLibrary: () => set({
        library: [], playlists: [], favorites: [], queue: [],
        currentSong: null, isPlaying: false, queueIndex: 0,
      }),

      playlists: [],
      createPlaylist: (name) => {
        const id = crypto.randomUUID()

          set((s) => ({
          playlists: [
          ...s.playlists,
          {
            id,
            name,
            songIds: [],
            createdAt: Date.now(),
          },
        ],
      }))

    return id
    },
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

      performanceMode: false,
      setPerformanceMode: (v) => set({ performanceMode: v }),

      theme: 'default',
      setTheme: (t) => set({ theme: t }),
      customAccentColor: '#B0B8C8',
      setCustomAccentColor: (c) => set({ customAccentColor: c }),

      crossfade: 0,
      setCrossfade: (v) => set({ crossfade: v }),

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
        performanceMode: s.performanceMode,
        theme: s.theme,
        customAccentColor: s.customAccentColor,
        crossfade: s.crossfade,
      }),
    }
  )
)
