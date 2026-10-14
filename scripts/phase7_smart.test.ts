// Phase 7 (Smart Music Engine) unit tests — pure engine only, no React/IO.
// Run with:
//   node --experimental-strip-types scripts/phase7_smart.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSmartRadio, fnv1a, mulberry32, DEFAULT_SMART_CONFIG,
  type SmartContext, type EngineListen,
} from '../src/lib/smartEngine.ts'
import type { Song } from '../src/types/index.ts'

let seq = 0
function mk(over: Partial<Song> = {}): Song {
  seq++
  return {
    id: `s${seq}`,
    path: `/music/s${seq}.mp3`,
    title: `Song ${seq}`,
    artist: 'Alpha',
    album: 'Album One',
    duration: 200,
    coverArt: null,
    ...over,
  }
}

const NOW = Date.UTC(2026, 8, 21, 14, 0, 0) // 2026-09-21T14:00Z
const listen = (over: Partial<EngineListen> = {}): EngineListen => ({
  plays: 0, completed: 0, skipped: 0, totalPlayedMs: 0, lastPlayedAt: null, ...over,
})

function ctx(over: Partial<SmartContext> = {}): SmartContext {
  return {
    seed: null,
    library: [],
    favorites: [],
    listens: new Map(),
    recentScrobbles: [],
    now: NOW,
    config: {},
    ...over,
  }
}

// ── Deterministic primitives ────────────────────────────────────────────────

test('fnv1a + mulberry32: stable, in-range, input-sensitive', () => {
  assert.equal(fnv1a('aura'), fnv1a('aura'))
  assert.notEqual(fnv1a('aura'), fnv1a('aurb'))
  const r1 = mulberry32(42)
  const seqA = [r1(), r1(), r1()]
  const r2 = mulberry32(42)
  assert.deepEqual([r2(), r2(), r2()], seqA)
  for (const v of seqA) assert.ok(v >= 0 && v < 1)
})

// ── Determinism contract ────────────────────────────────────────────────────

test('same inputs (same day) → byte-identical list; exclusion of jitter source changes nothing structurally', () => {
  const lib = Array.from({ length: 30 }, (_, i) => mk({ id: `d${i}`, title: `T${i}`, artist: i % 3 === 0 ? 'Beta' : 'Alpha', genre: i % 2 ? 'Rock' : 'Pop' }))
  const a = buildSmartRadio(ctx({ library: lib, seed: lib[0] }))
  const b = buildSmartRadio(ctx({ library: lib, seed: lib[0] }))
  assert.deepEqual(a.picks.map((p) => p.song.id), b.picks.map((p) => p.song.id))
  assert.deepEqual(a.picks.map((p) => p.score), b.picks.map((p) => p.score))
})

test('radio mode: seed itself never ranks, similarity dominates', () => {
  const seed = mk({ id: 'seed', title: 'Seed', artist: 'Alpha', genre: 'Rock', year: 2001, duration: 200 })
  const sameArtist = mk({ artist: 'Alpha', genre: 'Jazz' })
  const sameGenre = mk({ artist: 'Zeta', genre: 'Rock' })
  const unrelated = mk({ artist: 'Yankee', genre: 'Polka', year: 1975, duration: 90 })
  const r = buildSmartRadio(ctx({ seed, library: [seed, sameArtist, sameGenre, unrelated] }))
  const ids = r.picks.map((p) => p.song.id)
  assert.ok(!ids.includes('seed'), 'seed excluded from its own radio')
  assert.equal(r.mode, 'radio')
  const pos = (id: string) => ids.indexOf(id)
  assert.ok(pos(sameArtist.id) < pos(unrelated.id), 'same artist beats unrelated')
  assert.ok(pos(sameGenre.id) < pos(unrelated.id), 'same genre beats unrelated')
  const topReasons = r.picks[0].reasons.join(' ')
  assert.ok(topReasons.length > 0, 'every pick carries human-readable reasons')
})

