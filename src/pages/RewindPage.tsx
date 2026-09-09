import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, History, Play, Download, Loader2,
  CalendarDays, Flame, MoonStar, Sun, Headphones, Disc3, Mic2, Trophy,
} from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { toast } from '@/store/toastStore'
import { getScrobblesInRange } from '@/lib/scrobbleStore'
import {
  aggregateRewind, currentMonthWindow, shiftMonth, monthLabel,
  formatListeningTime, formatMs, setSongCoverResolver,
} from '@/lib/rewind'
import type { RewindMonthData } from '@/types'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'

// ── Aura Rewind (Wave 4) ─────────────────────────────────────────────────────
// The monthly listening experience: a scroll-told story built ONLY from the
// local scrobble store — listening time, top songs/artists/albums, listening
// clock, day-by-day rhythm, completion story, streaks — ending in a shareable
// image card drawn on a canvas and written straight to disk. Nothing here
// ever touches the network; the locked rule is total.
//
// Performance: aggregation is one pass over one month's rows; charts are
// plain divs/SVG with transform/width transitions; entrance animations use
// whileInView (IntersectionObserver — offscreen scenes cost nothing). The
// share canvas renders on click only.

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12} ${suffix}`
}

export default function RewindPage() {
  // Anchor to the month the page opened in; navigation shifts from here.
  const [anchor, setAnchor] = useState(() => {
    const w = currentMonthWindow()
    return { year: w.year, month0: w.month0 }
  })
  const [data, setData] = useState<RewindMonthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [cardBusy, setCardBusy] = useState(false)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const library = usePlayerStore((s) => s.library)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const nowWindow = currentMonthWindow()
  const isCurrentMonth = anchor.year === nowWindow.year && anchor.month0 === nowWindow.month0

  // Wire the cover resolver once — aggregateRewind stays data-only.
  useEffect(() => {
    setSongCoverResolver((songId) =>
      usePlayerStore.getState().library.find((s) => s.id === songId)?.coverArt ?? null)
  }, [])

  // Escape = back out of where I am (same contract as the Properties page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
        e.preventDefault()
        usePlayerStore.getState().setActiveView('library')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // Genre lookup joins live library rows; songs removed from the library
    // contribute no genre — history still tells their story by name.
    const genreBySongId = new Map(library.map((s) => [s.id, s.genre ?? null]))
    const win = shiftMonth(anchor.year, anchor.month0, 0)
    getScrobblesInRange(win.start, win.end)
      .then((rows) => {
        if (cancelled) return
        setData(aggregateRewind(rows, anchor.year, anchor.month0, genreBySongId))
        setLoading(false)
      })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [anchor.year, anchor.month0, library])

  return (
    <div className="h-full overflow-y-auto" data-rewind-page>
      <div className="max-w-2xl mx-auto px-6 pb-24">
        {/* ── Header: title + month stepper ─────────────────────────────── */}
        <header className="pt-10 pb-2 flex items-end justify-between">
          <div className="flex items-center gap-3.5">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
            >
              <History size={19} style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 className="text-xl font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                Aura Rewind
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Your month, told by your own listening — 100% local
              </p>
            </div>
          </div>

          {/* Month stepper — back into history, forward only up to today */}
          <div
            className="flex items-center gap-1 rounded-xl p-1"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
          >
            <button
              onClick={() => setAnchor((a) => { const n = shiftMonth(a.year, a.month0, -1); return { year: n.year, month0: n.month0 } })}
              className="p-1.5 rounded-lg icon-hover"
              style={{ color: 'var(--text-secondary)' }}
              title="Previous month"
              aria-label="Previous month"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs font-medium px-2 tabular-nums min-w-[96px] text-center" style={{ color: 'var(--text-primary)' }}>
              {monthLabel(anchor.year, anchor.month0)}
            </span>
            <button
              onClick={() => !isCurrentMonth && setAnchor((a) => { const n = shiftMonth(a.year, a.month0, 1); return { year: n.year, month0: n.month0 } })}
              disabled={isCurrentMonth}
              className="p-1.5 rounded-lg icon-hover disabled:opacity-25"
              style={{ color: 'var(--text-secondary)' }}
              title="Next month"
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center py-32 gap-2.5" style={{ color: 'var(--text-faint)' }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Reading your month…</span>
          </div>
        ) : !data?.hasData ? (
          <EmptyMonth onPlay={() => setActiveView('library')} />
        ) : (
          <div className={performanceMode ? '' : 'rewind-story'}>
            <HeroScene data={data} monthText={monthLabel(anchor.year, anchor.month0)} perf={performanceMode} />
            <TopScene
              kicker="On repeat"
              title={data.topSongs[0] ? `“${data.topSongs[0].title}” knew the way` : undefined}
              cover={data.topSongCover}
              rows={data.topSongs.map((t) => ({ key: t.key, primary: t.title, secondary: t.artist, ms: t.ms, plays: t.plays }))}
              icon={<Headphones size={13} />}
            />
            <TopScene
              kicker="Voices of the month"
              title={data.topArtists[0] ? `${data.topArtists[0].name} scored the soundtrack` : undefined}
              rows={data.topArtists.map((a) => ({ key: a.name, primary: a.name, secondary: `${a.plays} play${a.plays === 1 ? '' : 's'}`, ms: a.ms, plays: a.plays }))}
              icon={<Mic2 size={13} />}
            />
            <TopScene
              kicker="Albums that stayed"
              title={data.topAlbums[0] ? `${data.topAlbums[0].name} was home base` : undefined}
              rows={data.topAlbums.map((al) => ({ key: `${al.name}||${al.artist}`, primary: al.name, secondary: al.artist, ms: al.ms, plays: al.plays }))}
              icon={<Disc3 size={13} />}
            />
            {data.topGenres.length > 0 && (
              <Scene kicker="The sound of it all">
                <div className="flex flex-wrap gap-2">
                  {data.topGenres.map((g, i) => (
                    <span
                      key={g.name}
                      className="px-4 py-2 rounded-pill text-sm"
                      style={{
                        background: i === 0 ? 'var(--accent-dim)' : 'var(--glass-1)',
                        border: `1px solid ${i === 0 ? 'var(--accent-border)' : 'var(--border-subtle)'}`,
                        color: i === 0 ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                    >
                      {g.name}
                    </span>
                  ))}
                </div>
              </Scene>
            )}
            <ClockScene histogram={data.hourHistogram} />
            <WeekScene histogram={data.weekdayHistogram} />
            <HeatmapScene dayTotals={data.dayTotals} monthText={monthLabel(anchor.year, anchor.month0)} />
            <CompletionScene data={data} />
            <NumbersScene data={data} />
            <ShareCardScene data={data} monthText={monthLabel(anchor.year, anchor.month0)} busy={cardBusy} setBusy={setCardBusy} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Scene scaffolding ────────────────────────────────────────────────────────
function Scene({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <motion.section
      className="pt-20"
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="text-[10px] font-semibold uppercase mb-3" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
        {kicker}
      </p>
      {children}
    </motion.section>
  )
}

function SceneTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[22px] leading-snug font-semibold mb-6" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
      {children}
    </h2>
  )
}

// ── Hero: the big number ─────────────────────────────────────────────────────
function HeroScene({ data, monthText, perf }: { data: RewindMonthData; monthText: string; perf: boolean }) {
  const time = formatListeningTime(data.totalPlayedMs)
  const [shown, setShown] = useState(perf ? time.value : '0')
  const rafRef = useRef(0)

  // Count-up on first view — the single most "Rewind" moment. rAF over ~900ms
  // with an ease-out; skipped entirely under Performance Mode.
  useEffect(() => {
    if (perf) { setShown(time.value); return }
    const el = document.querySelector('[data-rewind-hero]')
    if (!el) { setShown(time.value); return }
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return
      io.disconnect()
      const target = parseInt(time.value.replace(/[^0-9]/g, ''), 10) || 0
      if (time.value.startsWith('<')) { setShown(time.value); return }
      const t0 = performance.now()
      const dur = 900
      const tick = (t: number) => {
        const p = Math.min((t - t0) / dur, 1)
        const eased = 1 - Math.pow(1 - p, 3)
        setShown(String(Math.round(target * eased)))
        if (p < 1) rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(rafRef.current) }
  }, [time.value, perf])

  return (
    <motion.section
      className="pt-14"
      data-rewind-hero
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="text-[10px] font-semibold uppercase mb-4" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
        {monthText} — your time in sound
      </p>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span
          className="font-semibold"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 72,
            lineHeight: 1,
            background: 'linear-gradient(120deg, var(--accent), var(--accent-strong))',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          {shown}
        </span>
        <span className="text-xl font-medium" style={{ color: 'var(--text-secondary)' }}>{time.unit}</span>
      </div>
      <p className="text-sm mt-4" style={{ color: 'var(--text-tertiary)' }}>
        Across <b style={{ color: 'var(--text-secondary)' }}>{data.sessions}</b> listening session{data.sessions === 1 ? '' : 's'} —
        {' '}{data.completed} played through to the end.
      </p>
    </motion.section>
  )
}

// ── Top-N ranking scene (songs / artists / albums share one shape) ──────────
function TopScene({ kicker, title, rows, cover, icon }: {
  kicker: string
  title?: string
  cover?: string | null
  rows: { key: string; primary: string; secondary: string; ms: number; plays: number }[]
  icon: React.ReactNode
}) {
  if (rows.length === 0) return null
  const max = rows[0].ms || 1
  return (
    <Scene kicker={kicker}>
      {title && <SceneTitle>{title}</SceneTitle>}
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div
            key={r.key}
            className="flex items-center gap-3 p-2 rounded-2xl group relative overflow-hidden"
            style={{ background: i === 0 ? 'var(--glass-1)' : 'transparent' }}
          >
            {/* Rank + art */}
            <div className="relative w-10 h-10 shrink-0">
              {i === 0 && cover ? (
                <img src={cover} alt="" className="w-10 h-10 rounded-xl object-cover" style={{ boxShadow: '0 0 18px var(--accent-whisper)' }} />
              ) : i === 0 ? (
                <div className="w-10 h-10 rounded-xl overflow-hidden"><ArtworkPlaceholder seed={r.key} size="sm" /></div>
              ) : null}
              {i !== 0 && (
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-semibold tabular-nums"
                  style={{ background: 'var(--glass-1)', color: 'var(--text-faint)', border: '1px solid var(--border-subtle)' }}
                >
                  {i + 1}
                </div>
              )}
              {i === 0 && (
                <div
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: 'var(--accent)', color: 'var(--text-on-accent)', boxShadow: '0 2px 8px var(--accent-veil)' }}
                >
                  <Trophy size={10} />
                </div>
              )}
            </div>

            {/* Names + bar */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <p className="text-[13.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {i === 0 && <span className="inline-flex align-middle mr-1.5" style={{ color: 'var(--accent)' }}>{icon}</span>}
                  {r.primary}
                </p>
                <p className="text-[11px] truncate shrink-0" style={{ color: 'var(--text-tertiary)' }}>{r.secondary}</p>
              </div>
              <div className="h-1 rounded-pill mt-1.5 overflow-hidden" style={{ background: 'var(--glass-1)' }}>
                <motion.div
                  className="h-full rounded-pill"
                  style={{ background: i === 0 ? 'linear-gradient(90deg, var(--accent), var(--accent-strong))' : 'var(--glass-3)' }}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${Math.max((r.ms / max) * 100, 3)}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, delay: 0.06 * i, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
            </div>
            <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--text-faint)' }}>{formatMs(r.ms)}</span>
          </div>
        ))}
      </div>
    </Scene>
  )
}

// ── Listening clock: 24 bars ─────────────────────────────────────────────────
function ClockScene({ histogram }: { histogram: number[] }) {
  const max = Math.max(...histogram, 1)
  const peak = histogram.indexOf(max)
  const nightOwl = peak >= 22 || peak < 5
  const caption = histogram[peak] === 0
    ? 'Every hour kept its secrets this month.'
    : nightOwl
      ? `The ${hourLabel(peak)} hours knew you best — a night owl's month.`
      : peak < 11
        ? `Mornings at ${hourLabel(peak)} carried your soundtrack.`
        : peak < 17
          ? `Afternoons at ${hourLabel(peak)} were your stage.`
          : `Evenings at ${hourLabel(peak)} belonged to the music.`
  return (
    <Scene kicker="When you listened">
      <SceneTitle>{caption}</SceneTitle>
      <div className="flex items-end gap-[3px] h-28" data-rewind-clock>
        {histogram.map((v, h) => (
          <div key={h} className="flex-1 flex flex-col items-center gap-1.5 group/h">
            <motion.div
              className="w-full rounded-t-md"
              style={{
                background: h === peak ? 'linear-gradient(180deg, var(--accent), var(--accent-strong))' : 'var(--glass-3)',
                minHeight: v > 0 ? 3 : 2,
              }}
              initial={{ height: 0 }}
              whileInView={{ height: `${Math.max((v / max) * 100, v > 0 ? 5 : 2)}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: h * 0.015, ease: [0.16, 1, 0.3, 1] }}
              title={`${hourLabel(h)} — ${v} session${v === 1 ? '' : 's'}`}
            />
            <span className="text-[8.5px] tabular-nums" style={{ color: h === peak ? 'var(--accent)' : 'var(--text-faint)' }}>
              {h % 6 === 0 ? hourLabel(h) : ''}
            </span>
          </div>
        ))}
      </div>
    </Scene>
  )
}

// ── Week rhythm ──────────────────────────────────────────────────────────────
function WeekScene({ histogram }: { histogram: number[] }) {
  const max = Math.max(...histogram, 1)
  const peak = histogram.indexOf(max)
  return (
    <Scene kicker="The week had a shape">
      <SceneTitle>
        {histogram[peak] > 0
          ? `${WEEKDAY_LABELS[peak]}day${['Sat', 'Sun'].includes(WEEKDAY_LABELS[peak]) ? 's' : 's'} hit different.`
          : 'A quiet month, in seven acts.'}
      </SceneTitle>
      <div className="grid grid-cols-7 gap-2" data-rewind-week>
        {histogram.map((v, d) => (
          <div key={d} className="flex flex-col items-center gap-1.5">
            <motion.div
              className="w-full rounded-lg"
              style={{
                background: d === peak ? 'linear-gradient(180deg, var(--accent), var(--accent-strong))' : 'var(--glass-2)',
                height: 64,
                transformOrigin: 'bottom',
              }}
              initial={{ scaleY: 0.02 }}
              whileInView={{ scaleY: Math.max(v / max, 0.04) }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: d * 0.04, ease: [0.16, 1, 0.3, 1] }}
              title={`${v} session${v === 1 ? '' : 's'}`}
            />
            <span className="text-[9.5px]" style={{ color: d === peak ? 'var(--accent)' : 'var(--text-faint)' }}>
              {WEEKDAY_LABELS[d]}
            </span>
          </div>
        ))}
      </div>
    </Scene>
  )
}

// ── Day-by-day heatmap (calendar grid, GitHub-style) ─────────────────────────
function HeatmapScene({ dayTotals, monthText }: { dayTotals: number[]; monthText: string }) {
  const daysInMonth = dayTotals.length - 1
  const max = Math.max(...dayTotals, 1)
  // First day-of-month's weekday (Mon-first). monthText comes from
  // monthLabel() — a locale date string — which Date() parses back reliably
  // for month-name + year forms in Chromium (Electron's only target).
  const parsed = new Date(monthText)
  const offset = isNaN(parsed.getTime()) ? 0 : (parsed.getDay() + 6) % 7
  const mostActive = dayTotals.indexOf(max)

  return (
    <Scene kicker="Day by day">
      <SceneTitle>
        {mostActive > 0 && max > 0
          ? `The ${ordinal(mostActive)} was the loudest day.`
          : 'A month measured in silence.'}
      </SceneTitle>
      <div className="flex gap-3" data-rewind-heatmap>
        <div className="grid grid-rows-7 gap-1 text-[8.5px] shrink-0" style={{ color: 'var(--text-faint)' }}>
          {WEEKDAY_LABELS.map((w) => <span key={w} className="h-3.5 leading-[14px]">{w}</span>)}
        </div>
        <div>
          <div className="grid gap-1" style={{ gridTemplateRows: 'repeat(7, 14px)', gridAutoFlow: 'column' }}>
            {Array.from({ length: offset }).map((_, i) => <span key={`pad-${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const ms = dayTotals[day]
              const intensity = ms / max
              return (
                <div
                  key={day}
                  className="w-3.5 h-3.5 rounded-[4px]"
                  style={{
                    background: ms > 0
                      ? `color-mix(in srgb, var(--accent) ${Math.max(Math.round(intensity * 92), 16)}%, var(--glass-1))`
                      : 'var(--glass-1)',
                    border: day === mostActive ? '1px solid var(--accent)' : '1px solid transparent',
                  }}
                  title={`Day ${day} — ${formatMs(ms)}`}
                />
              )
            })}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-[9px]" style={{ color: 'var(--text-faint)' }}>
            <CalendarDays size={9} />
            quieter
            {[16, 40, 65, 92].map((p) => (
              <span key={p} className="w-2.5 h-2.5 rounded-[3px]" style={{ background: `color-mix(in srgb, var(--accent) ${p}%, var(--glass-1))` }} />
            ))}
            louder
          </div>
        </div>
      </div>
    </Scene>
  )
}

// ── Completion story: donut + most replayed / most skipped ──────────────────
function CompletionScene({ data }: { data: RewindMonthData }) {
  const done = data.completed
  const skipped = data.skipped
  const partial = Math.max(data.sessions - done - skipped, 0)
  const total = Math.max(data.sessions, 1)
  const R = 52
  const CIRC = 2 * Math.PI * R
  const doneFrac = done / total
  const skipFrac = skipped / total

  return (
    <Scene kicker="How it went">
      <SceneTitle>
        {done > 0
          ? `${Math.round(doneFrac * 100)}% of the time, you stayed till the end.`
          : 'A month of wandering between songs.'}
      </SceneTitle>
      <div className="flex items-center gap-10 flex-wrap">
        <svg width={132} height={132} viewBox="0 0 132 132" data-rewind-donut>
          <circle cx={66} cy={66} r={R} fill="none" stroke="var(--glass-1)" strokeWidth={13} />
          {/* Stacked arcs: completed → skipped → partial remainder */}
          <circle
            cx={66} cy={66} r={R} fill="none" stroke="var(--accent)" strokeWidth={13} strokeLinecap="butt"
            strokeDasharray={`${doneFrac * CIRC} ${CIRC}`} transform="rotate(-90 66 66)"
          />
          <circle
            cx={66} cy={66} r={R} fill="none" stroke="var(--danger)" strokeWidth={13} strokeLinecap="butt"
            strokeDasharray={`${skipFrac * CIRC} ${CIRC}`}
            strokeDashoffset={-doneFrac * CIRC} transform="rotate(-90 66 66)"
          />
          <text x={66} y={63} textAnchor="middle" style={{ fill: 'var(--text-primary)', fontSize: 22, fontWeight: 600, fontFamily: 'var(--font-display)' }}>
            {data.sessions}
          </text>
          <text x={66} y={80} textAnchor="middle" style={{ fill: 'var(--text-faint)', fontSize: 9.5, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            sessions
          </text>
        </svg>
        <div className="space-y-2.5">
          <LegendRow color="var(--accent)" label="Played through" value={done} />
          <LegendRow color="var(--glass-3)" label="Partially heard" value={partial} />
          <LegendRow color="var(--danger)" label="Skipped early" value={skipped} />
        </div>
      </div>
    </Scene>
  )
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5 text-[13px]">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="ml-auto pl-8 tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

// ── Numbers scene: the trivia row ────────────────────────────────────────────
function NumbersScene({ data }: { data: RewindMonthData }) {
  return (
    <Scene kicker="The fine print">
      <div className="grid grid-cols-2 gap-3" data-rewind-numbers>
        <NumberCard icon={<Headphones size={14} />} value={data.uniqueSongs} label="Different songs" />
        <NumberCard icon={<Mic2 size={14} />} value={data.uniqueArtists} label="Different artists" />
        <NumberCard icon={<Disc3 size={14} />} value={data.uniqueAlbums} label="Different albums" />
        <NumberCard
          icon={<Flame size={14} />}
          value={data.longestStreak}
          label={data.longestStreak === 1 ? 'Day streak' : 'Day streak (best run)'}
        />
        <NumberCard
          icon={<Sun size={14} />}
          value={data.mostActiveDay ? ordinal(data.mostActiveDay.day) : '—'}
          label="Most active day"
        />
        <NumberCard
          icon={<MoonStar size={14} />}
          value={data.mostActiveDay ? formatMs(data.mostActiveDay.ms) : '—'}
          label="That day's listening"
        />
      </div>
    </Scene>
  )
}

function NumberCard({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div
      className="p-4 rounded-2xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="flex items-center gap-2 mb-1.5" style={{ color: 'var(--accent)' }}>{icon}</div>
      <p className="text-xl font-semibold tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{value}</p>
      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
    </div>
  )
}

// ── Share card: canvas export ────────────────────────────────────────────────
function ShareCardScene({ data, monthText, busy, setBusy }: {
  data: RewindMonthData
  monthText: string
  busy: boolean
  setBusy: (v: boolean) => void
}) {
  const exportCard = async () => {
    setBusy(true)
    try {
      const canvas = drawShareCard(data, monthText)
      const dataUrl = canvas.toDataURL('image/png')
      const api = (window as unknown as { electronAPI?: { saveImageFile?: (n: string, d: string) => Promise<string | null> } }).electronAPI
      if (api?.saveImageFile) {
        const savedPath = await api.saveImageFile(`Aura-Rewind-${monthText.replace(' ', '-')}.png`, dataUrl)
        if (savedPath) toast({ kind: 'rewind-saved', title: 'Share card saved', subtitle: savedPath })
      } else {
        // Plain-browser fallback (dev/preview): direct download.
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = `Aura-Rewind-${monthText.replace(' ', '-')}.png`
        a.click()
      }
    } catch {
      toast({ kind: 'metadata-updated', title: 'Could not render the card', subtitle: 'Try again' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Scene kicker="Take it with you">
      <div
        className="rounded-3xl p-8 flex flex-col items-center text-center"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
      >
        <p className="text-sm max-w-sm" style={{ color: 'var(--text-secondary)' }}>
          Turn this month into a card — your time, your top song, your month in one image.
          Rendered locally, saved where you choose.
        </p>
        <button
          onClick={exportCard}
          disabled={busy}
          className="mt-6 flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium pressable"
          style={{
            background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)',
          }}
          data-rewind-export
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {busy ? 'Rendering…' : 'Save share card'}
        </button>
      </div>
    </Scene>
  )
}

/**
 * Draws the 1200×630 share card on an offscreen canvas. Only shapes, text,
 * and gradients are drawn — no external images — so the canvas can never be
 * tainted and toDataURL can never throw a SecurityError (the Wave 1 lesson,
 * applied by design).
 */
function drawShareCard(data: RewindMonthData, monthText: string): HTMLCanvasElement {
  const W = 1200, H = 630
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const css = getComputedStyle(document.documentElement)
  const accent = css.getPropertyValue('--accent').trim() || '#7C8CF8'
  const accent2 = css.getPropertyValue('--accent-strong').trim() || accent
  const ink = '#0A0A0F'
  const white = 'rgba(255,255,255,0.92)'
  const dim = 'rgba(255,255,255,0.5)'
  const faint = 'rgba(255,255,255,0.28)'

  // Base
  ctx.fillStyle = ink
  ctx.fillRect(0, 0, W, H)

  // Ambient glows — two radial fields echoing the app's orbs
  const glow = ctx.createRadialGradient(180, 90, 40, 180, 90, 560)
  glow.addColorStop(0, hexToRgba(accent, 0.32))
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  const glow2 = ctx.createRadialGradient(1060, 580, 40, 1060, 580, 500)
  glow2.addColorStop(0, hexToRgba(accent2, 0.2))
  glow2.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow2
  ctx.fillRect(0, 0, W, H)

  // Brand row
  ctx.fillStyle = accent
  roundRect(ctx, 72, 64, 44, 44, 12)
  ctx.fill()
  ctx.fillStyle = ink
  // Mini equalizer glyph
  const bars = [10, 16, 22, 16, 10]
  bars.forEach((h, i) => {
    ctx.fillRect(80 + i * 7, 86 - h / 2, 4, h)
  })
  ctx.fillStyle = faint
  ctx.font = '600 20px Inter, system-ui, sans-serif'
  ctx.fillText('A U R A   R E W I N D', 132, 93)

  // Month kicker
  ctx.fillStyle = dim
  ctx.font = '600 17px Inter, system-ui, sans-serif'
  ctx.fillText(monthText.toUpperCase() + ' — LISTENED LOCALLY, LOUD FOREVER', 72, 178)

  // Big number
  const time = formatListeningTime(data.totalPlayedMs)
  ctx.fillStyle = white
  ctx.font = '700 108px "Geist", Inter, system-ui, sans-serif'
  ctx.fillText(time.value, 66, 300)
  const w = ctx.measureText(time.value).width
  ctx.fillStyle = accent
  ctx.font = '500 40px Inter, system-ui, sans-serif'
  ctx.fillText(time.unit, 78 + w, 300)

  // Divider
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(72, 348, W - 144, 1)

  // Top song / artist / album columns
  const top = data.topSongs[0]
  const artist = data.topArtists[0]
  const album = data.topAlbums[0]
  const colY = 408
  const colW = (W - 144 - 48) / 3
  const cols: { k: string; v: string; label: string }[] = [
    { k: 'SONG OF THE MONTH', v: top ? truncate(top.title, 26) : '—', label: top?.artist ?? '' },
    { k: 'ARTIST OF THE MONTH', v: artist ? truncate(artist.name, 26) : '—', label: artist ? `${artist.plays} plays` : '' },
    { k: 'ALBUM OF THE MONTH', v: album ? truncate(album.name, 26) : '—', label: album?.artist ?? '' },
  ]
  cols.forEach((c, i) => {
    const x = 72 + i * (colW + 24)
    ctx.fillStyle = accent
    ctx.fillRect(x, colY - 26, 26, 3)
    ctx.fillStyle = faint
    ctx.font = '600 13px Inter, system-ui, sans-serif'
    ctx.fillText(c.k, x, colY)
    ctx.fillStyle = white
    ctx.font = '600 27px "Geist", Inter, system-ui, sans-serif'
    ctx.fillText(c.v, x, colY + 38)
    ctx.fillStyle = dim
    ctx.font = '400 17px Inter, system-ui, sans-serif'
    ctx.fillText(c.label, x, colY + 66)
  })

  // Footer
  ctx.fillStyle = faint
  ctx.font = '400 15px Inter, system-ui, sans-serif'
  ctx.fillText(`${data.sessions} sessions · ${data.uniqueSongs} songs · ${formatMs(data.totalPlayedMs)} of listening`, 72, H - 56)

  return canvas
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Accent hex (or any CSS color the browser can parse) → rgba string. */
function hexToRgba(color: string, alpha: number): string {
  const c = document.createElement('canvas').getContext('2d')!
  c.fillStyle = color
  // c.fillStyle is now normalized to #rrggbb (or rgba() for alpha colors)
  const v = c.fillStyle as string
  if (v.startsWith('#')) {
    const n = parseInt(v.slice(1), 16)
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
  }
  return v // already rgba()/color() — good enough for a glow stop
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ── Empty month ──────────────────────────────────────────────────────────────
function EmptyMonth({ onPlay }: { onPlay: () => void }) {
  return (
    <motion.div
      className="pt-24 flex flex-col items-center text-center"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      data-rewind-empty
    >
      <div
        className="w-16 h-16 rounded-3xl flex items-center justify-center mb-6 animate-breathe"
        style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
      >
        <History size={26} style={{ color: 'var(--accent)' }} />
      </div>
      <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        This month is still a blank page
      </h2>
      <p className="text-sm mt-2 max-w-xs" style={{ color: 'var(--text-tertiary)' }}>
        Play something and your story starts writing itself — every session is kept right here on your device.
      </p>
      <button
        onClick={onPlay}
        className="mt-7 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium pressable"
        style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
      >
        <Play size={14} />
        Open Library
      </button>
    </motion.div>
  )
}
