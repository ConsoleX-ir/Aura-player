import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Song, Playlist, RepeatMode, AppView } from '@/types'
import { DEFAULT_THEME_ID, type ThemePresetId } from '@/lib/themePresets'

interface PlayerState {
  library: Song[]
  setLibrary: (songs: Song[]) => void
  addToLibrary: (songs: Song[]) => void
  removeFromLibrary: (songId: string) => void
  // Batch sibling of removeFromLibrary — same playlist/favorites/queue
  // cleanup, but in one state update instead of N. Used by Folder Sync,
  // which may need to drop many deleted files at once.
  removeSongsFromLibrary: (songIds: string[]) => void
  // Replaces existing library entries (matched by id) with fresh metadata,
  // preserving their position. Used by Folder Sync when a file's mtime has
  // changed since it was last imported.
  updateSongs: (songs: Song[]) => void
  clearLibrary: () => void

  // Top-level folders the user has imported via "Add Folder..." — tracked so
  // Folder Sync knows what to re-scan without the user re-selecting them.
  importedFolders: string[]
  addImportedFolder: (path: string) => void
  removeImportedFolder: (path: string) => void

  playlists: Playlist[]
  // Both return null/false when the name already exists (case- and
  // whitespace-insensitive) instead of silently creating a duplicate —
  // playlist names must be unique.
  createPlaylist: (name: string) => string | null
  deletePlaylist: (id: string) => void
  renamePlaylist: (id: string, name: string) => boolean
  addToPlaylist: (playlistId: string, songId: string) => void
  removeFromPlaylist: (playlistId: string, songId: string) => void

  favorites: string[]
  toggleFavorite: (songId: string) => void

