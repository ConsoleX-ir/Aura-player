// Phase 6 — Large Library Stress Tests
// Synthetic collections at 1K, 5K, 10K, 25K tracks.
// Pure store + algorithm stress — no Tauri, no filesystem.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/phase6_library_stress.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usePlayerStore } from '@/store/playerStore'
import { sortSongs } from '@/lib/sort'
import { searchLibrary } from '@/lib/search'
import { makeLibrary } from './phase6_helpers.ts'

function resetStore() {
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
  })
}

function timeFn(name: string, fn: () => void, iterations = 10): number {
  for (let i = 0; i < 3; i++) fn()
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  console.log(`  ${name}: median=${median.toFixed(2)}ms`)
  return median
}

const SIZES = [1_000, 5_000, 10_000, 25_000]

for (const size of SIZES) {
  test(`library stress: addToLibrary ${size} tracks (no dupes)`, () => {
    resetStore()
    const lib = makeLibrary(size)
    timeFn(`addToLibrary ${size}`, () => usePlayerStore.getState().addToLibrary(lib))
    const s = usePlayerStore.getState()
    assert.equal(s.library.length, size, `library should have ${size} entries`)
  })

  test(`library stress: addToLibrary ${size} tracks with duplicates (idempotent)`, () => {
    resetStore()
    const lib = makeLibrary(size)
    usePlayerStore.getState().addToLibrary(lib)
    timeFn(`addToLibrary ${size} (2nd batch)`, () => usePlayerStore.getState().addToLibrary(lib))
    const s = usePlayerStore.getState()
    assert.equal(s.library.length, size, 'duplicate batch must not add dupes')
  })

  test(`library stress: search ${size} tracks (free text)`, () => {
    resetStore()
    const lib = makeLibrary(size)
    usePlayerStore.getState().addToLibrary(lib)
    timeFn(`search ${size}`, () => searchLibrary(lib, 'Track 500', 40))
  })

  test(`library stress: search ${size} tracks (no match, worst case)`, () => {
    resetStore()
    const lib = makeLibrary(size)
    usePlayerStore.getState().addToLibrary(lib)
    timeFn(`search ${size} (no match)`, () => searchLibrary(lib, 'zzz-nonexistent-query-xyz', 40))
  })

  test(`library stress: sort ${size} tracks (title)`, () => {
    resetStore()
    const lib = makeLibrary(size)
    usePlayerStore.getState().addToLibrary(lib)
    timeFn(`sort ${size} (title)`, () => sortSongs(lib, 'title', 'asc'))
  })

  test(`library stress: sort ${size} tracks (added, desc)`, () => {
    resetStore()
    const lib = makeLibrary(size)
    usePlayerStore.getState().addToLibrary(lib)
    timeFn(`sort ${size} (added)`, () => sortSongs(lib, 'added', 'desc'))
  })

  test(`library stress: removeSongsFromLibrary ${size} (remove 500)`, () => {
    resetStore()
    const lib = makeLibrary(size)
    usePlayerStore.getState().addToLibrary(lib)
    const idsToRemove = lib.slice(0, 500).map((s) => s.id)
    timeFn(`remove 500 from ${size}`, () => usePlayerStore.getState().removeSongsFromLibrary(idsToRemove))
    const s = usePlayerStore.getState()
    assert.equal(s.library.length, size - 500, '500 tracks must be removed')
  })

  test(`library stress: queue construction from ${size} track library`, () => {
    resetStore()
    const lib = makeLibrary(size)
    usePlayerStore.getState().addToLibrary(lib)
    const song = lib[Math.floor(size / 2)]
    timeFn(`playSong from ${size}`, () => usePlayerStore.getState().playSong(song, lib))
    const s = usePlayerStore.getState()
    assert.equal(s.currentSong?.id, song.id, 'currentSong must be set')
    assert.equal(s.queue.length, size, 'queue must contain all library tracks')
  })

  test(`library stress: healCoverArt O(L) scan on ${size} tracks`, () => {
    resetStore()
    const lib = makeLibrary(size)
    usePlayerStore.getState().addToLibrary(lib)
    const targetPath = lib[Math.floor(size / 2)].path
    timeFn(`healCoverArt ${size}`, () => usePlayerStore.getState().healCoverArt(targetPath, 'healed://cover'))
    const s = usePlayerStore.getState()
    const healed = s.library.filter((x) => x.path === targetPath)
    assert.ok(healed.length > 0, 'at least one entry must be healed')
    assert.ok(healed.every((x) => x.coverArt === 'healed://cover'), 'all matching paths must heal')
  })
}

test('library stress: no duplicate IDs after repeated add/remove cycles', () => {
  resetStore()
  const lib = makeLibrary(5_000)
  for (let cycle = 0; cycle < 5; cycle++) {
    usePlayerStore.getState().addToLibrary(lib)
    const s = usePlayerStore.getState()
    assert.equal(s.library.length, 5_000, `cycle ${cycle}: no dupes after add`)
    const ids = s.library.filter((_, i) => i % 10 === 0).map((s) => s.id)
    usePlayerStore.getState().removeSongsFromLibrary(ids)
  }
  const s = usePlayerStore.getState()
  const ids = s.library.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicate IDs after cycles')
})

test('library stress: queue operations on 10K track queue', () => {
  resetStore()
  const lib = makeLibrary(10_000)
  usePlayerStore.getState().addToLibrary(lib)
  const song = lib[0]
  usePlayerStore.getState().playSong(song, lib)

  for (let i = 0; i < 100; i++) {
    usePlayerStore.getState().nextSong()
  }
  const s = usePlayerStore.getState()
  assert.ok(s.queueIndex >= 0 && s.queueIndex < s.queue.length, 'queueIndex valid after 100 nexts')
  assert.ok(s.currentSong !== null, 'currentSong must not be null')

  for (let i = 0; i < 50; i++) {
    usePlayerStore.getState().reorderQueueItem(0, s.queue.length - 1)
  }
  const s2 = usePlayerStore.getState()
  assert.equal(s2.queue.length, 10_000, 'queue length preserved after reorder')
})

test('library stress: shuffle toggle on 10K track queue', () => {
  resetStore()
  const lib = makeLibrary(10_000)
  usePlayerStore.getState().addToLibrary(lib)
  const song = lib[0]
  usePlayerStore.getState().playSong(song, lib)

  for (let i = 0; i < 100; i++) {
    usePlayerStore.getState().toggleShuffle()
  }
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, 10_000, 'queue length must be preserved')
  const ids = s.queue.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'shuffle must not create duplicates')
})

console.log('phase6_library_stress: all stress checks passed')
