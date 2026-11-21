// Phase 8 (Smart Queue & Smart Playlists) unit tests — pure helpers + engine keys.
// Run with:
//   node --experimental-strip-types scripts/phase8_smartqueue.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldExtendQueue, appendSmartPicks, pruneSmartIds, CONTINUE_THRESHOLD, CONTINUE_COUNT,
} from '../src/lib/smartQueue.ts'
import { buildSmartRadio, type SmartContext } from '../src/lib/smartEngine.ts'
import type { Song } from '../src/types/index.ts'

let seq = 0
const mk = (over: Partial<Song> = {}): Song => {
  seq++
  return {
    id: `s${seq}`, path: `/music/s${seq}.mp3`, title: `Song ${seq}`,
    artist: 'Alpha', album: 'Album One', duration: 200, coverArt: null, ...over,
  }
}

const NOW = Date.UTC(2026, 8, 21, 14, 0, 0)

// ── shouldExtendQueue ───────────────────────────────────────────────────────

test('shouldExtendQueue: only when enabled, repeat=none, near the end', () => {
  assert.equal(shouldExtendQueue(10, 8, 'none', true), true)   // 1 left < 3
  assert.equal(shouldExtendQueue(10, 7, 'none', true), true)   // 2 left
  assert.equal(shouldExtendQueue(10, 6, 'none', true), false)  // 3 left — not yet
  assert.equal(shouldExtendQueue(10, 8, 'none', false), false) // feature off
  assert.equal(shouldExtendQueue(10, 8, 'all', true), false)   // repeat=all never runs dry
  assert.equal(shouldExtendQueue(10, 8, 'one', true), false)
  assert.equal(shouldExtendQueue(0, 0, 'none', true), false)   // empty queue
  assert.equal(shouldExtendQueue(5, 5, 'none', true), false)   // out of bounds
})

test('shouldExtendQueue: short queues still continue (1-track queue at its end)', () => {
  assert.equal(shouldExtendQueue(1, 0, 'none', true), true)
  assert.equal(shouldExtendQueue(2, 0, 'none', true), true)
})

// ── appendSmartPicks ────────────────────────────────────────────────────────

test('appendSmartPicks: appends only, never reorders, dedupes vs queue and intra-batch', () => {
  const q = [mk({ id: 'a' }), mk({ id: 'b' })]
  const nq = [mk({ id: 'a' }), mk({ id: 'b' })]
  const picks = [
    { song: mk({ id: 'c' }), reason: 'Same artist' },
    { song: mk({ id: 'a' }), reason: 'duplicate of queued' },  // already in queue
    { song: mk({ id: 'd' }), reason: 'New to you' },
    { song: mk({ id: 'd' }), reason: 'dup inside batch' },     // already appended
  ]
  const r = appendSmartPicks(q, nq, picks)!
  assert.deepEqual(r.queue.map((s) => s.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(r.naturalQueue.map((s) => s.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(r.addedIds, ['c', 'd'])
  assert.deepEqual(r.reasons, { c: 'Same artist', d: 'New to you' })
})

test('appendSmartPicks: all-duplicate batch → null (store skips the set)', () => {
  const q = [mk({ id: 'a' })]
  assert.equal(appendSmartPicks(q, q, [{ song: mk({ id: 'a' }), reason: 'x' }]), null)
})

test('pruneSmartIds: only ids still in the queue survive', () => {
  const q = [mk({ id: 'a' }), mk({ id: 'c' })]
  assert.deepEqual(pruneSmartIds(['a', 'b', 'c'], q), ['a', 'c'])
})

// ── engine jitterKey (Smart Playlists regeneration) ─────────────────────────

function baseCtx(over: Partial<SmartContext> = {}): SmartContext {
  const lib = Array.from({ length: 40 }, (_, i) =>
    mk({ id: `t${i}`, artist: `A${i % 7}`, genre: i % 2 ? 'Rock' : 'Pop' }))
  const listens = new Map()
  lib.forEach((s, i) => listens.set(s.id, { plays: 10 - (i % 10), completed: 8, skipped: 0, totalPlayedMs: 1, lastPlayedAt: NOW - i * 1000 }))
  return {
    seed: null, library: lib, favorites: [], listens,
    recentScrobbles: [], now: NOW, config: { targetCount: 15 }, ...over,
  }
}

test('jitterKey: same key → identical list; different nonce → different order', () => {
  const ctx = baseCtx()
  const a = buildSmartRadio({ ...ctx, jitterKey: 'made|2026-09-21|0' })
  const b = buildSmartRadio({ ...ctx, jitterKey: 'made|2026-09-21|0' })
  assert.deepEqual(a.picks.map((p) => p.song.id), b.picks.map((p) => p.song.id))
  const c = buildSmartRadio({ ...ctx, jitterKey: 'made|2026-09-21|1' })
  const idsA = a.picks.map((p) => p.song.id).join(',')
  const idsC = c.picks.map((p) => p.song.id).join(',')
  assert.notEqual(idsA, idsC, 'regeneration produces a different (still valid) ordering')
})

test('Discovery config yields strictly more novel picks than Made for You on a familiar library', () => {
  const lib = Array.from({ length: 60 }, (_, i) =>
    mk({ id: `t${i}`, artist: `A${i % 10}`, genre: 'Rock' }))
  const listens = new Map<string, { plays: number; completed: number; skipped: number; totalPlayedMs: number; lastPlayedAt: number | null }>()
  // 50 well-played tracks, 10 untouched.
  lib.forEach((s, i) => listens.set(s.id, i < 50
    ? { plays: 8, completed: 7, skipped: 0, totalPlayedMs: 1, lastPlayedAt: NOW - 86400000 }
    : { plays: 0, completed: 0, skipped: 0, totalPlayedMs: 0, lastPlayedAt: null }))
  const made = buildSmartRadio({ ...baseCtx({ library: lib, listens }), jitterKey: 'd|0' })
  const discovery = buildSmartRadio({ ...baseCtx({ library: lib, listens }), config: { explorationShare: 0.6, artistCap: 2 }, jitterKey: 'd|0' })
  const novel = (r: ReturnType<typeof buildSmartRadio>) =>
    r.picks.filter((p) => p.reasons.some((x) => x.includes('discovery'))).length
  assert.ok(novel(discovery) > novel(made), `discovery novel=${novel(discovery)} made novel=${novel(made)}`)
  assert.ok(novel(discovery) >= Math.ceil(0.6 * CONTINUE_COUNT) - 1 || novel(discovery) >= 5, 'discovery honors its exploration share')
})

test('continuation count: engine respects targetCount for the continuation batch', () => {
  const lib = Array.from({ length: 30 }, (_, i) => mk({ id: `t${i}`, artist: `A${i}`, genre: 'G' }))
  const r = buildSmartRadio({ ...baseCtx({ library: lib, listens: new Map(), favorites: [] }), seed: lib[0], config: { targetCount: CONTINUE_COUNT } })
  assert.equal(r.picks.length, CONTINUE_COUNT)
  assert.ok(!r.picks.some((p) => p.song.id === lib[0].id), 'seed excluded from continuation picks')
})

test('excluded (user-removed) ids never re-enter the continuation', () => {
  const lib = Array.from({ length: 20 }, (_, i) => mk({ id: `t${i}`, artist: `A${i}`, genre: 'G' }))
  const removed = lib[3].id
  const r = buildSmartRadio({ ...baseCtx({ library: lib, listens: new Map() }), seed: lib[0], excludeIds: [removed], config: { targetCount: CONTINUE_COUNT } })
  assert.ok(!r.picks.some((p) => p.song.id === removed))
})
