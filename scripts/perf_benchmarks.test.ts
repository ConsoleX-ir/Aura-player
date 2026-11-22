// Phase 5 Performance Benchmarks — Frontend Algorithms
// Run with: npx tsx --tsconfig tsconfig.app.json scripts/perf_benchmarks.test.ts

import { describe, it, expect } from 'tsx'
import { sortSongs, type SortKey, type SortDir } from '@/lib/sort'
import { searchLibrary } from '@/lib/search'
import { hashStr } from '@/lib/utils'
import type { Song } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSong(index: number, override?: Partial<Song>): Song {
  const titles = ['Song', 'Track', 'Music', 'Audio', 'Melody', 'Harmony', 'Rhythm', 'Beat']
  const artists = ['Artist A', 'Artist B', 'Artist C', 'Artist D', 'Artist E']
  const albums = ['Album 1', 'Album 2', 'Album 3', 'Album 4']
  const genres = ['Pop', 'Rock', 'Jazz', 'Classical', 'Electronic']
  return {
    id: hashStr(`/music/track_${index}.mp3`),
    path: `/music/track_${index}.mp3`,
    title: `${titles[index % titles.length]} ${index}`,
    artist: artists[index % artists.length],
    album: albums[index % albums.length],
    genre: genres[index % genres.length],
    duration: 180 + (index % 300),
    year: 2000 + (index % 25),
    trackNumber: (index % 20) + 1,
    coverArt: null,
    mtimeMs: Date.now() - index * 1000,
    addedAt: Date.now() - index * 1000,
    ...override,
  }
}

function makeLibrary(size: number): Song[] {
  return Array.from({ length: size }, (_, i) => makeSong(i))
}

function bench(name: string, fn: () => void, iterations = 10): number {
  // Warmup
  for (let i = 0; i < 3; i++) fn()
  // Measure
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  const min = times[0]
  const max = times[times.length - 1]
  console.log(`  ${name}: median=${median.toFixed(2)}ms min=${min.toFixed(2)}ms max=${max.toFixed(2)}ms (${iterations} iters)`)
  return median
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

const sizes = [100, 1000, 5000, 10000]

console.log('\n═══ SORT SONGS (all keys) ═══\n')
for (const size of sizes) {
  const library = makeLibrary(size)
  console.log(`Library size: ${size}`)
  for (const key of ['added', 'title', 'artist', 'album', 'duration'] as SortKey[]) {
    for (const dir of ['asc', 'desc'] as SortDir[]) {
      bench(`  sort ${key} ${dir}`, () => sortSongs(library, key, dir))
    }
  }
  console.log()
}

console.log('═══ SEARCH LIBRARY ═══\n')
for (const size of sizes) {
  const library = makeLibrary(size)
  console.log(`Library size: ${size}`)
  bench('  search "track 500"', () => searchLibrary(library, 'track 500', 40))
  bench('  search "artist a"', () => searchLibrary(library, 'artist a', 40))
  bench('  search "artist: a"', () => searchLibrary(library, 'artist: a', 40))
  bench('  search "nonexistentxyz"', () => searchLibrary(library, 'nonexistentxyz', 40))
  bench('  search empty', () => searchLibrary(library, '', 40))
  console.log()
}

console.log('═══ ADD TO LIBRARY SIMULATION ═══\n')
for (const size of sizes) {
  const existing = makeLibrary(size)
  const newSongs = makeLibrary(100).map((s, i) => ({ ...s, path: `/music/new_${i}.mp3`, id: hashStr(`/music/new_${i}.mp3`) }))
  console.log(`Existing: ${size}, Adding: 100`)
  bench('  addToLibrary (dedupe via Set)', () => {
    const seen = new Set(existing.map((e) => e.id))
    const fresh: typeof newSongs = []
    for (const n of newSongs) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      fresh.push(n)
    }
    return [...existing, ...fresh]
  })
  console.log()
}

console.log('═══ REMOVE FROM LIBRARY (with playlists) ═══\n')
for (const size of sizes) {
  const library = makeLibrary(size)
  const playlists = Array.from({ length: 50 }, (_, pi) => ({
    id: `pl-${pi}`,
    name: `Playlist ${pi}`,
    songIds: library.slice(0, Math.min(200, size)).map((s) => s.id),
    createdAt: Date.now(),
  }))
  const idsToRemove = library.slice(0, 50).map((s) => s.id)
  console.log(`Library: ${size}, Playlists: 50 (200 songs each), Removing: 50`)
  bench('  removeSongsFromLibrary', () => {
    const idSet = new Set(idsToRemove)
    return {
      library: library.filter((song) => !idSet.has(song.id)),
      playlists: playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => !idSet.has(id)) })),
    }
  })
  console.log()
}

console.log('═══ HEAL COVER ART ═══\n')
for (const size of sizes) {
  const library = makeLibrary(size)
  const targetPath = library[Math.floor(size / 2)].path
  console.log(`Library size: ${size}`)
  bench('  healCoverArt (O(L) full scan)', () => {
    const patchById = new Map<string, Song>()
    for (const song of library) {
      if (song.path === targetPath) {
        patchById.set(song.id, { ...song, coverArt: 'healed://cover' })
      }
    }
    return library.map((song) => patchById.get(song.id) ?? song)
  })
  console.log()
}

console.log('═══ PLAYLIST COVER ═══\n')
for (const size of sizes) {
  const library = makeLibrary(size)
  const playlistSongIds = library.slice(0, 100).map((s) => s.id)
  console.log(`Library: ${size}, Playlist: 100 songs`)
  bench('  playlistCover (library.find per songId, O(P×L))', () => {
    const covers: (string | null)[] = []
    for (const id of playlistSongIds) {
      const song = library.find((s) => s.id === id)
      covers.push(song?.coverArt ?? null)
    }
    return covers
  })
  bench('  playlistCover (Map lookup, O(L+P))', () => {
    const byId = new Map(library.map((s) => [s.id, s]))
    const covers: (string | null)[] = []
    for (const id of playlistSongIds) {
      const song = byId.get(id)
      covers.push(song?.coverArt ?? null)
    }
    return covers
  })
  console.log()
}

console.log('═══ GENRES EXTRACTION ═══\n')
for (const size of sizes) {
  const library = makeLibrary(size)
  console.log(`Library size: ${size}`)
  bench('  genres (O(L) scan + Set)', () => {
    const set = new Set<string>()
    for (const s of library) {
      if (s.genre && s.genre.trim()) set.add(s.genre.trim())
    }
    return Array.from(set)
  })
  console.log()
}

console.log('═══ ALBUM GROUPING ═══\n')
for (const size of sizes) {
  const library = makeLibrary(size)
  console.log(`Library size: ${size}`)
  bench('  album grouping (O(S) map)', () => {
    const map = new Map<string, { songs: typeof library; coverArt: string | null; artist: string }>()
    for (const song of library) {
      const key = `${song.album}|||${song.artist}`
      if (!map.has(key)) map.set(key, { songs: [], coverArt: song.coverArt, artist: song.artist })
      map.get(key)!.songs.push(song)
    }
    return Array.from(map.entries())
  })
  console.log()
}

console.log('═══ BENCHMARKS COMPLETE ═══\n')
