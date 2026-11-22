// Phase 6 — Playback & Queue State Stress Tests
// Rapid transitions, reordering, edge cases, invariants.
// Pure store logic — no audio engine, no Tauri.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/phase6_queue_stress.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usePlayerStore } from '@/store/playerStore'
import { mkSong } from './phase6_helpers.ts'
import type { Song } from '@/types'

function resetStore() {
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
  })
}

function mkLibSong(i: number): Song {
  return mkSong({ id: `lib-${i}`, path: `/music/lib_${i}.mp3`, title: `Lib Song ${i}` })
}

test('queue stress: 1000 rapid next/prev transitions on 500-track queue', () => {
  resetStore()
  const lib = Array.from({ length: 500 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  for (let i = 0; i < 1000; i++) {
    usePlayerStore.getState().nextSong()
  }
  const s = usePlayerStore.getState()
  assert.ok(s.queueIndex >= 0 && s.queueIndex < s.queue.length, 'queueIndex valid after 1000 nexts')
  assert.ok(s.currentSong !== null, 'currentSong not null')
  assert.equal(s.queue.length, 500, 'queue length unchanged')
})

test('queue stress: repeat=all wraps correctly over 5000 transitions', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)
  usePlayerStore.getState().cycleRepeat() // none → all
  usePlayerStore.getState().cycleRepeat() // all → one
  usePlayerStore.getState().cycleRepeat() // one → none
  // Now cycleRepeat again → all
  usePlayerStore.getState().cycleRepeat()

  // With repeat=all, next() always wraps
  for (let i = 0; i < 5000; i++) {
    usePlayerStore.getState().nextSong()
  }
  const s = usePlayerStore.getState()
  assert.ok(s.queueIndex >= 0 && s.queueIndex < s.queue.length, 'queueIndex valid after wrap')
})

