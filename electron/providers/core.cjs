// ── Aura Provider Core (Phase 3 — Online Provider Core) ─────────────────────
// The ONE networking layer every online music provider goes through. Runs in
// the MAIN process only (the renderer has no network access of its own —
// contextIsolation stays intact; the renderer asks by provider id + op name,
// never by URL, so this module is the security boundary for what Aura can
// fetch).
//
// Design rules (locked to the roadmap):
//   • Providers register an ALLOWLIST of ops. The renderer cannot invent new
//     ones and cannot fetch arbitrary URLs.
//   • Every fetch has a timeout, is cancellable, retries transient failures
//     (network / 5xx / 429-with-Retry-After), and validates its response
//     shape through a per-op validate hook. Malformed responses are typed
//     errors, never raw crashes.
//   • JSON responses are cached (small TTL'd in-memory map) so repeated
//     searches / re-opens don't re-hit the network.
//   • No API keys, no telemetry, no code execution from remote data.

'use strict'

// IPv6 black-hole resilience: many real-world networks advertise AAAA routes
// they cannot actually deliver on (ENETUNREACH / silent drops), which stalls
// every fetch that tries the v6 address first. Preferring IPv4 keeps
// dual-stack hosts (Audius, Radio Browser, Deezer, iTunes, MusicBrainz are
// all dual-stack) working everywhere; a host with NO A record still resolves
// via AAAA, so nothing is lost for v6-only endpoints.
const dns = require('node:dns')
try { dns.setDefaultResultOrder('ipv4first') } catch { /* older Node — best effort */ }

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRIES = 2          // after the first attempt → up to 3 tries
const RETRY_BASE_DELAY_MS = 400
const MAX_RETRY_AFTER_MS = 5_000   // never sleep longer than this on 429
const CACHE_MAX_ENTRIES = 200

// ── Typed fetch errors ───────────────────────────────────────────────────────

class ProviderFetchError extends Error {
  /**
   * @param {'timeout'|'network'|'http'|'malformed'|'unavailable'} kind
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [extra]
   */
  constructor(kind, message, extra = {}) {
    super(message)
    this.name = 'ProviderFetchError'
    this.kind = kind
    this.status = extra.status
    this.cause = extra.cause
  }
}

// ── TTL cache (simple FIFO eviction — provider searches are tiny) ───────────

/** @type {Map<string, { at: number, ttl: number, value: any }>} */
const cache = new Map()

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key)
    return undefined
  }
  // LRU-ish: a hit refreshes recency so hot keys survive eviction.
  cache.delete(key)
  cache.set(key, hit)
  return hit.value
}

function cacheSet(key, value, ttlMs) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), ttl: ttlMs, value })
}

/** Test hook: wipe every cached response. */
function clearCache() {
  cache.clear()
}

// ── Cancellation registry (renderer requests can be cancelled) ──────────────

/** @type {Map<string, AbortController>} */
const activeRequests = new Map()

function beginRequest(requestId, externalSignal) {
  const controller = new AbortController()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  activeRequests.set(requestId, controller)
  return controller
}

function cancelRequest(requestId) {
  const controller = activeRequests.get(requestId)
  if (controller) {
    controller.abort()
    activeRequests.delete(requestId)
  }
}

function endRequest(requestId) {
  activeRequests.delete(requestId)
}

// ── providerFetch ────────────────────────────────────────────────────────────

const http = require('node:http')
const https = require('node:https')
const { URL: NodeURL } = require('node:url')

const MAX_REDIRECTS = 5
const MAX_BODY_BYTES = 10 * 1024 * 1024

/**
 * One HTTP(S) request through node:http(s) with MANUAL DNS resolution:
 * the hostname is resolved up-front (family 4 preferred, falling back to
 * any), the request connects to the IP with `servername` set for TLS/SNI,
 * so behavior is identical on IPv6-black-holed networks. Follows up to 5
 * redirects. Never throws ProviderFetchError — the caller maps failures.
 *
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: Buffer, finalUrl: string }>}
 */
