import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe, Search, X, Play, Pause, Loader2, WifiOff, ExternalLink, Radio, Flame, Gem, Mic2, BadgeCheck, Dices, LibraryBig, Heart, ListMusic, Sparkles, ArrowLeft } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { EmptyState } from '@/components/States/EmptyState'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { searchTracks, searchArtists, trending, underground, artistTracks, fresh, trendingPlaylists, searchPlaylists, playlistTracks, toSong, type OnlineTrack, type AudiusArtist, type AudiusPlaylist } from '@/services/providers/audius'
import { RadioTab } from '@/components/Explore/RadioTab'
import { Radio as RadioIcon, Music2 as MusicIcon } from 'lucide-react'
import { ProviderError } from '@/services/providers/types'
import { formatTime, cn } from '@/lib/utils'

// ── Explore (Phase 4) — online discovery, Audius first ──────────────────────
// The surface is provider-agnostic in its plumbing: it renders ProviderTrack
// rows and talks only through the provider bindings (services/providers/*).
// Phase 4 scope: online search (tracks + artist drill-down) and the two
// discovery lists the API actually offers (Trending, Underground — verified
// endpoints). Phase 6 expands this into the full Explore experience.
//
// State matrix per section — every surface the roadmap demands:
//   loading (skeleton) · error (typed + retry) · empty · offline ·
//   disabled while offline · unavailable tracks (non-streamable, dimmed
//   with a "not streamable" note instead of fake playability).

type SectionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; kind: string; message: string }
  | { status: 'empty' }
  | { status: 'done' }

