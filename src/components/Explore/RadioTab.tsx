import { useCallback, useEffect, useRef, useState } from 'react'
import { Radio, Heart, Search, Play, Pause, Signal } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useRadioStore, type RadioStation } from '@/store/radioStore'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { searchStations, countries, languages, tags, clickStation, toStationSong, type RadioFacet } from '@/services/providers/radiobrowser'
import { ProviderError } from '@/services/providers/types'
import { cn } from '@/lib/utils'
import { TrackListSkeleton, ErrorBlock, Section } from '@/pages/Explore'

// ── Radio tab (Phase 5 — Radio Browser) ─────────────────────────────────────
// Live-station discovery: name search + Country / Language / Genre facets
// (real facet endpoints, cached in main), dead stations filtered at the
// source (hidebroken=true), popularity by community votes. Favorites live in
// the persisted radioStore (full station snapshots — they render offline and
// survive restarts through the same Wave 0 shutdown flush).
//
// Playing: the station becomes a one-item queue of a live Song — duration 0
// (progress idles, seek is a no-op), streamCors:false so the engine drops its
// CORS mode and the stream can actually load. A citizenship click-ping fires
// fire-and-forget. If a station's stream is dead anyway, the playback-error
// toast names it and the one-item queue means no skip storm.

type FacetKey = 'country' | 'language' | 'tag'

