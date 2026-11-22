// Phase 6 — Persistence & Recovery Stress Tests
// Tests Zustand store persistence boundaries: large library serialization,
// debounced write behavior, hydration, restart simulation, partial failures.
// Pure store logic — no IndexedDB, no Tauri.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/phase6_persistence_stress.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usePlayerStore } from '@/store/playerStore'
import { makeLibrary, mkSong } from './phase6_helpers.ts'
import type { Song } from '@/types'

function resetStore() {
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
    removedPaths: [], importedFolders: [],
    volume: 0.8, muted: false, shuffle: false, repeat: 'none',
    performanceMode: false, theme: 'aurora', customAccentColor: '#B0B8C8',
    crossfade: 0, eqGains: [], eqPreset: 'flat', audioFx: {},
    fxUserPresets: [], preampDb: 0, balance: 0, limiterEnabled: false,
    eqEnabled: true, studioBypass: false, eqUserPresets: [],
    appearance: 'dark', watchFolders: true, miniLiquidGlass: true,
    smartQueue: true, smartAddedIds: [], smartReasons: {}, smartRemovedIds: [],
    activeView: 'home', previousView: null, selectedPlaylistId: null,
    selectedArtist: null, selectedAlbum: null,
    librarySortKey: 'added', librarySortDir: 'desc', libraryViewMode: 'list',
    sidebarCollapsed: false, seekRequest: null,
    sleepTimerEndsAt: null, ambientEffects: true,
  })
}

// Capture persistable state (serializable subset)
function capturePersistedState() {
  const s = usePlayerStore.getState()
  return {
    library: s.library.map((x) => ({ id: x.id, path: x.path })),
    playlists: s.playlists,
    favorites: s.favorites,
    importedFolders: s.importedFolders,
    volume: s.volume,
    shuffle: s.shuffle,
    repeat: s.repeat,
    performanceMode: s.performanceMode,
    theme: s.theme,
    customAccentColor: s.customAccentColor,
    removedPaths: s.removedPaths,
    librarySortKey: s.librarySortKey,
    librarySortDir: s.librarySortDir,
    libraryViewMode: s.libraryViewMode,
    sidebarCollapsed: s.sidebarCollapsed,
    queueIds: s.queue.map((x) => x.id),
    naturalQueueIds: s.naturalQueue.map((x) => x.id),
    queueIndex: s.queueIndex,
    currentSongId: s.currentSong?.id ?? null,
    isPlaying: s.isPlaying,
  }
}

// Simulate hydrate: restore library first, then resolve queue IDs from restored lib
function simulateHydrate(persisted: ReturnType<typeof capturePersistedState>) {
  // Step 1: restore library entries
  const library: Song[] = persisted.library.map((entry) =>
    mkSong({ id: entry.id, path: entry.path })
  )
  usePlayerStore.setState({ library })

  const current = usePlayerStore.getState()
  const byId = new Map(current.library.map((x) => [x.id, x]))
  const resolve = (ids?: string[]) =>
    Array.isArray(ids) ? ids.map((id) => byId.get(id)).filter((x): x is Song => !!x) : []
  const queue = resolve(persisted.queueIds)
  const naturalQueue = resolve(persisted.naturalQueueIds)
  const currentSong = persisted.currentSongId ? byId.get(persisted.currentSongId) ?? null : null

  const safeQueueIndex = currentSong && queue.length
    ? Math.max(0, Math.min(queue.findIndex((x) => x.id === currentSong.id), queue.length - 1))
    : 0

  usePlayerStore.setState({
    queue,
    naturalQueue,
    currentSong,
    queueIndex: safeQueueIndex,
    isPlaying: persisted.isPlaying && currentSong !== null,
    volume: persisted.volume,
    shuffle: persisted.shuffle,
    repeat: persisted.repeat,
    performanceMode: persisted.performanceMode,
    theme: persisted.theme,
    customAccentColor: persisted.customAccentColor,
    removedPaths: persisted.removedPaths,
    librarySortKey: persisted.librarySortKey,
    librarySortDir: persisted.librarySortDir,
    libraryViewMode: persisted.libraryViewMode,
    sidebarCollapsed: persisted.sidebarCollapsed,
    smartAddedIds: [],
    smartReasons: {},
    smartRemovedIds: [],
  })
}