export function Explore() {
  const { online, probing, recheck } = useOnlineStatus()
  const goBack = usePlayerStore((s) => s.goBack)
  const [tab, setTab] = useState<'music' | 'radio'>('music')

  // Search state: the query is debounced through useDeferredValue-free
  // manual timer — provider calls are networked, so an in-flight request is
  // superseded (aborted) the moment the user types more.
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('') // actual searched text
  const [tracks, setTracks] = useState<OnlineTrack[]>([])
  const [artists, setArtists] = useState<AudiusArtist[]>([])
  const [searchPlaylistResults, setSearchPlaylistResults] = useState<AudiusPlaylist[]>([])
  const [searchState, setSearchState] = useState<SectionState>({ status: 'idle' })

  // Discovery lists (no query).
  const [trendingTracks, setTrendingTracks] = useState<OnlineTrack[]>([])
  const [undergroundTracks, setUndergroundTracks] = useState<OnlineTrack[]>([])
  const [freshTracks, setFreshTracks] = useState<OnlineTrack[]>([])
  const [freshState, setFreshState] = useState<SectionState>({ status: 'idle' })
  const [trendingState, setTrendingState] = useState<SectionState>({ status: 'idle' })
  const [undergroundState, setUndergroundState] = useState<SectionState>({ status: 'idle' })
  const [playlists, setPlaylists] = useState<AudiusPlaylist[]>([])
  const [playlistState, setPlaylistState] = useState<SectionState>({ status: 'idle' })
  const [openPlaylist, setOpenPlaylist] = useState<AudiusPlaylist | null>(null)
  const [playlistTrackList, setPlaylistTrackList] = useState<OnlineTrack[]>([])
  const [playlistDetailState, setPlaylistDetailState] = useState<SectionState>({ status: 'idle' })

  // Artist drill-down.
  const [openArtist, setOpenArtist] = useState<AudiusArtist | null>(null)
  const [artistTrackList, setArtistTrackList] = useState<OnlineTrack[]>([])
  const [artistState, setArtistState] = useState<SectionState>({ status: 'idle' })

  const searchAbort = useRef<AbortController | null>(null)
  const discoveryAbort = useRef<AbortController | null>(null)
  const artistAbort = useRef<AbortController | null>(null)

  const abort = (ref: React.MutableRefObject<AbortController | null>) => {
    ref.current?.abort()
    ref.current = null
  }

  // ── Discovery load (Trending + Underground) ──────────────────────────
  const loadDiscovery = useCallback(() => {
    if (!online) return
    abort(discoveryAbort)
    const ac = new AbortController()
    discoveryAbort.current = ac
    setTrendingState({ status: 'loading' })
    setUndergroundState({ status: 'loading' })
    trending({ signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return
        setTrendingTracks(r.tracks)
        setTrendingState({ status: r.tracks.length === 0 ? 'empty' : 'done' })
      })
      .catch((e) => { if (!ac.signal.aborted) setTrendingState(toErrorState(e)) })
    underground({ signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return
        setUndergroundTracks(r.tracks)
        setUndergroundState({ status: r.tracks.length === 0 ? 'empty' : 'done' })
      })
      .catch((e) => { if (!ac.signal.aborted) setUndergroundState(toErrorState(e)) })
    fresh({ signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return
        setFreshTracks(r.tracks)
        setFreshState({ status: r.tracks.length === 0 ? 'empty' : 'done' })
      })
      .catch((e) => { if (!ac.signal.aborted) setFreshState(toErrorState(e)) })
    trendingPlaylists({ signal: ac.signal })
      .then((r) => {
        if (ac.signal.aborted) return
        setPlaylists(r.playlists)
        setPlaylistState({ status: r.playlists.length === 0 ? 'empty' : 'done' })
      })
      .catch((e) => { if (!ac.signal.aborted) setPlaylistState(toErrorState(e)) })
  }, [online])

  // On mount / going online: load discovery. Going offline: clear to the
  // offline banner (honest — no stale content pretending to be live).
  useEffect(() => {
    if (online) {
      if (trendingState.status === 'idle' || trendingState.status === 'error' || trendingTracks.length === 0) loadDiscovery()
    } else if (!probing) {
      abort(discoveryAbort)
      setTrendingState({ status: 'idle' })
      setUndergroundState({ status: 'idle' })
      setFreshState({ status: 'idle' })
      setPlaylistState({ status: 'idle' })
      setTrendingTracks([])
      setUndergroundTracks([])
      setFreshTracks([])
      setPlaylists([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, probing, loadDiscovery])

  // ── Search (debounced + cancellable) ─────────────────────────────────
  useEffect(() => {
    const q = query.trim()
    if (!q || !online) {
      abort(searchAbort)
      setSearchState({ status: 'idle' })
      setTracks([])
      setArtists([])
      setSearchPlaylistResults([])
      setSubmittedQuery('')
      return
    }
    const t = setTimeout(() => {
      abort(searchAbort)
      const ac = new AbortController()
      searchAbort.current = ac
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
    }, 350)
    return () => clearTimeout(t)
  }, [query, online])

  // ── Artist drill-down ────────────────────────────────────────────────
  const openArtistPage = (artist: AudiusArtist) => {
    abort(artistAbort)
    const ac = new AbortController()
    artistAbort.current = ac
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
  }

  const closeArtist = () => {
    abort(artistAbort)
    setOpenArtist(null)
    setArtistTrackList([])
    setArtistState({ status: 'idle' })
  }

  const openPlaylistDetail = (pl: AudiusPlaylist) => {
    abort(artistAbort)
    const ac = new AbortController()
    artistAbort.current = ac
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
  }

  // Phase 6 — Feeling Lucky: plays one random streamable track from the
  // whole loaded discovery pool. Honest: it is a coin flip over real picks,
  // not a "smart" recommendation.
  const luckyPool = [...trendingTracks, ...freshTracks, ...undergroundTracks].filter((t) => t.isStreamable && t.streamUrl)
  const feelingLucky = () => {
    if (luckyPool.length === 0) return
    const pick = luckyPool[Math.floor(Math.random() * luckyPool.length)]
    const s = usePlayerStore.getState()
    const song = toSong(pick)
    s.playSong(song, luckyPool.map(toSong))
  }

  const isSearching = query.trim().length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-7 pt-3 pb-4"
        style={{ background: 'linear-gradient(to bottom, var(--surface-base) 60%, transparent)' }}
      >
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 mb-3 transition-colors active:scale-95"
          style={{ color: 'var(--text-tertiary)', transitionDuration: 'var(--dur-fast)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
          title="Go back"
          aria-label="Go back to the previous page"
        >
          <ArrowLeft size={14} />
          <span className="text-xs font-medium">Back</span>
        </button>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight flex items-center gap-2.5"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              Explore
              <span
                className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase align-middle"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)', letterSpacing: '0.08em' }}
              >
                <Globe size={9} />
                Online
              </span>
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
              Stream free music from Audius — keyless, nothing to configure. Your library stays local.
            </p>
          </div>
          <OnlineChip online={online} probing={probing} recheck={recheck} />
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            type="text"
            placeholder={online ? 'Search Audius — tracks and artists…' : 'Go online to search Audius'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!online}
            className="w-full pl-9 pr-9 py-2 rounded-xl text-sm outline-none transition-all disabled:opacity-50"
            style={{
              background: 'var(--glass-1)',
              border: '1px solid var(--border-default)',
              color: 'var(--text-primary)',
              transitionDuration: 'var(--dur-fast)',
            }}
            aria-label="Search Audius"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="Clear search" aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors"
              style={{ color: 'var(--text-faint)' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Provider tabs — Phase 4 Music (Audius) / Phase 5 Radio (Radio Browser) */}
      <div className="px-7 pb-3">
        <div
          className="inline-flex items-center rounded-xl p-1 gap-0.5"
          style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
          role="tablist"
          aria-label="Explore sections"
        >
          <TabButton active={tab === 'music'} onClick={() => setTab('music')} label="Music" icon={<MusicIcon size={12} />} />
          <TabButton active={tab === 'radio'} onClick={() => setTab('radio')} label="Radio" icon={<RadioIcon size={12} />} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-6">
        {tab === 'radio' ? (
          <RadioTab />
        ) : !online && !probing ? (
          <div className="pt-10">
            <EmptyState
              icon={<WifiOff size={22} />}
              title="You're offline"
              hint="Explore needs an internet connection. Your library keeps working — it's 100% local."
              action={
                <div className="flex items-center gap-2">
                  <button
                    onClick={recheck}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium active:scale-95 transition-all"
                    style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
                  >
                    <Globe size={14} />
                    Try again
                  </button>
                  <OfflineLocalLinks />
                </div>
              }
            />
          </div>
        ) : openPlaylist ? (
          <div>
            <button
              onClick={() => { setOpenPlaylist(null); setPlaylistTrackList([]); setPlaylistDetailState({ status: 'idle' }) }}
              className="text-xs mb-3 flex items-center gap-1 transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ← Back to Explore
            </button>
            <h2 className="text-xl font-semibold tracking-tight mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {openPlaylist.name}
            </h2>
            <p className="text-xs mb-5" style={{ color: 'var(--text-faint)' }}>
              {openPlaylist.subtitle ? `by ${openPlaylist.subtitle} · ` : ''}Audius playlist · {openPlaylist.trackCount} tracks
            </p>
            <Section title="Tracks" icon={<Globe size={11} />}>
              {playlistDetailState.status === 'loading' && <TrackListSkeleton />}
              {playlistDetailState.status === 'error' && <ErrorBlock kind={playlistDetailState.kind} message={playlistDetailState.message} onRetry={() => openPlaylistDetail(openPlaylist)} />}
              {playlistDetailState.status === 'empty' && (
                <p className="text-xs py-6 text-center" style={{ color: 'var(--text-faint)' }}>This playlist has no streamable tracks right now.</p>
              )}
              {playlistDetailState.status === 'done' && <TrackList tracks={playlistTrackList} />}
            </Section>
          </div>
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
              <Section title="Artists" icon={<Mic2 size={11} />}>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {artists.map((a) => (
                    <ArtistCard key={a.id} artist={a} onOpen={() => openArtistPage(a)} />
                  ))}
                </div>
              </Section>
            )}
            {searchPlaylistResults.length > 0 && (
              <Section title="Playlists" icon={<ListMusic size={11} />}>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {searchPlaylistResults.map((pl) => (
                    <PlaylistCard key={pl.id} playlist={pl} onOpen={() => openPlaylistDetail(pl)} />
                  ))}
                </div>
              </Section>
            )}
            {tracks.length > 0 && (
              <Section title={`Tracks for “${submittedQuery}”`} icon={<Globe size={11} />}>
                <TrackList tracks={tracks} />
              </Section>
            )}
            {searchState.status === 'loading' && <LoadingBlock label={`Searching Audius for “${query.trim()}”…`} />}
            {searchState.status === 'error' && (
              <ErrorBlock kind={searchState.kind} message={searchState.message} onRetry={recheck} />
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
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium active:scale-95 transition-all disabled:opacity-40"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
                title="Play a random track from today's discovery pool"
              >
                <Dices size={12} />
                Feeling Lucky
              </button>
            </div>
            <Section title="Trending on Audius" icon={<Flame size={11} />}>
              <SectionBody
                state={trendingState}
                tracks={trendingTracks}
                onRetry={loadDiscovery}
              />
            </Section>
            <div className="h-6" />
            <Section
              title="Fresh this week"
              icon={<Sparkles size={11} />}
              hint="newest releases from this week's trending — Audius has no dedicated new-releases feed"
            >
              <SectionBody
                state={freshState}
                tracks={freshTracks}
                onRetry={loadDiscovery}
              />
            </Section>
            <div className="h-6" />
            <Section title="Under the Radar" icon={<Gem size={11} />}>
              <SectionBody
                state={undergroundState}
                tracks={undergroundTracks}
                onRetry={loadDiscovery}
              />
            </Section>
            <div className="h-6" />
            <Section title="Online Playlists" icon={<ListMusic size={11} />}>
              {playlistState.status === 'loading' || playlistState.status === 'idle' ? (
                <TrackListSkeleton />
              ) : playlistState.status === 'error' ? (
                <ErrorBlock kind={playlistState.kind} message={playlistState.message} onRetry={loadDiscovery} />
              ) : playlistState.status === 'empty' ? (
                <p className="text-xs py-6 text-center" style={{ color: 'var(--text-faint)' }}>
                  No playlists surfacing right now.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {playlists.map((pl) => (
                    <PlaylistCard key={pl.id} playlist={pl} onOpen={() => openPlaylistDetail(pl)} />
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label, icon }: {
  active: boolean; onClick: () => void; label: string; icon: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      aria-label={`${label} tab`}
      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all"
      style={{
        transitionDuration: 'var(--dur-fast)',
        color: active ? 'var(--text-primary)' : 'var(--text-faint)',
        background: active ? 'var(--glass-3)' : 'transparent',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

// ── Playlist cards + offline local links (Phase 6) ──────────────────────────

function PlaylistCard({ playlist, onOpen }: { playlist: AudiusPlaylist; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      title={`Open ${playlist.name}`}
    >
      <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={{ background: 'var(--glass-2)' }}>
        {playlist.artworkUrl
          ? <img src={playlist.artworkUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <ListMusic size={15} style={{ color: 'var(--text-faint)' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{playlist.name}</p>
        <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>
          {playlist.subtitle ? `${playlist.subtitle} · ` : ''}{playlist.trackCount} tracks
        </p>
      </div>
    </button>
  )
}

function OfflineLocalLinks() {
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  return (
    <>
      <button
        onClick={() => setActiveView('library')}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium active:scale-95 transition-all"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
      >
        <LibraryBig size={14} />
        Your Library
      </button>
      <button
        onClick={() => setActiveView('favorites')}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium active:scale-95 transition-all"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
      >
        <Heart size={14} />
        Favorites
      </button>
    </>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toPayload(e: unknown): { kind: string; message: string } {
  if (e instanceof ProviderError) return { kind: e.kind, message: e.message }
  return { kind: 'network', message: e instanceof Error ? e.message : 'Request failed' }
}

function toErrorState(e: unknown): SectionState {
  const p = toPayload(e)
  return { status: 'error', kind: p.kind, message: p.message }
}

function OnlineChip({ online, probing, recheck }: { online: boolean; probing: boolean; recheck: () => void }) {
  const color = online ? 'var(--success)' : 'var(--danger)'
  const veil = online ? 'var(--success-veil)' : 'var(--danger-veil)'
  return (
    <button
      onClick={() => { if (!online) recheck() }}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase transition-all"
      style={{ background: veil, color, border: `1px solid ${color}44`, letterSpacing: '0.08em' }}
      title={online ? 'Connected' : 'Offline — click to re-check'}
      aria-label={online ? 'Online' : 'Offline — click to re-check'}
    >
      {probing
        ? <Loader2 size={10} className="animate-spin" />
        : <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
      {online ? 'Online' : 'Offline'}
    </button>
  )
}

export function Section({ title, icon, hint, children }: { title: string; icon?: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2
          className="text-[11px] font-semibold uppercase"
          style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
        >
          {title}
        </h2>
        {hint && (
          <span className="text-[10px] normal-case truncate" style={{ color: 'var(--text-faint)', opacity: 0.8 }} title={hint}>
            {hint}
          </span>
        )}
        <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
      </div>
      {children}
    </section>
  )
}

function SectionBody({ state, tracks, onRetry }: {
  state: SectionState; tracks: OnlineTrack[]; onRetry: () => void
}) {
  if (state.status === 'loading' || state.status === 'idle') {
    return <TrackListSkeleton />
  }
  if (state.status === 'error') {
    return <ErrorBlock kind={state.kind} message={state.message} onRetry={onRetry} />
  }
  if (state.status === 'empty') {
    return (
      <p className="text-xs py-6 text-center" style={{ color: 'var(--text-faint)' }}>
        Nothing here right now — check back later.
      </p>
    )
  }
  return <TrackList tracks={tracks} />
}

// ── Track rows (provider-agnostic — the queue plays these like local songs) ─

function TrackList({ tracks }: { tracks: OnlineTrack[] }) {
  const playSong = usePlayerStore((s) => s.playSong)
  const currentSongId = usePlayerStore((s) => s.currentSong?.id)
  const isPlaying = usePlayerStore((s) => s.isPlaying)

  const songs = useMemo(() => tracks.map(toSong), [tracks])

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
      {tracks.map((track, i) => {
        const song = songs[i]
        const isActive = currentSongId === song.id
        const playable = track.isStreamable && !!track.streamUrl
        return (
          <div
            key={track.id}
            tabIndex={playable ? 0 : -1}
            aria-disabled={!playable}
            onKeyDown={(e) => {
              if (playable && e.key === 'Enter') { e.preventDefault(); playSong(song, songs) }
            }}
            className={cn(
              'group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
              i > 0 && 'border-t',
              !playable && 'opacity-45 cursor-not-allowed',
            )}
            style={{
              borderTopColor: 'var(--border-subtle)',
              background: isActive ? 'var(--accent-dim)' : undefined,
            }}
            onClick={() => { if (playable) playSong(song, songs) }}
            title={playable ? `Play ${track.title}` : 'This track is not streamable'}
          >
            <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden" style={{ background: 'var(--glass-2)' }}>
              {track.artworkUrl
                ? <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                : <ArtworkPlaceholder seed={track.id} size="sm" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" style={{ color: isActive ? 'var(--accent)' : 'var(--text-primary)', fontWeight: isActive ? 500 : 400 }}>
                {track.title}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                {track.artist}
                {track.subtitle ? <span style={{ color: 'var(--text-faint)' }}> · {track.subtitle}</span> : null}
                {!track.isStreamable ? <span style={{ color: 'var(--text-faint)' }}> · not streamable</span> : null}
              </p>
            </div>
            {track.permalink && (
              <a
                href={track.permalink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Open on audius.co"
                aria-label={`Open ${track.title} on audius.co`}
                className="p-1.5 rounded-lg shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--text-faint)' }}
              >
                <ExternalLink size={12} />
              </a>
            )}
            <span className="text-xs tabular-nums shrink-0 w-9 text-right" style={{ color: 'var(--text-faint)' }}>
              {track.durationSec ? formatTime(track.durationSec) : '—'}
            </span>
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

export function TrackListSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl animate-pulse" style={{ background: 'var(--glass-1)' }}>
          <div className="w-9 h-9 rounded-lg" style={{ background: 'var(--glass-2)' }} />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 rounded w-1/3" style={{ background: 'var(--glass-2)' }} />
            <div className="h-2.5 rounded w-1/4" style={{ background: 'var(--glass-2)' }} />
          </div>
          <div className="h-2.5 w-8 rounded" style={{ background: 'var(--glass-2)' }} />
        </div>
      ))}
    </div>
  )
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 py-8 justify-center" role="status">
      <Loader2 size={15} className="animate-spin" style={{ color: 'var(--accent)' }} />
      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
    </div>
  )
}

export function ErrorBlock({ kind, message, onRetry }: { kind: string; message: string; onRetry: () => void }) {
  const copy: Record<string, { title: string; hint: string }> = {
    offline: { title: "You're offline", hint: 'Connect to the internet and try again.' },
    timeout: { title: 'The provider took too long', hint: 'Audius may be slow right now — retrying usually helps.' },
    network: { title: 'Connection problem', hint: 'The network request could not complete.' },
    http: { title: 'The provider had a problem', hint: 'The service answered with an error status.' },
    rate_limited: { title: 'Slow down a little', hint: 'The provider asked us to wait a moment — retry shortly.' },
    malformed: { title: 'The provider answered oddly', hint: 'The response was not in the expected shape.' },
    unavailable: { title: 'Provider unavailable', hint: 'This online source is not reachable right now.' },
  }
  const c = copy[kind] ?? { title: 'Something went wrong', hint: message }
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.title}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{c.hint}</p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium active:scale-95 transition-all shrink-0"
        style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
      >
        <Radio size={11} />
        Retry
      </button>
    </div>
  )
}

// ── Artists ──────────────────────────────────────────────────────────────────

function ArtistCard({ artist, onOpen }: { artist: AudiusArtist; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] text-center"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      title={`Open ${artist.name}`}
    >
      <div className="w-14 h-14 rounded-full overflow-hidden shrink-0" style={{ background: 'var(--glass-2)' }}>
        {artist.avatarUrl
          ? <img src={artist.avatarUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <div className="w-full h-full flex items-center justify-center"><Mic2 size={18} style={{ color: 'var(--text-faint)' }} /></div>}
      </div>
      <div className="min-w-0 w-full">
        <p className="text-xs font-medium truncate flex items-center justify-center gap-1" style={{ color: 'var(--text-primary)' }}>
          <span className="truncate">{artist.name}</span>
          {artist.isVerified && <BadgeCheck size={10} style={{ color: 'var(--accent)' }} className="shrink-0" />}
        </p>
        <p className="text-[10px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
          {artist.followers.toLocaleString()} {artist.followers === 1 ? 'follower' : 'followers'}
        </p>
      </div>
    </button>
  )
}

function ArtistSection({ artist, tracks, state, onBack, onRetry }: {
  artist: AudiusArtist
  tracks: OnlineTrack[]
  state: SectionState
  onBack: () => void
  onRetry: () => void
}) {
  return (
    <div>
      <button
        onClick={onBack}
        className="text-xs mb-3 flex items-center gap-1 transition-colors"
        style={{ color: 'var(--text-tertiary)' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
      >
        ← Back to search
      </button>
      <div className="flex items-center gap-4 mb-5">
        <div className="w-16 h-16 rounded-full overflow-hidden shrink-0" style={{ background: 'var(--glass-2)' }}>
          {artist.avatarUrl
            ? <img src={artist.avatarUrl} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            : <div className="w-full h-full flex items-center justify-center"><Mic2 size={22} style={{ color: 'var(--text-faint)' }} /></div>}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-1.5" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {artist.name}
            {artist.isVerified && <BadgeCheck size={14} style={{ color: 'var(--accent)' }} />}
          </h2>
          <p className="text-xs tabular-nums mt-0.5" style={{ color: 'var(--text-faint)' }}>
            {artist.followers.toLocaleString()} {artist.followers === 1 ? 'follower' : 'followers'} · on Audius
          </p>
        </div>
      </div>
      <Section title="Tracks" icon={<Globe size={11} />}>
        {state.status === 'loading' && <TrackListSkeleton />}
        {state.status === 'error' && <ErrorBlock kind={state.kind} message={state.message} onRetry={onRetry} />}
        {state.status === 'empty' && (
          <p className="text-xs py-6 text-center" style={{ color: 'var(--text-faint)' }}>
            No streamable tracks from this artist right now.
          </p>
        )}
        {state.status === 'done' && <TrackList tracks={tracks} />}
      </Section>
    </div>
  )
}
