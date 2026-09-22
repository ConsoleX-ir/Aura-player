// ── History filtering (Phase 10) ────────────────────────────────────────────
// Pure predicate for the Listening History page — unit-tested in isolation;
// the page only wires inputs to it.

import type { Scrobble } from '@/lib/scrobbleStore'

export type StatusFilter = 'all' | 'completed' | 'skipped'
export type RangeFilter = 'all' | 'today' | '7d' | '30d'

/** Pure filter — substring query over title/artist/album, status, time range. */
export function filterHistory(
  rows: Scrobble[],
  opts: { query: string; status: StatusFilter; sinceMs: number | null },
): Scrobble[] {
  const q = opts.query.trim().toLowerCase()
  return rows.filter((r) => {
    if (opts.sinceMs != null && r.startedAt < opts.sinceMs) return false
    if (opts.status === 'completed' && !r.completed) return false
    if (opts.status === 'skipped' && !r.skipped) return false
    if (q) {
      const hay = `${r.title}\n${r.artist}\n${r.album}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
