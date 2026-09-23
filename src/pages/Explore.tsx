import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Dices, Search } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  searchTracks, searchArtists, trending, underground, artistTracks, fresh,
  trendingPlaylists, searchPlaylists, playlistTracks, toSong,
  type OnlineTrack, type AudiusArtist, type AudiusPlaylist,
} from '@/services/providers/audius'
import { RadioTab } from '@/components/Explore/RadioTab'
import { LiquidTabs } from '@/components/Explore/LiquidTabs'
import { ExploreHeader } from '@/components/Explore/ExploreHeader'
import {
  Section, LoadingBlock, ErrorBlock, OfflineState, toPayload, toErrorState,
  CachedBanner, type SectionState,
} from '@/components/Explore/ExploreStates'
import { EmptyState } from '@/components/States/EmptyState'
import { TrackList } from '@/components/Explore/ExploreTrackList'
import { ArtistCard, PlaylistCard } from '@/components/Explore/ExploreCards'
import {
  TrendingSection, FreshSection, UndergroundSection, PlaylistsSection,
  ArtistSection, PlaylistSection,
} from '@/components/Explore/ExploreSections'
import { Radio as RadioIcon, Music2 as MusicIcon } from 'lucide-react'

// ── Explore — online discovery, rebuilt as a composition root (v2.16.1) ─────
// The page ORCHESTRATES; everything visual lives in components/Explore/*.
//
// Networking contract (audited + hardened in v2.16.1):
//   • Every request is cancellable; leaving Explore (or a drill-down)
//     aborts what is still in flight — no setState-after-unmount.
//   • Newer requests supersede older ones (search debounce + abort);
//     stale responses can never overwrite fresh state (signal guards).
//   • Section failures are INDEPENDENT: Trending failing says nothing
//     about Radio. Each section renders its own typed error + retry that
//     re-issues THAT section's request (a successful connectivity probe
//     no longer leaves an error stuck on screen).
//   • Provider results ride a short-TTL dedupe/cache layer (services/
//     providers/cache.ts): remounts and tab switches render from memory,
//     identical concurrent calls share one round-trip.
//   • Offline keeps this session's already-loaded picks on screen under an
//     honest "cached" banner (stale-while-offline) — or the offline
//     landing when nothing was loaded. Recovery revalidates quietly.
//   • The renderer never touches the network directly: everything goes
//     through providerCall → IPC → main process (op allowlist, timeout,
//     typed ProviderError kinds).

type TabId = 'music' | 'radio'
type DiscoveryKey = 'trending' | 'underground' | 'fresh' | 'playlists'

const SEARCH_DEBOUNCE_MS = 350

