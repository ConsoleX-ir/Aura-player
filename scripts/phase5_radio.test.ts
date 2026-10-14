// Phase 5 (Radio Browser) unit tests — pure mapping logic.
// Run with:
//   node --experimental-strip-types scripts/phase5_radio.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
const require = (await import('node:module')).createRequire(import.meta.url)
const rb = require('../electron/providers/radiobrowser.cjs')
const { mapStation, cleanStationName, isStationPlayable, stationPopularity, clampLimit } = rb

const station = (over = {}) => ({
  stationuuid: 'uuid-1',
  name: '  Jazz\t FM  ',
  url_resolved: 'http://stream.example.com/live',
  favicon: 'https://example.com/logo.png',
  country: 'Germany',
  countrycode: 'DE',
  language: 'german,english',
  tags: 'jazz, smooth, night',
  codec: 'MP3',
  bitrate: 192,
  votes: 47,
  clickcount: 12,
  clicktrend: 2,
  homepage: 'https://jazzfm.example',
  lastcheckok: 1,
  ...over,
})

test('mapStation: cleans control chars in names, maps core fields', () => {
  const s = mapStation(station())
  assert.equal(s.id, 'uuid-1')
  assert.equal(s.title, 'Jazz FM')
  assert.equal(s.artist, 'Germany')
  assert.equal(s.providerId, 'radiobrowser')
  assert.equal(s.isStreamable, true)
  assert.equal(s.streamUrl, 'http://stream.example.com/live')
  assert.equal(s.durationSec, null) // live radio
  assert.equal(s.permalink, 'https://jazzfm.example')
  assert.deepEqual(s.tags, ['jazz', 'smooth', 'night'])
  assert.equal(s.subtitle, 'MP3 · 192 kbps · jazz, smooth, night')
})

test('mapStation: dead station (lastcheckok=0) is not streamable', () => {
  const s = mapStation(station({ lastcheckok: 0 }))
  assert.equal(s.isStreamable, false)
  assert.equal(s.streamUrl, null)
})

test('mapStation: missing url_resolved is not streamable', () => {
  const s = mapStation(station({ url_resolved: undefined }))
  assert.equal(s.isStreamable, false)
  assert.equal(s.streamUrl, null)
})

test('mapStation: non-http favicon and homepage rejected', () => {
  const s = mapStation(station({ favicon: 'javascript:alert(1)', homepage: 'not-a-url' }))
  assert.equal(s.artworkUrl, null)
  assert.equal(s.permalink, null)
})

test('mapStation: popularity weights votes > clicks > trend', () => {
  assert.equal(stationPopularity({ votes: 10, clickcount: 5, clicktrend: 1 }), 20 + 5 + 3)
  assert.equal(stationPopularity({}), 0)
})

test('isStationPlayable: http-only stream URLs accepted (radio reality)', () => {
  assert.equal(isStationPlayable(station({ url_resolved: 'http://plain.radio' })), true)
  assert.equal(isStationPlayable(station({ url_resolved: 'ftp://x' })), false)
})

test('clampLimit: caps at 200 for big libraries of stations', () => {
  assert.equal(clampLimit(9999), 200)
  assert.equal(clampLimit(undefined, 40), 40)
  assert.equal(clampLimit(3), 3)
})

test('cleanStationName: tabs/newlines collapse to single spaces', () => {
  assert.equal(cleanStationName('A\tB\nC\r\n  D '), 'A B C D')
})
