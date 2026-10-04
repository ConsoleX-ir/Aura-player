import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Track, RepeatMode, AppView, LibraryTab } from '@/types'
import { DEFAULT_THEME_ID, type ThemePresetId } from '@/lib/themePresets'
import { desktopPrefsStorage } from '@/lib/desktopPrefsStorage'
import type { SortKey, SortDir } from '@/lib/sort'
import {
  shuffledAround, nextIndex, prevIndex, removeByIds, moveItem, indexAfterMove, insertAfter, upcomingIds,
} from '@/lib/queueEngine'
import { eqPresetById, clampDb, isFlat, sanitizeGains } from '@/lib/eq'
import { sanitizeFx, sanitizeUserPresets, NEUTRAL_FX, type AudioFxState, type FxUserPreset } from '@/lib/audioFx'
import {
  clampPreampDb, clampBalance, sanitizeEqUserPresets,
  type EqUserPreset,
} from '@/lib/audioStudio'
import { appendSmartPicks, pruneSmartIds } from '@/lib/smartQueue'

// ── Aura 4 player store ─────────────────────────────────────────────────────
// The PLAYBACK domain (§13): queue, transport state, audio studio state, and
// the session's view state. Persisted preferences go through the SQLite
// prefs table (desktopPrefsStorage) — the catalog itself lives in
// catalogStore, mirrored from SQLite, and is NOT persisted here anymore.
//
// Queue persistence: the queue survives restarts as ID REFERENCES rebuilt
// against the catalog at boot (see pendingQueueRestore + the boot sequence).
// Restored queues NEVER autoplay — the user resumes explicitly.

interface PlayerState {
  // ── playback runtime ──
  currentSong: Track | null
  // The queue IS the actual playback order — what the queue view shows is
  // exactly what will play, shuffle ON or OFF (queueEngine enforces this).
  queue: Track[]
  queueIndex: number
  // The un-shuffled context playSong() was given. Kept alongside `queue` so
  // toggling shuffle OFF can restore the natural order. Not persisted.
  naturalQueue: Track[]
  isPlaying: boolean
  volume: number
  muted: boolean
  lastAudibleVolume: number
  progress: number
  duration: number
  seekRequest: number | null
  clearSeekRequest: () => void

