// ── Aura listening history (scrobbles) ──────────────────────────────────────
// 100% local listening statistics, recorded in IndexedDB. Nothing here ever
// touches the network — this data exists solely so the app can answer
// "what did I listen to?" (Wave 4's Aura Rewind monthly experience).
//
// Design constraints (locked in AURA_V2_ROADMAP.md):
//   • Append-only: entries are never updated or deleted by the app, so the
//     data layer stays trivially safe and future stats queries can trust it.
//   • The write path is fire-and-forget from the playback engine's point of
//     view: a scrobble can never break, delay, or desync playback.
//   • Schema versioned from day one (meta store) so future upgrades can
//     migrate in place without rewriting the whole system.
//
// One scrobble = one listening session of one song, from the moment it
// started until it was replaced, ended, or the app stopped playing it.
// `playedMs` counts only audible time (pauses don't accumulate).

import type { SongListenStats } from '@/types'

// Event dispatched on window whenever a scrobble lands, so reactive surfaces
// (useListenAggregates → Library sort, future history views) can refresh
// without the engine knowing about them. Debounced by consumers.
export const SCROBBLE_APPENDED_EVENT = 'aura:scrobble-appended'

export interface Scrobble {
  // Auto-incremented by IndexedDB — undefined on the draft we append.
  id?: number
  // Stable song id (hash of file path) — join key back to the library for
  // genre/album lookups at stats time. The denormalized title/artist/album
  // below keep history meaningful even if the song is later removed from
  // the library or the files move.
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

const DB_NAME = 'aura-stats'
const DB_VERSION = 1
const SCROBBLES = 'scrobbles'
const META = 'meta'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(SCROBBLES)) {
          const store = db.createObjectStore(SCROBBLES, { keyPath: 'id', autoIncrement: true })
          store.createIndex('byStartedAt', 'startedAt')
          store.createIndex('bySongId', 'songId')
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

/** Appends one listening session. Resolves with its assigned id. */
export async function appendScrobble(entry: Omit<Scrobble, 'id'>): Promise<number> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCROBBLES, 'readwrite')
    const req = tx.objectStore(SCROBBLES).add(entry)
    req.onsuccess = () => {
      writeSeq++
      resolve(req.result as number)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Fire-and-forget append for the playback engine — never throws, never
 * blocks playback. Failures are logged and otherwise ignored: losing one
 * local stats row is infinitely preferable to glitching audio over it.
 */
export function safeAppendScrobble(entry: Omit<Scrobble, 'id'>): void {
  appendScrobble(entry)
    .then(() => {
      try { window.dispatchEvent(new CustomEvent(SCROBBLE_APPENDED_EVENT)) } catch { /* non-window */ }
    })
    .catch((e) => console.warn('Scrobble append failed (ignored):', e))
}

// Aggregate listening stats for one song — computed by walking the song's
// scrobble rows via the bySongId index. Local scale (one user's history)
// makes a full scan per Properties-page open perfectly fine; Aura Rewind
// (Wave 4) will reuse this pattern over date ranges instead.
export async function getSongStats(songId: string): Promise<SongListenStats> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SCROBBLES, 'readonly')
      const req = tx.objectStore(SCROBBLES).index('bySongId').getAll(songId)
      req.onsuccess = () => {
        const rows: Scrobble[] = req.result ?? []
        resolve({
          plays: rows.length,
          completed: rows.filter((r) => r.completed).length,
          skipped: rows.filter((r) => r.skipped).length,
          totalPlayedMs: rows.reduce((acc, r) => acc + (r.playedMs || 0), 0),
          lastPlayedAt: rows.length ? Math.max(...rows.map((r) => r.startedAt || 0)) : null,
        })
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Stats are decorative context, never a failure surface — a broken or
    // blocked IndexedDB just renders the "no listening history yet" state.
    return { plays: 0, completed: 0, skipped: 0, totalPlayedMs: 0, lastPlayedAt: null }
  }
}

/**
 * Raw scrobble rows inside [startMs, endMs) — the feed for Aura Rewind's
 * monthly aggregation (lib/rewind.ts). Indexed on startedAt, so the range
 * walk stays cheap even with years of history. Empty array on any failure —
 * Rewind is a celebration, never an error surface.
 */
export async function getScrobblesInRange(startMs: number, endMs: number): Promise<Scrobble[]> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SCROBBLES, 'readonly')
      const index = tx.objectStore(SCROBBLES).index('byStartedAt')
      const range = IDBKeyRange.bound(startMs, endMs, false, true) // [start, end)
      const req = index.getAll(range)
      req.onsuccess = () => resolve((req.result as Scrobble[]) ?? [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

/**
 * Current schema version, written once on first open so future migrations
 * can detect what a user's history was recorded with.
 */
export async function ensureStatsSchemaMeta(): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(META, 'readwrite')
    const store = tx.objectStore(META)
    const existing = await new Promise<any>((resolve) => {
      const req = store.get('schemaVersion')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(undefined)
    })
    if (!existing) store.put({ key: 'schemaVersion', version: DB_VERSION })
  } catch {
    // Stats are a nice-to-have at runtime; a meta write failure is harmless.
  }
}

// ── Whole-history aggregates (Phase 1 — Library 2.0) ──────────────────────
// One cursor walk over every scrobble, folded into per-song totals. This is
// what powers the Library's Recently Played / Most Played / Most Skipped
// sorts and (later) the Smart Music Engine's familiarity signals.

export interface ListenAggregate {
  plays: number
  completed: number
  skipped: number
  totalPlayedMs: number
  lastPlayedAt: number | null
}

export type ListenAggregates = Map<string, ListenAggregate>

// Cache: a full cursor walk of years of history costs tens of ms — fine on
// mount, wasteful on every sort click. The cache busts whenever the store's
// write sequence advances, so fresh scrobbles are always reflected.
let aggregateCache: { seq: number; map: ListenAggregates } | null = null
let writeSeq = 0

function emptyAggregate(): ListenAggregate {
  return { plays: 0, completed: 0, skipped: 0, totalPlayedMs: 0, lastPlayedAt: null }
}

/**
 * Per-song aggregates over the ENTIRE history. Fails soft to an empty map —
 * stats decorate the library, they never break it.
 */
export async function getListenAggregates(): Promise<ListenAggregates> {
  if (aggregateCache && aggregateCache.seq === writeSeq) return aggregateCache.map
  const map: ListenAggregates = new Map()
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SCROBBLES, 'readonly')
      const req = tx.objectStore(SCROBBLES).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve()
          return
        }
        const row = cursor.value as Scrobble
        const agg = map.get(row.songId) ?? emptyAggregate()
        agg.plays++
        if (row.completed) agg.completed++
        if (row.skipped) agg.skipped++
        agg.totalPlayedMs += row.playedMs || 0
        if (row.startedAt && (agg.lastPlayedAt === null || row.startedAt > agg.lastPlayedAt)) {
          agg.lastPlayedAt = row.startedAt
        }
        map.set(row.songId, agg)
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    // A broken/blocked stats DB just means "no listening data" — the empty
    // map degrades every stats-backed feature to a stable tie, by design.
    return map
  }
  aggregateCache = { seq: writeSeq, map }
  return map
}

/** Forces the next getListenAggregates() call to re-walk the store. */
export function invalidateListenAggregates(): void {
  writeSeq++
}

/**
 * Distinct artists/albums/tracks listened to inside [startMs, endMs) —
 * exported for the Listening History phase; cheap because it reuses the
 * aggregate walk's scrobble shape over a bounded index range.
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
    songs.add(r.songId)
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
