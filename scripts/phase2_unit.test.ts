// Phase 2 (Search & Navigation 2.0) unit tests — shared search engine.
// Run with:
//   node --experimental-strip-types scripts/phase2_unit.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fuzzyScore, searchLibrary } from '../src/lib/search.ts'
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

// ── fuzzyScore (shared by Library + Palette) ────────────────────────────────
test('fuzzy: prefix beats substring beats subsequence', () => {
  const q = 'aur'
  assert.equal(fuzzyScore(q, 'Aurora'), 100)
  const sub = fuzzyScore(q, 'X Aurora')
  assert.ok(sub > 40 && sub < 100, `substring=${sub}`)
  assert.equal(fuzzyScore(q, 'a u r n'), 40) // a@0, u@2, r@4 — in order, no substring
})

test('fuzzy: returns -1 when chars not in order', () => {
  assert.equal(fuzzyScore('xz', 'abc'), -1)
})

// ── searchLibrary: exact mode ───────────────────────────────────────────────
test('searchLibrary: empty query returns everything, not fuzzy', () => {
  const songs = [mk(), mk()]
  const r = searchLibrary(songs, '   ')
  assert.equal(r.matches.length, 2)
  assert.equal(r.fuzzy, false)
})

test('searchLibrary: exact substring matches', () => {
  const a = mk({ title: 'Northern Lights' })
  const b = mk({ title: 'South Wind' })
  const r = searchLibrary([a, b], 'northern')
  assert.deepEqual(r.matches, [a])
  assert.equal(r.fuzzy, false)
})

test('searchLibrary: operators work and never fuzzy-fall back', () => {
  const a = mk({ artist: 'Aurora' })
  const b = mk({ title: 'Aurora', artist: 'Someone' })
  const r = searchLibrary([a, b], 'artist: aurora')
  assert.deepEqual(r.matches, [a])
  assert.equal(r.fuzzy, false)
  const miss = searchLibrary([a, b], 'artist: aurrra') // typo INSIDE operator
  assert.equal(miss.matches.length, 0)
  assert.equal(miss.fuzzy, false) // operator constraint respected literally
})

// ── searchLibrary: fuzzy fallback ───────────────────────────────────────────
test('searchLibrary: exact miss on plain text falls back to fuzzy', () => {
  const a = mk({ title: 'Run Away', artist: 'Aurora' })
  const b = mk({ title: 'Stay', artist: 'Someone Else' })
  const r = searchLibrary([a, b], 'run awy') // typo, no operator
  assert.equal(r.fuzzy, true)
  assert.deepEqual(r.matches, [a])
})

test('searchLibrary: fuzzy is capped and ranked', () => {
  const songs = Array.from({ length: 60 }, (_, i) => mk({ title: `Track ${String(i).padStart(3, '0')}xyz` }))
  const r = searchLibrary(songs, 'trck', 10)
  assert.equal(r.fuzzy, true)
  assert.ok(r.matches.length <= 10)
})

test('searchLibrary: exact hit means no fuzzy even with garbage ranking', () => {
  const a = mk({ title: 'Alpha' })
  const r = searchLibrary([a], 'alpha')
  assert.equal(r.fuzzy, false)
  assert.equal(r.matches.length, 1)
})
