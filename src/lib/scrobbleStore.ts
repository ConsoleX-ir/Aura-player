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
    req.onsuccess = () => resolve(req.result as number)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Fire-and-forget append for the playback engine — never throws, never
 * blocks playback. Failures are logged and otherwise ignored: losing one
 * local stats row is infinitely preferable to glitching audio over it.
 */
export function safeAppendScrobble(entry: Omit<Scrobble, 'id'>): void {
  appendScrobble(entry).catch((e) => console.warn('Scrobble append failed (ignored):', e))
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
