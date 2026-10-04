// ── Aura listening history (scrobbles) ──────────────────────────────────────
// 100% local listening statistics, now stored in the SQLite listen_sessions
// table through the desktop boundary (Aura 4 §5). Nothing here ever touches
// the network — this data exists solely so the app can answer "what did I
// listen to?" (Aura Rewind, Listening History, the smart engine).
//
// The write path stays fire-and-forget from the playback engine's point of
// view: a scrobble can never break, delay, or desync playback. Rows are
// append-only; title/artist/album are snapshotted so history stays
// meaningful even after the track leaves the library.
//
// One scrobble = one listening session of one song, from the moment it
// started until it was replaced, ended, or the app stopped playing it.
// `playedMs` counts only audible time (pauses don't accumulate).

import { desktop } from '@/services/desktop'
import type { SongListenStats } from '@/types'

// Event dispatched on window whenever a scrobble lands, so reactive surfaces
// (useListenAggregates → Library sort) can refresh without the engine
// knowing about them. Debounced by consumers.
export const SCROBBLE_APPENDED_EVENT = 'aura:scrobble-appended'

export interface Scrobble {
  // Assigned by the database.
  id?: number
  // Stable track id — join key back to the catalog at stats time.
  songId: string
  title: string
  artist: string
  album: string
  // ms epoch — when this listening session started.
  startedAt: number
  // Accumulated audible listen time in ms.
  playedMs: number
  // Track duration in seconds as known at play time (0 if unknown).
  durationSec: number
  // Listened to (at least) 90% of the track.
  completed: boolean
  // Changed away before the halfway point — "this was skipped".
  skipped: boolean
}

// Cap for full-history reads: one user's listening history at session
// granularity stays far below this in practice; the aggregate surfaces are
// honest about "history is effectively unbounded" only past it.
const HISTORY_READ_LIMIT = 50_000

function rowToScrobble(row: import('@/services/desktop').HistoryRow): Scrobble {
  return {
    id: row.id,
    songId: row.trackId ?? '',
    title: row.title,
    artist: row.artist,
    album: row.album,
    startedAt: row.startedAt,
    playedMs: row.playedMs,
    durationSec: row.durationSecs,
    completed: row.completed,
    skipped: row.skipped,
  }
}

/** Appends one listening session. Resolves with its assigned id. */
export async function appendScrobble(entry: Omit<Scrobble, 'id'>): Promise<number> {
  return desktop.library.history.append({
    trackId: entry.songId || null,
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    startedAt: entry.startedAt,
    playedMs: entry.playedMs,
    durationSecs: entry.durationSec,
    completed: entry.completed,
    skipped: entry.skipped,
  })
}

/**
 * Fire-and-forget append for the playback engine — never throws, never
 * blocks playback. Failures are logged and otherwise ignored.
 */
export function safeAppendScrobble(entry: Omit<Scrobble, 'id'>): void {
  appendScrobble(entry)
    .then(() => {
      writeSeq++
      try { window.dispatchEvent(new CustomEvent(SCROBBLE_APPENDED_EVENT)) } catch { /* non-window */ }
    })
    .catch((e) => console.warn('Scrobble append failed (ignored):', e))
}

// Aggregate listening stats for one song — computed over the song's session
// rows. Local scale (one user's history) makes a full pull per Properties-
// page open perfectly fine.
export async function getSongStats(songId: string): Promise<SongListenStats> {
  try {
    const rows = (await desktop.library.history.list(HISTORY_READ_LIMIT))
      .filter((r) => r.trackId === songId)
      .map(rowToScrobble)
    return {
      plays: rows.length,
      completed: rows.filter((r) => r.completed).length,
      skipped: rows.filter((r) => r.skipped).length,
      totalPlayedMs: rows.reduce((acc, r) => acc + (r.playedMs || 0), 0),
      lastPlayedAt: rows.length ? Math.max(...rows.map((r) => r.startedAt || 0)) : null,
    }
  } catch {
    // Stats are decorative context, never a failure surface.
    return { plays: 0, completed: 0, skipped: 0, totalPlayedMs: 0, lastPlayedAt: null }
  }
}

