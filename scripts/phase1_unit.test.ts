// Phase 1 (Library 2.0) unit tests — pure modules only:
//   lib/search.ts         (advanced query parsing + matching)
//   lib/sort.ts           (stats-backed sort keys)
//   lib/libraryHealth.ts  (missing/invalid/duplicate judgment)
// Run with:
//   node --experimental-strip-types scripts/phase1_unit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSearchQuery, matchSong, filterSongs } from '../src/lib/search.ts'
import { sortSongs, defaultDirFor } from '../src/lib/sort.ts'
import { analyzeLibraryHealth, findDuplicateGroups } from '../src/lib/libraryHealth.ts'
import type { Song } from '../src/types/index.ts'

let seq = 0
function mk(over: Partial<Song> = {}): Song {
  seq++
  return {
    id: `s${seq}`,
    path: `/music/s${seq}.mp3`,
    title: `Song ${seq}`,
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    coverArt: null,
    ...over,
  }
}

// ── search: parsing ─────────────────────────────────────────────────────────
test('parse: free text becomes a field-less token', () => {
  assert.deepEqual(parseSearchQuery('aurora'), [{ field: null, text: 'aurora', year: null }])
})

test('parse: field prefixes are recognized case-insensitively', () => {
  const t = parseSearchQuery('ARTIST: aurora genre:Jazz')
  assert.deepEqual(t, [
    { field: 'artist', text: 'aurora', year: null },
    { field: 'genre', text: 'jazz', year: null },
  ])
})

test('parse: quoted phrases keep spaces', () => {
  const t = parseSearchQuery('title: "run away"')
  assert.deepEqual(t, [{ field: 'title', text: 'run away', year: null }])
})

test('parse: half-typed field prefix is dropped, not a dead match', () => {
  assert.deepEqual(parseSearchQuery('artist:'), [])
})

test('parse: year parses to a number', () => {
  const t = parseSearchQuery('year:1994')
  assert.equal(t[0].field, 'year')
  assert.equal(t[0].year, 1994)
})

// ── search: matching ────────────────────────────────────────────────────────
test('match: free text hits title, artist, album, genre', () => {
  const song = mk({ title: 'Northern Lights', artist: 'Aurora', album: 'Sky', genre: 'Dream Pop' })
  assert.equal(matchSong(song, parseSearchQuery('northern')), true)
  assert.equal(matchSong(song, parseSearchQuery('aurora')), true)
  assert.equal(matchSong(song, parseSearchQuery('sky')), true)
  assert.equal(matchSong(song, parseSearchQuery('dream')), true)
  assert.equal(matchSong(song, parseSearchQuery('zeppelin')), false)
})

test('match: field tokens constrain their field only', () => {
  const song = mk({ title: 'Alpha', artist: 'Beta', album: 'Gamma', genre: 'Rock' })
  assert.equal(matchSong(song, parseSearchQuery('artist: beta')), true)
  assert.equal(matchSong(song, parseSearchQuery('artist: alpha')), false)
  assert.equal(matchSong(song, parseSearchQuery('title: alpha')), true)
  assert.equal(matchSong(song, parseSearchQuery('album: gamma')), true)
  assert.equal(matchSong(song, parseSearchQuery('genre: rock')), true)
})

test('match: year exact match', () => {
  const song = mk({ year: 1994 })
  assert.equal(matchSong(song, parseSearchQuery('year:1994')), true)
  assert.equal(matchSong(song, parseSearchQuery('year:1995')), false)
})

test('match: multiple tokens AND together', () => {
  const song = mk({ title: 'Run Away', artist: 'Aurora', year: 1994 })
  assert.equal(matchSong(song, parseSearchQuery('artist: aurora "run away"')), true)
  assert.equal(matchSong(song, parseSearchQuery('artist: aurora year:1995')), false)
})

test('match: empty query matches everything', () => {
  const song = mk()
  assert.equal(matchSong(song, parseSearchQuery('   ')), true)
})

test('filter: one-shot helper matches the pieces', () => {
  const songs = [mk({ title: 'One' }), mk({ title: 'Two' })]
  assert.equal(filterSongs(songs, 'title: one').length, 1)
  assert.equal(filterSongs(songs, '').length, 2)
})

// ── sort: stats-backed keys ─────────────────────────────────────────────────
test('defaultDirFor: stats and time keys default to desc', () => {
  assert.equal(defaultDirFor('mostPlayed'), 'desc')
  assert.equal(defaultDirFor('mostSkipped'), 'desc')
  assert.equal(defaultDirFor('recentlyPlayed'), 'desc')
  assert.equal(defaultDirFor('added'), 'desc')
  assert.equal(defaultDirFor('title'), 'asc')
})

