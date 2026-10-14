// Phase 4 (Audius) unit tests — pure mapping/normalization logic.
// Run with:
//   node --experimental-strip-types scripts/phase4_audius.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
const require = (await import('node:module')).createRequire(import.meta.url)
const audius = require('../electron/providers/audius.cjs')
const { mapTrack, mapUser, trackPopularity, isTrackStreamable, streamUrlFor, clampLimit, pickArtwork } = audius

const HOST = 'https://api.audius.co'

const fakeTrack = (over = {}) => ({
  id: 'trk1',
  title: '  Night Drive  ',
  duration: 201,
  is_streamable: true,
  is_delete: false,
  play_count: 1000,
  favorite_count: 40,
  repost_count: 10,
  genre: 'Synthwave',
  permalink: '/night-drive',
  artwork: { '150x150': 'https://img/150.jpg', '480x480': 'https://img/480.jpg' },
  user: { id: 'u1', name: 'Neon Fox', handle: 'neonfox' },
  ...over,
})

test('mapTrack: full mapping with priority artwork and popularity', () => {
  const t = mapTrack(fakeTrack(), HOST)
  assert.equal(t.id, 'trk1')
  assert.equal(t.title, 'Night Drive') // trimmed
  assert.equal(t.artist, 'Neon Fox')
  assert.equal(t.artistHandle, 'neonfox')
  assert.equal(t.durationSec, 201)
  assert.equal(t.artworkUrl, 'https://img/480.jpg') // 480 preferred over 150
  assert.equal(t.subtitle, 'Synthwave')
  assert.equal(t.isStreamable, true)
  assert.equal(t.streamUrl, `${HOST}/v1/tracks/trk1/stream?app_name=AuraPlayer`)
  assert.equal(t.permalink, 'https://audius.co/night-drive')
  assert.equal(t.popularity, 1000 + 40 * 3 + 10 * 5)
})

test('mapTrack: non-streamable track gets null streamUrl, honest flag', () => {
  const t = mapTrack(fakeTrack({ is_streamable: false }), HOST)
  assert.equal(t.isStreamable, false)
  assert.equal(t.streamUrl, null)
})

test('mapTrack: deleted track is not streamable', () => {
  const t = mapTrack(fakeTrack({ is_delete: true }), HOST)
  assert.equal(t.isStreamable, false)
  assert.equal(t.streamUrl, null)
})

test('mapTrack: missing artwork/user fall back safely', () => {
  const t = mapTrack(fakeTrack({ artwork: null, user: null, title: '' }), HOST)
  assert.equal(t.artworkUrl, null)
  assert.equal(t.artist, 'Unknown Artist')
  assert.equal(t.title, 'Untitled')
})

test('trackPopularity: weights favorites and reposts', () => {
  assert.equal(trackPopularity({ play_count: 10, favorite_count: 2, repost_count: 1 }), 10 + 6 + 5)
  assert.equal(trackPopularity({}), 0)
})

test('isTrackStreamable: zero duration disqualifies', () => {
  assert.equal(isTrackStreamable({ is_streamable: true, duration: 0 }), false)
  assert.equal(isTrackStreamable({ is_streamable: true, duration: 30 }), true)
})

test('streamUrlFor: encodes the track id', () => {
  assert.equal(streamUrlFor(HOST, 'a/b c'), `${HOST}/v1/tracks/a%2Fb%20c/stream?app_name=AuraPlayer`)
})

test('clampLimit: clamps to 1..100 with fallback', () => {
  assert.equal(clampLimit(undefined), 20)
  assert.equal(clampLimit(0), 20)
  assert.equal(clampLimit(-5), 20)
  assert.equal(clampLimit(5000), 100)
  assert.equal(clampLimit(7, 10), 7)
})

test('pickArtwork: falls down the size ladder', () => {
  assert.equal(pickArtwork({ '1000x1000': 'a', '480x480': 'b' }), 'b') // 480 wins
  assert.equal(pickArtwork({ '1000x1000': 'a' }), 'a')
  assert.equal(pickArtwork({}), null)
  assert.equal(pickArtwork(null), null)
})

test('mapUser: normalizes name/handle/followers', () => {
  const u = mapUser({ id: 'u9', name: '  ', handle: 'h', follower_count: 'x', is_verified: 1 })
  assert.equal(u.name, 'h')
  assert.equal(u.followers, 0)
  assert.equal(u.isVerified, true)
})