/**
 * Raw scrobble rows inside [startMs, endMs) — the feed for Aura Rewind's
 * monthly aggregation (lib/rewind.ts). Empty array on any failure — Rewind
 * is a celebration, never an error surface.
 */
export async function getScrobblesInRange(startMs: number, endMs: number): Promise<Scrobble[]> {
  try {
    const rows = await desktop.library.history.list(HISTORY_READ_LIMIT)
    return rows
      .map(rowToScrobble)
      .filter((r) => r.startedAt >= startMs && r.startedAt < endMs)
  } catch {
    return []
  }
}

/** Schema bookkeeping from the IndexedDB era — SQLite migrations own this now. */
export async function ensureStatsSchemaMeta(): Promise<void> {
  // The listen_sessions table is created by the Rust-side migrations;
  // nothing for the renderer to manage here anymore.
}

// ── Whole-history aggregates ────────────────────────────────────────────────
// Folded per-song totals over the full history. This is what powers the
// Library's Recently Played / Most Played / Most Skipped sorts and the
// Smart Music Engine's familiarity signals.

export interface ListenAggregate {
  plays: number
  completed: number
  skipped: number
  totalPlayedMs: number
  lastPlayedAt: number | null
}

export type ListenAggregates = Map<string, ListenAggregate>

// Cache: a full history pull costs a few ms over SQLite — fine on mount,
// wasteful on every sort click. The cache busts whenever the write sequence
// advances, so fresh scrobbles are always reflected.
let aggregateCache: { seq: number; map: ListenAggregates } | null = null
let writeSeq = 0

function emptyAggregate(): ListenAggregate {
  return { plays: 0, completed: 0, skipped: 0, totalPlayedMs: 0, lastPlayedAt: null }
}

export async function getListenAggregates(): Promise<ListenAggregates> {
  if (aggregateCache && aggregateCache.seq === writeSeq) return aggregateCache.map
  const map: ListenAggregates = new Map()
  try {
    const rows = await desktop.library.history.list(HISTORY_READ_LIMIT)
    for (const raw of rows) {
      const row = rowToScrobble(raw)
      const agg = map.get(row.songId) ?? emptyAggregate()
      agg.plays++
      if (row.completed) agg.completed++
      if (row.skipped) agg.skipped++
      agg.totalPlayedMs += row.playedMs || 0
      if (row.startedAt && (agg.lastPlayedAt === null || row.startedAt > agg.lastPlayedAt)) {
        agg.lastPlayedAt = row.startedAt
      }
      map.set(row.songId, agg)
    }
  } catch {
    // A stats read failure just means "no listening data" — the empty map
    // degrades every stats-backed feature to a stable tie, by design.
    return map
  }
  aggregateCache = { seq: writeSeq, map }
  return map
}

/** Forces the next getListenAggregates() call to re-walk the history. */
export function invalidateListenAggregates(): void {
  writeSeq++
}

/**
 * Distinct artists/albums/tracks listened to inside [startMs, endMs).
 */
export async function getHistorySummary(startMs: number, endMs: number): Promise<{
  sessions: number
  uniqueSongs: number
  uniqueArtists: number
  uniqueAlbums: number
  totalPlayedMs: number
  completed: number
  skipped: number
}> {
  const rows = await getScrobblesInRange(startMs, endMs)
  const songs = new Set<string>()
  const artists = new Set<string>()
  const albums = new Set<string>()
  let totalPlayedMs = 0
  let completed = 0
  let skipped = 0
  for (const r of rows) {
    if (r.songId) songs.add(r.songId)
    if (r.artist) artists.add(r.artist)
    if (r.album) albums.add(r.album)
    totalPlayedMs += r.playedMs || 0
    if (r.completed) completed++
    if (r.skipped) skipped++
  }
  return {
    sessions: rows.length,
    uniqueSongs: songs.size,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    totalPlayedMs,
    completed,
    skipped,
  }
}
