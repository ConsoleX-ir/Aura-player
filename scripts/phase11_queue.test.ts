// Phase 11 (Queue 2.0) unit tests — pure primitives.
// Run with:
//   node --experimental-strip-types scripts/phase11_queue.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveItem, indexAfterMove, insertAfter, upcomingIds } from '../src/lib/queueEngine.ts'

const ids = (arr: { id: string }[]) => arr.map((x) => x.id)

test('moveItem: reorders, clamps, and never mutates the input', () => {
  const q = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const r = moveItem(q, 3, 1)
  assert.deepEqual(ids(r), ['a', 'd', 'b', 'c'])
  assert.deepEqual(ids(q), ['a', 'b', 'c', 'd'], 'input untouched')
  assert.deepEqual(ids(moveItem(q, 0, 99)), ['b', 'c', 'd', 'a'], 'to clamps')
  assert.deepEqual(ids(moveItem(q, -5, 2)), ['b', 'c', 'a', 'd'], 'from clamps to 0')
  assert.deepEqual(ids(moveItem(q, 2, 2)), ids(q), 'no-op move returns equal content')
  assert.deepEqual(ids(moveItem([], 0, 0)), [])
})

test('indexAfterMove: the playing item never jumps', () => {
  // Playing item itself moves → ends up where it was dropped.
  assert.equal(indexAfterMove(2, 2, 0), 0)
  assert.equal(indexAfterMove(2, 2, 3), 3)
  // Moving an item from before the playhead to at/after it shifts the head back.
  assert.equal(indexAfterMove(3, 1, 4), 2)
  // Moving from after the playhead to at/before it shifts the head forward.
  assert.equal(indexAfterMove(1, 4, 0), 2)
  // Unrelated moves leave the head alone.
  assert.equal(indexAfterMove(2, 3, 4), 2)
  assert.equal(indexAfterMove(2, 0, 1), 2)
})

test('insertAfter: places item directly after the given index (clamped)', () => {
  const q = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(ids(insertAfter(q, 0, { id: 'x' })), ['a', 'x', 'b'])
  assert.deepEqual(ids(insertAfter(q, 1, { id: 'x' })), ['a', 'b', 'x'])
  assert.deepEqual(ids(insertAfter(q, 99, { id: 'x' })), ['a', 'b', 'x'])
  assert.deepEqual(ids(insertAfter(q, -1, { id: 'x' })), ['x', 'a', 'b'])
})

test('upcomingIds: everything strictly after the playhead', () => {
  const q = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const r = upcomingIds(q, 1)
  assert.ok(r.has('c'))
  assert.ok(!r.has('b'), 'playing item is never upcoming')
  assert.ok(!r.has('a'))
  assert.equal(upcomingIds(q, 2).size, 0, 'last track → nothing upcoming')
})

test('one-track and empty queues are safe', () => {
  assert.deepEqual(ids(moveItem([{ id: 'a' }], 0, 0)), ['a'])
  assert.deepEqual(ids(insertAfter([], 0, { id: 'x' })), ['x'])
  assert.equal(upcomingIds([{ id: 'a' }], 0).size, 0)
})