  playSong: (song: Track, queue?: Track[]) => void
  removeFromQueue: (index: number) => void
  reorderQueueItem: (from: number, to: number) => void
  playNextInQueue: (song: Track) => void
  addToQueueEnd: (song: Track) => void
  clearUpcomingQueue: () => void
  jumpToQueueIndex: (index: number) => void
  togglePlay: () => void
  setIsPlaying: (v: boolean) => void
  nextSong: () => void
  prevSong: () => void
  seekTo: (v: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setProgress: (v: number) => void
  setDuration: (v: number) => void
  trackEnded: () => void

  // ── Smart Queue session state (never persisted) ──
  smartAddedIds: string[]
  smartReasons: Record<string, string>
  smartRemovedIds: string[]
  extendWithSmartPicks: (picks: { song: Track; reason: string }[]) => void

  shuffle: boolean
  repeat: RepeatMode
  smartQueue: boolean
  setSmartQueue: (v: boolean) => void
  toggleShuffle: () => void
  cycleRepeat: () => void

  // ── preferences (persisted through SQLite prefs) ──
  performanceMode: boolean
  setPerformanceMode: (v: boolean) => void
  appearance: 'dark' | 'light'
  ambientEffects: boolean
  setAmbientEffects: (v: boolean) => void
  setAppearance: (v: 'dark' | 'light') => void
  watchFolders: boolean
  setWatchFolders: (v: boolean) => void
  theme: ThemePresetId | 'custom'
  setTheme: (t: ThemePresetId | 'custom') => void
  customAccentColor: string
  setCustomAccentColor: (c: string) => void
  crossfade: number
  setCrossfade: (v: number) => void

  eqGains: number[]
  eqPreset: string
  setEqBand: (index: number, gainDb: number) => void
  applyEqPreset: (presetId: string) => void

  audioFx: AudioFxState
  setAudioFx: (patch: Partial<AudioFxState>) => void
  fxUserPresets: FxUserPreset[]
  saveFxPreset: (name: string) => void
  deleteFxPreset: (name: string) => void
  renameFxPreset: (oldName: string, newName: string) => void
  duplicateFxPreset: (name: string) => void

  preampDb: number
  setPreampDb: (v: number) => void
  balance: number
  setBalance: (v: number) => void
  limiterEnabled: boolean
  setLimiterEnabled: (v: boolean) => void
  eqEnabled: boolean
  setEqEnabled: (v: boolean) => void
  studioBypass: boolean
  setStudioBypass: (v: boolean) => void
  resetStudio: () => void
  eqUserPresets: EqUserPreset[]
  saveEqPreset: (name: string) => void
  renameEqPreset: (id: string, newName: string) => void
  duplicateEqPreset: (id: string) => void
  deleteEqPreset: (id: string) => void
  applyEqUserPreset: (id: string) => void

  sleepTimerEndsAt: number | null
  setSleepTimer: (minutes: number | null) => void

  librarySortKey: SortKey
  librarySortDir: SortDir
  libraryViewMode: 'list' | 'grid'
  setLibrarySortKey: (k: SortKey) => void
  setLibrarySortDir: (d: SortDir) => void
  setLibraryViewMode: (m: 'list' | 'grid') => void

  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void

  // ── view state (session) ──
  activeView: AppView
  previousView: AppView | null
  setActiveView: (v: AppView) => void
  goBack: () => void
  selectedPlaylistId: string | null
  setSelectedPlaylistId: (id: string | null) => void
  selectedArtist: string | null
  setSelectedArtist: (name: string | null) => void
  selectedAlbum: { artist: string; album: string } | null
  setSelectedAlbum: (key: { artist: string; album: string } | null) => void
  /** Tab inside the Library destination (Aura 4 navigation model). */
  libraryTab: LibraryTab
  setLibraryTab: (t: LibraryTab) => void

  // ── queue restore (boot-time; consumed once) ──
  pendingQueueRestore: {
    queueIds: string[]
    naturalQueueIds: string[]
    queueIndex: number
    currentSongId: string | null
  } | null
  consumePendingQueueRestore: (resolve: (id: string) => Track | undefined) => void
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
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
        const q = queue ?? []
        const idx = q.findIndex((s) => s.id === song.id)
        if (idx >= 0) {
          const playQueue = shuffle ? shuffledAround(q, song.id) : q
          set({ currentSong: song, naturalQueue: q, queue: playQueue, queueIndex: idx, isPlaying: true, progress: 0 })
        } else {
          // Track isn't part of the given context (e.g. launched from a file
          // association). Leading the queue with it gives every later action
          // a valid anchor and a sensible continuation.
          const q2 = [song, ...q]
          set({ currentSong: song, naturalQueue: q2, queue: q2, queueIndex: 0, isPlaying: true, progress: 0 })
        }
      },
      removeFromQueue: (index) => set((s) => {
        if (index === s.queueIndex || index < 0 || index >= s.queue.length) return s
        const removedId = s.queue[index].id
        const next = removeByIds(s.queue, new Set([removedId]), s.queueIndex)
        const wasSmart = s.smartAddedIds.includes(removedId)
        return {
          queue: next.items,
          queueIndex: next.currentIndex ?? s.queueIndex,
          naturalQueue: s.naturalQueue.filter((song) => song.id !== removedId),
          smartAddedIds: s.smartAddedIds.filter((id) => id !== removedId),
          smartRemovedIds: wasSmart ? [...s.smartRemovedIds, removedId] : s.smartRemovedIds,
        }
      }),
      togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
      setIsPlaying: (v) => set({ isPlaying: v }),

