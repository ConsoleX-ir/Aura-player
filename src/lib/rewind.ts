// ── Aura Rewind aggregation ──────────────────────────────────────────────────
// The math behind the monthly listening story (Wave 4). Pure functions over
// raw scrobble rows — no React, no I/O — so the story page stays a thin
// renderer and this module can be reasoned about (and extended) on its own.
//
// Design notes:
//   • Everything derives from ONE walk over the month's rows. A user's month
//     is at most a few thousand sessions, so a single pass with Maps is both
//     the simple and the fast answer.
//   • Song identity = scrobble.songId (stable file hash); display strings
//     come from the denormalized title/artist/album captured at play time,
//     so history stays meaningful even after files are removed.
//   • Streaks/heatmaps are computed in the month's LOCAL timezone — the
//     story is about the listener's days, not UTC.
//   • Genres join back to the LIVE library by songId; songs that have since
//     been removed simply contribute no genre. Nothing here touches network.

import type { RewindMonthData } from '@/types'
import type { Scrobble } from './scrobbleStore'

const TOP_N = 5

function monthWindow(year: number, month0: number): { start: number; end: number } {
  // month0 is 0-indexed. The window is [first day local, first day next month).
  const start = new Date(year, month0, 1, 0, 0, 0, 0).getTime()
  const end = new Date(year, month0 + 1, 1, 0, 0, 0, 0).getTime()
  return { start, end }
}

/** Current month's window, or the most recent month that could have data. */
export function currentMonthWindow(now = Date.now()): { year: number; month0: number; start: number; end: number } {
  const d = new Date(now)
  const { start, end } = monthWindow(d.getFullYear(), d.getMonth())
  return { year: d.getFullYear(), month0: d.getMonth(), start, end }
}

/** Shift a window back/forward by n months (negative = past). */
export function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number; start: number; end: number } {
  const d = new Date(year, month0 + delta, 1)
  const { start, end } = monthWindow(d.getFullYear(), d.getMonth())
  return { year: d.getFullYear(), month0: d.getMonth(), start, end }
}