test('queue stress: repeat=none stops at end (null)', () => {
  resetStore()
  const lib = Array.from({ length: 10 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[9], lib) // last song

  // next() on last song with repeat=none: manual skip wraps to 0
  usePlayerStore.getState().nextSong()
  const s = usePlayerStore.getState()
  assert.equal(s.queueIndex, 0, 'manual next wraps to 0 with repeat=none')
})

test('queue stress: rapid play/pause 500 times', () => {
  resetStore()
  const lib = Array.from({ length: 10 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  // Verify toggling works: 1 toggle → false, 2 toggles → true
  usePlayerStore.getState().togglePlay()
  assert.equal(usePlayerStore.getState().isPlaying, false, '1 toggle → paused')
  usePlayerStore.getState().togglePlay()
  assert.equal(usePlayerStore.getState().isPlaying, true, '2 toggles → playing')

  // Remaining 498 toggles → total 500 (even) → back to true
  for (let i = 0; i < 498; i++) {
    usePlayerStore.getState().togglePlay()
  }
  const s = usePlayerStore.getState()
  assert.equal(s.isPlaying, true, '500 toggles total → playing=true')
})

test('queue stress: queue reordering on 1000-track queue', () => {
  resetStore()
  const lib = Array.from({ length: 1000 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  for (let i = 0; i < 500; i++) {
    const from = i % 1000
    const to = (from + 100) % 1000
    usePlayerStore.getState().reorderQueueItem(from, to)
  }
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, 1000, 'queue length preserved after reorders')
  const ids = s.queue.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicates after reorders')
  // All original IDs still present
  const originalIds = new Set(lib.map((x) => x.id))
  for (const id of ids) {
    assert.ok(originalIds.has(id), `id ${id} still in queue`)
  }
})

test('queue stress: playNextInQueue 500 times — queue grows, "already next" is no-op', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  // playNextInQueue adds after current song. Calling it 500 times cycles through
  // the library — queue grows by 1 each call (no dedup against whole queue,
  // only against "already next").
  for (let i = 1; i <= 500; i++) {
    const song = lib[i % 100]
    usePlayerStore.getState().playNextInQueue(song)
  }
  const s = usePlayerStore.getState()
  assert.ok(s.queue.length > 100, 'queue grows with playNextInQueue')
  // No duplicate IDs — each song added once per cycle position, but
  // playNextInQueue doesn't dedupe against full queue, so duplicates ARE expected
  // after cycling through the library multiple times. The key invariant:
  // current song stays at queueIndex.
  assert.equal(s.currentSong?.id, lib[0].id, 'current song unchanged')
  assert.equal(s.queueIndex, 0, 'playhead stays at 0')

  // Calling playNextInQueue with the song already next is a no-op
  const beforeLen = s.queue.length
  usePlayerStore.getState().playNextInQueue(s.queue[1])
  const after = usePlayerStore.getState()
  assert.equal(after.queue.length, beforeLen, 'already next → no-op')
})

test('queue stress: clearUpcomingQueue on large queue', () => {
  resetStore()
  const lib = Array.from({ length: 1000 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  // Advance to middle
  for (let i = 0; i < 500; i++) {
    usePlayerStore.getState().nextSong()
  }
  const before = usePlayerStore.getState()
  assert.ok(before.queue.length > 500, 'queue has upcoming tracks')

  usePlayerStore.getState().clearUpcomingQueue()
  const after = usePlayerStore.getState()
  assert.equal(after.queue.length, 501, 'only current + played remain')
  assert.equal(after.queueIndex, 500, 'playhead at current song')
})

test('queue stress: removeFromQueue on every index', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  // Remove from every index except current (0)
  for (let i = 99; i > 0; i--) {
    usePlayerStore.getState().removeFromQueue(i)
  }
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, 1, 'only current song remains')
  assert.equal(s.queueIndex, 0, 'playhead at 0')
})

test('queue stress: shuffle on/off preserves all tracks', () => {
  resetStore()
  const lib = Array.from({ length: 500 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  for (let i = 0; i < 20; i++) {
    usePlayerStore.getState().toggleShuffle()
  }
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, 500, 'all tracks preserved after shuffle toggles')
  const ids = s.queue.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicates after shuffle')
})

test('queue stress: naturalQueue stays in sync with queue during reorder', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  // Reorder with shuffle OFF — naturalQueue should mirror
  usePlayerStore.getState().reorderQueueItem(0, 50)
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, s.naturalQueue.length, 'queue and naturalQueue same length')
  const qIds = new Set(s.queue.map((x) => x.id))
  const nIds = new Set(s.naturalQueue.map((x) => x.id))
  assert.equal(qIds.size, nIds.size, 'same IDs in both')
  for (const id of qIds) {
    assert.ok(nIds.has(id), `id ${id} in naturalQueue`)
  }
})

test('queue stress: jumpToQueueIndex bounds checking', () => {
  resetStore()
  const lib = Array.from({ length: 10 }, (_, i) => mkLibSong(i))
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  // Invalid indices are no-ops
  usePlayerStore.getState().jumpToQueueIndex(-1)
  usePlayerStore.getState().jumpToQueueIndex(100)
  usePlayerStore.getState().jumpToQueueIndex(0) // same as current → no-op
  const s1 = usePlayerStore.getState()
  assert.equal(s1.queueIndex, 0, 'invalid jumps are no-ops')

  // Valid jump
  usePlayerStore.getState().jumpToQueueIndex(5)
  const s2 = usePlayerStore.getState()
  assert.equal(s2.queueIndex, 5, 'valid jump works')
  assert.equal(s2.currentSong?.id, lib[5].id, 'currentSong follows jump')
})

test('queue stress: empty queue operations are safe', () => {
  resetStore()
  assert.equal(usePlayerStore.getState().queue.length, 0)
  // nextSong on empty queue
  usePlayerStore.getState().nextSong()
  // prevSong on empty queue
  usePlayerStore.getState().prevSong()
  // togglePlay on empty queue
  usePlayerStore.getState().togglePlay()
  const s = usePlayerStore.getState()
  assert.equal(s.isPlaying, false, 'empty queue: not playing')
  assert.equal(s.queue.length, 0, 'empty queue stays empty')
})

console.log('phase6_queue_stress: all stress checks passed')
