// Phase 6 (Explore full experience) unit tests — pure mapping logic only.
// Run with:
//   node --experimental-strip-types scripts/phase6_unit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
const require = (await import('node:module')).createRequire(import.meta.url)
const audius = require('../electron/providers/audius.cjs')
const { mapPlaylist, sortByReleaseDateDesc, pickArtwork, clampLimit } = audius

const HOST = 'https://api.audius.co'

const fakePlaylist = (over = {}) => ({
  id: 'pl1',
  playlist_name: '  Chill Vault  ',
  permalink: '/playlist/chill-vault',
  favorite_count: 20,
  repost_count: 4,
  total_play_count: 2500,
  track_count: 0,
  playlist_contents: [{ track: null }, { track_id: 11 }, { track: { id: 't2' } }, {}],
  artwork: { '150x150': 'https://img/150.jpg', '480x480': 'https://img/480.jpg' },
  user: { name: 'Aura Editor', handle: 'auraeditor' },
  ...over,
})

test('mapPlaylist: artwork comes from the `artwork` map (live shape), 480 preferred', () => {
  const p = mapPlaylist(fakePlaylist(), HOST)
  // Regression: module once read `p.artifact`, which does not exist on live
  // payloads — cards silently lost covers.
  assert.equal(p.artworkUrl, 'https://img/480.jpg')
})

test('mapPlaylist: name trimmed, owner subtitle, permalink, popularity weights', () => {
  const p = mapPlaylist(fakePlaylist(), HOST)
  assert.equal(p.id, 'pl1')
  assert.equal(p.providerId, 'audius')
  assert.equal(p.name, 'Chill Vault')
  assert.equal(p.subtitle, 'Aura Editor')
  assert.equal(p.permalink, 'https://audius.co/playlist/chill-vault')
  // favorites*3 + reposts*5 + plays/100 (floor)
  assert.equal(p.popularity, 20 * 3 + 4 * 5 + Math.floor(2500 / 100))
})

test('mapPlaylist: trackCount prefers playlist_contents entries over stale track_count', () => {
  const p = mapPlaylist(fakePlaylist({ track_count: 99 }), HOST)
  assert.equal(p.trackCount, 2) // only entries with track_id/track
  const q = mapPlaylist(fakePlaylist({ playlist_contents: undefined, track_count: 7 }), HOST)
  assert.equal(q.trackCount, 7)
})

test('mapPlaylist: null/absent artwork + missing user degrade honestly', () => {
  const p = mapPlaylist(fakePlaylist({ artwork: null, user: undefined }), HOST)
  assert.equal(p.artworkUrl, null)
  assert.equal(p.subtitle, null)
  assert.equal(p.name, 'Chill Vault') // name present — kept
  const q = mapPlaylist(fakePlaylist({ playlist_name: '   ', user: {} }), HOST)
  assert.equal(q.name, 'Untitled playlist') // whitespace-only → fallback
})

test('mapPlaylist: cover_art_sizes (raw CID map) is never mistaken for a URL', () => {
  const p = mapPlaylist(fakePlaylist({ artwork: null, cover_art_sizes: '01M21DHST7CGK64NN8HPQNX0S2' }), HOST)
  assert.equal(p.artworkUrl, null)
})

test('sortByReleaseDateDesc: newest first, missing/invalid dates sink last (stable)', () => {
  const tracks = [
    { id: 'a', release_date: '2026-09-01' },
    { id: 'b', release_date: '2026-09-20' },
    { id: 'c', release_date: null },
    { id: 'd', release_date: 'not-a-date' },
    { id: 'e', release_date: '2026-08-15' },
  ]
  const sorted = sortByReleaseDateDesc(tracks)
  assert.deepEqual(sorted.map((t) => t.id), ['b', 'a', 'e', 'c', 'd'])
  // Pure — input untouched
  assert.equal(tracks[0].id, 'a')
})

test('sortByReleaseDateDesc: empty pool is safe', () => {
  assert.deepEqual(sortByReleaseDateDesc([]), [])
})

test('clampLimit: playlist search clamps to provider ceiling', () => {
  assert.equal(clampLimit(500, 12), 100)
  assert.equal(clampLimit(-1, 12), 12)
  assert.equal(clampLimit('7', 12), 7)
})
