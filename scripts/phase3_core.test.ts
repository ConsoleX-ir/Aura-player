// Phase 3 (Online Provider Core) unit tests — REAL network-layer behavior
// against a local HTTP server: timeout, retry, 429 Retry-After, malformed
// JSON, response validation, cache, registry allowlist, cancellation.
// Run with:
//   node --experimental-strip-types scripts/phase3_core.test.ts
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const require = createRequire(import.meta.url)
const core = require('../electron/providers/core.cjs')
const { providerFetch, cachedJson, clearCache, registerProvider, callProvider, cancelRequest, ProviderFetchError } = core

let server: http.Server
let baseUrl = ''
let hits: Record<string, number> = {}
const ROUTES = new Map<string, (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void>()

before(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/'
    const key = url.split('?')[0]
    const n = (hits[key] = (hits[key] ?? 0) + 1)
    const handler = ROUTES.get(key)
    if (!handler) {
      res.writeHead(404).end('nope')
      return
    }
    handler(req, res, n)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => { server.close() })

function route(path: string, handler: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void) {
  ROUTES.set(path, handler)
}

test('providerFetch: parses JSON and passes through values', async () => {
  route('/ok', (_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"hello":"world"}') })
  const json = await providerFetch(`${baseUrl}/ok`)
  assert.deepEqual(json, { hello: 'world' })
})

test('providerFetch: timeout is typed and bounded', async () => {
  route('/slow', (_q, res) => { setTimeout(() => res.end('{"x":1}'), 3000) })
  const t0 = Date.now()
  await assert.rejects(
    () => providerFetch(`${baseUrl}/slow`, { timeoutMs: 250, retries: 0 }),
    (e: ProviderFetchError) => e.kind === 'timeout',
  )
  assert.ok(Date.now() - t0 < 2000, 'timeout enforced promptly')
})

test('providerFetch: retries a 500 then succeeds', async () => {
  route('/flaky', (_q, res, n) => {
    if (n === 1) { res.writeHead(500).end('boom'); return }
    res.writeHead(200).end('{"attempt":2}')
  })
  const json = await providerFetch(`${baseUrl}/flaky`, { retries: 2 })
  assert.deepEqual(json, { attempt: 2 })
  assert.equal(hits['/flaky'], 2)
})

test('providerFetch: 429 honors Retry-After then succeeds', async () => {
  route('/limited', (_q, res, n) => {
    if (n === 1) { res.writeHead(429, { 'retry-after': '1' }).end(); return }
    res.writeHead(200).end('{"ok":true}')
  })
  const t0 = Date.now()
  const json = await providerFetch(`${baseUrl}/limited`, { retries: 2 })
  assert.deepEqual(json, { ok: true })
  assert.ok(Date.now() - t0 >= 900, 'waited ~1s per Retry-After')
})

test('providerFetch: non-transient 404 is typed http, no retry', async () => {
  route('/gone', (_q, res) => res.writeHead(404).end('{}'))
  await assert.rejects(
    () => providerFetch(`${baseUrl}/gone`, { retries: 3 }),
    (e: ProviderFetchError) => e.kind === 'http' && e.status === 404,
  )
  assert.equal(hits['/gone'], 1, 'no retry on 404')
})

test('providerFetch: invalid JSON is malformed', async () => {
  route('/garbage', (_q, res) => { res.writeHead(200); res.end('<html>not json</html>') })
  await assert.rejects(
    () => providerFetch(`${baseUrl}/garbage`),
    (e: ProviderFetchError) => e.kind === 'malformed',
  )
})

test('providerFetch: validate() rejects shape-mismatched 200s as malformed', async () => {
  route('/wrongshape', (_q, res) => { res.writeHead(200); res.end('{"unexpected":true}') })
  await assert.rejects(
    () => providerFetch(`${baseUrl}/wrongshape`, {
      validate: (json: any) => { if (!Array.isArray(json.data)) throw new Error('data[] required') },
    }),
    (e: ProviderFetchError) => e.kind === 'malformed' && /data\[\] required/.test(e.message),
  )
})

test('providerFetch: connection refused is typed network', async () => {
  // Port 1 on 127.0.0.1 refuses connections essentially always
  await assert.rejects(
    () => providerFetch('http://127.0.0.1:1/nope', { retries: 0, timeoutMs: 1500 }),
    (e: ProviderFetchError) => e.kind === 'network',
  )
})

test('cachedJson: fetcher runs once per key within TTL', async () => {
  route('/cache', (_q, res) => { res.writeHead(200); res.end(JSON.stringify({ n: hits['/cache'] })) })
  clearCache()
  const a = await cachedJson('test-cache-key', 60_000, () => providerFetch(`${baseUrl}/cache`))
  const b = await cachedJson('test-cache-key', 60_000, () => providerFetch(`${baseUrl}/cache`))
  assert.deepEqual(a, b)
  assert.equal(hits['/cache'], 1)
  clearCache()
})

test('registry: unknown provider / op / bad params are typed rejections', async () => {
  registerProvider({ id: 'mockprov', ops: { ping: async () => 'pong' } })
  await assert.rejects(
    () => callProvider({ requestId: 'r1', providerId: 'nope', op: 'ping', params: {} }),
    (e: ProviderFetchError) => e.kind === 'unavailable',
  )
  await assert.rejects(
    () => callProvider({ requestId: 'r2', providerId: 'mockprov', op: 'nope', params: {} }),
    (e: ProviderFetchError) => e.kind === 'malformed',
  )
  await assert.rejects(
    () => callProvider({ requestId: 'r3', providerId: 'mockprov', op: 'ping', params: 'not-an-object' }),
    (e: ProviderFetchError) => e.kind === 'malformed',
  )
  assert.equal(await callProvider({ requestId: 'r4', providerId: 'mockprov', op: 'ping', params: {} }), 'pong')
})

test('registry: op receives params and runs against real fetch', async () => {
  route('/api', (_q, res) => { res.writeHead(200); res.end('{"data":[1,2,3]}') })
  registerProvider({
    id: 'fetchprov',
    ops: {
      load: async (params, ctx) => {
        const json = await providerFetch(`${baseUrl}/api?x=${params.x}`, { validate: (j: any) => { if (!Array.isArray(j.data)) throw new Error('bad') }, signal: ctx.signal })
        return json.data
      },
    },
  })
  const out = await callProvider({ requestId: 'r5', providerId: 'fetchprov', op: 'load', params: { x: 7 } })
  assert.deepEqual(out, [1, 2, 3])
})

test('cancellation: aborting the requestId rejects the in-flight op', async () => {
  route('/hang', (_q, res) => { setTimeout(() => res.end('{}'), 5000) })
  // Register BEFORE calling — the registry check is synchronous.
  registerProvider({
    id: 'fetchprov2',
    ops: {
      hang: async (_params, ctx) => providerFetch(`${baseUrl}/hang`, { signal: ctx.signal, timeoutMs: 4500 }),
    },
  })
  const p = callProvider({
    requestId: 'cancel-me',
    providerId: 'fetchprov2',
    op: 'hang',
    params: {},
  })
  const assertion = assert.rejects(
    () => p,
    (e: ProviderFetchError) => e.kind === 'network' && /cancel/i.test(e.message),
  )
  setTimeout(() => cancelRequest('cancel-me'), 100)
  await assertion
})

test('cancellation: providerCall-level abort propagates (no dangling hangs)', async () => {
  route('/hang2', (_q, res) => { setTimeout(() => res.end('{}'), 5000) })
  registerProvider({
    id: 'fetchprov3',
    ops: { hang: async (_p, ctx) => providerFetch(`${baseUrl}/hang2`, { signal: ctx.signal, timeoutMs: 4500 }) },
  })
  const ac = new AbortController()
  const p = callProvider({ requestId: 'cancel-me-2', providerId: 'fetchprov3', op: 'hang', params: {}, signal: ac.signal })
  const assertion = assert.rejects(() => p, () => true)
  setTimeout(() => ac.abort(), 100)
  await assertion
})
