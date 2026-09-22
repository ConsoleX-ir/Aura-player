// ── Aura × Radio Browser (Phase 5 — Online Provider) ────────────────────────
// Radio Browser is a free, community-driven radio station directory. This
// module wraps it as a provider on the Provider Core, exposing ONLY verified
// endpoints (checked live against all.api.radio-browser.info — see worklog):
//
//   GET /json/stations/search?name=&country=&language=&tag=&limit=&hidebroken=true&order=votes
//   GET /json/countries · /json/languages · /json/tags        (facet lists)
//   GET /json/url/{uuid}                                      (play count ping)
//
// The service asks for a meaningful User-Agent (the core sends one) and
// politely requests no more than ~25 requests/minute — one search per user
// action fits comfortably.
//
// Station reality (verified): names may contain tab/control chars, language
// can be empty, url_resolved may be http (Aura plays it — the engine drops
// the CORS mode for radio streams, see playbackController), lastcheckok=1
// means the service's own checker heard it recently, votes/clickcount are
// the popularity signals.

'use strict'

const { providerFetch, cachedJson } = require('./core.cjs')

const BASE = 'https://all.api.radio-browser.info'
const FACET_TTL = 24 * 60 * 60_000
const SEARCH_TTL = 5 * 60_000
const API_TIMEOUT_MS = 9_000

const clampLimit = (v, fallback = 40) => {
  const n = Math.floor(Number(v) || 0)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, 200)
}

/** Station names arrive with tabs/control chars — normalize for display. */
function cleanStationName(name) {
  return (name || '').replace(/[\t\n\r]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isStationPlayable(s) {
  return (
    typeof s.url_resolved === 'string' && s.url_resolved.startsWith('http') &&
    s.lastcheckok !== 0 && s.lastcheckok !== false
  )
}

function stationPopularity(s) {
  return (s.votes || 0) * 2 + (s.clickcount || 0) + (s.clicktrend || 0) * 3
}

/**
 * Station → provider-agnostic shape. Radio stations are LIVE: durationSec
 * null, no seek, no queue browsing. corsOk:false — most radio streams don't
 * send CORS headers, so the engine plays them WITHOUT crossOrigin (playback
 * fine; the analyser may read silence — an honest, invisible limitation).
 */
function mapStation(s) {
  const tags = (s.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3)
  return {
    id: String(s.stationuuid),
    providerId: 'radiobrowser',
    title: cleanStationName(s.name) || 'Unnamed station',
    artist: s.country || '',
    subtitle: [
      s.codec ? String(s.codec).toUpperCase() : null,
      s.bitrate ? `${s.bitrate} kbps` : null,
      tags.length ? tags.join(', ') : null,
    ].filter(Boolean).join(' · ') || undefined,
    durationSec: null,
    artworkUrl: (typeof s.favicon === 'string' && s.favicon.startsWith('http')) ? s.favicon : null,
    streamUrl: isStationPlayable(s) ? s.url_resolved : null,
    permalink: (typeof s.homepage === 'string' && s.homepage.startsWith('http')) ? s.homepage : null,
    popularity: stationPopularity(s),
    isStreamable: isStationPlayable(s),
    // extra radio-only display data
    countrycode: s.countrycode || null,
    tags,
    votes: s.votes || 0,
    language: (s.language || '').split(',')[0].trim() || null,
  }
}

const STATIONS_SHAPE = (j) => {
  if (!Array.isArray(j)) throw new Error('radiobrowser: station array required')
}

const ops = {
  async searchStations(params, { signal }) {
    const limit = clampLimit(params.limit, 40)
    const query = {
      limit: String(limit),
      hidebroken: 'true',          // dead stations never enter results
      order: (params.order || 'votes').toString(),
      reverse: 'true',
    }
    const name = (params.name ?? '').toString().trim()
    if (name) query.name = name
    for (const key of ['country', 'language', 'tag']) {
      const v = (params[key] ?? '').toString().trim()
      if (v) query[key] = v
    }
    const qs = new URLSearchParams(query).toString()
    const json = await cachedJson(
      `rb:search:${qs}`,
      params.name ? 0 : SEARCH_TTL,   // typed searches stay fresh; facet browses cache
      () => providerFetch(`${BASE}/json/stations/search?${qs}`, {
        signal, timeoutMs: API_TIMEOUT_MS, validate: STATIONS_SHAPE,
      }),
    )
    return { stations: json.filter((s) => s && s.stationuuid).map(mapStation) }
  },

  async countries({ signal }) {
    const json = await cachedJson('rb:countries', FACET_TTL, () =>
      providerFetch(`${BASE}/json/countries?order=stationcount&reverse=true`, {
        signal, timeoutMs: API_TIMEOUT_MS, validate: STATIONS_SHAPE,
      }))
    return { facets: json.filter((c) => c.name && c.stationcount > 0).map((c) => ({ value: c.name, label: c.name, count: c.stationcount })) }
  },

  async languages({ signal }) {
    const json = await cachedJson('rb:languages', FACET_TTL, () =>
      providerFetch(`${BASE}/json/languages?order=stationcount&reverse=true&limit=100`, {
        signal, timeoutMs: API_TIMEOUT_MS, validate: STATIONS_SHAPE,
      }))
    return { facets: json.filter((l) => l.name && l.stationcount > 0).map((l) => ({ value: l.name, label: l.name, count: l.stationcount })) }
  },

  async tags({ signal }) {
    const json = await cachedJson('rb:tags', FACET_TTL, () =>
      providerFetch(`${BASE}/json/tags?order=stationcount&reverse=true&limit=60`, {
        signal, timeoutMs: API_TIMEOUT_MS, validate: STATIONS_SHAPE,
      }))
    return { facets: json.filter((t) => t.name && t.stationcount > 0).map((t) => ({ value: t.name, label: t.name, count: t.stationcount })) }
  },

  /** Citizenship ping: tells Radio Browser the station was played. Fire-and-forget. */
  async clickStation(params) {
    const id = (params.stationId ?? '').toString().trim()
    if (!id) return { ok: false }
    try {
      await providerFetch(`${BASE}/json/url/${encodeURIComponent(id)}`, { timeoutMs: 4000, retries: 0 })
      return { ok: true }
    } catch {
      return { ok: false } // never a failure surface
    }
  },
}

module.exports = {
  id: 'radiobrowser',
  ops,
  // pure functions for unit tests
  mapStation,
  cleanStationName,
  isStationPlayable,
  stationPopularity,
  clampLimit,
}
