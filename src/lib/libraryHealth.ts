import type { Song } from '@/types'

// ── Aura Library Health (Phase 1 — Library 2.0) ─────────────────────────────
// Pure, React-free analysis of library entries against filesystem reality.
// The IPC layer (libraryService.runLibraryHealthCheck) gathers per-path
// existence facts; this module owns every judgment:
//
//   missing   — the file no longer exists on disk (moved/deleted/unmounted)
//   invalid   — the file exists but the import couldn't read it as audio
//               (zero duration + fallback metadata from the parser's catch)
//   duplicate — different paths that almost certainly hold the same song
//               (same normalized title+artist+album, duration within ±3s)
//
// Keeping the judgments here makes them unit-testable without Electron, and
// lets future surfaces (startup warning, sync integration) reuse them.

export interface PathCheck {
  path: string
  exists: boolean
}

export interface LibraryHealthReport {
  checkedAt: number
  /** How many entries were examined. */
  checked: number
  /** Entries with an existing, readable file — the healthy majority. */
  ok: number
  /** Files that no longer exist on disk. */
  missing: Song[]
  /** Files that exist but produced no playable duration at import time. */
  invalid: Song[]
  /** Groups of distinct paths that look like the same recording. */
  duplicateGroups: Song[][]
}

/** Two recordings under 3s apart are the same track; more is a different take. */
const DUPLICATE_DURATION_TOLERANCE_SEC = 3

/** Normalized duplicate-signature text: case/punctuation/space-insensitive. */
function normText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Groups songs that share a normalized title+artist+album signature, then
 * splits each group into duration clusters (± tolerance). Only clusters with
 * more than one member are reported. O(n log n): signature bucket, then a
 * duration-ordered walk inside each bucket.
 */
export function findDuplicateGroups(songs: Song[], durationToleranceSec = DUPLICATE_DURATION_TOLERANCE_SEC): Song[][] {
  // Bucket by text signature first — cheap, collision-free for real music.
  const buckets = new Map<string, Song[]>()
  for (const song of songs) {
    const key = `${normText(song.title)}|||${normText(song.artist)}|||${normText(song.album)}`
    const arr = buckets.get(key)
    if (arr) arr.push(song)
    else buckets.set(key, [song])
  }

  const groups: Song[][] = []
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    // Within a signature, cluster by duration. Zero durations (unreadable
    // files) must never equal each other — a missing duration is NOT a match.
    const withDuration = bucket.filter((s) => s.duration > 0).sort((a, b) => a.duration - b.duration)
    const zeroDuration = bucket.filter((s) => s.duration <= 0)

    const clusters: Song[][] = []
    let cluster: Song[] = []
    for (const song of withDuration) {
      if (cluster.length === 0 || song.duration - cluster[cluster.length - 1].duration <= durationToleranceSec) {
        cluster.push(song)
      } else {
        clusters.push(cluster)
        cluster = [song]
      }
    }
    if (cluster.length > 0) clusters.push(cluster)

    for (const c of clusters) {
      if (c.length > 1) {
        groups.push(c)
      } else if (zeroDuration.length > 0) {
        // One readable copy plus unreadable twin(s) sharing the same
        // signature: strong evidence they're the same recording, so the
        // user gets a group to clean the unreadable copies out with.
        // (Two unreadable files alone never match each other.)
        groups.push([...c, ...zeroDuration])
      }
    }
  }
  return groups
}

/**
 * The one health judgment entry point. `checks` maps song.path → existence;
 * a path missing from the map is treated as existing (the caller couldn't
 * check it — never flag what we don't know).
 */
export function analyzeLibraryHealth(songs: Song[], checks: Map<string, PathCheck>): LibraryHealthReport {
  const missing: Song[] = []
  const invalid: Song[] = []
  let ok = 0

  for (const song of songs) {
    const check = checks.get(song.path)
    if (check && !check.exists) {
      missing.push(song)
      continue
    }
    // Exists (or unknown) — readability heuristics. The parser's catch path
    // produces duration 0 with fallback metadata; a REAL audio file virtually
    // always has a positive duration, so duration 0 = "couldn't actually
    // read this file's audio".
    if (song.duration <= 0) {
      invalid.push(song)
      continue
    }
    ok++
  }

  return {
    checkedAt: Date.now(),
    checked: songs.length,
    ok,
    missing,
    invalid,
    duplicateGroups: findDuplicateGroups(songs),
  }
}