      // Queue 2.0 manual controls: the playing item NEVER moves as a side
      // effect of an edit; every action corrects the playhead via index math.
      reorderQueueItem: (from, to) => set((s) => {
        if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return s
        const nextQueue = moveItem(s.queue, from, to)
        return {
          queue: nextQueue,
          queueIndex: indexAfterMove(s.queueIndex, from, to),
          naturalQueue: s.shuffle ? s.naturalQueue : moveItem(s.naturalQueue, from, to),
        }
      }),
      playNextInQueue: (song) => set((s) => {
        if (s.queue[s.queueIndex + 1]?.id === song.id) return s
        const nextQueue = insertAfter(s.queue, s.queueIndex, song)
        const natIdx = s.naturalQueue.findIndex((x) => x.id === s.queue[s.queueIndex]?.id)
        return {
          queue: nextQueue,
          naturalQueue: s.shuffle ? insertAfter(s.naturalQueue, natIdx, song) : nextQueue,
        }
      }),
      addToQueueEnd: (song) => set((s) => ({
        queue: [...s.queue, song],
        naturalQueue: [...s.naturalQueue, song],
      })),
      clearUpcomingQueue: () => set((s) => {
        const doomed = upcomingIds(s.queue, s.queueIndex)
        if (doomed.size === 0) return s
        const nextQueue = s.queue.slice(0, s.queueIndex + 1)
        return {
          queue: nextQueue,
          naturalQueue: s.shuffle ? s.naturalQueue.filter((x) => !doomed.has(x.id)) : nextQueue,
          smartAddedIds: s.smartAddedIds.filter((id) => !doomed.has(id)),
        }
      }),
      jumpToQueueIndex: (index) => set((s) => {
        if (index < 0 || index >= s.queue.length || index === s.queueIndex) return s
        return { currentSong: s.queue[index], queueIndex: index, isPlaying: true, progress: 0 }
      }),

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
      smartQueue: true,
      smartAddedIds: [],
      smartReasons: {},
      smartRemovedIds: [],
      setSmartQueue: (v) => set({ smartQueue: v }),
      extendWithSmartPicks: (picks) => set((s) => {
        const r = appendSmartPicks(s.queue, s.naturalQueue, picks)
        if (!r) return s
        return {
          queue: r.queue,
          naturalQueue: r.naturalQueue,
          smartAddedIds: pruneSmartIds([...s.smartAddedIds, ...r.addedIds], r.queue),
          smartReasons: { ...s.smartReasons, ...r.reasons },
        }
      }),
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
      ambientEffects: true,
      setAmbientEffects: (v) => set({ ambientEffects: v }),
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

      audioFx: { ...NEUTRAL_FX },
      setAudioFx: (patch) => set((s) => ({ audioFx: sanitizeFx({ ...s.audioFx, ...patch }) })),
      fxUserPresets: [],
      saveFxPreset: (name) => set((s) => {
        const trimmed = name.trim()
        if (!trimmed) return s
        const rest = s.fxUserPresets.filter((p) => p.name !== trimmed)
        return { fxUserPresets: [...rest, { name: trimmed, state: { ...s.audioFx }, createdAt: Date.now() }] }
      }),
      deleteFxPreset: (name) => set((s) => ({
        fxUserPresets: s.fxUserPresets.filter((p) => p.name !== name),
      })),
      renameFxPreset: (oldName, newName) => set((s) => {
        const trimmed = newName.trim()
        if (!trimmed || trimmed === oldName) return s
        return {
          fxUserPresets: s.fxUserPresets.map((p) =>
            p.name === oldName ? { ...p, name: trimmed } : p.name === trimmed ? null : p
          ).filter((p): p is FxUserPreset => p !== null),
        }
      }),
      duplicateFxPreset: (name) => set((s) => {
        const src = s.fxUserPresets.find((p) => p.name === name)
        if (!src) return s
        let copy = `${src.name} copy`
        let n = 2
        while (s.fxUserPresets.some((p) => p.name === copy)) copy = `${src.name} copy ${n++}`
        return { fxUserPresets: [...s.fxUserPresets, { name: copy, state: { ...src.state }, createdAt: Date.now() }] }
      }),