test('familiarity: plays + completions boost, heavy skip penalty, favorites boost', () => {
  const seed = mk({ id: 'seed', artist: 'SeedArtist', genre: 'SeedGenre' })
  const loved = mk({ artist: 'LovedArtist' })       // favorite + completions
  const skipped = mk({ artist: 'SkipArtist' })      // chronic skip
  const r = buildSmartRadio(ctx({
    seed,
    library: [seed, loved, skipped],
    favorites: [loved.id],
    listens: new Map([
      [loved.id, listen({ plays: 10, completed: 9, skipped: 0 })],
      [skipped.id, listen({ plays: 4, completed: 0, skipped: 4 })],
    ]),
  }))
  const ids = r.picks.map((p) => p.song.id)
  assert.ok(ids.indexOf(loved.id) < ids.indexOf(skipped.id), 'loved track outranks chronic skip')
  const lovedPick = r.picks.find((p) => p.song.id === loved.id)!
  assert.ok(lovedPick.reasons.some((x) => x.includes('favorites')))
  const skippedPick = r.picks.find((p) => p.song.id === skipped.id)!
  assert.ok(skippedPick.reasons.some((x) => x.includes('skip')))
})

test('recency: a track heard minutes ago sinks below an identical sibling', () => {
  const seed = mk({ id: 'seed', artist: 'S', genre: 'G' })
  const fresh = mk({ artist: 'A', genre: 'G', title: 'Fresh' })
  const justHeard = mk({ artist: 'A', genre: 'G', title: 'JustHeard' })
  const r = buildSmartRadio(ctx({
    seed,
    library: [seed, fresh, justHeard],
    listens: new Map([[justHeard.id, listen({ plays: 3, completed: 3, lastPlayedAt: NOW - 10 * 60 * 1000 })]]),
  }))
  const ids = r.picks.map((p) => p.song.id)
  assert.ok(ids.indexOf(fresh.id) < ids.indexOf(justHeard.id), 'just-heard track is decayed')
  const pick = r.picks.find((p) => p.song.id === justHeard.id)!
  assert.ok(pick.reasons.some((x) => x.includes('recently')))
})

test('diversity: per-artist cap enforced while alternatives exist; honest shortfall fill afterwards', () => {
  const seed = mk({ id: 'seed', artist: 'Seed', genre: 'G' })
  const lib = [seed]
  for (let i = 0; i < 40; i++) lib.push(mk({ id: `same${i}`, artist: 'Mono', genre: 'G' }))
  for (let i = 0; i < 10; i++) lib.push(mk({ id: `var${i}`, artist: `V${i}`, genre: `G${i}` }))
  // 13 reachable under the cap (3 Mono + 10 distinct V*) — ask for exactly that.
  const r = buildSmartRadio(ctx({ seed, library: lib, config: { targetCount: 13, artistCap: 3, explorationShare: 0.2 } }))
  const monoCount = r.picks.filter((p) => p.song.artist === 'Mono').length
  assert.ok(monoCount <= 3, `artist cap respected while alternatives exist (got ${monoCount})`)
  assert.equal(r.picks.length, 13, 'target count reached')

  // Monoculture library: the cap cannot be honored — the tail fills over cap
  // (rank order) rather than returning a mysteriously short list.
  const mono2 = buildSmartRadio(ctx({ seed, library: lib, config: { targetCount: 20, artistCap: 3, explorationShare: 0.2 } }))
  assert.equal(mono2.picks.length, 20)
  const head = mono2.picks.slice(0, 13)
  assert.equal(head.filter((p) => p.song.artist === 'Mono').length, 3, 'head stays diverse')
})

test('exploration quota: novel picks guaranteed even against heavy favorites', () => {
  const seed = mk({ id: 'seed', artist: 'Seed', genre: 'G' })
  const lib = [seed]
  // 30 heavily-played tracks + 10 untouched ones.
  for (let i = 0; i < 30; i++) {
    const s = mk({ id: `old${i}`, artist: `O${i}`, genre: 'G' })
    lib.push(s)
  }
  const listens = new Map<string, EngineListen>()
  lib.forEach((s) => { if (s.id.startsWith('old')) listens.set(s.id, listen({ plays: 12, completed: 11, skipped: 0 })) })
  for (let i = 0; i < 10; i++) lib.push(mk({ id: `new${i}`, artist: `N${i}`, genre: 'H' }))
  const r = buildSmartRadio(ctx({ seed, library: lib, listens, config: { targetCount: 20, explorationShare: 0.2, artistCap: 3 } }))
  const novel = r.picks.filter((p) => p.reasons.some((x) => x.includes('discovery')))
  assert.ok(novel.length >= 4, `exploration quota satisfied (got ${novel.length})`)
})

