import { useEffect, useMemo, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { getScrobblesInRange, getHistorySummary, type Scrobble } from '@/lib/scrobbleStore'
import { useVirtualWindow, VIRTUALIZE_THRESHOLD } from '@/hooks/useVirtualWindow'
import { formatTime, formatRuntime, cn } from '@/lib/utils'
import { filterHistory, startOfLocalDay, type StatusFilter, type RangeFilter } from '@/lib/historyFilter'
import { History, Music2, Check, SkipForward, Search, Loader2 } from 'lucide-react'

// ── Listening History (Phase 10) ────────────────────────────────────────────
// The chronological record of everything heard in Aura, backed by the
// Wave-0 IndexedDB scrobble store (already restart-proof). Rows carry the
// denormalized title/artist/album so deleted songs stay honest ("removed
// from library", never blank).
//
// Scale: one cursor walk on mount (tens of ms per years of history — the
// store's own measurement), then pure in-memory filtering; rendering is
// virtualized with the SAME windowing hook the library list uses.

const ROW_HEIGHT = 56

const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = {
  today: 0, // computed per-render (start of local day)
  '7d': 7 * 86400000,
  '30d': 30 * 86400000,
}

export function HistoryPage() {
  const [rows, setRows] = useState<Scrobble[] | null>(null)
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getHistorySummary>> | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [range, setRange] = useState<RangeFilter>('all')

  const library = usePlayerStore((s) => s.library)
  const playSong = usePlayerStore((s) => s.playSong)

  useEffect(() => {
    let alive = true
    const now = Date.now()
    Promise.all([getScrobblesInRange(0, now), getHistorySummary(0, now)])
      .then(([list, sum]) => {
        if (!alive) return
        // Store order is insertion (auto-increment) — display newest first.
        list.sort((a, b) => b.startedAt - a.startedAt)
        setRows(list)
        setSummary(sum)
      })
      .catch(() => {
        if (alive) setRows([])
      })
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    const sinceMs = range === 'all'
      ? null
      : range === 'today'
        ? startOfLocalDay(Date.now())
        : Date.now() - RANGE_MS[range]
    return filterHistory(rows, { query, status, sinceMs })
  }, [rows, query, status, range])

  const libraryIds = useMemo(() => new Set(library.map((s) => s.id)), [library])

  // ── Virtual window (shared hook — same math as the library list) ──
  const vw = useVirtualWindow(filtered.length, ROW_HEIGHT)
  const isVirtualized = filtered.length >= VIRTUALIZE_THRESHOLD
  const visible = isVirtualized ? filtered.slice(vw.start, vw.end) : filtered

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-7 pt-6 pb-4">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2.5" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          <History size={20} style={{ color: 'var(--accent)' }} />
          Listening History
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          Every session recorded on this device — kept in your local database, never uploaded.
        </p>

        {/* Stats strip */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {[
              { label: 'Sessions', value: summary.sessions.toLocaleString() },
              { label: 'Unique songs', value: summary.uniqueSongs.toLocaleString() },
              { label: 'Finished', value: `${summary.sessions ? Math.round((summary.completed / summary.sessions) * 100) : 0}%` },
              { label: 'Total listening', value: formatRuntime(Math.round(summary.totalPlayedMs / 1000)) },
            ].map((s) => (
              <div key={s.label} className="px-3 py-2.5 rounded-xl" style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}>
                <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
                <p className="text-[10px] uppercase mt-0.5" style={{ color: 'var(--text-faint)', letterSpacing: '0.08em' }}>{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <div className="relative flex-1 min-w-52">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, artist, album…"
              aria-label="Search history"
              className="w-full pl-9 pr-3 py-2 rounded-xl text-sm outline-none"
              style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
            />
          </div>
          {(['all', 'completed', 'skipped'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={cn('px-3 py-2 rounded-xl text-xs font-medium capitalize transition-all')}
              style={{
                background: status === s ? 'var(--accent-dim)' : 'var(--glass-1)',
                border: `1px solid ${status === s ? 'var(--accent-border)' : 'var(--border-default)'}`,
                color: status === s ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
          {(['all', 'today', '7d', '30d'] as RangeFilter[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className="px-3 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: range === r ? 'var(--accent-dim)' : 'var(--glass-1)',
                border: `1px solid ${range === r ? 'var(--accent-border)' : 'var(--border-default)'}`,
                color: range === r ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {r === 'all' ? 'All time' : r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : 'Last 30 days'}
            </button>
          ))}
        </div>
        {rows && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
            Showing {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} sessions
          </p>
        )}
      </div>

      {/* List */}
      <div
        ref={vw.containerRef}
        className="flex-1 min-h-0 overflow-y-auto px-7 pb-6"
        data-testid="history-list"
      >
        {rows === null ? (
          <div className="flex items-center justify-center gap-2.5 py-16" role="status">
            <Loader2 size={15} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading your history…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14" style={{ color: 'var(--text-faint)' }}>
            <Music2 size={20} />
            <p className="text-xs">{rows.length === 0 ? 'Nothing recorded yet — play something!' : 'No sessions match the current filters.'}</p>
          </div>
        ) : isVirtualized ? (
          <div style={{ position: 'relative', height: filtered.length * ROW_HEIGHT }}>
            {visible.map((r, i) => {
              const realIndex = vw.start + i
              return (
                <HistoryRow key={r.id ?? `${r.songId}-${r.startedAt}-${realIndex}`} scrobble={r} index={realIndex} inLibrary={libraryIds.has(r.songId)} playSong={playSong} />
              )
            })}
          </div>
        ) : (
          visible.map((r, i) => (
            <HistoryRow key={r.id ?? `${r.songId}-${r.startedAt}-${i}`} scrobble={r} index={i} inLibrary={libraryIds.has(r.songId)} playSong={playSong} />
          ))
        )}
      </div>
    </div>
  )
}

function HistoryRow({ scrobble, index, inLibrary, playSong }: {
  scrobble: Scrobble
  index: number
  inLibrary: boolean
  playSong: ReturnType<typeof usePlayerStore.getState>['playSong']
}) {
  const r = scrobble
  const song = usePlayerStore((s) => s.library.find((x) => x.id === r.songId))
  const d = new Date(r.startedAt)
  const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  const onClick = () => {
    if (song) playSong(song, usePlayerStore.getState().library)
  }

  return (
    <div
      role={inLibrary ? 'button' : undefined}
      tabIndex={inLibrary ? 0 : -1}
      aria-label={inLibrary ? `Play ${r.title}` : undefined}
      title={inLibrary ? `Play ${r.title}` : 'Removed from your library'}
      onKeyDown={(e) => { if (inLibrary && e.key === 'Enter') onClick() }}
      onClick={inLibrary ? onClick : undefined}
      className={cn(
        'flex items-center gap-3 px-3 rounded-xl transition-colors',
        inLibrary ? 'cursor-pointer hover-surface' : 'opacity-55 cursor-default',
        index > 0 && 'mt-1',
      )}
      style={{ height: ROW_HEIGHT - 4, background: 'var(--glass-1)' }}
    >
      {/* Status */}
      <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center" style={{ background: r.completed ? 'var(--success-veil)' : 'var(--glass-2)' }}>
        {r.completed
          ? <Check size={12} style={{ color: 'var(--success)' }} />
          : <SkipForward size={11} style={{ color: r.skipped ? 'var(--text-faint)' : 'var(--text-tertiary)' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{r.title || 'Unknown title'}</p>
        <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
          {r.artist || 'Unknown artist'}{r.album ? ` · ${r.album}` : ''}
        </p>
      </div>
      <div className="text-right shrink-0 hidden sm:block">
        <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
          {formatTime(Math.round((r.playedMs || 0) / 1000))} {r.durationSec > 0 ? `· ${formatTime(r.durationSec)}` : ''}
        </p>
        <p className="text-[10px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
          {dateStr} · {timeStr}
        </p>
      </div>
    </div>
  )
}