test('sort: mostPlayed orders by plays, ties stay stable', () => {
  const a = mk(), b = mk(), c = mk()
  const listen = new Map([
    [a.id, { plays: 3, skipped: 0, lastPlayedAt: 1 }],
    [b.id, { plays: 9, skipped: 0, lastPlayedAt: 2 }],
    [c.id, { plays: 1, skipped: 0, lastPlayedAt: 3 }],
  ])
  const out = sortSongs([a, b, c], 'mostPlayed', 'desc', listen)
  assert.deepEqual(out.map((s) => s.id), [b.id, a.id, c.id])
})

test('sort: never-played songs sink in recentlyPlayed in BOTH directions', () => {
  const a = mk(), b = mk(), never1 = mk(), never2 = mk()
  const listen = new Map([
    [a.id, { plays: 1, skipped: 0, lastPlayedAt: 100 }],
    [b.id, { plays: 1, skipped: 0, lastPlayedAt: 200 }],
  ])
  for (const dir of ['asc', 'desc'] as const) {
    const out = sortSongs([never1, a, never2, b], 'recentlyPlayed', dir, listen)
    assert.deepEqual(out.slice(-2).map((s) => s.id), [never1.id, never2.id], `dir=${dir}`)
    if (dir === 'desc') assert.deepEqual(out.slice(0, 2).map((s) => s.id), [b.id, a.id])
    else assert.deepEqual(out.slice(0, 2).map((s) => s.id), [a.id, b.id])
  }
})

test('sort: mostSkipped orders by skips', () => {
  const a = mk(), b = mk()
  const listen = new Map([
    [a.id, { plays: 5, skipped: 4, lastPlayedAt: 1 }],
    [b.id, { plays: 5, skipped: 1, lastPlayedAt: 2 }],
  ])
  const out = sortSongs([b, a], 'mostSkipped', 'desc', listen)
  assert.deepEqual(out.map((s) => s.id), [a.id, b.id])
})

test('sort: stats keys without a map degrade to stable library order', () => {
  const a = mk(), b = mk()
  assert.deepEqual(sortSongs([a, b], 'mostPlayed', 'desc').map((s) => s.id), [a.id, b.id])
})

// ── libraryHealth ───────────────────────────────────────────────────────────
test('health: missing files are flagged, existing pass', () => {
  const here = mk(), gone = mk()
  const checks = new Map([
    [here.path, { path: here.path, exists: true }],
    [gone.path, { path: gone.path, exists: false }],
  ])
  const r = analyzeLibraryHealth([here, gone], checks)
  assert.equal(r.ok, 1)
  assert.deepEqual(r.missing.map((s) => s.id), [gone.id])
})

test('health: zero-duration entries are invalid, not missing', () => {
  const junk = mk({ duration: 0 })
  const checks = new Map([[junk.path, { path: junk.path, exists: true }]])
  const r = analyzeLibraryHealth([junk], checks)
  assert.equal(r.ok, 0)
  assert.equal(r.missing.length, 0)
  assert.deepEqual(r.invalid.map((s) => s.id), [junk.id])
})

test('health: unchecked paths never count as missing', () => {
  const s = mk()
  const r = analyzeLibraryHealth([s], new Map())
  assert.equal(r.missing.length, 0)
  assert.equal(r.ok, 1)
})

test('health: duplicates detected by signature + duration tolerance', () => {
  const a = mk({ title: 'Run Away', artist: 'Aurora', album: 'Sky', duration: 180 })
  const b = mk({ title: 'run  away', artist: 'AURORA', album: 'sky', duration: 181.5 })
  const other = mk({ title: 'Run Away', artist: 'Aurora', album: 'Sky', duration: 240 })
  const groups = findDuplicateGroups([a, b, other])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].map((s) => s.id), [a.id, b.id])
})

test('health: zero-duration never equals another zero-duration as duplicate', () => {
  const a = mk({ duration: 0 })
  const b = mk({ duration: 0 })
  assert.equal(findDuplicateGroups([a, b]).length, 0)
})

test('health: same song name on DIFFERENT albums is not a duplicate', () => {
  const a = mk({ title: 'Intro', album: 'Album One', duration: 100 })
  const b = mk({ title: 'Intro', album: 'Album Two', duration: 100 })
  assert.equal(findDuplicateGroups([a, b]).length, 0)
})

test('health: duplicate clusters split when durations diverge', () => {
  const a = mk({ title: 'X', artist: 'A', album: 'B', duration: 180 })
  const b = mk({ title: 'X', artist: 'A', album: 'B', duration: 240 })
  const groups = findDuplicateGroups([a, b])
  assert.equal(groups.length, 0)
})

test('health: unreadable file joins its readable twin in a duplicate group', () => {
  const good = mk({ duration: 180 })
  const junk = mk({ title: good.title, artist: good.artist, album: good.album, duration: 0 })
  const groups = findDuplicateGroups([good, junk])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].length, 2)
})
