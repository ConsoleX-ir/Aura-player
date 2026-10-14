// Phase 10 (Listening History) unit tests — pure filter logic.
// Run with:
//   node --experimental-strip-types scripts/phase10_history.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterHistory, startOfLocalDay } from '../src/lib/historyFilter.ts'
import type { Scrobble } from '../src/lib/scrobbleStore.ts'

const NOW = Date.UTC(2026, 8, 21, 15, 0, 0)
const mk = (over: Partial<Scrobble> = {}): Scrobble => ({
  id: undefined,
  songId: 's1', title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun',
  startedAt: NOW, playedMs: 180000, durationSec: 200, completed: true, skipped: false,
  ...over,
})

test('filterHistory: query matches title, artist, or album (case-insensitive)', () => {
  const rows = [mk(), mk({ songId: 's2', title: 'Other', artist: 'Beta', album: 'Sunset' })]
  assert.equal(filterHistory(rows, { query: 'night', status: 'all', sinceMs: null }).length, 1)
  assert.equal(filterHistory(rows, { query: 'KAVINSKY', status: 'all', sinceMs: null }).length, 1)
  assert.equal(filterHistory(rows, { query: 'sunset', status: 'all', sinceMs: null }).length, 1)
  assert.equal(filterHistory(rows, { query: 'zzz', status: 'all', sinceMs: null }).length, 0)
})

test('filterHistory: status filters completed vs skipped (a row is never both)', () => {
  const rows = [mk(), mk({ completed: false, skipped: true })]
  assert.equal(filterHistory(rows, { query: '', status: 'completed', sinceMs: null }).length, 1)
  assert.equal(filterHistory(rows, { query: '', status: 'skipped', sinceMs: null }).length, 1)
  assert.equal(filterHistory(rows, { query: '', status: 'all', sinceMs: null }).length, 2)
})

test('filterHistory: sinceMs cuts older sessions', () => {
  const rows = [mk({ startedAt: NOW }), mk({ songId: 's2', startedAt: NOW - 40 * 86400000 })]
  assert.equal(filterHistory(rows, { query: '', status: 'all', sinceMs: NOW - 7 * 86400000 }).length, 1)
  assert.equal(filterHistory(rows, { query: '', status: 'all', sinceMs: null }).length, 2)
})

test('filterHistory: composes all three constraints', () => {
  const rows = [
    mk({ songId: 'a', startedAt: NOW - 1000, completed: true, skipped: false, title: 'Hit' }),
    mk({ songId: 'b', startedAt: NOW - 1000, completed: false, skipped: true, title: 'Hit' }),
    mk({ songId: 'c', startedAt: NOW - 90 * 86400000, completed: true, skipped: false, title: 'Hit' }),
    mk({ songId: 'd', startedAt: NOW - 1000, completed: true, skipped: false, title: 'Miss' }),
  ]
  const r = filterHistory(rows, { query: 'hit', status: 'completed', sinceMs: NOW - 7 * 86400000 })
  assert.deepEqual(r.map((x) => x.songId), ['a'])
})

test('startOfLocalDay: lands at midnight local time', () => {
  const sod = startOfLocalDay(new Date(2026, 8, 21, 15, 30, 45).getTime())
  const d = new Date(sod)
  assert.equal(d.getHours(), 0)
  assert.equal(d.getMinutes(), 0)
  assert.equal(d.getSeconds(), 0)
})