function rawRequest(urlStr, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, signal, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const url = new NodeURL(urlStr)
    const isHttps = url.protocol === 'https:'
    const lib = isHttps ? https : http
    const port = url.port ? Number(url.port) : (isHttps ? 443 : 80)

    const req = lib.request({
      host: url.hostname,
      port,
      path: url.pathname + url.search,
      method,
      headers: { 'User-Agent': 'AuraPlayer/2.16.1 (desktop music player)', Accept: 'application/json', ...headers },
      // Manual happy-eyeballs: resolve up-front, v4 first (see file header).
      // NOTE: with autoSelectFamily the caller passes all:true and expects
      // an array of { address, family } — honor opts.all or node throws
      // ERR_INVALID_IP_ADDRESS(undefined).
      lookup: (hostname, opts, cb) => {
        const finish = (err, addr, fam) => {
          if (err) return cb(err)
          if (opts.all) return cb(null, [{ address: addr, family: fam }])
          cb(null, addr, fam)
        }
        dns.lookup(hostname, { family: 4 }, (err, addr, fam) => {
          if (!err) return finish(null, addr, fam)
          // No A record (or v4 lookup broken) — resolve any family.
          dns.lookup(hostname, { family: 0 }, (err2, addr2, fam2) => {
            if (err2) cb(err2)
            else finish(null, addr2, fam2)
          })
        })
      },
    }, (res) => {
      // Redirects (GET/HEAD only — providers never redirect POSTs).
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location &&
          (method === 'GET' || method === 'HEAD')) {
        res.resume() // drain
        const next = new NodeURL(res.headers.location, urlStr).toString()
        if (redirectDepth[urlStr] === undefined) redirectDepth[urlStr] = 0
        if (redirectDepth[urlStr] >= MAX_REDIRECTS) {
          reject(new ProviderFetchError('http', `Too many redirects (> ${MAX_REDIRECTS})`, { status: res.statusCode }))
          return
        }
        redirectDepth[urlStr]++
        rawRequest(next, { headers, timeoutMs, signal, method })
          .then(resolve, reject)
          .finally(() => { delete redirectDepth[urlStr] })
        return
      }

      const chunks = []
      let size = 0
      res.on('data', (c) => {
        size += c.length
        if (size > MAX_BODY_BYTES) {
          res.destroy()
          reject(new ProviderFetchError('malformed', `Response body exceeds ${MAX_BODY_BYTES / 1024 / 1024}MB cap`))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), finalUrl: urlStr })
      })
      res.on('error', (err) => reject(err))
    })

    // Timeout + cancellation, both racing the socket.
    const timer = setTimeout(() => {
      req.destroy(new Error('aura:timeout'))
    }, timeoutMs)
    const onAbort = () => req.destroy(new Error('aura:cancelled'))
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); reject(new ProviderFetchError('network', 'cancelled')); return }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    req.on('error', (err) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const msg = err.message || ''
      if (msg === 'aura:timeout') reject(new ProviderFetchError('timeout', `Timed out after ${timeoutMs}ms`))
      else if (msg === 'aura:cancelled') reject(new ProviderFetchError('network', 'cancelled'))
      else reject(err)
    })
    req.on('close', () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    })
    req.end()
  })
}

// Redirect depth tracking per in-flight chain (keyed by first URL).
const redirectDepth = {}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  if (signal) {
    const onAbort = () => { clearTimeout(t); reject(new ProviderFetchError('network', 'cancelled during backoff')) }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
})

function isTransientStatus(status) {
  return status === 429 || (status >= 500 && status <= 599)
}

/**
 * JSON fetch with timeout / retry / typed errors / response validation.
 *
 * @param {string} url
 * @param {{
 *   timeoutMs?: number,
 *   retries?: number,
 *   headers?: Record<string, string>,
 *   signal?: AbortSignal,
 *   validate?: (json: any) => void,   // throw to reject a shape-mismatched 200
 *   retryOn?: (status: number) => boolean,
 * }} [opts]
 * @returns {Promise<any>} parsed JSON
 */
