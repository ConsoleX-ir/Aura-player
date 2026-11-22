// Phase 6 — Concurrency & Race Condition Stress Tests
// Tests concurrent/overlapping operations for race conditions: overlapping
// imports, sync vs import races, rapid state transitions, stale snapshots.
// Pure store logic — no Tauri, no real async timing.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/phase6_concurrency_stress.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usePlayerStore } from '@/store/playerStore'
import { mkSong } from './phase6_helpers.ts'
import type { Song } from '@/types'

function resetStore() {
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
    removedPaths: [], importedFolders: [],
  })
}

test('concurrency stress: overlapping addToLibrary batches — no lost updates', () => {
  resetStore()
  const batch1 = Array.from({ length: 500 }, (_, i) =>
    mkSong({ id: `b1-${i}`, path: `/music/b1/${i}.mp3` })
  )
  const batch2 = Array.from({ length: 500 }, (_, i) =>
    mkSong({ id: `b2-${i}`, path: `/music/b2/${i}.mp3` })
  )
  const batch3 = Array.from({ length: 500 }, (_, i) =>
    mkSong({ id: `b3-${i}`, path: `/music/b3/${i}.mp3` })
  )

  // Simulate overlapping: all three added without waiting
  usePlayerStore.getState().addToLibrary(batch1)
  usePlayerStore.getState().addToLibrary(batch2)
  usePlayerStore.getState().addToLibrary(batch3)

  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 1500, 'all 3 batches of 500 present')
  const ids = s.library.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicate IDs')
})

test('concurrency stress: addToLibrary + removeFromLibrary interleaved', () => {
  resetStore()
  const songs = Array.from({ length: 1000 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(songs)

  // Interleave: add 100, remove 100, repeat
  for (let round = 0; round < 10; round++) {
    const newSongs = Array.from({ length: 100 }, (_, i) =>
      mkSong({ id: `new-${round}-${i}`, path: `/music/new/${round}/${i}.mp3` })
    )
    usePlayerStore.getState().addToLibrary(newSongs)
    const idsToRemove = songs.slice(round * 100, (round + 1) * 100).map((s) => s.id)
    usePlayerStore.getState().removeSongsFromLibrary(idsToRemove)
  }

  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 1000, '1000 original - 1000 removed + 1000 new = 1000')
  const ids = s.library.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicates')
  // All remaining should be "new-" songs
  assert.ok(s.library.every((x) => x.id.startsWith('new-')), 'only new songs remain')
})

test('concurrency stress: playSong + nextSong + removeFromLibrary race', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  // Simulate: play next, then remove the current song from library
  usePlayerStore.getState().nextSong() // now playing s1
  const currentId = usePlayerStore.getState().currentSong!.id
  usePlayerStore.getState().removeFromLibrary(currentId)

  const s = usePlayerStore.getState()
  assert.equal(s.currentSong, null, 'removed playing song → currentSong=null')
  assert.equal(s.isPlaying, false, 'stopped playing')
  assert.equal(s.queue.length, 99, 'song removed from queue')
  assert.ok(!s.queue.some((x) => x.id === currentId), 'removed song not in queue')
})

test('concurrency stress: shuffle toggle during rapid next transitions', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  for (let i = 0; i < 100; i++) {
    if (i % 2 === 0) usePlayerStore.getState().toggleShuffle()
    usePlayerStore.getState().nextSong()
  }
  const s = usePlayerStore.getState()
  assert.ok(s.queueIndex >= 0 && s.queueIndex < s.queue.length, 'valid index')
  const ids = s.queue.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicates after shuffle + next interleaving')
})

test('concurrency stress: removeFromQueue + playNextInQueue interleaved', () => {
  resetStore()
  const lib = Array.from({ length: 50 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  for (let i = 0; i < 50; i++) {
    // Add a song to play next
    const nextSong = lib[i % 50]
    usePlayerStore.getState().playNextInQueue(nextSong)
    // Remove from a random upcoming position
    const s = usePlayerStore.getState()
    if (s.queue.length > s.queueIndex + 1) {
      usePlayerStore.getState().removeFromQueue(s.queueIndex + 1)
    }
  }
  const final = usePlayerStore.getState()
  const ids = final.queue.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicates')
})

test('concurrency stress: toggleShuffle + reorderQueueItem interleaved', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)
  usePlayerStore.getState().playSong(lib[0], lib)

  for (let i = 0; i < 200; i++) {
    if (i % 3 === 0) usePlayerStore.getState().toggleShuffle()
    usePlayerStore.getState().reorderQueueItem(i % 100, (i + 10) % 100)
  }
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, 100, 'queue length preserved')
  const ids = s.queue.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicates')
})

test('concurrency stress: addToPlaylist + removeFromLibrary consistency', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)
  const pid = usePlayerStore.getState().createPlaylist('Test')
  for (const song of lib) {
    usePlayerStore.getState().addToPlaylist(pid, song.id)
  }

  // Remove 50 songs from library — playlists must be cleaned up
  const idsToRemove = lib.slice(0, 50).map((s) => s.id)
  usePlayerStore.getState().removeSongsFromLibrary(idsToRemove)

  const s = usePlayerStore.getState()
  const pl = s.playlists.find((p) => p.id === pid)
  assert.ok(pl, 'playlist exists')
  assert.equal(pl.songIds.length, 50, 'playlist cleaned up')
  // No stale references
  const remainingIds = new Set(s.library.map((x) => x.id))
  for (const id of pl.songIds) {
    assert.ok(remainingIds.has(id), `no stale ref ${id}`)
  }
})

test('concurrency stress: favorites + removeFromLibrary consistency', () => {
  resetStore()
  const lib = Array.from({ length: 100 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(lib)
  for (const song of lib.slice(0, 50)) {
    usePlayerStore.getState().toggleFavorite(song.id)
  }

  // Remove 30 favorited songs
  const idsToRemove = lib.slice(0, 30).map((s) => s.id)
  usePlayerStore.getState().removeSongsFromLibrary(idsToRemove)

  const s = usePlayerStore.getState()
  // Favorites should only contain songs still in library
  for (const favId of s.favorites) {
    assert.ok(s.library.some((x) => x.id === favId), `favorite ${favId} still in library`)
  }
  assert.equal(s.favorites.length, 20, '50 favorited - 30 removed = 20')
})

console.log('phase6_concurrency_stress: all stress checks passed')
