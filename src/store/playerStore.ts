import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Song, Playlist, RepeatMode, AppView } from '@/types'
import { DEFAULT_THEME_ID, type ThemePresetId } from '@/lib/themePresets'
import { idbStorage } from '@/lib/idbStorage'
import type { SortKey, SortDir } from '@/lib/sort'
import {
  shuffledAround, nextIndex, prevIndex, removeByIds,
} from '@/lib/queueEngine'
import { eqPresetById, clampDb, isFlat, sanitizeGains } from '@/lib/eq'

interface PlayerState {
  library: Song[]
  setLibrary: (songs: Song[]) => void
  addToLibrary: (songs: Song[]) => void
  removeFromLibrary: (songId: string) => void
  // Batch sibling of removeFromLibrary — same playlist/favorites/queue
  // cleanup, but in one state update instead of N. Used by Folder Sync,
  // which may need to drop many deleted files at once. NOTE: deliberately
  // does NOT tombstone (see removedPaths) — a sync removal means the FILE
  // is gone from disk, so there is nothing to prevent re-importing; if the
  // file comes back (recycle-bin restore), it should re-appear.
  removeSongsFromLibrary: (songIds: string[]) => void

  // ── Removal tombstones (Wave 0 — persistence stability) ───────────────
  // Paths the user deliberately removed from the library (the file itself
  // may still exist on disk). Folder Sync reconciles disk → library, so
  // without tombstones every sync would silently resurrect exactly what
  // the user deleted. Tombstones are cleared by explicit re-import
  // (Add Files / Add Folder / drag-drop / file-association launch —
  // restoreImportedPaths) and garbage-collected by Folder Sync once the
  // file no longer exists on disk (a re-created file at the same path is
  // fresh import material, not the song the user deleted).
  removedPaths: string[]
  restoreImportedPaths: (paths: string[]) => void
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
  // The queue IS the actual playback order — what the queue view shows is
  // exactly what will play, shuffle ON or OFF (queueEngine enforces this).
  queue: Song[]
  queueIndex: number
  // The un-shuffled context playSong() was given. Kept alongside `queue` so
  // toggling shuffle OFF can restore the natural order instead of leaving
  // the queue permanently scrambled. Not persisted (matches `queue`).
  naturalQueue: Song[]
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
  // Auto-advance when a track finishes naturally (audio 'ended'). Unlike
  // nextSong() (manual skip, always advances/wraps), this respects the
  // repeat mode as an END-OF-QUEUE policy: repeat=none STOPS playback at
  // the last song instead of silently restarting it (a v1.x UI/audio
  // desync bug).
  trackEnded: () => void

  // Settings — Performance Mode disables backdrop blur + decorative animations,
  // aimed at weaker systems (older GPUs, integrated graphics, low RAM)
  performanceMode: boolean
  setPerformanceMode: (v: boolean) => void

  // ── Appearance (v2.0.0 — Wave 5 light activation) ─────────────────────
  // 'dark' is the true Aura form; 'light' is the designed glow-first
  // foundation from tokens.css now given a toggle. Persisted.
  appearance: 'dark' | 'light'
  setAppearance: (v: 'dark' | 'light') => void

  // ── Folder watching (Wave 4) ──────────────────────────────────────────
  // When on, every imported folder is watched via Electron's fs.watch and
  // the library auto-reconciles through Folder Sync. Persisted; defaults
  // ON so the feature works out of the box (it is event-driven — zero
  // polling cost while nothing changes).
  watchFolders: boolean
  setWatchFolders: (v: boolean) => void

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

  // EQ (Wave 3): per-band gains in dB for the 10 reserved BiquadFilter bands
  // (31 Hz → 16 kHz). `eqPreset` is the last preset applied, or 'custom' once
  // a band is moved by hand — purely cosmetic bookkeeping for the UI. Flat =
  // all zeros = the engine's zero-cost bypass (peaking filters at 0 dB are
  // transparent), so "EQ off" needs no special audio path at all.
  eqGains: number[]
  eqPreset: string
  setEqBand: (index: number, gainDb: number) => void
  applyEqPreset: (presetId: string) => void

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

