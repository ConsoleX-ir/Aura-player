// ── Artist/Album grouping helpers (Phase 9) ─────────────────────────────────
// Pure functions that turn the flat library into artist/album views. Shared
// by ArtistPage, AlbumPage and the SongRow menu — one grouping rule
// everywhere, no duplicated logic.
//
// Normalization is deliberately shallow (trim + casefold): "The Beatles" vs
// "Beatles" is a music-brain problem, not a string problem — honest grouping
// beats clever over-matching that merges distinct artists.

import type { Song } from '@/types'

export function normName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

export const UNKNOWN_RE = /^(unknown (artist|album)|unknown|)$/i

export interface AlbumKey {
  artist: string  // display form (most frequent variant)
  album: string   // display form
  normArtist: string
  normAlbum: string
}

/**
 * Picks the most frequent raw spelling within each group as the display form
 * (ties → first spelling encountered, i.e. stable library order), so "MIKE"
 * and "Mike" render the way the user's own tags mostly spell it.
 */
export function displayVariant(variants: string[]): string {
  const counts = new Map<string, number>()
  for (const v of variants) {
    const key = v.trim()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = ''
  let bestN = 0
  for (const [key, n] of counts) {
    if (n > bestN) {
      best = key
      bestN = n
    }
  }
  return best
}

export function songsByArtist(library: Song[], artistDisplay: string): Song[] {
  const norm = normName(artistDisplay)
  return library.filter((s) => normName(s.artist) === norm)
}

export function albumKeyOf(song: Song): string {
  return `${normName(song.artist)}||${normName(song.album)}`
}

export function albumsOfArtist(songs: Song[]): { key: AlbumKey; songs: Song[] }[] {
  const groups = new Map<string, Song[]>()
  for (const s of songs) {
    const k = albumKeyOf(s)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(s)
  }
  return [...groups.entries()]
    .map(([, list]) => ({
      key: {
        artist: displayVariant(list.map((s) => s.artist)),
        album: displayVariant(list.map((s) => s.album)),
        normArtist: normName(list[0].artist),
        normAlbum: normName(list[0].album),
      },
      songs: sortAlbumTracks(list),
    }))
    .sort((a, b) => a.key.album.localeCompare(b.key.album))
}

/** Album order: trackNumber asc (missing sink, title asc), a stable order. */
export function sortAlbumTracks(songs: Song[]): Song[] {
  return [...songs].sort((a, b) => {
    const ta = a.trackNumber ?? Number.MAX_SAFE_INTEGER
    const tb = b.trackNumber ?? Number.MAX_SAFE_INTEGER
    if (ta !== tb) return ta - tb
    return (a.title || '').localeCompare(b.title || '')
  })
}

/**
 * Related artists: others whose normalized genre sets overlap this artist's.
 * Ranked by overlap size then name; returns display names only. Honest: a
 * purely local signal — no pretending to know taste similarity we cannot see.
 */
export function relatedArtists(library: Song[], artistDisplay: string, limit = 4): string[] {
  const norm = normName(artistDisplay)
  const genresOf = (artist: string): Set<string> => {
    const set = new Set<string>()
    for (const s of library) {
      if (normName(s.artist) === artist && s.genre && !UNKNOWN_RE.test(s.genre)) set.add(normName(s.genre))
    }
    return set
  }
  const base = genresOf(norm)
  if (base.size === 0) return []
  const scores = new Map<string, number>()
  for (const s of library) {
    const a = normName(s.artist)
    if (!a || a === norm) continue
    if (s.genre && !UNKNOWN_RE.test(s.genre) && base.has(normName(s.genre))) {
      scores.set(a, (scores.get(a) ?? 0) + 1)
    }
  }
  const display = new Map<string, string[]>()
  for (const s of library) {
    const a = normName(s.artist)
    if (a && a !== norm && scores.has(a)) {
      if (!display.has(a)) display.set(a, [])
      display.get(a)!.push(s.artist)
    }
  }
  return [...scores.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, limit)
    .map(([a]) => displayVariant(display.get(a) ?? [a]))
}

export function totalRuntimeSec(songs: Song[]): number {
  return songs.reduce((acc, s) => acc + (s.duration > 0 ? s.duration : 0), 0)
}
