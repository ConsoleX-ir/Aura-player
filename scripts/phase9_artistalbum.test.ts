// Phase 9 (Artist & Album Experience) unit tests — pure grouping helpers.
// Run with:
//   node --experimental-strip-types scripts/phase9_artistalbum.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normName, displayVariant, songsByArtist, albumKeyOf, albumsOfArtist,
  sortAlbumTracks, relatedArtists, totalRuntimeSec,
} from '../src/lib/artistAlbum.ts'
import type { Song } from '../src/types/index.ts'

let seq = 0
const mk = (over: Partial<Song> = {}): Song => {
  seq++
  return {
    id: `s${seq}`, path: `/music/s${seq}.mp3`, title: `Song ${seq}`,
    artist: 'Alpha', album: 'Album One', duration: 200, coverArt: null, ...over,
  }
}

test('normName: trims and casefolds; displayVariant picks the most frequent spelling', () => {
  assert.equal(normName('  MIKE '), 'mike')
  // 2× "Mike", 1× "MIKE" → "Mike" wins; ties → first spelling encountered
  assert.equal(displayVariant(['Mike', 'MIKE', 'Mike']), 'Mike')
  assert.equal(displayVariant(['beta', 'alpha', 'alpha']), 'alpha') // 2× alpha wins
  assert.equal(displayVariant(['One', 'one']), 'One') // first-seen wins ties
  assert.equal(displayVariant([]), '')
})

test('songsByArtist: case-insensitive across all spelling variants', () => {
  const lib = [
    mk({ id: '1', artist: 'Aurora' }),
    mk({ id: '2', artist: 'AURORA' }),
    mk({ id: '3', artist: 'aurora ' }),
    mk({ id: '4', artist: 'Nova' }),
  ]
  const r = songsByArtist(lib, 'Aurora')
  assert.deepEqual(r.map((s) => s.id).sort(), ['1', '2', '3'])
})

test('albumKeyOf + albumsOfArtist: artist-scoped album grouping', () => {
  const lib = [
    mk({ id: '1', artist: 'Alpha', album: 'One' }),
    mk({ id: '2', artist: 'Alpha', album: 'one' }),    // same album, different case
    mk({ id: '3', artist: 'Beta', album: 'One' }),     // same album name, other artist
  ]
  const groups = albumsOfArtist(lib)
  assert.equal(groups.length, 2) // Alpha/One + Beta/One
  const alpha = groups.find((g) => g.key.artist === 'Alpha')!
  assert.equal(alpha.songs.length, 2)
  assert.equal(alpha.key.album, 'One')
})

test('sortAlbumTracks: trackNumber asc, missing numbers sink alphabetically', () => {
  const r = sortAlbumTracks([
    mk({ id: 'x', title: 'X', trackNumber: null }),
    mk({ id: 'c', title: 'C', trackNumber: 2 }),
    mk({ id: 'a', title: 'A', trackNumber: 1 }),
    mk({ id: 'b', title: 'B', trackNumber: 2 }),
    mk({ id: 'y', title: 'Y', trackNumber: null }),
  ])
  assert.deepEqual(r.map((s) => s.id), ['a', 'b', 'c', 'x', 'y'])
})

test('relatedArtists: genre overlap ranking, excludes self and unknown genres', () => {
  const lib = [
    mk({ id: '1', artist: 'Alpha', genre: 'Rock' }),
    mk({ id: '2', artist: 'Alpha', genre: 'Jazz' }),
    mk({ id: '3', artist: 'Beta', genre: 'Rock' }),
    mk({ id: '4', artist: 'Beta', genre: 'Rock' }),
    mk({ id: '5', artist: 'Gamma', genre: 'Rock' }),
    mk({ id: '6', artist: 'Delta', genre: 'Unknown' }),   // never matches
    mk({ id: '7', artist: 'Epsilon', genre: 'Polka' }),   // no overlap
  ]
  const r = relatedArtists(lib, 'Alpha', 4)
  assert.deepEqual(r, ['Beta', 'Gamma']) // Beta: 2 shared tracks > Gamma: 1
})

test('relatedArtists: display variant resolution for matched artists', () => {
  const lib = [
    mk({ id: '0', artist: 'Alpha', genre: 'Rock' }),
    mk({ id: '1', artist: 'Nova', genre: 'Rock' }),
    mk({ id: '2', artist: 'NOVA', genre: 'Rock' }),
  ]
  const r = relatedArtists(lib, 'Alpha', 4)
  assert.deepEqual(r, ['Nova']) // most frequent variant (tie → first seen)
})

test('totalRuntimeSec: skips non-positive durations', () => {
  assert.equal(totalRuntimeSec([mk({ duration: 100 }), mk({ duration: 0 }), mk({ duration: 20 })]), 120)
})
