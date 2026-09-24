// ── Aura × Audius (Phase 4 — Online Provider) ───────────────────────────────
// Audius is a free, decentralized streaming catalog. This module wraps it as
// a provider on top of the Provider Core, exposing ONLY what the live API
// actually offers (every op below was verified against api.audius.co before
// being implemented — see worklog 20-phase3 / 21-phase4):
//
//   GET {host}/v1/tracks/search?query=&app_name=      ✓ (keyless, app_name
//      is the documented attribution param — NOT a token)
//   GET {host}/v1/users/search?query=                 ✓
//   GET {host}/v1/playlists/trending                  ✓ (Phase 6 — verified live)
//   GET {host}/v1/playlists/search?query=             ✓ (Phase 6 — verified live)
//   GET {host}/v1/playlists/{id}/tracks               ✓ (Phase 6 — verified live)
//   GET {host}/v1/tracks/trending                     ✓ (+ /underground, + time=week|month|allTime)
//   GET {host}/v1/tracks/{id}/stream                  ✓ 302 → audio/mpeg,
//      CORS `access-control-allow-origin: *` end-to-end (verified), so the
//      Web Audio analyser chain keeps working for online tracks.
//   GET {host}/v1/users/{id}/tracks                   ✓
//
// All JSON responses are validated (shape) and mapped to the provider-agnostic
// track shape the UI consumes. Non-streamable/deleted tracks are reported
// honestly (isStreamable:false) instead of silently hidden — the UI shows
// them as disabled.

'use strict'

const { providerFetch, cachedJson, ProviderFetchError } = require('./core.cjs')

const APP_NAME = 'AuraPlayer'
const HOST_LIST_TTL = 10 * 60_000
const MAX_HOSTS_TO_TRY = 3
const API_TIMEOUT_MS = 9_000

// ── Host discovery + failover ───────────────────────────────────────────────
// https://api.audius.co returns { data: [host1, host2, ...] } — the discovery
// node list. api.audius.co itself serves the API too, so it leads the list;
// the others are failover. Verified live.

let hostsCache = { at: 0, hosts: null }

async function getHosts(signal) {
  if (hostsCache.hosts && Date.now() - hostsCache.at < HOST_LIST_TTL) return hostsCache.hosts
  let hosts = ['https://api.audius.co']
  try {
    const json = await providerFetch('https://api.audius.co', {
      signal,
      timeoutMs: 5000,
      validate: (j) => {
        if (!j || !Array.isArray(j.data)) throw new Error('audius host list: data[] required')
        if (!j.data.every((h) => typeof h === 'string' && h.startsWith('https://'))) {
          throw new Error('audius host list: invalid hosts')
        }
      },
    })
    const discovered = json.data.filter((h) => /^https:\/\/[a-z0-9.-]+/.test(h))
    if (discovered.length > 0) {
      hosts = Array.from(new Set(['https://api.audius.co', ...discovered])).slice(0, 6)
    }
  } catch (err) {
    // Host list is an optimization — the primary host is a fine constant.
    // Dev diagnostics: a degraded host list shrinks failover to one host,
    // so say WHY instead of failing over silently (network investigation).
    // Cancellations (component unmounts, superseded requests) are normal
    // control flow, not degradation — stay quiet for those.
    const cancelled = err?.message === 'cancelled' || err?.message === 'cancelled during backoff'
    if (process.env.NODE_ENV === 'development' && !cancelled) {
      console.log(`[Provider] audius host-list unavailable (kind=${err?.kind ?? 'network'}: ${err?.message ?? 'no response'}) — failover reduced to the primary host`)
    }
  }
  hostsCache = { at: Date.now(), hosts }
  return hosts
}

function invalidateHosts() {
  hostsCache = { at: 0, hosts: null }
}

/**
 * Runs `fn(host)` against candidate hosts in order until one succeeds.
 * Cancellation propagates immediately; any other failure tries the next
 * host; when EVERY host failed, the LAST typed error is thrown.
 *
 * History (network investigation, pre-2.17): the previous inline loops
 * re-threw only when `host === hosts[MAX_HOSTS_TO_TRY - 1]` — with the live
 * discovery list advertising a single host, that condition could never fire,
 * so a failing request resolved `undefined` (discovery ops) or silently
 * empty (search ops) instead of a typed error. Runtime-proven via IPC:
 * providerRequest('audius','artistTracks',{artistId:<bad>}) → UNDEFINED.
 */
async function withHostFailover(hosts, signal, fn) {
  let lastErr = null
  for (const host of hosts.slice(0, MAX_HOSTS_TO_TRY)) {
    try {
      return await fn(host)
    } catch (err) {
      if (signal?.aborted) throw err
      lastErr = err
    }
  }
  throw lastErr ?? new ProviderFetchError('network', 'All Audius hosts failed')
}

/**
 * Calls the Audius API with host failover. Validation errors (a host talking
 * nonsense) fail over to the next host; real HTTP errors (404s etc.) do too
 * — a specific discovery node may be missing data a sibling has.
 */