export function RadioTab() {
  const { online, recheck } = useOnlineStatus()
  const favorites = useRadioStore((s) => s.favorites)

  const [name, setName] = useState('')
  const [facets, setFacets] = useState<{ country: RadioFacet[]; language: RadioFacet[]; tag: RadioFacet[] }>({ country: [], language: [], tag: [] })
  const [active, setActive] = useState<{ country?: string; language?: string; tag?: string }>({})
  const [stations, setStations] = useState<RadioStation[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'empty' | 'error' | 'offline'>('idle')
  const [errKind, setErrKind] = useState('')
  const [errMessage, setErrMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // Facets once per online session; failures leave the dropdowns empty but
  // never break the tab (name search still works).
  useEffect(() => {
    if (!online) return
    const ac = new AbortController()
    Promise.all([
      countries({ signal: ac.signal }).catch(() => ({ facets: [] as RadioFacet[] })),
      languages({ signal: ac.signal }).catch(() => ({ facets: [] as RadioFacet[] })),
      tags({ signal: ac.signal }).catch(() => ({ facets: [] as RadioFacet[] })),
    ]).then(([c, l, t]) => {
      if (ac.signal.aborted) return
      setFacets({ country: c.facets, language: l.facets, tag: t.facets })
    })
    return () => ac.abort()
  }, [online])

  const load = useCallback((q: { name: string } & { country?: string; language?: string; tag?: string }) => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setState('loading')
    searchStations({ ...q, limit: 60, order: 'votes' }, { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return
        setStations(r.stations)
        setState(r.stations.length === 0 ? 'empty' : 'done')
      })
      .catch((e) => {
        if (ac.signal.aborted) return
        setState('error')
        setErrKind(e instanceof ProviderError ? e.kind : 'network')
        setErrMessage(e instanceof Error ? e.message : 'Search failed')
      })
  }, [])

  // First load / recovery from offline.
  useEffect(() => {
    if (online) {
      if (state === 'idle' || state === 'offline') load({ name: '' })
    } else {
      abortRef.current?.abort()
      setState('offline')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // Debounce name typing; facet changes apply immediately.
  useEffect(() => {
    if (!online) return
    const t = setTimeout(() => {
      load({ name, ...active })
    }, name ? 350 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, active.country, active.language, active.tag, online])

  const clearFacet = (key: FacetKey) => {
    setActive((a) => {
      const next = { ...a }
      delete next[key]
      return next
    })
  }

  const facetConfigs: { key: FacetKey; label: string; options: RadioFacet[] }[] = [
    { key: 'country', label: 'Country', options: facets.country },
    { key: 'language', label: 'Language', options: facets.language },
    { key: 'tag', label: 'Genre', options: facets.tag },
  ]

  return (
    <div>
      {/* Search + facets */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            type="text"
            placeholder={online ? 'Search stations by name…' : 'Go online to browse radio'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!online}
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm outline-none transition-all disabled:opacity-50"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
            aria-label="Search radio stations"
          />
        </div>
        {facetConfigs.map(({ key, label, options }) => (
          <FacetDropdown
            key={key}
            label={label}
            options={options}
            active={active[key]}
            disabled={!online}
            onSelect={(v) => setActive((a) => ({ ...a, [key]: v ?? undefined }))}
            onClear={() => clearFacet(key)}
          />
        ))}
      </div>

      {/* Favorites (persisted — render offline too) */}
      {favorites.length > 0 && (
        <div className="mb-5">
          <Section title={`Radio favorites (${favorites.length})`} icon={<Heart size={11} />}>
            <StationList stations={favorites} />
          </Section>
          <div className="h-5" />
        </div>
      )}

      {/* Results */}
      {state === 'offline' ? (
        <p className="text-xs py-8 text-center" style={{ color: 'var(--text-faint)' }}>
          Radio browsing needs an internet connection. Your favorites above still work if the station itself is up.
        </p>
      ) : state === 'loading' || state === 'idle' ? (
        <TrackListSkeleton />
      ) : state === 'error' ? (
        <ErrorBlock kind={errKind} message={errMessage} onRetry={recheck} />
      ) : state === 'empty' ? (
        <p className="text-xs py-8 text-center" style={{ color: 'var(--text-faint)' }}>
          No stations match — try fewer filters or another name.
        </p>
      ) : (
        <StationList stations={stations.filter((s) => s.isStreamable)} />
      )}
    </div>
  )
}

// ── Facet dropdown (compact popover with counts) ────────────────────────────

function FacetDropdown({ label, options, active, disabled, onSelect, onClear }: {
  label: string
  options: RadioFacet[]
  active?: string
  disabled?: boolean
  onSelect: (value: string | null) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-40"
        style={{
          background: active ? 'var(--accent-dim)' : 'var(--glass-1)',
          border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border-default)'}`,
          color: active ? 'var(--accent)' : 'var(--text-secondary)',
        }}
        title={`Filter by ${label.toLowerCase()}`}
        aria-expanded={open}
      >
        <span className="max-w-20 truncate">{active ?? label}</span>
        {active && (
          <span
            role="button"
            aria-label={`Clear ${label} filter`}
            onClick={(e) => { e.stopPropagation(); onClear(); setOpen(false) }}
            className="hover:opacity-70 text-[10px]"
          >
            ✕
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 min-w-48 max-h-64 overflow-y-auto p-1 rounded-xl text-sm right-0"
          style={{ background: 'var(--surface-chrome)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-overlay)' }}
        >
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          )}
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onSelect(o.value === active ? null : o.value); setOpen(false) }}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors text-left"
              style={{ color: active === o.value ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <span className="truncate">{o.label}</span>
              <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--text-faint)' }}>{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Station rows ─────────────────────────────────────────────────────────────

function StationList({ stations }: { stations: RadioStation[] }) {
  const playSong = usePlayerStore((s) => s.playSong)
  const currentSongId = usePlayerStore((s) => s.currentSong?.id)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const favorites = useRadioStore((s) => s.favorites)
  const toggleFavorite = useRadioStore((s) => s.toggleFavorite)

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
      {stations.map((station, i) => {
        const song = toStationSong(station)
        const isActive = currentSongId === song.id
        const playable = station.isStreamable && !!station.streamUrl
        const isFav = favorites.some((f) => f.id === station.id)
        return (
          <div
            key={`${station.id}-${i}`}
            tabIndex={playable ? 0 : -1}
            aria-disabled={!playable}
            onKeyDown={(e) => {
              if (playable && e.key === 'Enter') {
                e.preventDefault()
                playSong(song, [song])
                clickStation(station.id)
              }
            }}
            className={cn(
              'group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
              i > 0 && 'border-t',
              !playable && 'opacity-45 cursor-not-allowed',
            )}
            style={{ borderTopColor: 'var(--border-subtle)', background: isActive ? 'var(--accent-dim)' : undefined }}
            onClick={() => {
              if (!playable) return
              playSong(song, [song])
              clickStation(station.id)
            }}
            title={playable ? `Play ${station.title}` : 'This station is not reachable right now'}
          >
            <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden flex items-center justify-center" style={{ background: 'var(--glass-2)' }}>
              {station.artworkUrl
                ? <img src={station.artworkUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                : <Radio size={13} style={{ color: 'var(--text-faint)' }} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" style={{ color: isActive ? 'var(--accent)' : 'var(--text-primary)', fontWeight: isActive ? 500 : 400 }}>
                {station.title}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                {station.artist || 'Unknown country'}
                {station.subtitle ? <span style={{ color: 'var(--text-faint)' }}> · {station.subtitle}</span> : null}
              </p>
            </div>
            {!!station.votes && (
              <span className="hidden md:flex items-center gap-1 text-[10px] tabular-nums shrink-0" style={{ color: 'var(--text-faint)' }} title={`${station.votes} votes`}>
                <Signal size={9} />
                {station.votes}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); toggleFavorite(station) }}
              aria-label={isFav ? `Remove ${station.title} from radio favorites` : `Add ${station.title} to radio favorites`}
              className="p-1.5 rounded-lg shrink-0 transition-all"
              style={{ color: isFav ? 'var(--favorite)' : 'var(--text-faint)' }}
              onMouseEnter={(e) => { if (!isFav) e.currentTarget.style.color = 'var(--favorite)' }}
              onMouseLeave={(e) => { if (!isFav) e.currentTarget.style.color = 'var(--text-faint)' }}
            >
              <Heart size={13} fill={isFav ? 'currentColor' : 'none'} />
            </button>
            <div className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center" style={{ background: isActive && isPlaying ? 'var(--accent-veil)' : 'var(--glass-2)' }}>
              {isActive && isPlaying
                ? <Pause size={11} style={{ color: 'var(--accent)' }} />
                : <Play size={11} style={{ color: playable ? 'var(--text-secondary)' : 'var(--text-faint)' }} fill="currentColor" />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
