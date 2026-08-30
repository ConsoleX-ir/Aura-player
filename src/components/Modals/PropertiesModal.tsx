import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X, Info, Sparkles, FolderOpen, Loader2, ExternalLink, Check,
  SearchX, Heart, Music2, Search, Globe, BadgeCheck,
} from 'lucide-react'
import type { Song, OnlineMatch, SongFileStats } from '@/types'
import { usePlayerStore } from '@/store/playerStore'
import { formatTime, formatBytes, cn } from '@/lib/utils'
import { toast } from '@/store/toastStore'

// ── Song Properties + "Find Info Online" (keyless) ──────────────────────────
// Two tabs in one dialog:
//   Info — song tags, technical file stats (fetched on demand via IPC), path.
//   Find — online metadata lookup against free, keyless sources (Deezer,
//          iTunes/Apple Music, MusicBrainz). Text queries only — no audio
//          upload, no API token, nothing to sign up for. Candidates are
//          scored against the current tags, merged across sources, and shown
//          as a before/after diff; only fields the user explicitly ticks get
//          applied.
// Opened from the "..." menu on any song row ("Properties" / "Find Info Online").

interface PropertiesModalProps {
  song: Song
  open: boolean
  /** Open directly on the Find tab (via the "Find Info Online" menu item). */
  initialFind?: boolean
  onClose: () => void
}

type FindPhase = 'idle' | 'loading' | 'success' | 'error'

interface DiffRow {
  key: 'title' | 'artist' | 'album' | 'year' | 'genre'
  label: string
  current: string | null
  found: string | null
}