async function providerFetch(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retries = opts.retries ?? DEFAULT_RETRIES
  const retryOn = opts.retryOn ?? isTransientStatus
  // True while the CURRENT attempt's timeout fired (see catch below).
  let timedOut = false

  let lastError = /** @type {ProviderFetchError|null} */ (null)

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw new ProviderFetchError('network', 'cancelled')
    timedOut = false

    const controller = new AbortController()
    // Plain abort() makes fetch reject with AbortError; a REASON would be
    // rethrown verbatim (and lose the AbortError name), so the timeout is
    // tracked with the per-attempt `timedOut` flag instead of an abort reason.
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const onOuterAbort = () => controller.abort(new Error('cancelled'))
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort(new Error('cancelled'))
      else opts.signal.addEventListener('abort', onOuterAbort, { once: true })
    }

    try {
      const response = await rawRequest(url, {
        signal: controller.signal,
        headers: opts.headers ?? {},
        timeoutMs,
      })

      if (response.status < 200 || response.status >= 300) {
        // 429 honors Retry-After (seconds; capped) with a retry, like the
        // other transient statuses.
        if (response.status === 429 && attempt < retries) {
          const ra = Number(response.headers['retry-after'] ?? '0')
          const delay = Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : RETRY_BASE_DELAY_MS, MAX_RETRY_AFTER_MS)
          await sleep(delay, opts.signal)
          continue
        }
        if (retryOn(response.status) && attempt < retries) {
          await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt), opts.signal)
          continue
        }
        throw new ProviderFetchError('http', `HTTP ${response.status} from ${new NodeURL(url).host}`, {
          status: response.status,
        })
      }

      let json
      try {
        json = JSON.parse(response.body.toString('utf8'))
      } catch (cause) {
        throw new ProviderFetchError('malformed', `Response from ${new NodeURL(url).host} is not valid JSON`, { cause })
      }
      if (opts.validate) {
        try {
          opts.validate(json)
        } catch (cause) {
          throw new ProviderFetchError('malformed', cause instanceof Error ? cause.message : 'Response shape rejected', { cause })
        }
      }
      return json
    } catch (err) {
      // The attempt timeout classifies FIRST: the abort it triggered surfaces
      // as a generic cancellation deeper in the transport, but the caller
      // must see 'timeout' — cancellation only means cancelled when the
      // CALLER's signal asked for it.
      if (timedOut && !opts.signal?.aborted) {
        lastError = new ProviderFetchError('timeout', `Timed out after ${timeoutMs}ms`)
        // transient — fall through to retry
      } else if (err instanceof ProviderFetchError) {
        lastError = err
        if (err.kind === 'http' || err.kind === 'malformed') throw err // not retryable
        if (opts.signal?.aborted) throw err
      } else if (err instanceof Error && err.name === 'AbortError') {
        if (opts.signal?.aborted) throw new ProviderFetchError('network', 'cancelled')
        lastError = new ProviderFetchError('timeout', `Timed out after ${timeoutMs}ms`)
        // timeouts are transient — fall through to retry
      } else {
        // fetch() TypeError etc. — DNS, refused, offline
        lastError = new ProviderFetchError('network', err instanceof Error ? err.message : 'Network error')
      }
    } finally {
      clearTimeout(timeout)
    }

    if (attempt < retries) {
      await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt), opts.signal)
    }
  }

  throw lastError ?? new ProviderFetchError('network', 'Request failed')
}

/**
 * Cached JSON: `cachedJson(key, ttlMs, fetcher)` — fetcher runs only on a
 * miss; rejections are NOT cached (a transient failure shouldn't stick).
 *
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} fetcher
 * @returns {Promise<T>}
 */
async function cachedJson(key, ttlMs, fetcher) {
  const hit = cacheGet(key)
  if (hit !== undefined) return hit
  const value = await fetcher()
  cacheSet(key, value, ttlMs)
  return value
}

// ── Provider registry ────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   id: string,
 *   description?: string,
 *   ops: Record<string, (params: any, ctx: { signal: AbortSignal }) => Promise<any>>,
 * }} ProviderModule
 */

/** @type {Map<string, ProviderModule>} */
const providers = new Map()

