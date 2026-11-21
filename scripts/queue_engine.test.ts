// Unit tests for src/lib/queueEngine.ts — run with:
//   node --experimental-strip-types scripts/queue_engine.test.ts
// (Node 24 strips erasable TS types natively; queueEngine imports nothing,
//  so no bundler/alias resolution is needed.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  shuffledAround, nextIndex, prevIndex, indexAfterRemoval,
  removeByIds, indexOfId, type QueueItem,
} from '../src/lib/queueEngine.ts'

const ids = (xs: ReadonlyArray<QueueItem>) => xs.map((x) => x.id)
const mk = (n: number): QueueItem[] => Array.from({ length: n }, (_, i) => ({ id: `s${i}` }))

// ── shuffledAround ──────────────────────────────────────────────────────────
test('shuffledAround: returns a permutation (same items, no loss/dup)', () => {
  const q = mk(50)
  const out = shuffledAround(q, null)
  assert.equal(out.length, q.length)
  assert.deepEqual([...ids(out)].sort(), [...ids(q)].sort())
})

test('shuffledAround: actually reorders for >2 items (statistical sanity)', () => {
  const q = mk(24)
  // Practically impossible for 24 items to land in original order
  assert.notDeepEqual(ids(shuffledAround(q, null)), ids(q))
})

test('shuffledAround: current song keeps its exact index', () => {
  const q = mk(30)
  const out = shuffledAround(q, 's7')
  assert.equal(ids(out)[7], 's7')
})

test('shuffledAround: input array is not mutated', () => {
  const q = mk(10)
  const before = ids(q)
  shuffledAround(q, 's3')
  assert.deepEqual(ids(q), before)
})

test('shuffledAround: empty and singleton queues', () => {
  assert.deepEqual(shuffledAround([], null), [])
  assert.deepEqual(ids(shuffledAround([{ id: 'a' }], 'a')), ['a'])
})

test('shuffledAround: keepId absent from queue → full shuffle, no crash', () => {
  const q = mk(10)
  const out = shuffledAround(q, 'ghost')
  assert.equal(out.length, 10)
})

// ── nextIndex ───────────────────────────────────────────────────────────────
test('nextIndex: manual skip advances', () => {
  assert.equal(nextIndex(10, 3, 'none', false), 4)
})

test('nextIndex: manual skip wraps at end even with repeat=none', () => {
  assert.equal(nextIndex(10, 9, 'none', false), 0)
})

test('nextIndex: auto + repeat=none stops (null) at end of queue', () => {
  assert.equal(nextIndex(10, 9, 'none', true), null)
})

test('nextIndex: auto + repeat=none advances mid-queue', () => {
  assert.equal(nextIndex(10, 4, 'none', true), 5)
})

test('nextIndex: auto + repeat=all wraps at end', () => {
  assert.equal(nextIndex(10, 9, 'all', true), 0)
})

test('nextIndex: empty queue → null', () => {
  assert.equal(nextIndex(0, 0, 'all', false), null)
})

test('nextIndex: repeat=one + auto is the caller restarting (mid-queue advance only)', () => {
  // repeat=one never auto-advances past the end; mid-queue auto behavior
  // with 'one' is irrelevant because the controller restarts the track,
  // but the engine must still be total (no throw / sensible value).
  assert.equal(nextIndex(10, 4, 'one', true), 5)
})

// ── prevIndex ───────────────────────────────────────────────────────────────
test('prevIndex: steps back', () => {
  assert.equal(prevIndex(10, 5, 'none'), 4)
})

test('prevIndex: clamps at 0 with repeat=none', () => {
  assert.equal(prevIndex(10, 0, 'none'), 0)
})

test('prevIndex: repeat=all wraps to last', () => {
  assert.equal(prevIndex(10, 0, 'all'), 9)
})

// ── indexAfterRemoval ───────────────────────────────────────────────────────
test('indexAfterRemoval: removing before the playhead shifts it down', () => {
  assert.equal(indexAfterRemoval(3, 1), 2)
})

test('indexAfterRemoval: removing at/after the playhead keeps it', () => {
  assert.equal(indexAfterRemoval(3, 3), 3)
  assert.equal(indexAfterRemoval(3, 4), 3)
})

// ── removeByIds ─────────────────────────────────────────────────────────────
test('removeByIds: filters items and re-anchors the playhead by id', () => {
  const q = mk(5) // s0..s4
  const { items, currentIndex } = removeByIds(q, new Set(['s1']), 3) // playing s3
  assert.deepEqual(ids(items), ['s0', 's2', 's3', 's4'])
  assert.equal(currentIndex, 2) // s3 moved from 3 → 2
})

test('removeByIds: removing the playing song → null index', () => {
  const q = mk(5)
  const { items, currentIndex } = removeByIds(q, new Set(['s3']), 3)
  assert.deepEqual(ids(items), ['s0', 's1', 's2', 's4'])
  assert.equal(currentIndex, null)
})

test('removeByIds: removing everything → empty, null index', () => {
  const q = mk(3)
  const { items, currentIndex } = removeByIds(q, new Set(['s0', 's1', 's2']), 1)
  assert.deepEqual(items, [])
  assert.equal(currentIndex, null)
})

// ── indexOfId ───────────────────────────────────────────────────────────────
test('indexOfId: found and not-found', () => {
  const q = mk(4)
  assert.equal(indexOfId(q, 's2'), 2)
  assert.equal(indexOfId(q, 'nope'), -1)
})