export function PropertiesModal({ song, open, initialFind = false, onClose }: PropertiesModalProps) {
  const [tab, setTab] = useState<'info' | 'find'>(initialFind ? 'find' : 'info')

  // Every open starts on the right tab — a new song (or a new menu entry)
  // must not inherit the previous dialog's tab choice.
  useEffect(() => {
    if (open) setTab(initialFind ? 'find' : 'info')
  }, [open, initialFind, song.id])

  // Escape closes — same contract as every other dialog in Aura.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // ── shared store reads ──
  const playlists = usePlayerStore((s) => s.playlists)
  const favorites = usePlayerStore((s) => s.favorites)

  const isFav = favorites.includes(song.id)
  const inPlaylists = playlists.filter((p) => p.songIds.includes(song.id))

  // ── Info tab: technical stats, fetched only while the dialog is open ──
  const [stats, setStats] = useState<SongFileStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setStatsLoading(true)
    window.electronAPI?.getFileStats(song.path)
      .then((s) => { if (!cancelled) setStats(s) })
      .catch(() => { /* stats stay null → the dialog shows dashes */ })
      .finally(() => { if (!cancelled) setStatsLoading(false) })
    return () => { cancelled = true }
  }, [open, song.path])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-3xl border border-[var(--color-border-mid)] bg-[var(--color-base-2)] shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center gap-3 p-5 border-b border-[var(--color-border)] shrink-0">
                <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 bg-[var(--color-glass-mid)] flex items-center justify-center">
                  {song.coverArt
                    ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" />
                    : <Sparkles size={16} className="text-white/20" />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold text-white/90 truncate" style={{ fontFamily: 'var(--font-display)' }}>
                    {song.title}
                  </h2>
                  <p className="text-xs text-white/35 truncate">{song.artist}</p>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 transition shrink-0">
                  <X size={16} className="text-white/35" />
                </button>
              </div>

              {/* Tab switcher */}
              <div className="flex gap-1 px-5 pt-4 shrink-0">
                <TabButton active={tab === 'info'} icon={Info} label="Properties" onClick={() => setTab('info')} />
                <TabButton active={tab === 'find'} icon={Sparkles} label="Find Info Online" onClick={() => setTab('find')} />
              </div>

              {/* Body — both tab bodies stay mounted (hidden, not unmounted) so
                  search results and ticked boxes survive switching back and forth.
                  key={song.id} guarantees a different song starts totally fresh. */}
              <div className="overflow-y-auto p-5">
                <div className={cn(tab !== 'info' && 'hidden')}>
                  <div className="space-y-5">
                    <Section title="Details">
                      <Row label="Title"  value={song.title} />
                      <Row label="Artist" value={song.artist} />
                      <Row label="Album"  value={song.album} />
                      <Row label="Year"   value={song.year ? song.year.toString() : null} />
                      <Row label="Genre"  value={song.genre ?? null} />
                      <Row label="Track"  value={song.trackNumber ? song.trackNumber.toString() : null} />
                      <Row label="Duration" value={formatTime(song.duration)} />
                      <Row
                        label="Favorite"
                        value={isFav ? 'Yes' : 'No'}
                        custom={isFav ? <Heart size={11} className="text-red-400 inline" fill="currentColor" /> : undefined}
                      />
                      <Row
                        label="Playlists"
                        value={inPlaylists.length ? inPlaylists.map((p) => p.name).join(', ') : null}
                      />
                    </Section>

                    <Section title="File">
                      {statsLoading && !stats ? (
                        <div className="flex items-center gap-2 py-3 text-white/30 text-xs">
                          <Loader2 size={12} className="animate-spin" /> Reading file properties…
                        </div>
                      ) : (
                        <>
                          <Row
                            label="Format"
                            value={
                              stats
                                ? [stats.extension.replace('.', '').toUpperCase(), stats.codec, stats.container].filter(Boolean).join(' · ') || null
                                : null
                            }
                          />
                          <Row label="Size"        value={stats ? formatBytes(stats.sizeBytes) : null} />
                          <Row label="Bitrate"     value={stats?.bitrateKbps ? `${stats.bitrateKbps} kbps` : null} />
                          <Row label="Sample Rate" value={stats?.sampleRateHz ? `${(stats.sampleRateHz / 1000).toFixed(1)} kHz` : null} />
                          <Row label="Channels"    value={stats?.channels ? stats.channels === 2 ? 'Stereo' : stats.channels === 1 ? 'Mono' : stats.channels.toString() : null} />
                        </>
                      )}
                      <Row label="Path" value={song.path} mono />
                      <button
                        onClick={() => window.electronAPI?.showItemInFolder(song.path)}
                        className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-glass)] border border-[var(--color-border)] text-white/60 hover:text-white/90 text-xs active:scale-95 transition-all"
                      >
                        <FolderOpen size={12} />
                        Show in Folder
                      </button>
                    </Section>
                  </div>
                </div>

                <FindTab key={song.id} song={song} hidden={tab !== 'find'} onApplied={() => setTab('info')} />
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Find tab — keyless online lookup (self-contained child component) ───────

const SOURCE_LABELS: Record<string, string> = {
  deezer: 'Deezer',
  itunes: 'Apple Music',
  musicbrainz: 'MusicBrainz',
}