      preampDb: 0,
      setPreampDb: (v) => set({ preampDb: clampPreampDb(v) }),
      balance: 0,
      setBalance: (v) => set({ balance: clampBalance(v) }),
      limiterEnabled: false,
      setLimiterEnabled: (v) => set({ limiterEnabled: v }),
      eqEnabled: true,
      setEqEnabled: (v) => set({ eqEnabled: v }),
      studioBypass: false,
      setStudioBypass: (v) => set({ studioBypass: v }),
      resetStudio: () => set({
        eqGains: sanitizeGains(undefined),
        eqPreset: 'flat',
        eqEnabled: true,
        audioFx: { ...NEUTRAL_FX },
        preampDb: 0,
        balance: 0,
        limiterEnabled: false,
        studioBypass: false,
      }),
      eqUserPresets: [],
      saveEqPreset: (name) => set((s) => {
        const trimmed = name.trim()
        if (!trimmed) return s
        const rest = s.eqUserPresets.filter((p) => p.name !== trimmed)
        return {
          eqUserPresets: [...rest, { id: `eq-${Date.now()}`, name: trimmed, gains: [...s.eqGains], createdAt: Date.now() }],
          eqPreset: trimmed,
        }
      }),
      renameEqPreset: (id, newName) => set((s) => {
        const trimmed = newName.trim()
        if (!trimmed) return s
        return {
          eqUserPresets: s.eqUserPresets.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
          eqPreset: s.eqPreset === s.eqUserPresets.find((p) => p.id === id)?.name ? trimmed : s.eqPreset,
        }
      }),
      duplicateEqPreset: (id) => set((s) => {
        const src = s.eqUserPresets.find((p) => p.id === id)
        if (!src) return s
        let copy = `${src.name} copy`
        let n = 2
        while (s.eqUserPresets.some((p) => p.name === copy)) copy = `${src.name} copy ${n++}`
        return {
          eqUserPresets: [...s.eqUserPresets, { id: `eq-${Date.now()}`, name: copy, gains: [...src.gains], createdAt: Date.now() }],
        }
      }),
      deleteEqPreset: (id) => set((s) => ({
        eqUserPresets: s.eqUserPresets.filter((p) => p.id !== id),
      })),
      applyEqUserPreset: (id) => set((s) => {
        const preset = s.eqUserPresets.find((p) => p.id === id)
        if (!preset) return s
        return { eqGains: [...preset.gains], eqPreset: preset.name }
      }),

      sleepTimerEndsAt: null,
      setSleepTimer: (minutes) => set({
        sleepTimerEndsAt: minutes ? Date.now() + minutes * 60_000 : null
      }),

      librarySortKey: 'added',
      librarySortDir: 'asc',
      libraryViewMode: 'list',
      setLibrarySortKey: (k) => set({ librarySortKey: k }),
      setLibrarySortDir: (d) => set({ librarySortDir: d }),
      setLibraryViewMode: (m) => set({ libraryViewMode: m }),

      sidebarCollapsed: false,
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      activeView: 'library',
      previousView: null,
      setActiveView: (v) => set((s) => (s.activeView === v ? s : { previousView: s.activeView, activeView: v })),
      goBack: () => {
        const { previousView, activeView } = get()
        get().setActiveView(previousView && previousView !== activeView ? previousView : 'library')
      },
      selectedPlaylistId: null,
      setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
      selectedArtist: null,
      setSelectedArtist: (name) => set({ selectedArtist: name }),
      selectedAlbum: null,
      setSelectedAlbum: (key) => set({ selectedAlbum: key }),

      libraryTab: 'all',
      setLibraryTab: (t) => set({ libraryTab: t }),