function registerProvider(module) {
  if (!module || typeof module.id !== 'string' || !module.id) {
    throw new Error('registerProvider: id required')
  }
  if (!module.ops || typeof module.ops !== 'object') {
    throw new Error(`registerProvider(${module.id}): ops object required`)
  }
  providers.set(module.id, module)
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The single entry point behind the net:providerRequest IPC channel.
 * Everything here is allowlisted: provider id, op name, and param shape
 * (plain object only). Returns the op result or throws a typed error the
 * IPC layer serializes for the renderer.
 *
 * @param {{ requestId: string, providerId: string, op: string, params: any, signal?: AbortSignal }} req
 */
async function callProvider(req) {
  const { requestId, providerId, op, params } = req
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 64) {
    throw new ProviderFetchError('malformed', 'requestId must be a short string')
  }
  const module = providers.get(providerId)
  if (!module) throw new ProviderFetchError('unavailable', `Unknown provider "${providerId}"`)
  const fn = module.ops[op]
  if (typeof fn !== 'function') {
    throw new ProviderFetchError('malformed', `Provider "${providerId}" has no op "${op}"`)
  }
  if (!isPlainObject(params)) {
    throw new ProviderFetchError('malformed', 'params must be an object')
  }

  const controller = beginRequest(requestId, req.signal)
  try {
    return await fn(params, { signal: controller.signal })
  } finally {
    endRequest(requestId)
  }
}

/**
 * Health check for the whole online layer: cheap, always HEADs one host.
 *
 * Returns a DIAGNOSTIC RESULT, not a bare boolean: { ok, kind, detail?,
 * latencyMs }. The historical `catch { return false }` hid WHY the probe
 * failed — DNS vs TLS vs an HTTP status vs timeout — which made every
 * "offline" UI state unexplainable (runtime-verified during the network
 * investigation: the probe reported `true` while sibling requests to the
 * same host were being refused, and reported `false` with no reason at
 * all when blocked). `ok` is still the field the UI needs; callers written
 * for the legacy boolean stay compatible via a typeof check.
 *
 *   ok:true    → kind 'online'                       (HTTP 2xx/3xx)
 *   ok:false   → kind 'http'    detail "HTTP 403 …"  (edge blocks, 4xx/5xx)
 *              → kind 'timeout' detail "Timed out…"  (host unreachable-slow)
 *              → kind 'network' detail (DNS/refused/cancelled)
 */
async function probeOnline(signal) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('timeout')), 4000)
  const onAbort = () => controller.abort(new Error('cancelled'))
  if (signal) {
    if (signal.aborted) return { ok: false, kind: 'network', detail: 'cancelled', latencyMs: 0 }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await rawRequest('https://api.audius.co', { method: 'HEAD', signal: controller.signal, timeoutMs: 3500 })
    const ok = res.status >= 200 && res.status < 400
    return {
      ok,
      kind: ok ? 'online' : 'http',
      ...(ok ? {} : { detail: `api.audius.co answered HTTP ${res.status}` }),
      latencyMs: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      ok: false,
      kind: err instanceof ProviderFetchError ? err.kind : 'network',
      detail: err instanceof Error ? err.message : 'no response',
      latencyMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Binary download through the same deterministic transport — used for
 * artwork caching (bounded size, image bytes, redirects follow).
 * @returns {Promise<Buffer>}
 */
async function downloadBinary(url, opts = {}) {
  const res = await rawRequest(url, { timeoutMs: opts.timeoutMs ?? 20_000, signal: opts.signal, headers: { Accept: 'image/*', ...(opts.headers ?? {}) } })
  if (res.status < 200 || res.status >= 300) {
    throw new ProviderFetchError('http', `HTTP ${res.status}`, { status: res.status })
  }
  return res.body
}

module.exports = {
  ProviderFetchError,
  providerFetch,
  rawRequest,
  downloadBinary,
  cachedJson,
  clearCache,
  registerProvider,
  callProvider,
  cancelRequest,
  probeOnline,
  // exposed for tests
  __cacheSize: () => cache.size,
}
