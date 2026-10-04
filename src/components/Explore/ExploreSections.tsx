import { Flame, Sparkles, Gem, ListMusic, Globe, Mic2, BadgeCheck } from 'lucide-react'
import type { OnlineTrack, AudiusArtist, AudiusPlaylist } from '@/services/providers/audius'
import { toTrack } from '@/services/providers/audius'
import { Section, TrackListSkeleton, ErrorBlock, EmptyBlock, type SectionState } from './ExploreStates'
import { TrackList } from './ExploreTrackList'
import { PlaylistCardLarge, TrackTile, HeroCard } from './ExploreCards'
import { useMemo } from 'react'

// ── Discovery sections (v2.16.1) ─────────────────────────────────────────────
// The four discovery bodies (Trending / Fresh / Under the Radar / Online
// Playlists) plus the artist + playlist drill-downs. EVERY section carries
// its own state machine — one section's failure never takes the page down,
// and each Retry re-issues that section's own request.

/** The standard body renderer for a list-backed discovery section. */
export function DiscoveryBody({ state, tracks, onRetry }: {
  state: SectionState
  tracks: OnlineTrack[]
  onRetry: () => void
}) {
  if (state.status === 'loading' || state.status === 'idle') return <TrackListSkeleton />
  if (state.status === 'error') return <ErrorBlock kind={state.kind} message={state.message} onRetry={onRetry} />
  if (state.status === 'empty') return <EmptyBlock note="Nothing here right now — check back later." />
  return <TrackList tracks={tracks} />
}

export function TrendingSection({ state, tracks, onRetry }: { state: SectionState; tracks: OnlineTrack[]; onRetry: () => void }) {
  // Explore 3.0 composition: HERO (#1) + horizontal rail of square tiles
  // (#2…). Derived from the SAME list — songs for queue continuity computed
  // once. The hero takes track[0] and the rail starts at #2, so a title can
  // never appear twice on the page (a v2.16.1 test contract).
  const songs = useMemo(() => tracks.map(toTrack), [tracks])
  const hero = state.status === 'done' ? tracks[0] : undefined
  const rest = hero ? tracks.slice(1) : tracks
  return (
    <Section title="Trending on Audius" icon={<Flame size={11} />}>
      {state.status === 'loading' || state.status === 'idle' ? (
        <TrackListSkeleton />
      ) : state.status === 'error' ? (
        <ErrorBlock kind={state.kind} message={state.message} onRetry={onRetry} />
      ) : state.status === 'empty' ? (
        <EmptyBlock note="Nothing here right now — check back later." />
      ) : (
        <>
          {hero && <HeroCard track={hero} songs={songs} />}
          {rest.length > 0 && (
            <div
              className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1"
              style={{ scrollbarWidth: 'thin' }}
              data-trending-rail
            >
              {rest.map((t, i) => (
                <TrackTile key={t.id} track={t} rank={i + 2} songs={songs} />
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  )
}

export function FreshSection({ state, tracks, onRetry }: { state: SectionState; tracks: OnlineTrack[]; onRetry: () => void }) {
  return (
    <Section
      title="Fresh this week"
      icon={<Sparkles size={11} />}
      hint="newest releases from this week's trending — Audius has no dedicated new-releases feed"
    >
      <DiscoveryBody state={state} tracks={tracks} onRetry={onRetry} />
    </Section>
  )
}

export function UndergroundSection({ state, tracks, onRetry }: { state: SectionState; tracks: OnlineTrack[]; onRetry: () => void }) {
  const songs = useMemo(() => tracks.map(toTrack), [tracks])
  return (
    <Section title="Under the Radar" icon={<Gem size={11} />}>
      {state.status === 'loading' || state.status === 'idle' ? (
        <TrackListSkeleton />
      ) : state.status === 'error' ? (
        <ErrorBlock kind={state.kind} message={state.message} onRetry={onRetry} />
      ) : state.status === 'empty' ? (
        <EmptyBlock note="Nothing here right now — check back later." />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3" data-underground-grid>
          {tracks.map((t, i) => (
            <TrackTile key={t.id} track={t} rank={i + 1} songs={songs} />
          ))}
        </div>
      )}
    </Section>
  )
}

export function PlaylistsSection({ state, playlists, onRetry, onOpen }: {
  state: SectionState
  playlists: AudiusPlaylist[]
  onRetry: () => void
  onOpen: (pl: AudiusPlaylist) => void
}) {
  return (
    <Section title="Online Playlists" icon={<ListMusic size={11} />}>
      {state.status === 'loading' || state.status === 'idle' ? (
        <TrackListSkeleton />
      ) : state.status === 'error' ? (
        <ErrorBlock kind={state.kind} message={state.message} onRetry={onRetry} />
      ) : state.status === 'empty' ? (
        <EmptyBlock note="No playlists surfacing right now." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-playlist-editorial>
          {playlists.map((pl) => (
            <PlaylistCardLarge key={pl.id} playlist={pl} onOpen={() => onOpen(pl)} />
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Drill-down: artist ───────────────────────────────────────────────────────

export function ArtistSection({ artist, tracks, state, onBack, onRetry }: {
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
        {state.status === 'empty' && <EmptyBlock note="No streamable tracks from this artist right now." />}
        {state.status === 'done' && <TrackList tracks={tracks} />}
      </Section>
    </div>
  )
}

// ── Drill-down: playlist ─────────────────────────────────────────────────────

export function PlaylistSection({ playlist, tracks, state, onBack, onRetry }: {
  playlist: AudiusPlaylist
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
        ← Back to Explore
      </button>
      <h2 className="text-xl font-semibold tracking-tight mb-1" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        {playlist.name}
      </h2>
      <p className="text-xs mb-5" style={{ color: 'var(--text-faint)' }}>
        {playlist.subtitle ? `by ${playlist.subtitle} · ` : ''}Audius playlist · {playlist.trackCount} tracks
      </p>
      <Section title="Tracks" icon={<Globe size={11} />}>
        {state.status === 'loading' && <TrackListSkeleton />}
        {state.status === 'error' && <ErrorBlock kind={state.kind} message={state.message} onRetry={onRetry} />}
        {state.status === 'empty' && <EmptyBlock note="This playlist has no streamable tracks right now." />}
        {state.status === 'done' && <TrackList tracks={tracks} />}
      </Section>
    </div>
  )
}