  // ── Library view state (Wave 0 — persisted) ───────────────────────────
  // v2.1.0 kept these session-local; the Wave 0 persistence gate overrides
  // that: sort key, sort direction and list/grid mode must survive
  // Change → Close → Restart like every other user preference. Search text
  // stays ephemeral by design (a search is a moment, not a preference).
  librarySortKey: SortKey
  librarySortDir: SortDir
  libraryViewMode: 'list' | 'grid'
  setLibrarySortKey: (k: SortKey) => void
  setLibrarySortDir: (d: SortDir) => void
  setLibraryViewMode: (m: 'list' | 'grid') => void

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
        const queueNext = removeByIds(s.queue, new Set([songId]), s.queueIndex)
        // Tombstone the file path so Folder Sync never resurrects this song
        // (Wave 0: user-intent removals are remembered across syncs).
        const removedSong = s.library.find((song) => song.id === songId)
        const removedPaths = removedSong && !s.removedPaths.includes(removedSong.path)
          ? [...s.removedPaths, removedSong.path]
          : s.removedPaths
        return {
          library: s.library.filter((song) => song.id !== songId),
          playlists: s.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => id !== songId) })),
          favorites: s.favorites.filter((id) => id !== songId),
          queue: queueNext.items,
          queueIndex: queueNext.currentIndex ?? s.queueIndex,
          naturalQueue: s.naturalQueue.filter((song) => song.id !== songId),
          currentSong: wasCurrentSong ? null : s.currentSong,
          isPlaying: wasCurrentSong ? false : s.isPlaying,
          // A removed playing song must not leave stale seek/time UI behind.
          progress: wasCurrentSong ? 0 : s.progress,
          duration: wasCurrentSong ? 0 : s.duration,
          removedPaths,
        }
      }),
      removeSongsFromLibrary: (songIds) => set((s) => {
        const idSet = new Set(songIds)
        const wasCurrentSong = !!s.currentSong && idSet.has(s.currentSong.id)
        const queueNext = removeByIds(s.queue, idSet, s.queueIndex)
        return {
          library: s.library.filter((song) => !idSet.has(song.id)),
          playlists: s.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => !idSet.has(id)) })),
          favorites: s.favorites.filter((id) => !idSet.has(id)),
          queue: queueNext.items,
          queueIndex: queueNext.currentIndex ?? s.queueIndex,
          naturalQueue: s.naturalQueue.filter((song) => !idSet.has(song.id)),
          currentSong: wasCurrentSong ? null : s.currentSong,
          isPlaying: wasCurrentSong ? false : s.isPlaying,
          // Same stale-UI guard as removeFromLibrary (no tombstones here —
          // the FILES are gone; see interface note).
          progress: wasCurrentSong ? 0 : s.progress,
          duration: wasCurrentSong ? 0 : s.duration,
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
          // Same freshness for the natural-order snapshot — otherwise a
          // shuffle-off restore would resurrect stale titles/cover art.
          naturalQueue: s.naturalQueue.map((song) => updatesById.get(song.id) ?? song),
        }
      }),
      clearLibrary: () => set({
        library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
        currentSong: null, isPlaying: false, queueIndex: 0,
        importedFolders: [],
        // Folder tracking is wiped too, so sync can never run again against
        // anything — tombstones would be dead weight. A future re-import is
        // explicit intent and never hits a tombstone path anyway.
        removedPaths: [],
      }),

      removedPaths: [],
      restoreImportedPaths: (paths) => set((s) => {
        if (!s.removedPaths.length) return s
        const drop = new Set(paths)
        const next = s.removedPaths.filter((p) => !drop.has(p))
        return next.length === s.removedPaths.length ? s : { removedPaths: next }
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
      naturalQueue: [],
      isPlaying: false,
      volume: 0.8,
      muted: false,
      lastAudibleVolume: 0.8,
      progress: 0,
      duration: 0,
      seekRequest: null,

      playSong: (song, queue) => {
        const { shuffle } = get()
        const q = queue ?? get().library
        const idx = q.findIndex((s) => s.id === song.id)
        if (idx >= 0) {
          // Shuffle ON: the new context gets a real shuffled play order with
          // this song anchored where it was — the queue view then shows the
          // truth about what plays next.
          const playQueue = shuffle ? shuffledAround(q, song.id) : q
          set({ currentSong: song, naturalQueue: q, queue: playQueue, queueIndex: idx, isPlaying: true, progress: 0 })
        } else {
          // Song isn't part of the given context (e.g. launched from a file
          // association with an empty library). v1.x pointed queueIndex at 0
          // — a DIFFERENT song — so next/prev navigated from the wrong anchor.
          // Leading the queue with the song gives every later action a valid
          // anchor and a sensible continuation.
          const q2 = [song, ...q]
          set({ currentSong: song, naturalQueue: q2, queue: q2, queueIndex: 0, isPlaying: true, progress: 0 })
        }
      },
      removeFromQueue: (index) => set((s) => {
        if (index === s.queueIndex || index < 0 || index >= s.queue.length) return s
        const removedId = s.queue[index].id
        const next = removeByIds(s.queue, new Set([removedId]), s.queueIndex)
        return {
          queue: next.items,
          queueIndex: next.currentIndex ?? s.queueIndex,
          // Keep the natural-order snapshot in sync so shuffle OFF restores
          // the context minus the song you just removed.
          naturalQueue: s.naturalQueue.filter((song) => song.id !== removedId),
        }
      }),
      togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
      setIsPlaying: (v) => set({ isPlaying: v }),

      // Manual skip: always advances (wraps at the end) so navigation is
      // never stuck. The queue is the real play order, so "next" is simply
      // the next item — v1.x re-rolled Math.random() here, which could
      // replay the same song and never matched the displayed queue.
      nextSong: () => {
        const { queue, queueIndex, repeat } = get()
        if (!queue.length) return
        const next = nextIndex(queue.length, queueIndex, repeat, false)
        if (next === null) return
        set({ currentSong: queue[next], queueIndex: next, isPlaying: true, progress: 0 })
      },

      prevSong: () => {
        const { queue, queueIndex, progress, duration, repeat } = get()
        if (!queue.length) return
        if (progress * duration > 3) { set({ seekRequest: 0 }); return }
        const prev = prevIndex(queue.length, queueIndex, repeat)
        set({ currentSong: queue[prev], queueIndex: prev, isPlaying: true, progress: 0 })
      },

      // Natural end-of-track. repeat=one is handled entirely by the audio
      // controller (it restarts the element without touching the queue);
      // everything else follows the queue's real order, and repeat=none
      // STOPS at the end instead of restarting the last song.
      trackEnded: () => {
        const { queue, queueIndex, repeat } = get()
        if (!queue.length || repeat === 'one') return
        const next = nextIndex(queue.length, queueIndex, repeat, true)
        if (next === null) {
          set({ isPlaying: false })
          return
        }
        set({ currentSong: queue[next], queueIndex: next, isPlaying: true, progress: 0 })
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
      // Shuffle becomes a REAL reorder of the queue (the play order), not a
      // per-skip dice roll. Turning it on permutes the queue around the
      // current song (its index is preserved — playback state untouched) and
      // snapshots the natural order; turning it off restores that snapshot.
      // Either way the queue view shows exactly what will play.
      toggleShuffle: () => set((s) => {
        if (!s.shuffle) {
          const shuffled = shuffledAround(s.queue, s.currentSong?.id ?? null)
          const idx = s.currentSong
            ? shuffled.findIndex((x) => x.id === s.currentSong!.id)
            : s.queueIndex
          return { shuffle: true, naturalQueue: s.queue, queue: shuffled, queueIndex: Math.max(idx, 0) }
        }
        const restored = s.naturalQueue.length ? s.naturalQueue : s.queue
        const idx = s.currentSong
          ? restored.findIndex((x) => x.id === s.currentSong!.id)
          : s.queueIndex
        return { shuffle: false, queue: restored, queueIndex: Math.max(idx, 0) }
      }),
      cycleRepeat: () => set((s) => {
        const cycle: RepeatMode[] = ['none', 'all', 'one']
        return { repeat: cycle[(cycle.indexOf(s.repeat) + 1) % cycle.length] }
      }),

      performanceMode: false,
      setPerformanceMode: (v) => set({ performanceMode: v }),

      appearance: 'dark',
      setAppearance: (v) => set({ appearance: v }),

      watchFolders: true,
      setWatchFolders: (v) => set({ watchFolders: v }),

      theme: DEFAULT_THEME_ID,
      setTheme: (t) => set({ theme: t }),
      customAccentColor: '#B0B8C8',
      setCustomAccentColor: (c) => set({ customAccentColor: c }),

      crossfade: 0,
      setCrossfade: (v) => set({ crossfade: v }),

      eqGains: sanitizeGains(undefined),
      eqPreset: 'flat',
      setEqBand: (index, gainDb) => set((s) => {
        if (index < 0 || index > 9) return s
        const eqGains = s.eqGains.map((g, i) => (i === index ? clampDb(gainDb) : g))
        // Manual edits label the state 'custom' — unless the user dragged
        // everything back to zero, which is just Flat again.
        return {
          eqGains,
          eqPreset: isFlat(eqGains) ? 'flat' : 'custom',
        }
      }),
      applyEqPreset: (presetId) => set(() => {
        const preset = eqPresetById(presetId)
        if (!preset) return {}
        return { eqGains: [...preset.gains], eqPreset: preset.id }
      }),

      sleepTimerEndsAt: null,
      setSleepTimer: (minutes) => set({
        sleepTimerEndsAt: minutes ? Date.now() + minutes * 60_000 : null
      }),

      activeView: 'library',
      setActiveView: (v) => set({ activeView: v }),
      selectedPlaylistId: null,
      setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),

      librarySortKey: 'added',
      librarySortDir: 'asc',
      libraryViewMode: 'list',
      setLibrarySortKey: (k) => set({ librarySortKey: k }),
      setLibrarySortDir: (d) => set({ librarySortDir: d }),
      setLibraryViewMode: (m) => set({ libraryViewMode: m }),
    }),
    {
      name: 'aura-player',
      // v2: IndexedDB instead of localStorage. Two wins: async writes that
      // never block the main thread, and debounced flushes that coalesce
      // the ~4-10Hz playback progress ticks (previously each tick
      // re-stringified the whole library JSON synchronously). The adapter
      // transparently migrates a v1.x localStorage library on first run.
      // NOTE: version stays 0 (the v1.x default) on purpose — the persisted
      // SHAPE is unchanged; only the storage backend moved. Bumping it
      // without a migrate fn would make zustand discard users' libraries.
      storage: createJSONStorage(() => idbStorage),
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
        eqGains: s.eqGains,
        eqPreset: s.eqPreset,
        appearance: s.appearance,
        watchFolders: s.watchFolders,
        // Wave 0 — persistence stability: tombstones keep deleted songs
        // deleted; library sort/view preferences survive restarts.
        removedPaths: s.removedPaths,
        librarySortKey: s.librarySortKey,
        librarySortDir: s.librarySortDir,
        libraryViewMode: s.libraryViewMode,
      }),
    }
  )
)