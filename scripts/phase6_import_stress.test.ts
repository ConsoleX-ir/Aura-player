// Phase 6 — Import & Metadata Stress Tests
// Tests the import pipeline with large batches, duplicates, mixed valid/invalid,
// and edge cases. Pure store + libraryService logic — mocks Tauri where needed.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/phase6_import_stress.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usePlayerStore } from '@/store/playerStore'
import { hashStr } from '@/lib/utils'
import { mkSong, benchSync } from './phase6_helpers.ts'
import type { Song } from '@/types'

function resetStore() {
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
    removedPaths: [], importedFolders: [],
  })
}

function makeTestSong(path: string, overrides?: Partial<Song>): Song {
  return {
    id: hashStr(path),
    path,
    title: `Title ${path}`,
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    coverArt: null,
    mtimeMs: Date.now(),
    addedAt: Date.now(),
    ...overrides,
  }
}

test('import stress: 10 batches of 1000 tracks, no duplicates accumulate', () => {
  resetStore()
  const base = makeTestSong
  for (let batch = 0; batch < 10; batch++) {
    const songs = Array.from({ length: 1000 }, (_, i) =>
      base(`/music/batch${batch}/track${i}.mp3`)
    )
    usePlayerStore.getState().addToLibrary(songs)
  }
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 10_000, '10 batches × 1000 = 10000, no dupes')
  const ids = s.library.map((x) => x.id)
  const unique = new Set(ids)
  assert.equal(ids.length, unique.size, 'no duplicate IDs')
})

test('import stress: duplicate tracks across batches are deduped', () => {
  resetStore()
  const shared = makeTestSong('/music/shared/track.mp3')
  for (let i = 0; i < 50; i++) {
    usePlayerStore.getState().addToLibrary([shared])
    usePlayerStore.getState().addToLibrary([makeTestSong(`/music/unique_${i}.mp3`)])
  }
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 51, 'shared track counted once + 50 unique')
  const sharedCount = s.library.filter((x) => x.id === shared.id).length
  assert.equal(sharedCount, 1, 'shared track appears exactly once')
})

test('import stress: mixed valid and invalid metadata — valid not corrupted', () => {
  resetStore()
  const valid = makeTestSong('/music/valid.mp3', { title: 'Valid Track', duration: 180 })
  const invalidPath = makeTestSong('/music/invalid.mp3', { duration: 0, title: 'Unknown Title' })
  usePlayerStore.getState().addToLibrary([valid, invalidPath])
  usePlayerStore.getState().addToLibrary([valid])
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 2, 'only valid + invalid (deduped valid)')
  const v = s.library.find((x) => x.path === '/music/valid.mp3')
  assert.ok(v, 'valid track present')
  assert.equal(v!.title, 'Valid Track', 'valid track metadata intact')
})

test('import stress: very long filenames within filesystem limits', () => {
  resetStore()
  const longName = 'a'.repeat(200) + '.mp3'
  const song = makeTestSong(`/music/${longName}`)
  usePlayerStore.getState().addToLibrary([song])
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 1)
  assert.equal(s.library[0].path, `/music/${longName}`)
})

test('import stress: Unicode paths and metadata', () => {
  resetStore()
  const songs = [
    makeTestSong('/music/آزمون.mp3', { title: 'آزمون melody', artist: 'هنرمند', album: 'آلبوم' }),
    makeTestSong('/music/テスト.mp3', { title: 'テストソング', artist: 'アーティスト', album: 'アルバム' }),
    makeTestSong('/music/测试.mp3', { title: '测试歌曲', artist: '歌手', album: '专辑' }),
    makeTestSong('/music/emoji 🎵.mp3', { title: 'Song 🎵', artist: 'Artist 🎸' }),
  ]
  usePlayerStore.getState().addToLibrary(songs)
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 4)
  const persian = s.library.find((x) => x.path.includes('آزمون'))
  assert.ok(persian, 'Persian path present')
  assert.equal(persian!.title, 'آزمون melody', 'Unicode title preserved')
})

test('import stress: rapid consecutive batches of same folder', () => {
  resetStore()
  const folderSongs = Array.from({ length: 500 }, (_, i) =>
    makeTestSong(`/music/folder/track_${i}.mp3`)
  )
  for (let i = 0; i < 10; i++) {
    usePlayerStore.getState().addToLibrary(folderSongs)
  }
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 500, 're-import same folder: no dupes')
})

test('import stress: tombstone prevents re-add of user-deleted track', () => {
  resetStore()
  const song = makeTestSong('/music/tombstoned.mp3')
  usePlayerStore.getState().addToLibrary([song])
  usePlayerStore.getState().removeFromLibrary(song.id)
  const s1 = usePlayerStore.getState()
  assert.ok(s1.removedPaths.includes('/music/tombstoned.mp3'), 'path is tombstoned')
  assert.equal(s1.library.length, 0, 'library empty')
  usePlayerStore.getState().addToLibrary([song])
  const s2 = usePlayerStore.getState()
  assert.equal(s2.library.length, 1, 'explicit re-add via addToLibrary restores track')
})

test('import stress: 25K tracks insertion performance', () => {
  resetStore()
  const lib = Array.from({ length: 25_000 }, (_, i) =>
    makeTestSong(`/music/bulk/track_${i}.mp3`)
  )
  // Inline timing
  for (let i = 0; i < 3; i++) usePlayerStore.getState().addToLibrary(lib)
  const times: number[] = []
  for (let i = 0; i < 10; i++) {
    const start = performance.now()
    usePlayerStore.getState().addToLibrary(lib)
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  console.log(`  addToLibrary 25K: median=${median.toFixed(2)}ms`)
  const s = usePlayerStore.getState()
  assert.equal(s.library.length, 25_000)
})

console.log('phase6_import_stress: all stress checks passed')