async function apiGet(path, params, signal, validate) {
  const hosts = await getHosts(signal)
  const qs = new URLSearchParams({ app_name: APP_NAME, ...(params ?? {}) }).toString()
  return withHostFailover(hosts, signal, (host) =>
    providerFetch(`${host}${path}?${qs}`, {
      signal,
      timeoutMs: API_TIMEOUT_MS,
      validate,
    }))
}

// ── Mapping (pure — unit-tested) ────────────────────────────────────────────

const clampLimit = (v, fallback = 20) => {
  const n = Math.floor(Number(v) || 0)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, 100)
}

function pickArtwork(artwork) {
  if (!artwork || typeof artwork !== 'object') return null
  return artwork['480x480'] || artwork['150x150'] || artwork['1000x1000'] || artwork['640x640'] || null
}

/** Deterministic popularity score used for cross-op ranking parity. */
function trackPopularity(t) {
  return (t.play_count || 0) + (t.favorite_count || 0) * 3 + (t.repost_count || 0) * 5
}

function isTrackStreamable(t) {
  return t.is_streamable !== false && t.is_delete !== true && !t.is_delete && t.duration > 0
}

function streamUrlFor(host, trackId) {
  return `${host}/v1/tracks/${encodeURIComponent(trackId)}/stream?app_name=${APP_NAME}`
}

/**
 * Audius track → provider-agnostic shape. Pure; the shape the renderer's
 * UI and playback engine consume.
 */
function mapTrack(t, host) {
  return {
    id: String(t.id),
    providerId: 'audius',
    title: (t.title || '').trim() || 'Untitled',
    artist: (t.user && (t.user.name || t.user.handle) || '').trim() || 'Unknown Artist',
    artistHandle: t.user?.handle ?? null,
    artistId: t.user?.id ?? null,
    subtitle: t.genre || undefined,
    durationSec: typeof t.duration === 'number' && t.duration > 0 ? t.duration : null,
    artworkUrl: pickArtwork(t.artwork),
    streamUrl: isTrackStreamable(t) ? streamUrlFor(host, t.id) : null,
    permalink: t.permalink ? `https://audius.co${t.permalink}` : null,
    popularity: trackPopularity(t),
    isStreamable: isTrackStreamable(t),
  }
}

/**
 * Phase 6 — "Fresh this week" honesty note: Audius has no release-date sort
 * endpoint. This approximation takes the WEEKLY trending pool and orders it
 * by release date (newest first). Labeled in the UI as fresh+trending —
 * never as a chart the API does not provide.
 */
function sortByReleaseDateDesc(tracks) {
  return [...tracks].sort((a, b) => {
    const ta = Date.parse(a.release_date || '') || 0
    const tb = Date.parse(b.release_date || '') || 0
    return tb - ta
  })
}

function mapPlaylist(p, host) {
  const user = p.user || {}
  const trackCount = Array.isArray(p.playlist_contents)
    ? p.playlist_contents.filter((t) => t && (t.track_id || t.track)).length
    : (p.track_count || 0)
  return {
    id: String(p.id),
    providerId: 'audius',
    name: (p.playlist_name || '').trim() || 'Untitled playlist',
    subtitle: user.name || user.handle || null,
    permalink: p.permalink ? `https://audius.co${p.permalink}` : null,
    popularity: (p.favorite_count || 0) * 3 + (p.repost_count || 0) * 5 + Math.floor((p.total_play_count || 0) / 100),
    trackCount,
    // Live payloads carry the artwork map on `artwork` (same shape as tracks;
    // verified 2026-09 across trending + search). `cover_art_sizes` is a raw
    // content CID, not a URL — never used directly.
    artworkUrl: pickArtwork(p.artwork),
  }
}

function mapUser(u) {
  return {
    id: String(u.id),
    providerId: 'audius',
    name: (u.name || '').trim() || u.handle || 'Unknown Artist',
    handle: u.handle ?? null,
    avatarUrl: pickArtwork(u.profile_picture),
    followers: typeof u.follower_count === 'number' ? u.follower_count : 0,
    isVerified: !!u.is_verified,
  }
}

const TRACKS_SHAPE = (j) => {
  if (!j || !Array.isArray(j.data)) throw new Error('audius: data[] required')
}
const USERS_SHAPE = (j) => {
  if (!j || !Array.isArray(j.data)) throw new Error('audius: data[] required')
}

// ── Ops ─────────────────────────────────────────────────────────────────────