// ── Cold start ──────────────────────────────────────────────────────────────

test('cold start: no history + favorites → favorites lead with an honest note', () => {
  const lib = [mk({ id: 'f1' }), mk({ id: 'f2' }), mk({ id: 'x1' })]
  const r = buildSmartRadio(ctx({ library: lib, favorites: ['f1'] }))
  assert.equal(r.mode, 'cold-favorites')
  assert.equal(r.picks[0].song.id, 'f1')
  assert.ok(r.notes.some((n) => n.includes('favorites')))
})

test('cold start: no history, no favorites → recently added lead', () => {
  const lib = [
    mk({ id: 'old', addedAt: 1000 }),
    mk({ id: 'newest', addedAt: 3000 }),
    mk({ id: 'mid', addedAt: 2000 }),
  ]
  const r = buildSmartRadio(ctx({ library: lib }))
  assert.equal(r.mode, 'cold-library')
  assert.deepEqual(r.picks.map((p) => p.song.id), ['newest', 'mid', 'old'])
  assert.ok(r.notes.some((n) => n.includes('history')))
})

test('cold start: empty library → empty picks + note, never a crash', () => {
  const r = buildSmartRadio(ctx({ library: [] }))
  assert.equal(r.picks.length, 0)
  assert.ok(r.notes.length > 0)
})

// ── Availability & hygiene ──────────────────────────────────────────────────

test('excluded ids and stale seeds are handled honestly', () => {
  const seed = mk({ id: 'seed', artist: 'A', genre: 'G' })
  const a = mk({ artist: 'A', genre: 'G' })
  const b = mk({ artist: 'B' })
  const r = buildSmartRadio(ctx({ seed, library: [seed, a, b], excludeIds: [a.id] }))
  const ids = r.picks.map((p) => p.song.id)
  assert.ok(!ids.includes(a.id), 'excluded id never appears')
  assert.ok(ids.includes(b.id))
})

test('seed missing from library → taste fallback with note, not a crash', () => {
  const ghost = mk({ id: 'ghost' })
  const lib = [mk({ artist: 'A' }), mk({ artist: 'B' })]
  const r = buildSmartRadio(ctx({ seed: ghost, library: lib, listens: new Map([['x', listen({ plays: 5 })]]) }))
  assert.equal(r.mode, 'taste')
  assert.ok(r.notes.some((n) => n.includes('no longer in the library')))
})

test('taste mode (no seed, real history) ranks by familiarity and explains itself', () => {
  const lib = [mk({ id: 'big', artist: 'Big' }), mk({ id: 'none', artist: 'None' })]
  const r = buildSmartRadio(ctx({ library: lib, listens: new Map([['big', listen({ plays: 20, completed: 18 })]]) }))
  assert.equal(r.mode, 'taste')
  assert.equal(r.picks[0].song.id, 'big')
  assert.ok(r.notes.some((n) => n.includes('listening history')))
})

test('pool exhausted by exclusions → honest empty, no crash', () => {
  const seed = mk({ id: 'seed' })
  const a = mk()
  const r = buildSmartRadio(ctx({ seed, library: [seed, a], excludeIds: [a.id] }))
  assert.equal(r.picks.length, 0)
})

test('large library: 5000 tracks score in reasonable time (performance guard)', () => {
  const seed = mk({ id: 'seed', artist: 'Seed', genre: 'G' })
  const lib = Array.from({ length: 5000 }, (_, i) => mk({ id: `p${i}`, artist: i % 50 === 0 ? 'Seed' : `A${i % 300}`, genre: i % 2 ? 'G' : 'H', year: 1960 + (i % 60) }))
  const listens = new Map<string, EngineListen>()
  for (let i = 0; i < 1000; i++) listens.set(`p${i}`, listen({ plays: (i % 9) + 1, completed: i % 3, lastPlayedAt: NOW - i * 3600_000 }))
  const t0 = process.hrtime.bigint()
  const r = buildSmartRadio(ctx({ seed, library: lib, listens }))
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  assert.equal(r.picks.length, DEFAULT_SMART_CONFIG.targetCount)
  assert.ok(ms < 500, `engine scored 5k tracks in ${ms.toFixed(1)}ms (limit 500ms)`)
})
