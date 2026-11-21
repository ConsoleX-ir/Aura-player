// v2.16.1 — unit tests for the provider result cache (services/providers/cache.ts)
// Semantics under test: TTL hits, in-flight dedupe, abort isolation, failure
// non-caching, eviction, invalidate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cachedProviderCall, peekCache, invalidateProviderCache, providerCacheStats,
} from '../src/services/providers/cache.ts'

const deferred = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('cache: TTL hit avoids a second run', async () => {
  invalidateProviderCache()
  let runs = 0
  const a = cachedProviderCall('p', 'trending', { limit: 24 }, undefined, { ttlMs: 10_000 }, async () => { runs++; return { n: runs } })
  assert.equal(a.fromCache, false)
  // second call arrives BEFORE resolution → shares the in-flight (dedupe)
  const b = cachedProviderCall('p', 'trending', { limit: 24 }, undefined, { ttlMs: 10_000 }, async () => { runs++; return { n: runs } })
  assert.equal(b.fromCache, false)
  assert.equal((await a.promise).n, 1)
  assert.equal((await b.promise).n, 1)
  assert.equal(runs, 1)
  // AFTER resolution the entry is cached — a third call is a synchronous hit
  const c = cachedProviderCall('p', 'trending', { limit: 24 }, undefined, { ttlMs: 10_000 }, async () => { runs++; return { n: runs } })
  assert.equal(c.fromCache, true)
  assert.equal((await c.promise).n, 1)
  assert.equal(runs, 1)
})

test('cache: distinct params do not collide', async () => {
  invalidateProviderCache()
  let runs = 0
  cachedProviderCall('p', 'trending', { limit: 24 }, undefined, { ttlMs: 10_000 }, async () => { runs++; return 1 })
  const b = cachedProviderCall('p', 'trending', { limit: 30 }, undefined, { ttlMs: 10_000 }, async () => { runs++; return 2 })
  assert.equal(await b.promise, 2)
  assert.equal(runs, 2)
})

test('cache: concurrent identical calls share one in-flight (dedupe)', async () => {
  invalidateProviderCache()
  let runs = 0
  const gate = deferred<number>()
  const c1 = cachedProviderCall('p', 'fresh', {}, undefined, undefined, () => { runs++; return gate.promise })
  const c2 = cachedProviderCall('p', 'fresh', {}, undefined, undefined, () => { runs++; return gate.promise })
  gate.resolve(7)
  assert.equal(await c1.promise, 7)
  assert.equal(await c2.promise, 7)
  assert.equal(runs, 1)
  await new Promise((r) => setTimeout(r, 0)) // let the cleanup chain settle
  assert.equal(providerCacheStats().inflight, 0)
})

test('cache: failures are never cached — next call re-runs', async () => {
  invalidateProviderCache()
  let runs = 0
  const first = cachedProviderCall('p', 'underground', {}, undefined, { ttlMs: 10_000 }, async () => { runs++; throw new Error('boom') })
  await assert.rejects(first.promise)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(peekCache('p', 'underground', {}), null) // failure did not stick
  const second = cachedProviderCall('p', 'underground', {}, undefined, { ttlMs: 10_000 }, async () => { runs++; return 'ok' })
  assert.equal(await second.promise, 'ok')
  assert.equal(runs, 2)
})

test('cache: TTL expiry forces a re-run', async () => {
  invalidateProviderCache()
  let runs = 0
  cachedProviderCall('p', 'list', {}, undefined, { ttlMs: 5 }, async () => { runs++; return 'v1' })
  await new Promise((r) => setTimeout(r, 15))
  const again = cachedProviderCall('p', 'list', {}, undefined, { ttlMs: 5 }, async () => { runs++; return 'v2' })
  assert.equal(await again.promise, 'v2')
  assert.equal(runs, 2)
})

test('cache: pre-aborted caller rejects without touching the group', async () => {
  invalidateProviderCache()
  const ac = new AbortController()
  ac.abort()
  let runs = 0
  const rejected = cachedProviderCall('p', 'x', {}, { signal: ac.signal }, { ttlMs: 10_000 }, async () => { runs++; return 1 })
  await assert.rejects(rejected.promise)
  assert.equal(runs, 0)
  // and a healthy caller still runs + caches
  const ok = cachedProviderCall('p', 'x', {}, undefined, { ttlMs: 10_000 }, async () => { runs++; return 2 })
  assert.equal(await ok.promise, 2)
  assert.equal(runs, 1)
})

test('cache: last listener abort cancels the shared run; earlier listener survives', async () => {
  invalidateProviderCache()
  const ac1 = new AbortController()
  const ac2 = new AbortController()
  const gate = deferred<string>()
  let cancelled = false
  const run = (signal: AbortSignal) => {
    signal.addEventListener('abort', () => { cancelled = true })
    return gate.promise
  }
  const c1 = cachedProviderCall('p', 'y', {}, { signal: ac1.signal }, { ttlMs: 10_000 }, run)
  const c2 = cachedProviderCall('p', 'y', {}, { signal: ac2.signal }, { ttlMs: 10_000 }, run)
  // first listener leaves — shared run must stay alive for the second
  ac1.abort()
  assert.equal(cancelled, false)
  gate.resolve('done')
  assert.equal(await c2.promise, 'done')
  // c1 never awaited its own result — it had aborted; the group resolved regardless
  await c1.promise.catch(() => {})
  assert.equal(providerCacheStats().inflight, 0)
  // now the last listener leaves before settlement → cancel fires
  invalidateProviderCache()
  const ac3 = new AbortController()
  const gate2 = deferred<string>()
  let cancelled2 = false
  const run2 = (signal: AbortSignal) => {
    signal.addEventListener('abort', () => { cancelled2 = true })
    return gate2.promise
  }
  const solo = cachedProviderCall('p', 'z', {}, { signal: ac3.signal }, undefined, run2)
  solo.promise.catch(() => {})
  ac3.abort()
  assert.equal(cancelled2, true)
})

test('cache: eviction caps entries (oldest dropped)', async () => {
  invalidateProviderCache()
  for (let i = 0; i < 45; i++) {
    const c = cachedProviderCall('p', 'bulk', { i }, undefined, { ttlMs: 10_000, maxEntries: 10 }, async () => i)
    await c.promise
  }
  const stats = providerCacheStats()
  assert.equal(stats.entries, 10)
  assert.equal(peekCache('p', 'bulk', { i: 0 }), null)       // evicted
  assert.notEqual(peekCache('p', 'bulk', { i: 44 }), null)   // newest survives
})