// Strip junk from the tag before using it as a search term — "(feat. X)",
// "[Official Video]", site-watermark suffixes — so bad tags still find the
// right song. Mirrors cleanField in useLyrics.ts.
function cleanSearchTerm(raw: string): string {
  return raw
    .replace(/\s+[A-Z0-9]{3,}\.[A-Z]{2,4}$/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function FindTab({
  song, hidden, onApplied,
}: {
  song: Song
  hidden: boolean
  onApplied: () => void
}) {
  const updateSongs = usePlayerStore((s) => s.updateSongs)

  // Editable search terms, prefilled from the song's (possibly wrong) tags —
  // cleaned so junk suffixes don't poison the query.
  const [queryTitle, setQueryTitle]   = useState(cleanSearchTerm(song.title))
  const [queryArtist, setQueryArtist] = useState(cleanSearchTerm(song.artist))

  const [phase, setPhase] = useState<FindPhase>('idle')
  const [candidates, setCandidates] = useState<OnlineMatch[]>([])
  const [selIdx, setSelIdx] = useState(0)
  const [findError, setFindError] = useState<string | null>(null)
  // Per-field "apply this" checkboxes — all default on, and every box is
  // re-enabled whenever a new candidate is selected.
  const [selected, setSelected] = useState({ title: true, artist: true, album: true, year: true, genre: true, artwork: true })
  const [applying, setApplying] = useState(false)

  const search = async () => {
    setPhase('loading')
    setFindError(null)
    try {
      const result = await window.electronAPI?.findMetadata({
        title: queryTitle,
        artist: queryArtist,
        album: song.album ?? '',
        duration: song.duration ?? 0,
      })
      if (!result) { setPhase('error'); setFindError('network_error'); return }
      if (result.ok) {
        setCandidates(result.candidates)
        setSelIdx(0)
        setSelected({ title: true, artist: true, album: true, year: true, genre: true, artwork: true })
        setPhase('success')
      } else {
        setPhase('error')
        setFindError(result.error)
      }
    } catch {
      setPhase('error')
      setFindError('network_error')
    }
  }

  // Fire the first search automatically when the dialog opens — unlike the
  // old AudD flow there is nothing sensitive here (a text query, no audio),
  // so waiting for a click would only add friction.
  useEffect(() => {
    search()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cand: OnlineMatch | null = candidates[selIdx] ?? null

  const diffRows: DiffRow[] = cand ? [
    { key: 'title',  label: 'Title',  current: song.title,  found: cand.title },
    { key: 'artist', label: 'Artist', current: song.artist, found: cand.artist },
    { key: 'album',  label: 'Album',  current: song.album,  found: cand.album },
    { key: 'year',   label: 'Year',   current: song.year?.toString() ?? null, found: cand.year ? cand.year.toString() : null },
    { key: 'genre',  label: 'Genre',  current: song.genre ?? null, found: cand.genre },
  ] : []

  // A row is "applicable" when the candidate has a value AND it differs from
  // what the library currently holds. Unchanged rows render without a checkbox.
  const isApplicable = (r: DiffRow) => !!r.found && r.found !== r.current

  const nothingToApply = cand
    ? !diffRows.some((r) => isApplicable(r) && selected[r.key]) && !(selected.artwork && !!cand.artworkUrl)
    : true

  const apply = async () => {
    if (!cand) return
    setApplying(true)
    try {
      let coverArt = song.coverArt
      // Artwork goes through the main process so it lands in the same disk
      // cache as embedded covers — persistent and served via aura://.
      if (selected.artwork && cand.artworkUrl) {
        const cached = await window.electronAPI?.cacheArtwork(cand.artworkUrl)
        if (cached) coverArt = cached
      }
      updateSongs([{
        ...song,
        title:  selected.title  && cand.title  ? cand.title  : song.title,
        artist: selected.artist && cand.artist ? cand.artist : song.artist,
        album:  selected.album  && cand.album  ? cand.album  : song.album,
        year:   selected.year   && cand.year   ? cand.year   : song.year,
        genre:  selected.genre  && cand.genre  ? cand.genre  : song.genre,
        coverArt,
      }])
      toast({ kind: 'metadata-updated', title: 'Metadata Updated', subtitle: cand.title ?? song.title })
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  const errorText = (err: string | null) => {
    if (!err) return 'Something went wrong. Please try again.'
    if (err === 'empty_query')   return 'Type a title or artist to search for.'
    if (err === 'network_error') return 'Couldn\u2019t reach Deezer, Apple Music, or MusicBrainz. Check your connection and try again.'
    if (err.startsWith('http_')) return `A music service returned an HTTP error (${err.slice(5)}). Try again in a moment.`
    return `Search error: ${err}`
  }

  return (
    <div className={cn('space-y-4', hidden && 'hidden')}>
      <p className="text-xs text-white/40 leading-relaxed">
        Search <span className="text-white/70">Deezer</span>, <span className="text-white/70">Apple&nbsp;Music</span> and{' '}
        <span className="text-white/70">MusicBrainz</span> for the correct info —{' '}
        <span className="text-white/55">free, no account, no API token</span>. Only a text query is sent;
        your files never leave the device, and nothing changes until you apply it.
      </p>

      {/* Search terms — prefilled from the current tags, editable for retries */}
      <div className="flex gap-2">
        <input
          value={queryTitle}
          onChange={(e) => setQueryTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          placeholder="Title"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/20 border border-[var(--color-border)] text-xs text-white/80 placeholder:text-white/20 outline-none focus:border-[var(--color-border-mid)]"
        />
        <input
          value={queryArtist}
          onChange={(e) => setQueryArtist(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          placeholder="Artist"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/20 border border-[var(--color-border)] text-xs text-white/80 placeholder:text-white/20 outline-none focus:border-[var(--color-border-mid)]"
        />
        <button
          onClick={search}
          disabled={phase === 'loading'}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-white text-xs transition active:scale-95 disabled:opacity-40 shrink-0"
          style={{ background: 'var(--color-dynamic-1)' }}
        >
          {phase === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Search
        </button>
      </div>

      {/* Loading state */}
      {phase === 'loading' && (
        <div className="flex flex-col items-center gap-2.5 py-6">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-dynamic-1)' }} />
          <p className="text-xs text-white/40">Searching Deezer, Apple Music & MusicBrainz…</p>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <SearchX size={13} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300/90 leading-relaxed">{errorText(findError)}</p>
        </div>
      )}

      {/* Results */}
      {phase === 'success' && (
        candidates.length === 0 ? (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)]">
            <SearchX size={13} className="text-white/30 mt-0.5 shrink-0" />
            <p className="text-xs text-white/50 leading-relaxed">
              No matches found. Tweak the search terms above and try again — the more of the title and artist is right, the better the matches.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--color-dynamic-1)' }}>
              <BadgeCheck size={14} />
              {candidates.length} match{candidates.length === 1 ? '' : 'es'} found
              <span className="text-white/25 font-normal">— pick one, review below</span>
            </div>

            {/* Candidate list */}
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              {candidates.map((c, i) => (
                <button
                  key={`${c.title}-${c.artist}-${i}`}
                  onClick={() => { setSelIdx(i); setSelected({ title: true, artist: true, album: true, year: true, genre: true, artwork: true }) }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-[var(--color-border)] last:border-b-0',
                    i === selIdx ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                  )}
                >
                  {/* selection rail */}
                  <span
                    className="w-0.5 self-stretch rounded-full shrink-0 -my-2.5"
                    style={{ background: i === selIdx ? 'var(--color-dynamic-1)' : 'transparent' }}
                  />
                  <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-black/30 flex items-center justify-center">
                    {c.artworkUrl
                      ? <img src={c.artworkUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      : <Music2 size={12} className="text-white/20" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white/85 truncate flex items-center gap-1.5">
                      <span className="truncate">{c.title ?? 'Unknown title'}</span>
                      {i === 0 && (
                        <span
                          className="shrink-0 px-1.5 py-px rounded-full text-[9px] font-medium"
                          style={{ background: 'var(--color-dynamic-3)', color: 'var(--color-dynamic-1)' }}
                        >
                          BEST
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-white/30 truncate">
                      {c.artist ?? 'Unknown artist'}
                      {c.album ? ` — ${c.album}` : ''}
                      {c.year ? ` · ${c.year}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-[10px] text-white/20 tabular-nums">{c.durationSec ? formatTime(c.durationSec) : ''}</span>
                    <div className="flex items-center gap-1">
                      {c.sources.map((src) => (
                        <span
                          key={src}
                          className="px-1.5 py-px rounded-md bg-white/[0.06] border border-[var(--color-border)] text-[9px] text-white/40"
                        >
                          {SOURCE_LABELS[src] ?? src}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Artwork preview + apply toggle */}
            {cand?.artworkUrl && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)]">
                <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-black/30">
                  <img src={cand.artworkUrl} alt="" className="w-full h-full object-cover" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <DiffCheckbox
                    checked={selected.artwork}
                    onChange={(v) => setSelected({ ...selected, artwork: v })}
                  />
                  <span className="text-xs text-white/70">Apply album art</span>
                  {!song.coverArt && <span className="text-[10px] text-white/25">(fills the missing art)</span>}
                </label>
              </div>
            )}

            {/* Tag diff for the selected candidate */}
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              {diffRows.map((row, i) => (
                <DiffRowView
                  key={row.key}
                  row={row}
                  index={i}
                  checked={selected[row.key]}
                  onToggle={(v) => setSelected({ ...selected, [row.key]: v })}
                />
              ))}
            </div>

            {/* Source page links for the selected candidate */}
            {cand && cand.links.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {cand.links.slice(0, 3).map((url) => (
                  <LinkChip key={url} href={url} label={labelForLink(url)} />
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setCandidates([]); setPhase('idle') }}
                className="px-4 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] text-white/60 hover:text-white text-xs transition"
              >
                Discard
              </button>
              <button
                onClick={apply}
                disabled={applying || nothingToApply}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-white text-xs transition active:scale-95 disabled:opacity-30"
                style={{ background: 'var(--color-dynamic-1)' }}
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
                Apply Selected
              </button>
            </div>
          </div>
        )
      )}

      {/* Keyless reassurance footer */}
      <div className="flex items-center gap-1.5 text-[10px] text-white/20">
        <Globe size={10} />
        No API key needed — lookups use each service's free public search API.
      </div>
    </div>
  )
}

// Human label for a candidate's page link, from its hostname.
function labelForLink(url: string): string {
  try {
    const host = new URL(url).hostname
    if (host.includes('deezer')) return 'Deezer'
    if (host.includes('apple'))  return 'Apple Music'
    if (host.includes('musicbrainz')) return 'MusicBrainz'
    if (host.includes('spotify')) return 'Spotify'
    return host.replace('www.', '')
  } catch {
    return 'Link'
  }
}

// ── Small presentational helpers ──

function TabButton({ active, icon: Icon, label, onClick }: {
  active: boolean; icon: typeof Info; label: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all',
        active ? 'text-white' : 'text-white/35 hover:text-white/60'
      )}
      style={active ? { background: 'var(--color-glass-mid)' } : undefined}
    >
      <Icon size={12} />
      {label}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/25 mb-2">{title}</h3>
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, mono, custom }: { label: string; value: string | null; mono?: boolean; custom?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-2 border-b border-[var(--color-border)] last:border-b-0">
      <span className="text-xs text-white/30 shrink-0 pt-0.5">{label}</span>
      <span className={cn('text-xs text-white/75 text-right break-all min-w-0', mono && 'font-mono text-[11px]')}>
        {value ?? <span className="text-white/20">—</span>}
        {custom}
      </span>
    </div>
  )
}

function DiffCheckbox({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all',
        checked ? 'text-white' : 'border-white/25 text-transparent hover:border-white/50',
        disabled && 'opacity-30 cursor-not-allowed'
      )}
      style={checked ? { background: 'var(--color-dynamic-1)', borderColor: 'var(--color-dynamic-1)' } : undefined}
    >
      <Check size={10} strokeWidth={3.5} />
    </button>
  )
}

function DiffRowView({ row, index, checked, onToggle }: {
  row: DiffRow; index: number; checked: boolean; onToggle: (v: boolean) => void
}) {
  const unchanged = !row.found || row.found === row.current
  return (
    <div className={cn('flex items-center gap-3 px-3 py-2.5 border-b border-[var(--color-border)] last:border-b-0', index % 2 === 1 && 'bg-white/[0.015]')}>
      {unchanged ? (
        <div className="w-4 shrink-0" />
      ) : (
        <DiffCheckbox checked={checked} onChange={onToggle} />
      )}
      <span className="text-[11px] text-white/30 w-12 shrink-0">{row.label}</span>
      <div className="flex-1 min-w-0 text-xs">
        <p className="text-white/35 line-through truncate">{row.current ?? '—'}</p>
        <p className={cn('truncate', unchanged ? 'text-white/50' : 'text-white/85')}>{row.found ?? '—'}</p>
      </div>
    </div>
  )
}

function LinkChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-glass)] border border-[var(--color-border)] text-white/50 hover:text-white/85 hover:bg-[var(--color-glass-mid)] text-[11px] transition-colors"
    >
      <ExternalLink size={10} />
      {label}
    </a>
  )
}
