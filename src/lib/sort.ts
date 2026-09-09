import type { Song } from '@/types'

// ── Library sorting (v2.1.0) ────────────────────────────────────────────────
// Pure, React-free, unit-testable. The Library view owns the UI; this module
// owns the ordering rules. Array.prototype.sort is stable in V8, so songs
// with equal keys keep their library order — the sort never "scrambles"
// ties, which matters for the default view.

export type SortKey = 'added' | 'title' | 'artist' | 'album' | 'duration'
export type SortDir = 'asc' | 'desc'

export const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Recently Added' },
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'duration', label: 'Duration' },
]

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
export function sortSongs(songs: Song[], key: SortKey, dir: SortDir): Song[] {
  const sorted = [...songs]
  const flip = dir === 'desc' ? -1 : 1
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
  }
  return sorted
}
