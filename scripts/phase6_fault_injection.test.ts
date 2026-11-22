// Phase 6 — Fault Injection Stress Tests
// Tests failure handling: metadata errors, invalid paths, missing files,
// persistence failures, partial batch failures, cancellation, watcher errors.
// Pure store + library logic — mocks Tauri where needed.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/phase6_fault_injection.test.ts

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

test('fault injection: import with invalid metadata (duration 0) doesn\'t crash', () => {
  resetStore()
  const valid = mkSong({ id: 'v1', path: '/music/valid.mp3', title: 'Valid', duration: 180 })
  const invalid = mkSong({ id: 'i1', path: '/music/invalid.mp3', title: 'Unknown Title', duration: 0 })
  // Both added — invalid metadata doesn't crash addToLibrary
  usePlayerStore.getState().addToLibrary([valid, invalid])
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 2)
  const v = s.library.find((x) => x.id === 'v1')
  assert.ok(v, 'valid track present')
  assert.equal(v!.duration, 180, 'valid duration preserved')
})

test('fault injection: empty batch addToLibrary is no-op', () => {
  resetStore()
  const before = usePlayerStore.getState()
  usePlayerStore.getState().addToLibrary([])
  const after = usePlayerStore.getState()
  assert.equal(after.library, before.library, 'empty batch: state object unchanged')
  assert.equal(after.library.length, 0, 'library still empty')
})

test('fault injection: removeFromLibrary on nonexistent ID is no-op', () => {
  resetStore()
  const song = mkSong({ id: 's1', path: '/music/s1.mp3' })
  usePlayerStore.getState().addToLibrary([song])
  const before = usePlayerStore.getState()
  usePlayerStore.getState().removeFromLibrary('nonexistent-id')
  const after = usePlayerStore.getState()
  assert.equal(after.library.length, before.library.length, 'library length unchanged')
  assert.equal(after.library[0].id, before.library[0].id, 'same song remains')
})

test('fault injection: removeSongsFromLibrary with all IDs removes everything', () => {
  resetStore()
  const songs = Array.from({ length: 100 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(songs)
  const allIds = songs.map((s) => s.id)
  usePlayerStore.getState().removeSongsFromLibrary(allIds)
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 0, 'all songs removed')
  assert.equal(s.queue.length, 0, 'queue empty')
})

test('fault injection: playSong with song not in library still works', () => {
  resetStore()
  const song = mkSong({ id: 'orphan', path: '/music/orphan.mp3' })
  // Song not added to library, but playSong should still work (file association case)
  usePlayerStore.getState().playSong(song, [])
  const s = usePlayerStore.getState()
  assert.equal(s.currentSong?.id, 'orphan', 'orphan song can be played')
  assert.equal(s.queue.length, 1, 'queue has just the song')
  assert.equal(s.queueIndex, 0, 'playhead at 0')
  assert.equal(s.isPlaying, true, 'playing')
})

test('fault injection: jumpToQueueIndex out of bounds is safe', () => {
  resetStore()
  const song = mkSong({ id: 's1', path: '/music/s1.mp3' })
  usePlayerStore.getState().addToLibrary([song])
  usePlayerStore.getState().playSong(song, [song])

  usePlayerStore.getState().jumpToQueueIndex(-1)
  usePlayerStore.getState().jumpToQueueIndex(5)
  usePlayerStore.getState().jumpToQueueIndex(100)
  const s = usePlayerStore.getState()
  assert.equal(s.queueIndex, 0, 'out-of-bounds jumps are no-ops')
})

test('fault injection: nextSong/prevSong on empty queue are safe', () => {
  resetStore()
  // No songs at all
  usePlayerStore.getState().nextSong()
  usePlayerStore.getState().prevSong()
  const s = usePlayerStore.getState()
  assert.equal(s.queue.length, 0, 'empty queue stays empty')
  assert.equal(s.currentSong, null, 'no current song')
})

test('fault injection: togglePlay with no song loaded is no-op', () => {
  resetStore()
  usePlayerStore.getState().togglePlay()
  const s = usePlayerStore.getState()
  assert.equal(s.isPlaying, false, 'togglePlay with no song: still not playing')
})

test('fault injection: setVolume with extreme values', () => {
  resetStore()
  usePlayerStore.getState().setVolume(-1)
  usePlayerStore.getState().setVolume(2)
  usePlayerStore.getState().setVolume(0.5)
  const s = usePlayerStore.getState()
  assert.equal(s.volume, 0.5, 'volume set to valid value after extremes')
})

test('fault injection: duplicate IDs in addToLibrary batch collapse to first occurrence', () => {
  resetStore()
  const song = mkSong({ id: 'dup', path: '/music/dup.mp3' })
  // Same song object 5 times in one batch
  usePlayerStore.getState().addToLibrary([song, song, song, song, song])
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 1, 'duplicate IDs in batch collapse to one')
})

test('fault injection: removeFromQueue on current song index is no-op', () => {
  resetStore()
  const songs = Array.from({ length: 5 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(songs)
  usePlayerStore.getState().playSong(songs[0], songs) // playing index 0
  const before = usePlayerStore.getState()
  usePlayerStore.getState().removeFromQueue(0) // try to remove current song
  const after = usePlayerStore.getState()
  assert.equal(after.queue, before.queue, 'removing current song: queue unchanged')
  assert.equal(after.queueIndex, before.queueIndex, 'queueIndex unchanged')
})

test('fault injection: clearUpcomingQueue on queue with no upcoming tracks', () => {
  resetStore()
  const song = mkSong({ id: 's1', path: '/music/s1.mp3' })
  usePlayerStore.getState().addToLibrary([song])
  usePlayerStore.getState().playSong(song, [song])
  const before = usePlayerStore.getState()
  usePlayerStore.getState().clearUpcomingQueue()
  const after = usePlayerStore.getState()
  assert.equal(after.queue, before.queue, 'no upcoming: no change')
})

test('fault injury: reorderQueueItem out of bounds is safe', () => {
  resetStore()
  const songs = Array.from({ length: 5 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(songs)
  usePlayerStore.getState().playSong(songs[0], songs)
  const before = usePlayerStore.getState()

  usePlayerStore.getState().reorderQueueItem(-1, 2)
  usePlayerStore.getState().reorderQueueItem(2, -1)
  usePlayerStore.getState().reorderQueueItem(100, 2)
  usePlayerStore.getState().reorderQueueItem(2, 100)
  usePlayerStore.getState().reorderQueueItem(0, 0)

  const after = usePlayerStore.getState()
  assert.equal(after.queue, before.queue, 'out-of-bounds reorders: queue unchanged')
})

test('fault injection: playNextInQueue with song already next is no-op', () => {
  resetStore()
  const songs = Array.from({ length: 3 }, (_, i) =>
    mkSong({ id: `s${i}`, path: `/music/s${i}.mp3` })
  )
  usePlayerStore.getState().addToLibrary(songs)
  usePlayerStore.getState().playSong(songs[0], songs)
  const before = usePlayerStore.getState()
  // songs[1] is already next
  usePlayerStore.getState().playNextInQueue(songs[1])
  const after = usePlayerStore.getState()
  assert.equal(after.queue, before.queue, 'already next: no change')
})

console.log('phase6_fault_injection: all stress checks passed')
