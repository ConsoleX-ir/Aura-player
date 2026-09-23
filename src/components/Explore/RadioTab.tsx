import { useCallback, useEffect, useRef, useState } from 'react'
import { Heart, Search } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useRadioStore, type RadioStation } from '@/store/radioStore'
import { searchStations, countries, languages, tags, type RadioFacet } from '@/services/providers/radiobrowser'
import { toPayload, Section, TrackListSkeleton, ErrorBlock } from './ExploreStates'
import { RadioFilters } from './RadioFilters'
import { StationList } from './StationList'

// ── Radio tab (Phase 5 — Radio Browser; v2.16.1 architecture pass) ──────────
// Live-station discovery: name search + Country / Language / Genre facets
// (real facet endpoints, cached in main AND in the renderer dedupe layer),
// dead stations filtered at the source (hidebroken=true), popularity by
// community votes. Favorites live in the persisted radioStore (full station
// snapshots — they render offline and survive restarts through the same
// Wave 0 shutdown flush).
//
// v2.16.1 fixes:
//   • Retry now RE-ISSUES the failed station search (it used to only probe
//     connectivity — a successful probe left the error stuck on screen).
//   • In-flight search is aborted on unmount.
//   • Facet lists ride the 10-minute TTL cache — reopening the tab no
//     longer refetches them.
//
// Playing: the station becomes a one-item queue of a live Song — duration 0
// (progress idles, seek is a no-op), streamCors:false so the engine drops its
// CORS mode and the stream can actually load. A citizenship click-ping fires
// fire-and-forget. If a station's stream is dead anyway, the playback-error
// toast names it and the one-item queue means no skip storm.

type FacetKey = 'country' | 'language' | 'tag'

type RadioState = 'idle' | 'loading' | 'done' | 'empty' | 'error' | 'offline'

export function RadioTab() {
  const { online, recheck } = useOnlineStatus()
  const favorites = useRadioStore((s) => s.favorites)

  const [name, setName] = useState('')
  const [facets, setFacets] = useState<{ country: RadioFacet[]; language: RadioFacet[]; tag: RadioFacet[] }>({ country: [], language: [], tag: [] })
  const [active, setActive] = useState<{ country?: string; language?: string; tag?: string }>({})
  const [stations, setStations] = useState<RadioStation[]>([])
  const [state, setState] = useState<RadioState>('idle')
  const [errState, setErrState] = useState<{ kind: string; message: string }>({ kind: 'network', message: '' })
  const abortRef = useRef<AbortController | null>(null)

  // Every search carries the CURRENT name+facets; retry re-issues it verbatim.
  const queryRef = useRef<{ name: string; country?: string; language?: string; tag?: string }>({ name: '' })
  queryRef.current = { name, ...active }

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
        setErrState(toPayload(e))
        setState('error')
      })
  }, [])

  // Facets once per online session (dedupe layer makes remounts free);
  // failures leave the dropdowns empty but never break the tab.
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

  // Leaving the tab cancels any station search still in flight.
  useEffect(() => () => abortRef.current?.abort(), [])

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

  const retrySearch = () => {
    // Re-issue the actual failed request (v2.16.1 fix). If the machine is
    // also suspected offline, refresh the probe too — but the retry no
    // longer DEPENDS on it.
    if (errState.kind === 'offline') recheck()
    load(queryRef.current)
  }

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
        <RadioFilters
          configs={facetConfigs}
          active={active}
          disabled={!online}
          onSelect={(key, value) => setActive((a) => ({ ...a, [key]: value ?? undefined }))}
          onClear={clearFacet}
        />
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
        <ErrorBlock kind={errState.kind} message={errState.message} onRetry={retrySearch} />
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
