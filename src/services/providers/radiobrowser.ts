import { providerCall } from './client'
import type { Song } from '@/types'
import type { RadioStation } from '@/store/radioStore'

// ── Radio Browser provider — renderer bindings (Phase 5) ────────────────────
// Thin typed wrappers over providerCall('radiobrowser', …). The main process
// owns the network; this module only normalizes results into the shapes the
// Explore Radio tab and the playback engine consume.

export interface RadioFacet {
  value: string
  label: string
  count: number
}

export function searchStations(params: {
  name?: string
  country?: string
  language?: string
  tag?: string
  limit?: number
  order?: string
}, opts?: { signal?: AbortSignal }): Promise<{ stations: RadioStation[] }> {
  return providerCall('radiobrowser', 'searchStations', params, opts)
}

export function countries(opts?: { signal?: AbortSignal }): Promise<{ facets: RadioFacet[] }> {
  return providerCall('radiobrowser', 'countries', {}, opts)
}

export function languages(opts?: { signal?: AbortSignal }): Promise<{ facets: RadioFacet[] }> {
  return providerCall('radiobrowser', 'languages', {}, opts)
}

export function tags(opts?: { signal?: AbortSignal }): Promise<{ facets: RadioFacet[] }> {
  return providerCall('radiobrowser', 'tags', {}, opts)
}

/** Citizenship ping — fire and forget, never a failure surface. */
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
