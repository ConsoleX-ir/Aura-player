import { useEffect, useState } from 'react'
import {
  Loader2, ExternalLink, Check, SearchX, Music2, Search, Globe, BadgeCheck,
} from 'lucide-react'
import type { Song, OnlineMatch } from '@/types'
import { usePlayerStore } from '@/store/playerStore'
import { formatTime, cn } from '@/lib/utils'
import { toast } from '@/store/toastStore'

// ── "Find Info Online" (keyless) — Properties page section ──────────────────
// Online metadata lookup against free, keyless sources (Deezer, iTunes/
// Apple Music, MusicBrainz). Text queries only — no audio upload, no API
// token, nothing to sign up for. Candidates are scored against the current
// tags, merged across sources, and shown as a before/after diff; only fields
// the user explicitly ticks get applied.
// Reached from the song "..." menu ("Find Info Online") or the page's tab.

type FindPhase = 'idle' | 'loading' | 'success' | 'error'

interface DiffRow {
  key: 'title' | 'artist' | 'album' | 'year' | 'genre'
  label: string
  current: string | null
  found: string | null
}

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

export function FindInfoPanel({ song, onApplied }: { song: Song; onApplied: () => void }) {
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

  // Fire the first search automatically when the panel opens — unlike the
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
    <div className="space-y-4">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
        Search <span style={{ color: 'var(--text-secondary)' }}>Deezer</span>, <span style={{ color: 'var(--text-secondary)' }}>Apple&nbsp;Music</span> and{' '}
        <span style={{ color: 'var(--text-secondary)' }}>MusicBrainz</span> for the correct info —{' '}
        <span style={{ color: 'var(--text-faint)' }}>free, no account, no API token</span>. Only a text query is sent;
        your files never leave the device, and nothing changes until you apply it.
      </p>

      {/* Search terms — prefilled from the current tags, editable for retries */}
      <div className="flex gap-2">
        <input
          value={queryTitle}
          onChange={(e) => setQueryTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          placeholder="Title"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-ink/5 border border-[var(--color-border)] text-xs text-ink placeholder:text-ink-faint outline-none focus:border-[var(--color-border-mid)]"
        />
        <input
          value={queryArtist}
          onChange={(e) => setQueryArtist(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          placeholder="Artist"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-ink/5 border border-[var(--color-border)] text-xs text-ink placeholder:text-ink-faint outline-none focus:border-[var(--color-border-mid)]"
        />
        <button
          onClick={search}
          disabled={phase === 'loading'}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-ink text-xs transition active:scale-95 disabled:opacity-40 shrink-0"
          style={{ background: 'var(--accent)' }}
        >
          {phase === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          Search
        </button>
      </div>

      {/* Loading state */}
      {phase === 'loading' && (
        <div className="flex flex-col items-center gap-2.5 py-8">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent)' }} />
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Searching Deezer, Apple Music & MusicBrainz…</p>
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && (
        <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'var(--danger-veil)', border: '1px solid var(--danger-border)' }}>
          <SearchX size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
          <p className="text-xs leading-relaxed" style={{ color: 'color-mix(in srgb, var(--danger) 85%, white)' }}>{errorText(findError)}</p>
        </div>
      )}

      {/* Results */}
      {phase === 'success' && (
        candidates.length === 0 ? (
          <div className="flex items-start gap-2 p-3 rounded-xl" style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}>
            <SearchX size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--text-faint)' }} />
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              No matches found. Tweak the search terms above and try again — the more of the title and artist is right, the better the matches.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--accent)' }}>
              <BadgeCheck size={14} />
              {candidates.length} match{candidates.length === 1 ? '' : 'es'} found
              <span className="font-normal" style={{ color: 'var(--text-faint)' }}>— pick one, review below</span>
            </div>

            {/* Candidate list */}
            <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
              {candidates.map((c, i) => (
                <button
                  key={`${c.title}-${c.artist}-${i}`}
                  onClick={() => { setSelIdx(i); setSelected({ title: true, artist: true, album: true, year: true, genre: true, artwork: true }) }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-[var(--color-border)] last:border-b-0',
                    i === selIdx ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.03]'
                  )}
                >
                  {/* selection rail */}
                  <span
                    className="w-0.5 self-stretch rounded-full shrink-0 -my-2.5"
                    style={{ background: i === selIdx ? 'var(--accent)' : 'transparent' }}
                  />
                  <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-black/30 flex items-center justify-center">
                    {c.artworkUrl
                      ? <img src={c.artworkUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      : <Music2 size={12} className="text-ink-faint" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                      <span className="truncate">{c.title ?? 'Unknown title'}</span>
                      {i === 0 && (
                        <span
                          className="shrink-0 px-1.5 py-px rounded-full text-[9px] font-medium"
                          style={{ background: 'var(--accent-veil)', color: 'var(--accent)' }}
                        >
                          BEST
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>
                      {c.artist ?? 'Unknown artist'}
                      {c.album ? ` — ${c.album}` : ''}
                      {c.year ? ` · ${c.year}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{c.durationSec ? formatTime(c.durationSec) : ''}</span>
                    <div className="flex items-center gap-1">
                      {c.sources.map((src) => (
                        <span
                          key={src}
                          className="px-1.5 py-px rounded-md bg-ink/[0.05] border border-[var(--color-border)] text-[9px]"
                          style={{ color: 'var(--text-tertiary)' }}
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
              <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}>
                <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 bg-black/30">
                  <img src={cand.artworkUrl} alt="" className="w-full h-full object-cover" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <DiffCheckbox
                    checked={selected.artwork}
                    onChange={(v) => setSelected({ ...selected, artwork: v })}
                  />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Apply album art</span>
                  {!song.coverArt && <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>(fills the missing art)</span>}
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
                className="px-4 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] text-xs transition"
                style={{ color: 'var(--text-secondary)' }}
              >
                Discard
              </button>
              <button
                onClick={apply}
                disabled={applying || nothingToApply}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-ink text-xs transition active:scale-95 disabled:opacity-30"
                style={{ background: 'var(--accent)' }}
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
                Apply Selected
              </button>
            </div>
          </div>
        )
      )}

      {/* Keyless reassurance footer */}
      <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>
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

function DiffCheckbox({ checked, onChange, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      /* v2.1.0: unchecked border was hardcoded white-alpha — invisible over
         light paper. Token borders now read in both themes. */
      className={cn(
        'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all',
        checked ? 'text-ink' : 'border-[var(--border-emphasis)] text-transparent hover:border-[var(--accent-border)]',
        disabled && 'opacity-30 cursor-not-allowed'
      )}
      style={checked ? { background: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
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
    <div className={cn('flex items-center gap-3 px-3 py-2.5 border-b border-[var(--color-border)] last:border-b-0', index % 2 === 1 && 'bg-ink/[0.02]')}>
      {unchanged ? (
        <div className="w-4 shrink-0" />
      ) : (
        <DiffCheckbox checked={checked} onChange={onToggle} />
      )}
      <span className="text-[11px] w-12 shrink-0" style={{ color: 'var(--text-tertiary)' }}>{row.label}</span>
      <div className="flex-1 min-w-0 text-xs">
        <p className="line-through truncate" style={{ color: 'var(--text-faint)' }}>{row.current ?? '—'}</p>
        <p className="truncate" style={{ color: unchanged ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>{row.found ?? '—'}</p>
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
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-glass)] border border-[var(--color-border)] text-[11px] transition-colors"
      style={{ color: 'var(--text-secondary)' }}
    >
      <ExternalLink size={10} />
      {label}
    </a>
  )
}