const ops = {
  async searchTracks(params, { signal }) {
    const q = (params.query ?? '').toString().trim()
    if (!q) return { tracks: [] }
    const limit = clampLimit(params.limit, 20)
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      const json = await providerFetch(`${host}/v1/tracks/search?app_name=${APP_NAME}&query=${encodeURIComponent(q)}&limit=${limit}`, {
        signal, timeoutMs: API_TIMEOUT_MS, validate: TRACKS_SHAPE,
      })
      return { tracks: json.data.filter((t) => t && t.id != null).map((t) => mapTrack(t, host)) }
    })
  },

  async searchArtists(params, { signal }) {
    const q = (params.query ?? '').toString().trim()
    if (!q) return { artists: [] }
    const limit = clampLimit(params.limit, 12)
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      const json = await providerFetch(`${host}/v1/users/search?app_name=${APP_NAME}&query=${encodeURIComponent(q)}&limit=${limit}`, {
        signal, timeoutMs: API_TIMEOUT_MS, validate: USERS_SHAPE,
      })
      return { artists: json.data.filter((u) => u && u.id != null).map(mapUser) }
    })
  },

  async trending(params, { signal }) {
    const limit = clampLimit(params.limit, 24)
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      const json = await cachedJson(`audius:trending:${limit}:${host}`, 5 * 60_000, () =>
        providerFetch(`${host}/v1/tracks/trending?app_name=${APP_NAME}&limit=${limit}`, {
          signal, timeoutMs: API_TIMEOUT_MS, validate: TRACKS_SHAPE,
        }))
      return { tracks: json.data.filter((t) => t && t.id != null).map((t) => mapTrack(t, host)) }
    })
  },

  async underground(params, { signal }) {
    const limit = clampLimit(params.limit, 24)
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      const json = await cachedJson(`audius:underground:${limit}:${host}`, 5 * 60_000, () =>
        providerFetch(`${host}/v1/tracks/trending/underground?app_name=${APP_NAME}&limit=${limit}`, {
          signal, timeoutMs: API_TIMEOUT_MS, validate: TRACKS_SHAPE,
        }))
      return { tracks: json.data.filter((t) => t && t.id != null).map((t) => mapTrack(t, host)) }
    })
  },

  async artistTracks(params, { signal }) {
    const id = (params.artistId ?? '').toString().trim()
    if (!id) return { artist: null, tracks: [] }
    const limit = clampLimit(params.limit, 24)
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      const json = await providerFetch(`${host}/v1/users/${encodeURIComponent(id)}/tracks?app_name=${APP_NAME}&limit=${limit}&sort=plays`, {
        signal, timeoutMs: API_TIMEOUT_MS, validate: TRACKS_SHAPE,
      })
      const tracks = json.data.filter((t) => t && t.id != null).map((t) => mapTrack(t, host))
      // The first track's user carries the artist display data.
      const artist = json.data[0]?.user ? mapUser(json.data[0].user) : null
      return { artist, tracks }
    })
  },

  async fresh(params, { signal }) {
    const limit = clampLimit(params.limit, 24)
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      const json = await cachedJson(`audius:fresh:${limit}:${host}`, 5 * 60_000, () =>
        providerFetch(`${host}/v1/tracks/trending?app_name=${APP_NAME}&time=week&limit=100`, {
          signal, timeoutMs: API_TIMEOUT_MS, validate: TRACKS_SHAPE,
        }))
      const fresh = sortByReleaseDateDesc(json.data.filter((t) => t && t.id != null))
        .slice(0, limit)
        .map((t) => mapTrack(t, host))
      return { tracks: fresh }
    })
  },

  async searchPlaylists(params, { signal }) {
    const q = (params.query ?? '').toString().trim()
    if (!q) return { playlists: [] }
    const limit = clampLimit(params.limit, 12)
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      const json = await providerFetch(`${host}/v1/playlists/search?app_name=${APP_NAME}&query=${encodeURIComponent(q)}&limit=${limit}`, {
        signal, timeoutMs: API_TIMEOUT_MS,
        validate: (j) => { if (!j || !Array.isArray(j.data)) throw new Error('audius: data[] required') },
      })
      return { playlists: json.data.filter((p) => p && p.id != null).map((p) => mapPlaylist(p, host)) }
    })
  },

  async trendingPlaylists(params, { signal }) {
    const limit = clampLimit(params.limit, 12)
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      const json = await cachedJson(`audius:playlists:${limit}:${host}`, 10 * 60_000, () =>
        providerFetch(`${host}/v1/playlists/trending?app_name=${APP_NAME}&limit=${limit}`, {
          signal, timeoutMs: API_TIMEOUT_MS,
          validate: (j) => { if (!j || !Array.isArray(j.data)) throw new Error('audius: data[] required') },
        }))
      return { playlists: json.data.filter((p) => p && p.id != null).map((p) => mapPlaylist(p, host)) }
    })
  },

  async playlistTracks(params, { signal }) {
    const id = (params.playlistId ?? '').toString().trim()
    if (!id) return { playlist: null, tracks: [] }
    const hosts = await getHosts(signal)
    return withHostFailover(hosts, signal, async (host) => {
      // The playlist tracks endpoint returns full track objects.
      const json = await providerFetch(`${host}/v1/playlists/${encodeURIComponent(id)}/tracks?app_name=${APP_NAME}`, {
        signal, timeoutMs: API_TIMEOUT_MS, validate: TRACKS_SHAPE,
      })
      return { tracks: json.data.filter((t) => t && t.id != null).map((t) => mapTrack(t, host)) }
    })
  },
}

module.exports = {
  id: 'audius',
  ops,
  // exported for unit tests (pure functions, no network)
  mapTrack,
  mapUser,
  trackPopularity,
  isTrackStreamable,
  streamUrlFor,
  clampLimit,
  pickArtwork,
  invalidateHosts,
  sortByReleaseDateDesc,
  mapPlaylist,
}
