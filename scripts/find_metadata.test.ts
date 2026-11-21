import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeFindInfoCandidates } from '../src/services/findMetadata'

const query = { title: 'Song Title', artist: 'The Artist', album: 'An Album', duration: 180 }

test('Find Info Online merges cross-source duplicates and preserves source links', () => {
  const candidates = mergeFindInfoCandidates(query, [
    { source: 'deezer', title: 'Song Title', artist: 'The Artist', album: 'An Album', year: null, genre: null, durationSec: 181, artworkUrl: null, link: 'https://deezer.test/1' },
    { source: 'itunes', title: 'Song Title', artist: 'The Artist', album: 'An Album', year: 2020, genre: 'Rock', durationSec: 181, artworkUrl: 'https://img.test/cover.jpg', link: 'https://itunes.test/1' },
  ])
  assert.equal(candidates.length, 1)
  assert.deepEqual(candidates[0].sources, ['deezer', 'itunes'])
  assert.equal(candidates[0].year, 2020)
  assert.equal(candidates[0].artworkUrl, 'https://img.test/cover.jpg')
  assert.equal(candidates[0].links.length, 2)
})

test('Find Info Online ranks title and artist matches above unrelated results', () => {
  const candidates = mergeFindInfoCandidates(query, [
    { source: 'deezer', title: 'Song Title', artist: 'The Artist', album: null, year: null, genre: null, durationSec: 180, artworkUrl: null },
    { source: 'itunes', title: 'Unrelated Song', artist: 'Other Artist', album: null, year: null, genre: null, durationSec: 180, artworkUrl: null },
  ])
  assert.equal(candidates[0].title, 'Song Title')
  assert.ok(candidates[0].score > candidates[1].score)
})
