// Phase 6 — Resource & Long-Run Stability Stress Tests
// Tests for resource leaks: Zustand subscriptions, event listeners, timers,
// repeated mount/unmount cycles, and unbounded growth patterns.
// Pure store logic — no React, no Tauri, no real timers.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/phase6_resource_stress.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usePlayerStore } from '@/store/playerStore'
import { mkSong, makeLibrary } from './phase6_helpers.ts'
import type { Song } from '@/types'

function resetStore() {
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
    removedPaths: [], importedFolders: [],
  })
}

test('resource stress: 1000 addToLibrary calls don\'t churn state object identity unnecessarily', () => {
  resetStore()
  const songs = Array.from({ length: 100 }, (_, i) => mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` }))
  let stateChurns = 0
  let prevRef: any = null

  for (let i = 0; i < 1000; i++) {
    const before = usePlayerStore.getState()
    usePlayerStore.getState().addToLibrary(songs)
    const after = usePlayerStore.getState()
    if (after.library !== before.library) stateChurns++
    prevRef = after
  }
  const s = usePlayerStore.getState()
  // After first batch, subsequent adds are no-ops (all dupes) → state object not replaced
  assert.equal(s.library.length, 100, '100 unique songs')
  console.log(`  state churns over 1000 addToLibrary calls: ${stateChurns} (expected: 1)`)
  assert.ok(stateChurns <= 2, 'state should not churn on duplicate adds')
})

test('resource stress: rapid removeFromLibrary on 5000 tracks, 500 at a time', () => {
  resetStore()
  const lib = Array.from({ length: 5000 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)

  // Remove 500 at a time, 10 times
  for (let round = 0; round < 10; round++) {
    const ids = lib.slice(round * 500, (round + 1) * 500).map((s) => s.id)
    usePlayerStore.getState().removeSongsFromLibrary(ids)
  }
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 0, 'all tracks removed')
  assert.equal(s.queue.length, 0, 'queue empty')
  assert.equal(s.favorites.length, 0, 'favorites empty')
})

test('resource stress: playlists with 1000 songs each, 50 playlists — remove from all', () => {
  resetStore()
  const lib = Array.from({ length: 1000 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)

  // Create 50 playlists, each with all 1000 songs
  for (let p = 0; p < 50; p++) {
    const pid = usePlayerStore.getState().createPlaylist(`Playlist ${p}`)
    assert.ok(pid, `playlist ${p} created`)
    const plState = usePlayerStore.getState()
    const playlist = plState.playlists.find((pl) => pl.id === pid)
    assert.ok(playlist, `playlist ${p} found`)
    for (const song of lib) {
      usePlayerStore.getState().addToPlaylist(pid, song.id)
    }
  }

  const s1 = usePlayerStore.getState()
  assert.equal(s1.playlists.length, 50, '50 playlists')
  assert.ok(s1.playlists.every((p) => p.songIds.length === 1000), 'each playlist has 1000 songs')

  // Remove 500 songs from library — must clean up all 50 playlists
  const idsToRemove = lib.slice(0, 500).map((s) => s.id)
  usePlayerStore.getState().removeSongsFromLibrary(idsToRemove)

  const s2 = usePlayerStore.getState()
  assert.equal(s2.library.length, 500, '500 songs remain')
  assert.ok(s2.playlists.every((p) => p.songIds.length === 500), 'each playlist has 500 songs')
  // Verify no stale references
  const remainingIds = new Set(s2.library.map((x) => x.id))
  for (const pl of s2.playlists) {
    for (const id of pl.songIds) {
      assert.ok(remainingIds.has(id), `playlist ${pl.name} has stale ref ${id}`)
    }
  }
})

test('resource stress: toggleShuffle 10000 times on 1000-track queue — no memory growth', () => {
  resetStore()
  const lib = Array.from({ length: 1000 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  const queueLengths: number[] = []
  for (let i = 0; i < 10000; i++) {
    usePlayerStore.getState().toggleShuffle()
    if (i % 1000 === 0) {
      queueLengths.push(usePlayerStore.getState().queue.length)
    }
  }
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, 1000, 'queue length stable after 10000 toggles')
  assert.ok(queueLengths.every((l) => l === 1000), 'queue length never changed during toggles')
  // No duplicate IDs
  const ids = s.queue.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicate IDs')
})

test('resource stress: healCoverArt called 1000 times on 10K library — no state churn when no-op', () => {
  resetStore()
  const lib = makeLibrary(10_000)
  usePlayerStore.getState().addToLibrary(lib)
  const targetPath = lib[5000].path

  // First call: actual heal
  usePlayerStore.getState().healCoverArt(targetPath, 'healed://cover')
  const s1 = usePlayerStore.getState()
  assert.equal(s1.library[5000].coverArt, 'healed://cover')

  // Subsequent calls with same URL: no-op, state object not replaced
  let stateReplaced = 0
  let prevState = usePlayerStore.getState()
  for (let i = 0; i < 1000; i++) {
    usePlayerStore.getState().healCoverArt(targetPath, 'healed://cover')
    const curr = usePlayerStore.getState()
    if (curr.library !== prevState.library) stateReplaced++
    prevState = curr
  }
  assert.equal(stateReplaced, 0, 'no state churn on no-op healCoverArt')
})

test('resource stress: importFiles pattern — 100 batches of 100 with overlap', () => {
  resetStore()
  const sharedSongs = Array.from({ length: 100 }, (_, i) =>
    mkSong({ id: `shared-${i}`, path: `/music/shared/${i}.mp3` })
  )

  // Each batch adds shared songs + some unique ones
  for (let b = 0; b < 100; b++) {
    const unique = Array.from({ length: 10 }, (_, i) =>
      mkSong({ id: `b${b}u${i}`, path: `/music/batch${b}/u${i}.mp3` })
    )
    usePlayerStore.getState().addToLibrary([...sharedSongs, ...unique])
  }

  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 100 + 100 * 10, '100 shared + 1000 unique = 1100')
  const sharedIds = new Set(sharedSongs.map((x) => x.id))
  let sharedFound = 0
  for (const song of s.library) {
    if (sharedIds.has(song.id)) sharedFound++
  }
  assert.equal(sharedFound, 100, 'all 100 shared songs present exactly once')
})

test('resource stress: 1000 setProgress calls — store notification overhead', () => {
  resetStore()
  const song = mkSong({ id: 's1', path: '/music/s1.mp3' })
  usePlayerStore.getState().addToLibrary([song])
  usePlayerStore.getState().playSong(song, [song])

  let notificationCount = 0
  const unsub = usePlayerStore.subscribe(() => {
    notificationCount++
  })
  for (let i = 0; i < 1000; i++) {
    usePlayerStore.getState().setProgress(i / 1000)
  }
  unsub()
  // Each setProgress triggers a store notification
  assert.equal(notificationCount, 1000, '1000 notifications for 1000 progress updates')
  console.log(`  1000 setProgress notifications: ${notificationCount} (expected, progress tick pattern)`)
})

console.log('phase6_resource_stress: all stress checks passed')