export function Explore() {
  const { online, probing, recheck } = useOnlineStatus()
  const [tab, setTab] = useState<TabId>('music')

  // ── Search state ──────────────────────────────────────────────────────
  // `query` is what the box shows; the effect debounces and issues the three
  // sub-searches (tracks/artists/playlists). `searchNonce` bumps on Retry to
  // re-issue the SAME query without the user retyping it.
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [searchNonce, setSearchNonce] = useState(0)
  const [tracks, setTracks] = useState<OnlineTrack[]>([])
  const [artists, setArtists] = useState<AudiusArtist[]>([])
  const [searchPlaylistResults, setSearchPlaylistResults] = useState<AudiusPlaylist[]>([])
  const [searchState, setSearchState] = useState<SectionState>({ status: 'idle' })

  // ── Discovery state (each section independent) ────────────────────────
  const [trendingTracks, setTrendingTracks] = useState<OnlineTrack[]>([])
  const [undergroundTracks, setUndergroundTracks] = useState<OnlineTrack[]>([])
  const [freshTracks, setFreshTracks] = useState<OnlineTrack[]>([])
  const [playlists, setPlaylists] = useState<AudiusPlaylist[]>([])
  const [trendingState, setTrendingState] = useState<SectionState>({ status: 'idle' })
  const [undergroundState, setUndergroundState] = useState<SectionState>({ status: 'idle' })
  const [freshState, setFreshState] = useState<SectionState>({ status: 'idle' })
  const [playlistState, setPlaylistState] = useState<SectionState>({ status: 'idle' })
  const [showingCached, setShowingCached] = useState(false)

  // ── Drill-down state ───────────────────────────────────────────────────
  const [openArtist, setOpenArtist] = useState<AudiusArtist | null>(null)
  const [artistTrackList, setArtistTrackList] = useState<OnlineTrack[]>([])
  const [artistState, setArtistState] = useState<SectionState>({ status: 'idle' })
  const [openPlaylist, setOpenPlaylist] = useState<AudiusPlaylist | null>(null)
  const [playlistTrackList, setPlaylistTrackList] = useState<OnlineTrack[]>([])
  const [playlistDetailState, setPlaylistDetailState] = useState<SectionState>({ status: 'idle' })

  // One AbortController per request family. Unmount aborts everything.
  const searchAbort = useRef<AbortController | null>(null)
  const discoveryAborts = useRef<Record<DiscoveryKey, AbortController | null>>({ trending: null, underground: null, fresh: null, playlists: null })
  const detailAbort = useRef<AbortController | null>(null)

  useEffect(() => () => {
    searchAbort.current?.abort()
    discoveryAborts.current.trending?.abort()
    discoveryAborts.current.underground?.abort()
    discoveryAborts.current.fresh?.abort()
    discoveryAborts.current.playlists?.abort()
    detailAbort.current?.abort()
  }, [])

  const arm = (slot: MutableRefObject<AbortController | null>): AbortController => {
    slot.current?.abort()
    const ac = new AbortController()
    slot.current = ac
    return ac
  }

  const armDiscovery = (key: DiscoveryKey): AbortController => {
    const slot = { current: discoveryAborts.current[key] } as MutableRefObject<AbortController | null>
    const ac = arm(slot)
    discoveryAborts.current[key] = ac
    return ac
  }

  // ── Discovery loads — per-section (retry fixes one section, not all four)
  const loadTrending = useCallback(() => {
    const ac = armDiscovery('trending')
    setTrendingState({ status: 'loading' })
    trending({ signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) { setTrendingTracks(r.tracks); setTrendingState({ status: r.tracks.length === 0 ? 'empty' : 'done' }) } })
      .catch((e) => { if (!ac.signal.aborted) setTrendingState(toErrorState(e)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadUnderground = useCallback(() => {
    const ac = armDiscovery('underground')
    setUndergroundState({ status: 'loading' })
    underground({ signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) { setUndergroundTracks(r.tracks); setUndergroundState({ status: r.tracks.length === 0 ? 'empty' : 'done' }) } })
      .catch((e) => { if (!ac.signal.aborted) setUndergroundState(toErrorState(e)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadFresh = useCallback(() => {
    const ac = armDiscovery('fresh')
    setFreshState({ status: 'loading' })
    fresh({ signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) { setFreshTracks(r.tracks); setFreshState({ status: r.tracks.length === 0 ? 'empty' : 'done' }) } })
      .catch((e) => { if (!ac.signal.aborted) setFreshState(toErrorState(e)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadPlaylists = useCallback(() => {
    const ac = armDiscovery('playlists')
    setPlaylistState({ status: 'loading' })
    trendingPlaylists({ signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) { setPlaylists(r.playlists); setPlaylistState({ status: r.playlists.length === 0 ? 'empty' : 'done' }) } })
      .catch((e) => { if (!ac.signal.aborted) setPlaylistState(toErrorState(e)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDiscovery = useCallback(() => {
    if (!online) return
    setShowingCached(false)
    loadTrending()
    loadUnderground()
    loadFresh()
    loadPlaylists()
  }, [online, loadTrending, loadUnderground, loadFresh, loadPlaylists])

  // Mount / recovery / first-fill. Going online ALWAYS (re)loads — the TTL
  // dedupe layer makes it a no-op round-trip while fresh, a real revalidate
  // once stale (stale-while-revalidate). Going offline: abort in-flight,
  // keep loaded content under the cached banner, or fall to the offline
  // landing when nothing ever loaded.
  const discoveryBusy = trendingState.status !== 'idle' || undergroundState.status !== 'idle' ||
    freshState.status !== 'idle' || playlistState.status !== 'idle'
  useEffect(() => {
    if (online) {
      loadDiscovery()
    } else if (!probing) {
      discoveryAborts.current.trending?.abort()
      discoveryAborts.current.underground?.abort()
      discoveryAborts.current.fresh?.abort()
      discoveryAborts.current.playlists?.abort()
      searchAbort.current?.abort()
      setShowingCached(discoveryBusy)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, probing, loadDiscovery])

  // ── Search (debounced, cancellable, retryable) ─────────────────────────
  useEffect(() => {
    const q = query.trim()
    if (!q || !online) {
      searchAbort.current?.abort()
      setSearchState({ status: 'idle' })
      setTracks([])
      setArtists([])
      setSearchPlaylistResults([])
      setSubmittedQuery('')
      return
    }
    const t = setTimeout(() => {
      const ac = arm(searchAbort)
      setSearchState({ status: 'loading' })
      setSubmittedQuery(q)
      let failedCount = 0
      let anyTracks = false
      let anyArtists = false
      let anyPlaylists = false
      let errPayload: { kind: string; message: string } | null = null
      const markFailure = (e: unknown) => {
        failedCount++
        errPayload = errPayload ?? toPayload(e)
      }
      Promise.all([
        searchTracks(q, { signal: ac.signal })
          .then((r) => { anyTracks = r.tracks.length > 0; if (!ac.signal.aborted) setTracks(r.tracks) })
          .catch((e) => { if (!ac.signal.aborted) markFailure(e) }),
        searchArtists(q, { signal: ac.signal })
          .then((r) => { anyArtists = r.artists.length > 0; if (!ac.signal.aborted) setArtists(r.artists) })
          .catch((e) => { if (!ac.signal.aborted) markFailure(e) }),
        searchPlaylists(q, { signal: ac.signal })
          .then((r) => { anyPlaylists = r.playlists.length > 0; if (!ac.signal.aborted) setSearchPlaylistResults(r.playlists) })
          .catch((e) => { if (!ac.signal.aborted) markFailure(e) }),
      ]).then(() => {
        if (ac.signal.aborted) return
        // Honest state rule: the provider is clearly unreachable only when
        // EVERY sub-op failed. If any sub-op answered, trust it — show what
        // it returned (content, or an honest empty state), not a scary error
        // for a sibling op's transient hiccup.
        if (failedCount === 3) setSearchState({ status: 'error', kind: errPayload?.kind ?? 'network', message: errPayload?.message ?? 'Search failed' })
        else if (!anyTracks && !anyArtists && !anyPlaylists) setSearchState({ status: 'empty' })
        else setSearchState({ status: 'done' })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
    // searchNonce: bumped by the error card's Retry to re-issue the same query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, online, searchNonce])

  // ── Drill-downs (one shared detail controller — only one shows at a time)
  const openArtistPage = useCallback((artist: AudiusArtist) => {
    const ac = arm(detailAbort)
    setOpenArtist(artist)
    setArtistTrackList([])
    setArtistState({ status: 'loading' })
    artistTracks(artist.id, { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return
        setArtistTrackList(r.tracks)
        setArtistState({ status: r.tracks.length === 0 ? 'empty' : 'done' })
      })
      .catch((e) => { if (!ac.signal.aborted) setArtistState(toErrorState(e)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closeArtist = () => {
    detailAbort.current?.abort()
    setOpenArtist(null)
    setArtistTrackList([])
    setArtistState({ status: 'idle' })
  }

  const openPlaylistDetail = useCallback((pl: AudiusPlaylist) => {
    const ac = arm(detailAbort)
    setOpenPlaylist(pl)
    setPlaylistTrackList([])
    setPlaylistDetailState({ status: 'loading' })
    playlistTracks(pl.id, { signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return
        setPlaylistTrackList(r.tracks)
        setPlaylistDetailState({ status: r.tracks.length === 0 ? 'empty' : 'done' })
      })
      .catch((e) => { if (!ac.signal.aborted) setPlaylistDetailState(toErrorState(e)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const closePlaylistDetail = () => {
    detailAbort.current?.abort()
    setOpenPlaylist(null)
    setPlaylistTrackList([])
    setPlaylistDetailState({ status: 'idle' })
  }

  // Phase 6 — Feeling Lucky: one random streamable pick from the whole
  // loaded discovery pool. Honest: a coin flip over real picks, not a
  // "smart" recommendation.
  const luckyPool = useMemo(
    () => [...trendingTracks, ...freshTracks, ...undergroundTracks].filter((t) => t.isStreamable && t.streamUrl),
    [trendingTracks, freshTracks, undergroundTracks],
  )
  const feelingLucky = () => {
    if (luckyPool.length === 0) return
    const pick = luckyPool[Math.floor(Math.random() * luckyPool.length)]
    const s = usePlayerStore.getState()
    const song = toSong(pick)
    s.playSong(song, luckyPool.map(toSong))
  }

  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const isSearching = query.trim().length > 0 && online
  const offlineWithContent = !online && !probing && showingCached

  return (
    <div className="flex flex-col h-full">
      <ExploreHeader
        online={online}
        probing={probing}
        recheck={recheck}
        query={query}
        onQueryChange={setQuery}
      />

      {/* Provider tabs — the gel pill travels between Music and Radio */}
      <div className="px-7 pb-3">
        <LiquidTabs<TabId>
          items={[
            { id: 'music', label: 'Music', icon: <MusicIcon size={12} /> },
            { id: 'radio', label: 'Radio', icon: <RadioIcon size={12} /> },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel="Explore sections"
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-6" data-explore-content="">
        {tab === 'radio' ? (
          <RadioTab />
        ) : offlineWithContent ? (
          // Offline with this-session content: keep browsing the cached
          // picks, honestly labeled. No fake liveness.
          <>
            <CachedBanner
              note="You're offline — showing this session's cached picks. Reconnect for live charts."
              onLibrary={() => setActiveView('library')}
              onFavorites={() => setActiveView('favorites')}
            />
            <DiscoverySections
              trendingState={trendingState} trendingTracks={trendingTracks}
              freshState={freshState} freshTracks={freshTracks}
              undergroundState={undergroundState} undergroundTracks={undergroundTracks}
              playlistState={playlistState} playlists={playlists}
              onRetryAll={loadDiscovery}
              onOpenPlaylist={openPlaylistDetail}
            />
          </>
        ) : !online && !probing ? (
          <OfflineState
            onRecheck={recheck}
            onLibrary={() => setActiveView('library')}
            onFavorites={() => setActiveView('favorites')}
          />
        ) : openPlaylist ? (
          <PlaylistSection
            playlist={openPlaylist}
            tracks={playlistTrackList}
            state={playlistDetailState}
            onBack={closePlaylistDetail}
            onRetry={() => openPlaylistDetail(openPlaylist)}
          />
        ) : openArtist ? (
          <ArtistSection
            artist={openArtist}
            tracks={artistTrackList}
            state={artistState}
            onBack={closeArtist}
            onRetry={() => openArtistPage(openArtist)}
          />
        ) : isSearching ? (
          <>
            {artists.length > 0 && (
              <Section title="Artists" icon={<MusicIcon size={11} />}>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {artists.map((a) => (
                    <ArtistCard key={a.id} artist={a} onOpen={() => openArtistPage(a)} />
                  ))}
                </div>
              </Section>
            )}
            {searchPlaylistResults.length > 0 && (
              <Section title="Playlists" icon={<MusicIcon size={11} />}>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {searchPlaylistResults.map((pl) => (
                    <PlaylistCard key={pl.id} playlist={pl} onOpen={() => openPlaylistDetail(pl)} />
                  ))}
                </div>
              </Section>
            )}
            {tracks.length > 0 && (
              <Section title={`Tracks for “${submittedQuery}”`} icon={<MusicIcon size={11} />}>
                <TrackList tracks={tracks} />
              </Section>
            )}
            {searchState.status === 'loading' && <LoadingBlock label={`Searching Audius for “${query.trim()}”…`} />}
            {searchState.status === 'error' && (
              <ErrorBlock
                kind={searchState.kind}
                message={searchState.message}
                onRetry={() => setSearchNonce((n) => n + 1)}
              />
            )}
            {searchState.status === 'empty' && (
              <div className="pt-10">
                <EmptyState
                  compact
                  icon={<Search size={20} />}
                  title={`No Audius results for “${submittedQuery}”`}
                  hint="Try a different spelling, or browse the trending picks below the search box."
                />
              </div>
            )}
            {(searchState.status === 'done' || searchState.status === 'error') && (tracks.length > 0 || artists.length > 0 || searchPlaylistResults.length > 0) && (
              <div className="h-10" />
            )}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Free streams from Audius · picks refresh as the charts move
              </p>
              <button
                onClick={feelingLucky}
                disabled={luckyPool.length === 0}
                className="gel-press flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium disabled:opacity-40"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
                title="Play a random track from today's discovery pool"
              >
                <Dices size={12} />
                Feeling Lucky
              </button>
            </div>
            <DiscoverySections
              trendingState={trendingState} trendingTracks={trendingTracks}
              freshState={freshState} freshTracks={freshTracks}
              undergroundState={undergroundState} undergroundTracks={undergroundTracks}
              playlistState={playlistState} playlists={playlists}
              onRetryAll={loadDiscovery}
              onOpenPlaylist={openPlaylistDetail}
            />
          </>
        )}
      </div>
    </div>
  )
}

// The discovery grid — composed once so the cached and live branches render
// the identical structure (no layout jump when connectivity changes).
function DiscoverySections({ trendingState, trendingTracks, freshState, freshTracks, undergroundState, undergroundTracks, playlistState, playlists, onRetryAll, onOpenPlaylist }: {
  trendingState: SectionState; trendingTracks: OnlineTrack[]
  freshState: SectionState; freshTracks: OnlineTrack[]
  undergroundState: SectionState; undergroundTracks: OnlineTrack[]
  playlistState: SectionState; playlists: AudiusPlaylist[]
  onRetryAll: () => void
  onOpenPlaylist: (pl: AudiusPlaylist) => void
}) {
  return (
    <>
      <TrendingSection state={trendingState} tracks={trendingTracks} onRetry={onRetryAll} />
      <div className="h-6" />
      <FreshSection state={freshState} tracks={freshTracks} onRetry={onRetryAll} />
      <div className="h-6" />
      <UndergroundSection state={undergroundState} tracks={undergroundTracks} onRetry={onRetryAll} />
      <div className="h-6" />
      <PlaylistsSection state={playlistState} playlists={playlists} onRetry={onRetryAll} onOpen={onOpenPlaylist} />
    </>
  )
}