export function monthLabel(year: number, month0: number): string {
  return new Date(year, month0, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/**
 * Aggregate a month's scrobbles into the Rewind story payload.
 * `genreBySongId` maps live library song ids → genre (may be sparse).
 */
export function aggregateRewind(
  rows: Scrobble[],
  year: number,
  month0: number,
  genreBySongId: Map<string, string | null | undefined>,
): RewindMonthData {
  const { start, end } = monthWindow(year, month0)
  const daysInMonth = new Date(year, month0 + 1, 0).getDate()

  let totalPlayedMs = 0
  let completed = 0
  let skipped = 0

  const songAgg = new Map<string, { title: string; artist: string; album: string; ms: number; plays: number }>()
  const artistAgg = new Map<string, { name: string; ms: number; plays: number }>()
  const albumAgg = new Map<string, { name: string; artist: string; ms: number; plays: number }>()
  const genreAgg = new Map<string, number>()
  const hourHistogram = new Array<number>(24).fill(0)
  const weekdayHistogram = new Array<number>(7).fill(0) // Mon-first
  const dayTotals = new Array<number>(daysInMonth + 1).fill(0) // 1-indexed
  const activeDays = new Set<number>()

  for (const r of rows) {
    totalPlayedMs += r.playedMs || 0
    if (r.completed) completed++
    if (r.skipped) skipped++

    // Song bucket — denormalized strings captured at play time.
    const s = songAgg.get(r.songId)
    if (s) { s.ms += r.playedMs || 0; s.plays++ }
    else songAgg.set(r.songId, { title: r.title || 'Unknown Title', artist: r.artist || 'Unknown Artist', album: r.album || 'Unknown Album', ms: r.playedMs || 0, plays: 1 })

    if (r.artist) {
      const a = artistAgg.get(r.artist)
      if (a) { a.ms += r.playedMs || 0; a.plays++ }
      else artistAgg.set(r.artist, { name: r.artist, ms: r.playedMs || 0, plays: 1 })
    }

    if (r.album) {
      const key = `${r.album}||${r.artist}` // same album name, different artists
      const al = albumAgg.get(key)
      if (al) { al.ms += r.playedMs || 0; al.plays++ }
      else albumAgg.set(key, { name: r.album, artist: r.artist || 'Unknown Artist', ms: r.playedMs || 0, plays: 1 })
    }

    const genre = genreBySongId.get(r.songId)
    if (genre) genreAgg.set(genre, (genreAgg.get(genre) ?? 0) + 1)

    // Timeline buckets use the session START in local time — that's "when
    // I pressed play", which is the story listeners remember.
    const d = new Date(r.startedAt)
    hourHistogram[d.getHours()]++
    weekdayHistogram[(d.getDay() + 6) % 7]++ // JS Sunday=0 → Mon-first
    const day = d.getDate()
    if (day >= 1 && day <= daysInMonth) {
      dayTotals[day] += r.playedMs || 0
      activeDays.add(day)
    }
  }

  const byMs = (a: { ms: number }, b: { ms: number }) => b.ms - a.ms
  const topSongs = [...songAgg.entries()]
    .map(([key, v]) => ({ key, ...v })).sort(byMs).slice(0, TOP_N)
  const topArtists = [...artistAgg.entries()]
    .map(([key, v]) => ({ key, ...v })).sort(byMs).slice(0, TOP_N)
  const topAlbums = [...albumAgg.entries()]
    .map(([key, v]) => ({ key, ...v })).sort(byMs).slice(0, TOP_N)
  const topGenres = [...genreAgg.entries()]
    .map(([name, plays]) => ({ name, plays })).sort((a, b) => b.plays - a.plays).slice(0, TOP_N)

  // Longest run of consecutive active days within the month.
  let longestStreak = 0
  let run = 0
  for (let day = 1; day <= daysInMonth; day++) {
    if (activeDays.has(day)) { run++; longestStreak = Math.max(longestStreak, run) }
    else run = 0
  }

  let mostActiveDay: { day: number; ms: number } | null = null
  for (let day = 1; day <= daysInMonth; day++) {
    if (dayTotals[day] > 0 && (!mostActiveDay || dayTotals[day] > mostActiveDay.ms)) {
      mostActiveDay = { day, ms: dayTotals[day] }
    }
  }

  const sessions = rows.length
  // The #1 song's cover art, resolved against the live library (the cover
  // file may be gone, in which case the story renders its aura placeholder).
  const topSongCover = topSongs.length
    ? (songCoverResolver?.(topSongs[0].key) ?? null)
    : null

  return {
    monthStart: start,
    monthEnd: end,
    hasData: sessions > 0,
    totalPlayedMs,
    sessions,
    completed,
    skipped,
    uniqueSongs: songAgg.size,
    uniqueArtists: artistAgg.size,
    uniqueAlbums: albumAgg.size,
    topSongs,
    topArtists,
    topAlbums,
    topGenres,
    hourHistogram,
    weekdayHistogram,
    dayTotals,
    longestStreak,
    mostActiveDay,
    topSongCover,
  }
}

// ── Cover-art resolver injection ─────────────────────────────────────────────
// The library lives in the zustand store; importing the store here would add
// a cycle (store → queueEngine → …, rewind is a lib module). Instead the
// RewindPage wires a resolver once at call time. Module-level because
// aggregateRewind's signature stays data-only for testability.
let songCoverResolver: ((songId: string) => string | null) | null = null
export function setSongCoverResolver(fn: (songId: string) => string | null): void {
  songCoverResolver = fn
}

// ── Formatting helpers (shared by the page and the share card) ──────────────

/** 4h 32m / 38m / <1m style compact listening time. */
export function formatListeningTime(ms: number): { value: string; unit: string } {
  const minutes = Math.floor(ms / 60_000)
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? { value: `${h}`, unit: `hr${h === 1 ? '' : 's'} ${m} min` } : { value: `${h}`, unit: `hour${h === 1 ? '' : 's'}` }
  }
  if (minutes >= 1) return { value: `${minutes}`, unit: 'minutes' }
  return { value: '<1', unit: 'minute' }
}

export function formatMs(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  return `${Math.max(minutes, 1)}m`
}
