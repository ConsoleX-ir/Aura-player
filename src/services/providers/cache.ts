// ── providerResultCache — shared TTL cache + in-flight dedupe (v2.16.1) ─────
// Explore used to refetch everything on every mount: 4 discovery lists per
// visit, stations + 3 facet lists per Radio tab open, and every repeated
// identical search. This layer sits BETWEEN the UI's provider bindings and
// providerCall and gives them two things:
//
//   1. DEDUPE — identical concurrent calls (same provider/op/params) share
//      one in-flight request. Two components asking for trending at the same
//      moment cost ONE network round-trip.
//   2. TTL CACHE — successful results are reused for a short window so
//      remounts and tab switches render instantly from memory instead of
//      re-tripping the network. Cached data also powers: offline rendering
//      (stale-while-offline) and instant paint on recovery (revalidated in
//      the background by the caller).
//
// Rules the rest of the code can rely on:
//   • FAILURES ARE NEVER CACHED — a timeout/rate-limit/http error is not
//     sticky; the next call tries the network again.
//   • ABORT-SAFE — the shared request owns an INTERNAL AbortController.
//     Each caller registers its own signal as a listener; a caller aborting
//     simply stops listening, and the shared request is cancelled only when
//     the LAST listener leaves (nobody wants it anymore). A late result for
//     a request whose caller left still lands in the cache — legitimate:
//     the next mount serves it instantly.
//   • NOT persisted — memory only, dies with the renderer session. Nothing
//     stale survives a restart, and "cached" always means this-session.
//   • Cache is BYPASSED for ops without a policy (search: dedupe only — a
//     re-run of the same search SHOULD hit the network again; the UI
//     debounce already collapses rapid keystrokes).
//
// Budget: entries are small (a few KB of normalized JSON); the caps below
// bound the worst case well under a megabyte.

export interface CacheOptions {
  /** How long a successful result may be reused. Caching is off without it. */
  ttlMs?: number
  /** Cap: drop the OLDEST entries beyond this count (default 40). */
  maxEntries?: number
}

export interface CachedCallOptions {
  signal?: AbortSignal
}

interface CacheEntry {
  value: unknown
  expiresAt: number
}

interface InflightEntry {
  promise: Promise<unknown>
  controller: AbortController
  /** Signals of callers still interested in the result. */
  listeners: Set<AbortSignal>
  /** Map from listener signal → its cleanup. */
  cleanups: Map<AbortSignal, () => void>
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, InflightEntry>()

function key(providerId: string, op: string, params: Record<string, unknown>): string {
  // Params are flat primitives in every binding (query, ids, limits) — a
  // stable stringify is enough. Sorted so key order never splits the cache.
  const parts = Object.keys(params).sort().map((k) => `${k}=${String(params[k])}`)
  return `${providerId}::${op}::${parts.join('&')}`
}

function evictIfNeeded(maxEntries: number): void {
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export interface CachedCallResult<T> {
  /** The (possibly cached) result. */
  promise: Promise<T>
  /** True when served synchronously from the TTL cache. */
  fromCache: boolean
}

/** Read the cache without going through dedupe — used for instant offline paint. */
export function peekCache<T>(providerId: string, op: string, params: Record<string, unknown>): T | null {
  const hit = cache.get(key(providerId, op, params))
  return hit ? (hit.value as T) : null
}

/**
 * Run a provider call through dedupe + (optionally) TTL cache.
 * `run(signal)` is the actual network call factory — invoked at most once
 * per identical concurrent group, never for a fresh cache hit. It receives
 * the SHARED internal signal (not any individual caller's).
 */
export function cachedProviderCall<T>(
  providerId: string,
  op: string,
  params: Record<string, unknown>,
  opts: CachedCallOptions | undefined,
  cacheOpts: CacheOptions | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): CachedCallResult<T> {
  const k = key(providerId, op, params)
  const maxEntries = cacheOpts?.maxEntries ?? 40

  // 1 — fresh TTL hit: resolve immediately, no network, no inflight churn.
  const hit = cache.get(k)
  if (hit && Date.now() <= hit.expiresAt) {
    return { promise: Promise.resolve(hit.value as T), fromCache: true }
  }

  // 2 — caller already cancelled before we started: reject without touching
  // the shared group (its result may still be wanted by others).
  if (opts?.signal?.aborted) {
    const err = new Error('cancelled')
    return { promise: Promise.reject(err), fromCache: false }
  }

  // 3 — join or start the shared in-flight.
  let entry = inflight.get(k)
  if (!entry) {
    const controller = new AbortController()
    entry = {
      promise: run(controller.signal),
      controller,
      listeners: new Set(),
      cleanups: new Map(),
    }
    inflight.set(k, entry)
    entry.promise
      .then((value) => {
        if (cacheOpts?.ttlMs) {
          cache.set(k, { value, expiresAt: Date.now() + cacheOpts.ttlMs })
          evictIfNeeded(maxEntries)
        }
      })
      .catch(() => { /* failures are never cached */ })
      .finally(() => {
        // All cleanups are idempotent; drop the group either way.
        entry?.cleanups.forEach((fn) => fn())
        entry?.cleanups.clear()
        if (inflight.get(k) === entry) inflight.delete(k)
      })
  }

  const signal = opts?.signal
  if (signal && entry) {
    const e = entry
    e.listeners.add(signal)
    const onAbort = () => {
      e.listeners.delete(signal)
      e.cleanups.get(signal)?.()
      e.cleanups.delete(signal)
      // Last interested party gone → cancel the underlying work. Results
      // that somehow still arrive are simply not cached as failures.
      if (e.listeners.size === 0 && inflight.get(k) === e) {
        inflight.delete(k)
        e.controller.abort()
      }
    }
    signal.addEventListener('abort', onAbort, { once: true })
    e.cleanups.set(signal, () => signal.removeEventListener('abort', onAbort))
  }

  return { promise: entry.promise as Promise<T>, fromCache: false }
}

/** Test/debug hook: drop every cached entry and cancel pending groups. */
export function invalidateProviderCache(): void {
  cache.clear()
  const groups = [...inflight.values()]
  inflight.clear()
  groups.forEach((g) => {
    g.cleanups.forEach((fn) => fn())
    g.controller.abort()
  })
}

/** Test/debug introspection. */
export function providerCacheStats(): { entries: number; inflight: number } {
  return { entries: cache.size, inflight: inflight.size }
}
