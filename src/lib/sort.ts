import type { Song } from '@/types'

// ── Library sorting (v2.1.0) ────────────────────────────────────────────────
// Pure, React-free, unit-testable. The Library view owns the UI; this module
// owns the ordering rules. Array.prototype.sort is stable in V8, so songs
// with equal keys keep their library order — the sort never "scrambles"
// ties, which matters for the default view.

export type SortKey =
  | 'added' | 'title' | 'artist' | 'album' | 'duration'
  // Phase 1 (Library 2.0) — backed by the local listening-history aggregates
  // (scrobble store). Callers pass a `listen` map; without one these keys
  // behave like stable ties (library order), which is the honest degradation
  // for a fresh install with no history yet.
  | 'recentlyPlayed' | 'mostPlayed' | 'mostSkipped'
export type SortDir = 'asc' | 'desc'

export const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Recently Added' },
  { key: 'recentlyPlayed', label: 'Recently Played' },
  { key: 'mostPlayed', label: 'Most Played' },
  { key: 'mostSkipped', label: 'Most Skipped' },
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'duration', label: 'Duration' },
]

/** Sort keys that read better newest/most-first by default. */
export function defaultDirFor(key: SortKey): SortDir {
  return key === 'added' || key === 'duration' ||
    key === 'recentlyPlayed' || key === 'mostPlayed' || key === 'mostSkipped'
    ? 'desc'
    : 'asc'
}

/** The minimal per-song listening facts the stats-backed keys need. */
export interface ListenSortStats {
  plays: number
  skipped: number
  lastPlayedAt: number | null
}
export type ListenStatsMap = Map<string, ListenSortStats>

// One collator shared by every string comparison — locale-aware, case-
// insensitive ("aurora" and "Aurora" tie), numeric ("Track 2" < "Track 10").
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function addedTime(s: Song): number {
  // Songs imported before addedAt existed (and Folder-Sync-touched files)
  // fall back to their file mtime; songs with neither sink to the bottom of
  // "asc" and lead "desc"... deliberately: MAX means "oldest possible" so
  // ascending (oldest → newest) keeps them first, matching their position
  // as the library's earliest residents.
  return s.addedAt ?? s.mtimeMs ?? Number.MAX_SAFE_INTEGER
}

/** Returns a NEW sorted array — the input is never mutated. */
export function sortSongs(
  songs: Song[],
  key: SortKey,
  dir: SortDir,
  listen?: ListenStatsMap,
): Song[] {
  const sorted = [...songs]
  const flip = dir === 'desc' ? -1 : 1
  const statsOf = (s: Song): ListenSortStats | undefined => listen?.get(s.id)
  switch (key) {
    case 'added':
      sorted.sort((a, b) => (addedTime(a) - addedTime(b)) * flip)
      break
    case 'title':
      sorted.sort((a, b) => collator.compare(a.title, b.title) * flip)
      break
    case 'artist':
      // Artist first, then album, then track number — the natural browsing
      // order within an artist, mirroring how the album grid groups.
      sorted.sort((a, b) =>
        (collator.compare(a.artist, b.artist) ||
          collator.compare(a.album, b.album) ||
          (a.trackNumber ?? 0) - (b.trackNumber ?? 0)) * flip
      )
      break
    case 'album':
      sorted.sort((a, b) =>
        (collator.compare(a.album, b.album) ||
          collator.compare(a.artist, b.artist) ||
          (a.trackNumber ?? 0) - (b.trackNumber ?? 0)) * flip
      )
      break
    case 'duration':
      sorted.sort((a, b) => (a.duration - b.duration) * flip)
      break
    case 'recentlyPlayed': {
      // Never-played songs always sink to the bottom — "recently played"
      // ascending must not lead with every track the user never opened.
      sorted.sort((a, b) => {
        const ta = statsOf(a)?.lastPlayedAt ?? null
        const tb = statsOf(b)?.lastPlayedAt ?? null
        if (ta === null && tb === null) return 0
        if (ta === null) return 1
        if (tb === null) return -1
        return (ta - tb) * flip
      })
      break
    }
    case 'mostPlayed':
      // Zero plays is real data here (least-played first is a legitimate
      // asc read), so no sinking rule — plain numeric compare.
      sorted.sort((a, b) => ((statsOf(a)?.plays ?? 0) - (statsOf(b)?.plays ?? 0)) * flip)
      break
    case 'mostSkipped':
      sorted.sort((a, b) => ((statsOf(a)?.skipped ?? 0) - (statsOf(b)?.skipped ?? 0)) * flip)
      break
  }
  return sorted
}
