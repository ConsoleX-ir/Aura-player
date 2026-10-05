import { providerCall } from './client'
import { cachedProviderCall } from './cache'
import type { Song } from '@/types'
import type { RadioStation } from '@/store/radioStore'

// ── Radio Browser provider — renderer bindings (Phase 5, v2.16.1 cache) ─────
// Thin typed wrappers over providerCall('radiobrowser', …). The main process
// owns the network; this module only normalizes results into the shapes the
// Explore Radio tab and the playback engine consume.
//
// Caching policy: facet lists barely change — a 10-minute TTL means the tab
// no longer refetches them on every open. Station searches dedupe identical
// concurrent calls but stay uncached: changing a filter should always hit
// the directory again.

export interface RadioFacet {
  value: string
  label: string
  count: number
}

const FACET_TTL = 10 * 60_000

function call<T>(op: string, params: Record<string, unknown>, opts: { signal?: AbortSignal } | undefined, ttl?: number): Promise<T> {
  return cachedProviderCall<T>(
    'radiobrowser', op, params, opts,
    ttl ? { ttlMs: ttl } : undefined,
    (signal) => providerCall<T>('radiobrowser', op, params, { signal }),
  ).promise
}

export function searchStations(params: {
  name?: string
  country?: string
  language?: string
  tag?: string
  limit?: number
  order?: string
}, opts?: { signal?: AbortSignal }): Promise<{ stations: RadioStation[] }> {
  return call('searchStations', params, opts)
}

export function countries(opts?: { signal?: AbortSignal }): Promise<{ facets: RadioFacet[] }> {
  return call('countries', {}, opts, FACET_TTL)
}

export function languages(opts?: { signal?: AbortSignal }): Promise<{ facets: RadioFacet[] }> {
  return call('languages', {}, opts, FACET_TTL)
}

export function tags(opts?: { signal?: AbortSignal }): Promise<{ facets: RadioFacet[] }> {
  return call('tags', {}, opts, FACET_TTL)
}

/** Citizenship ping — fire and forget, never a failure surface, never cached. */
export function clickStation(stationId: string): void {
  providerCall('radiobrowser', 'clickStation', { stationId }, { timeoutMs: 6000 })
    .catch(() => { /* deliberately ignored */ })
}

// ── Station → Song ──────────────────────────────────────────────────────────
// Stations are live: durationSec null → Song.duration 0 (progress bar idles,
// seek is a no-op), queue of one, and `streamCors: false` tells the engine to
// drop the CORS mode — most radio streams don't send ACAO headers, and
// forcing crossOrigin would make them fail to load entirely.

export function toStationSong(station: RadioStation): Song {
  return {
    id: `radio.${station.id}`,
    path: station.streamUrl ?? '',
    title: station.title,
    artist: station.artist || 'Radio',
    album: station.subtitle || 'Live Radio',
    duration: 0,
    coverArt: station.artworkUrl,
    source: 'online',
    streamCors: false,
  }
}