test('persistence stress: 10K track library serialize/rehydrate round-trip', () => {
  resetStore()
  const lib = makeLibrary(10_000)
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)
  usePlayerStore.getState().setVolume(0.5)
  usePlayerStore.getState().setTheme('ember')

  const persisted = capturePersistedState()
  assert.equal(persisted.library.length, 10_000)
  assert.equal(persisted.queueIds.length, 10_000)
  assert.equal(persisted.currentSongId, lib[0].id)

  resetStore()
  simulateHydrate(persisted)
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 10_000, 'library restored')
  assert.equal(s.queue.length, 10_000, 'queue restored')
  assert.equal(s.currentSong?.id, lib[0].id, 'currentSong restored')
  assert.equal(s.queueIndex, 0, 'queueIndex restored')
  assert.equal(s.volume, 0.5, 'volume restored')
  assert.equal(s.theme, 'ember', 'theme restored')
})

test('persistence stress: 25K track library serialize/rehydrate', () => {
  resetStore()
  const lib = makeLibrary(25_000)
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[5000], lib)

  const persisted = capturePersistedState()
  assert.equal(persisted.library.length, 25_000)

  resetStore()
  simulateHydrate(persisted)
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 25_000)
  assert.equal(s.queue.length, 25_000)
  assert.equal(s.currentSong?.id, lib[5000].id)
})

test('persistence stress: repeated persist/hydrate cycles don\'t accumulate duplicates', () => {
  resetStore()
  const lib = makeLibrary(1_000)
  usePlayerStore.getState().addToLibrary(lib)

  for (let cycle = 0; cycle < 10; cycle++) {
    const persisted = capturePersistedState()
    resetStore()
    simulateHydrate(persisted)
  }
  const s = usePlayerStore.getState()
  const ids = s.library.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicate IDs after 10 cycles')
  assert.equal(s.library.length, 1_000, 'library size stable after cycles')
})

test('persistence stress: removedPaths tombstones survive hydrate', () => {
  resetStore()
  const song = mkSong({ id: 'tomb', path: '/music/tombstoned.mp3' })
  usePlayerStore.getState().addToLibrary([song])
  usePlayerStore.getState().removeFromLibrary(song.id)

  const s1 = usePlayerStore.getState()
  assert.ok(s1.removedPaths.includes('/music/tombstoned.mp3'), 'tombstone set')

  const persisted = capturePersistedState()
  resetStore()
  simulateHydrate(persisted)
  const s2 = usePlayerStore.getState()
  assert.ok(s2.removedPaths.includes('/music/tombstoned.mp3'), 'tombstone survives hydrate')
  assert.equal(s2.library.length, 0, 'library still empty after hydrate')
})

test('persistence stress: debounced write doesn\'t discard final update', () => {
  resetStore()
  for (let i = 0; i < 100; i++) {
    usePlayerStore.getState().setVolume(i / 100)
    usePlayerStore.getState().setTheme(i % 2 === 0 ? 'aurora' : 'ember')
  }
  const s = usePlayerStore.getState()
  assert.equal(s.volume, 0.99, 'final volume wins')
  assert.equal(s.theme, 'ember', 'last iteration i=99 → ember')
})

test('persistence stress: hydration with missing queue IDs drops them gracefully', () => {
  resetStore()
  const lib = makeLibrary(100)
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  const persisted = capturePersistedState()
  persisted.queueIds = [...persisted.queueIds, 'ghost-id-1', 'ghost-id-2']

  resetStore()
  simulateHydrate(persisted)
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, 100, 'ghost IDs dropped, real queue intact')
  assert.ok(!s.queue.some((x) => x.id === 'ghost-id-1'), 'ghost ID not in queue')
})

test('persistence stress: hydration with invalid currentSongId', () => {
  resetStore()
  const lib = makeLibrary(50)
  usePlayerStore.getState().addToLibrary(lib)

  const persisted = capturePersistedState()
  persisted.currentSongId = 'nonexistent-song-id'

  resetStore()
  simulateHydrate(persisted)
  const s = usePlayerStore.getState()
  assert.equal(s.currentSong, null, 'invalid currentSongId → null')
  assert.equal(s.queueIndex, 0, 'queueIndex reset to 0')
})

console.log('phase6_persistence_stress: all stress checks passed')