      pendingQueueRestore: null,
      consumePendingQueueRestore: (resolve) => {
        const pending = get().pendingQueueRestore
        if (!pending) return
        set({ pendingQueueRestore: null })
        const pick = (ids: string[]): Track[] =>
          ids.map(resolve).filter((t): t is Track => !!t)
        const queue = pick(pending.queueIds)
        const naturalQueue = pick(pending.naturalQueueIds)
        const currentSong = pending.currentSongId
          ? resolve(pending.currentSongId) ?? null
          : null
        set({
          queue,
          naturalQueue,
          currentSong,
          queueIndex: currentSong && queue.length
            ? Math.max(0, Math.min(queue.findIndex((x) => x.id === currentSong.id), queue.length - 1))
            : 0,
          isPlaying: false,
        })
      },
    }),
    {
      name: 'aura-player',
      // Aura 4: preferences persist through the SQLite prefs table via the
      // desktop boundary (the catalog itself is NOT here — see catalogStore).
      storage: createJSONStorage(() => desktopPrefsStorage),
      partialize: (s) => ({
        volume: s.volume,
        shuffle: s.shuffle,
        repeat: s.repeat,
        performanceMode: s.performanceMode,
        theme: s.theme,
        customAccentColor: s.customAccentColor,
        crossfade: s.crossfade,
        eqGains: s.eqGains,
        eqPreset: s.eqPreset,
        audioFx: s.audioFx,
        fxUserPresets: s.fxUserPresets,
        preampDb: s.preampDb,
        balance: s.balance,
        limiterEnabled: s.limiterEnabled,
        eqEnabled: s.eqEnabled,
        studioBypass: s.studioBypass,
        eqUserPresets: s.eqUserPresets,
        appearance: s.appearance,
        watchFolders: s.watchFolders,
        librarySortKey: s.librarySortKey,
        librarySortDir: s.librarySortDir,
        libraryViewMode: s.libraryViewMode,
        sidebarCollapsed: s.sidebarCollapsed,
        smartQueue: s.smartQueue,
        ambientEffects: s.ambientEffects,
        // The queue persists as ID REFERENCES; rebuilt against the catalog
        // at boot by consumePendingQueueRestore.
        queueIds: s.queue.map((x) => x.id),
        naturalQueueIds: s.naturalQueue.map((x) => x.id),
        queueIndex: s.queueIndex,
        currentSongId: s.currentSong?.id ?? null,
      }),

      // The persisted snapshot maps back 1:1, except the queue: it lands in
      // pendingQueueRestore for the boot sequence to resolve against the
      // hydrated catalog (deleted tracks drop out honestly — a stale
      // snapshot can never resurrect a removed song).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlayerState> & {
          queueIds?: string[]
          naturalQueueIds?: string[]
          queueIndex?: number
          currentSongId?: string | null
        }
        const base = { ...current, ...p } as PlayerState
        return {
          ...base,
          audioFx: sanitizeFx((p as { audioFx?: unknown }).audioFx),
          fxUserPresets: sanitizeUserPresets((p as { fxUserPresets?: unknown }).fxUserPresets),
          preampDb: clampPreampDb(typeof (p as { preampDb?: unknown }).preampDb === 'number' ? (p as { preampDb: number }).preampDb : 0),
          balance: clampBalance(typeof (p as { balance?: unknown }).balance === 'number' ? (p as { balance: number }).balance : 0),
          limiterEnabled: (p as { limiterEnabled?: unknown }).limiterEnabled === true,
          eqEnabled: (p as { eqEnabled?: unknown }).eqEnabled !== false,
          studioBypass: (p as { studioBypass?: unknown }).studioBypass === true,
          eqUserPresets: sanitizeEqUserPresets((p as { eqUserPresets?: unknown }).eqUserPresets),
          queue: [],
          naturalQueue: [],
          currentSong: null,
          queueIndex: 0,
          isPlaying: false,
          smartAddedIds: [],
          smartReasons: {},
          smartRemovedIds: [],
          pendingQueueRestore: Array.isArray(p.queueIds)
            ? {
                queueIds: p.queueIds,
                naturalQueueIds: Array.isArray(p.naturalQueueIds) ? p.naturalQueueIds : [],
                queueIndex: typeof p.queueIndex === 'number' ? p.queueIndex : 0,
                currentSongId: p.currentSongId ?? null,
              }
            : null,
        }
      },
    }
  )
)