  currentSong: Song | null
  queue: Song[]
  queueIndex: number
  isPlaying: boolean
  volume: number
  // Mute lives in the store (not local UI state) so it can be driven both by
  // the PlayerBar controls AND the "M" keyboard shortcut with a single source
  // of truth. Not persisted — a user unmuting between sessions is the least
  // surprising default, mirroring how system volume behaves.
  muted: boolean
  // What the volume was before the most recent mute, so unmute restores the
  // exact level the user had rather than snapping to some arbitrary value.
  lastAudibleVolume: number
  progress: number
  duration: number
  playSong: (song: Song, queue?: Song[]) => void
  // Removes a song from the live queue by position. No-op if you try to
  // remove the currently-playing song this way — deliberately not handling
  // that edge case (skip to next? stop? something else?) by keeping the
  // remove button hidden for the active row instead, in the UI.
  removeFromQueue: (index: number) => void
  togglePlay: () => void
  setIsPlaying: (v: boolean) => void
  nextSong: () => void
  prevSong: () => void
  seekTo: (v: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
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

  // 'default' = ConsoleX (the original cloud-gray look), 'forest' = same
  // dark base with a green ambient color, 'custom' = user-picked accent color.
  // Any built-in preset id from THEME_PRESETS (lib/themePresets.ts), or
  // 'custom' for a user-picked accent color.
  theme: ThemePresetId | 'custom'
  setTheme: (t: ThemePresetId | 'custom') => void
  customAccentColor: string
  setCustomAccentColor: (c: string) => void

  crossfade: number
  setCrossfade: (v: number) => void

  // Sleep Timer — a timestamp (ms) to auto-pause at, or null when off.
  // Deliberately NOT persisted: a timer left running from a previous session
  // silently firing on next launch would be a confusing surprise, not a
  // convenience.
  sleepTimerEndsAt: number | null
  setSleepTimer: (minutes: number | null) => void

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
      removeSongsFromLibrary: (songIds) => set((s) => {
        const idSet = new Set(songIds)
        const wasCurrentSong = !!s.currentSong && idSet.has(s.currentSong.id)
        return {
          library: s.library.filter((song) => !idSet.has(song.id)),
          playlists: s.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => !idSet.has(id)) })),
          favorites: s.favorites.filter((id) => !idSet.has(id)),
          queue: s.queue.filter((song) => !idSet.has(song.id)),
          currentSong: wasCurrentSong ? null : s.currentSong,
          isPlaying: wasCurrentSong ? false : s.isPlaying,
        }
      }),
      updateSongs: (songs) => set((s) => {
        const updatesById = new Map(songs.map((song) => [song.id, song]))
        return {
          library: s.library.map((song) => updatesById.get(song.id) ?? song),
          // Keep currentSong/queue showing the fresh metadata too, so a
          // sync that updates the title of the song currently playing is
          // reflected immediately instead of after the next song change.
          currentSong: s.currentSong && updatesById.has(s.currentSong.id)
            ? updatesById.get(s.currentSong.id)!
            : s.currentSong,
          queue: s.queue.map((song) => updatesById.get(song.id) ?? song),
        }
      }),
      clearLibrary: () => set({
        library: [], playlists: [], favorites: [], queue: [],
        currentSong: null, isPlaying: false, queueIndex: 0,
        importedFolders: [],
      }),

      importedFolders: [],
      addImportedFolder: (path) => set((s) =>
        s.importedFolders.includes(path) ? s : { importedFolders: [...s.importedFolders, path] }
      ),
      removeImportedFolder: (path) => set((s) => ({
        importedFolders: s.importedFolders.filter((p) => p !== path)
      })),

      playlists: [],
      createPlaylist: (name) => {
        const trimmed = name.trim()
        const isDuplicate = get().playlists.some(
          (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase()
        )
        if (isDuplicate) return null

        const id = crypto.randomUUID()

        set((s) => ({
          playlists: [
            ...s.playlists,
            {
              id,
              name: trimmed,
              songIds: [],
              createdAt: Date.now(),
            },
          ],
        }))

        return id
      },
      deletePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),
      renamePlaylist: (id, name) => {
        const trimmed = name.trim()
        const isDuplicate = get().playlists.some(
          (p) => p.id !== id && p.name.trim().toLowerCase() === trimmed.toLowerCase()
        )
        if (isDuplicate) return false

        set((s) => ({
          playlists: s.playlists.map((p) => p.id === id ? { ...p, name: trimmed } : p)
        }))
        return true
      },
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
      muted: false,
      lastAudibleVolume: 0.8,
      progress: 0,
      duration: 0,
      seekRequest: null,

      playSong: (song, queue) => {
        const q = queue ?? get().library
        const idx = q.findIndex((s) => s.id === song.id)
        set({ currentSong: song, queue: q, queueIndex: Math.max(idx, 0), isPlaying: true, progress: 0 })
      },
      removeFromQueue: (index) => set((s) => {
        if (index === s.queueIndex) return s
        return {
          queue: s.queue.filter((_, i) => i !== index),
          // Shift the pointer down if we removed something before the
          // currently-playing song, so it keeps pointing at the same song.
          queueIndex: index < s.queueIndex ? s.queueIndex - 1 : s.queueIndex,
        }
      }),
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
      // Moving the slider always unmutes — that's what every mainstream
      // player does, and silently changing volume while still muted is a
      // classic "why is there no sound?!" trap.
      setVolume: (v) => set({ volume: v, muted: false }),
      toggleMute: () => set((s) => {
        if (s.muted) {
          const restore = s.lastAudibleVolume > 0 ? s.lastAudibleVolume : s.volume || 0.8
          return { muted: false, volume: restore }
        }
        return { muted: true, lastAudibleVolume: s.volume }
      }),
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

      theme: DEFAULT_THEME_ID,
      setTheme: (t) => set({ theme: t }),
      customAccentColor: '#B0B8C8',
      setCustomAccentColor: (c) => set({ customAccentColor: c }),

      crossfade: 0,
      setCrossfade: (v) => set({ crossfade: v }),

      sleepTimerEndsAt: null,
      setSleepTimer: (minutes) => set({
        sleepTimerEndsAt: minutes ? Date.now() + minutes * 60_000 : null
      }),

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
        importedFolders: s.importedFolders,
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
