// Aura 3.0 — spec §9 Radio music-focus filter unit tests. Run with:
//   node --experimental-strip-types scripts/a3_radio_music.test.ts
// radioMusic.ts is dependency-free (no @/ imports), so no bundler resolution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isNonMusicTagText, isMusicStation, filterMusicStations, filterMusicFacets,
} from '../src/lib/radioMusic.ts'

test('non-music markers: explicit spec categories are caught', () => {
  for (const t of ['news', 'talk', 'politics', 'political', 'sports', 'football',
    'religion', 'religious', 'prayer', 'sermon', 'comedy', 'science', 'business',
    'weather', 'podcast', 'audiobook']) {
    assert.equal(isNonMusicTagText(t), true, `expected "${t}" to be non-music`)
  }
})

test('music genres never match — including religious music genres', () => {
  for (const t of ['pop', 'rock', 'jazz', 'electronic', 'classical', 'lo-fi', 'hip hop',
    'metal', 'ambient', 'blues', 'country', 'folk', 'reggae', 'soul', 'funk',
    '80s', 'chillout', 'gospel', 'christian music', 'worship', 'christmas',
    'top 40', 'dance', 'house', 'techno']) {
    assert.equal(isNonMusicTagText(t), false, `expected "${t}" to stay`)
  }
})

test('whole-word matching: "newsroom" style substrings do not false-positive… except real words', () => {
  // 'newsroom' contains 'news' at a word boundary followed by more chars —
  // \b requires the FULL word, so compound words like 'newsroom' stay.
  assert.equal(isNonMusicTagText('newsroom'), false)
  assert.equal(isNonMusicTagText('classic rock news'), true) // real word 'news'
  assert.equal(isNonMusicTagText('talkradio'), false)        // compound stays
  assert.equal(isNonMusicTagText('talk'), true)
})

test('isMusicStation: untagged/missing tags are KEPT (no metadata = no assumption)', () => {
  assert.equal(isMusicStation(undefined), true)
  assert.equal(isMusicStation(null), true)
  assert.equal(isMusicStation([]), true)
})

test('isMusicStation: tagged stations judged by metadata only', () => {
  assert.equal(isMusicStation(['jazz', 'smooth']), true)
  assert.equal(isMusicStation(['pop', 'news']), false)      // news station
  assert.equal(isMusicStation(['sports', 'rock']), false)   // sports station
  assert.equal(isMusicStation(['religion', 'community']), false)
  // Music genre + non-music marker mixed → filtered (it IS categorized talk).
  assert.equal(isMusicStation(['music', 'talk']), false)
})

test('filterMusicStations preserves order and keeps untagged rows', () => {
  const list = [
    { id: 'a', tags: ['news', 'politics'] },
    { id: 'b' },                       // no tags field
    { id: 'c', tags: ['jazz'] },
    { id: 'd', tags: null },
    { id: 'e', tags: ['sports'] },
  ]
  assert.deepEqual(filterMusicStations(list).map((s) => s.id), ['b', 'c', 'd'])
})

test('filterMusicFacets curates the genre dropdown toward music', () => {
  const facets = [
    { value: 'pop', count: 900 },
    { value: 'news', count: 1700 },
    { value: 'jazz', count: 400 },
    { value: 'talk', count: 1500 },
    { value: 'religion', count: 300 },
  ]
  assert.deepEqual(filterMusicFacets(facets).map((f) => f.value), ['pop', 'jazz'])
})
