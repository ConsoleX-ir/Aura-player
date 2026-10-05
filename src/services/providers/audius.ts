import { providerCall } from './client'
import { cachedProviderCall } from './cache'
import type { ProviderTrack } from './types'
import type { Song } from '@/types'

// ── Audius provider — renderer bindings (Phase 4, v2.16.1 cache layer) ──────
// Thin typed wrappers over providerCall('audius', …) plus the mapping from
// the provider-agnostic track shape to Aura's Song shape so online tracks can
// ride the SAME queue / playback engine / mini player as local files.
//
// The main process owns the network (electron/providers/audius.cjs); this
// module never sees URLs to fetch — only normalized results back.
//
// Caching policy (services/providers/cache.ts): discovery lists and
// drill-downs carry a short TTL so Explore remounts, tab switches, and
// back-navigation render from memory instead of re-tripping the network;
// searches dedupe concurrent identical calls but always re-run when the
// user actually searches again.

export interface AudiusArtist {
  id: string
  providerId: string
  name: string
  handle: string | null
  avatarUrl: string | null
  followers: number
  isVerified: boolean
}

export type OnlineTrack = ProviderTrack & {
  artistHandle: string | null
  artistId: string | null
}

const LIST_TTL = 45_000   // trending / underground / fresh / playlists
const DETAIL_TTL = 30_000 // artist + playlist drill-downs

function call<T>(op: string, params: Record<string, unknown>, opts: { signal?: AbortSignal } | undefined, ttl?: number): Promise<T> {
  return cachedProviderCall<T>(
    'audius', op, params, opts,
    ttl ? { ttlMs: ttl } : undefined,
    (signal) => providerCall<T>('audius', op, params, { signal }),
  ).promise
}

export function searchTracks(query: string, opts?: { signal?: AbortSignal }): Promise<{ tracks: OnlineTrack[] }> {
  return call('searchTracks', { query, limit: 30 }, opts)
}

export function searchArtists(query: string, opts?: { signal?: AbortSignal }): Promise<{ artists: AudiusArtist[] }> {
  return call('searchArtists', { query, limit: 12 }, opts)
}

export function trending(opts?: { signal?: AbortSignal }): Promise<{ tracks: OnlineTrack[] }> {
  return call('trending', { limit: 24 }, opts, LIST_TTL)
}

export function underground(opts?: { signal?: AbortSignal }): Promise<{ tracks: OnlineTrack[] }> {
  return call('underground', { limit: 24 }, opts, LIST_TTL)
}

export function artistTracks(artistId: string, opts?: { signal?: AbortSignal }): Promise<{ artist: AudiusArtist | null; tracks: OnlineTrack[] }> {
  return call('artistTracks', { artistId, limit: 24 }, opts, DETAIL_TTL)
}

export interface AudiusPlaylist {
  id: string
  providerId: string
  name: string
  subtitle: string | null
  permalink: string | null
  popularity: number
  trackCount: number
  artworkUrl: string | null
}

export function fresh(opts?: { signal?: AbortSignal }): Promise<{ tracks: OnlineTrack[] }> {
  return call('fresh', { limit: 24 }, opts, LIST_TTL)
}

export function trendingPlaylists(opts?: { signal?: AbortSignal }): Promise<{ playlists: AudiusPlaylist[] }> {
  return call('trendingPlaylists', { limit: 12 }, opts, LIST_TTL)
}

export function searchPlaylists(query: string, opts?: { signal?: AbortSignal }): Promise<{ playlists: AudiusPlaylist[] }> {
  return call('searchPlaylists', { query, limit: 12 }, opts)
}

export function playlistTracks(playlistId: string, opts?: { signal?: AbortSignal }): Promise<{ tracks: OnlineTrack[] }> {
  return call('playlistTracks', { playlistId, limit: 100 }, opts, DETAIL_TTL)
}

// ── Online track → Song ─────────────────────────────────────────────────────
// Online tracks are NOT library entries: no tombstones, no favorites, no
// playlists. They exist to be queued and played through the same engine.
// `path` carries the stream URL; playbackController passes http(s) URLs
// through untouched (verified: Audius streams CORS `*`, so the Web Audio
// graph keeps receiving samples for the visualizer and Aura Pulse).

export function onlineSongId(track: OnlineTrack): string {
  return `audius.${track.id}`
}

export function toSong(track: OnlineTrack): Song {
  return {
    id: onlineSongId(track),
    path: track.streamUrl ?? '',
    title: track.title,
    artist: track.artist,
    album: track.subtitle || 'Audius',
    duration: track.durationSec ?? 0,
    coverArt: track.artworkUrl,
    source: 'online',
  }
}

export function isOnlineSong(song: Song | null | undefined): boolean {
  return song?.source === 'online' || (!!song && song.id.startsWith('audius.'))
}
