import { memo } from 'react'
import { ListMusic, Mic2, BadgeCheck, Pause, Play, ExternalLink } from 'lucide-react'
import type { AudiusArtist, AudiusPlaylist, OnlineTrack } from '@/services/providers/audius'
import { toSong } from '@/services/providers/audius'
import { usePlayerStore } from '@/store/playerStore'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { formatTime } from '@/lib/utils'

// ── Explore cards (v2.16.1 → 3.0) ────────────────────────────────────────────
// Discovery cards share one voice: glass surface, hairline border, spring
// press (gel-press), identical radii — so artists and playlists read as the
// same family of objects even though their bodies differ (round avatar vs
// square artwork).
//
// Explore 3.0 (Wave 9) adds the page's varied composition vocabulary
// (spec §8 — not every item the same card):
//   • HeroCard        — the editorial #1 pick (once per page, never repeated
//                       in the row below)
//   • TrackTile       — square-artwork card for horizontal rail / grids
//   • PlaylistCardLarge — editorial 2-up playlist card

export function ArtistCard({ artist, onOpen }: { artist: AudiusArtist; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="gel-press flex flex-col items-center gap-2 p-3 rounded-xl text-center"
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

export function PlaylistCard({ playlist, onOpen }: { playlist: AudiusPlaylist; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="gel-press flex items-center gap-3 p-3 rounded-xl text-left"
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

// ── HeroCard — the editorial #1 pick (Explore 3.0) ──────────────────────────
// A wide glass slab with the artwork left, a gradient scrim, and the play
// action right on it. Plays the section's full list (queue continues into
// the chart below). Rendered ONCE per page — the section row starts at #2,
// so a title can never appear twice (a v2.16.1 test contract).
export function HeroCard({ track, songs }: { track: OnlineTrack; songs: ReturnType<typeof toSong>[] }) {
  const playSong = usePlayerStore((s) => s.playSong)
  const currentSongId = usePlayerStore((s) => s.currentSong?.id)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const song = toSong(track)
  const playable = track.isStreamable && !!track.streamUrl
  const active = currentSongId === song.id
  return (
    <div
      className="gel-press relative flex items-center gap-5 p-4 rounded-2xl overflow-hidden mb-4"
      style={{
        background: 'linear-gradient(120deg, var(--accent-veil), var(--glass-1) 45%, var(--glass-1))',
        border: '1px solid var(--accent-border)',
        boxShadow: 'var(--shadow-2), inset 0 1px 0 var(--border-emphasis)',
      }}
      data-explore-hero
    >
      <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-xl overflow-hidden shrink-0 relative" style={{ background: 'var(--glass-2)', boxShadow: 'var(--shadow-2)' }}>
        {track.artworkUrl
          ? <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <ArtworkPlaceholder seed={track.id} size="lg" />}
        <button
          onClick={() => { if (playable) playSong(song, songs) }}
          disabled={!playable}
          aria-label={active && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          title={playable ? `Play ${track.title}` : 'This track is not streamable'}
          className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.4)' }}
        >
          <span className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
            {active && isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
          </span>
        </button>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase mb-1.5" style={{ color: 'var(--accent)', letterSpacing: 'var(--tracking-caps)' }}>
          Featured · #1 on the charts
        </p>
        <p className="text-lg sm:text-xl font-semibold truncate" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          {track.title}
        </p>
        <p className="text-sm truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          {track.artist}
          {track.subtitle ? <span style={{ color: 'var(--text-faint)' }}> · {track.subtitle}</span> : null}
        </p>
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => { if (playable) playSong(song, songs) }}
            disabled={!playable}
            className="gel-press flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            {active && isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
            {active && isPlaying ? 'Playing' : 'Play now'}
          </button>
          {track.permalink && (
            <a
              href={track.permalink} target="_blank" rel="noreferrer"
              title="Open on audius.co"
              aria-label={`Open ${track.title} on audius.co`}
              className="p-1.5 rounded-lg icon-hover"
              style={{ color: 'var(--text-faint)' }}
            >
              <ExternalLink size={13} />
            </a>
          )}
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
            {track.durationSec ? formatTime(track.durationSec) : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── TrackTile — square-artwork card (horizontal rail / grid item) ───────────
// Rank badge top-left, hover play overlay, title + artist below. One tile per
// track; the parent owns the list used for queue continuity.
export const TrackTile = memo(function TrackTile({ track, rank, songs }: {
  track: OnlineTrack
  rank: number
  songs: ReturnType<typeof toSong>[]
}) {
  const playSong = usePlayerStore((s) => s.playSong)
  const currentSongId = usePlayerStore((s) => s.currentSong?.id)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const song = toSong(track)
  const playable = track.isStreamable && !!track.streamUrl
  const active = currentSongId === song.id
  return (
    <div
      className="gel-press shrink-0 w-[150px] cursor-pointer group/tile"
      onClick={() => { if (playable) playSong(song, songs) }}
      onKeyDown={(e) => { if (playable && e.key === 'Enter') { e.preventDefault(); playSong(song, songs) } }}
      tabIndex={playable ? 0 : -1}
      aria-disabled={!playable}
      role="button"
      title={playable ? `Play ${track.title}` : 'This track is not streamable'}
    >
      <div className="relative w-[150px] h-[150px] rounded-xl overflow-hidden" style={{ background: 'var(--glass-2)', boxShadow: active ? '0 0 0 1.5px var(--accent-border)' : undefined }}>
        {track.artworkUrl
          ? <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <ArtworkPlaceholder seed={track.id} size="md" />}
        <span
          className="absolute top-1.5 left-1.5 min-w-5 h-5 px-1 flex items-center justify-center rounded-md text-[10px] font-semibold tabular-nums"
          style={{ background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)' }}
        >
          {rank}
        </span>
        <span
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/tile:opacity-100 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.32)' }}
        >
          <span className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
            {active && isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </span>
        </span>
      </div>
      <p className="text-xs font-medium truncate mt-1.5" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{track.title}</p>
      <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
        {track.artist}
        {!track.isStreamable ? <span style={{ color: 'var(--text-faint)' }}> · not streamable</span> : null}
      </p>
    </div>
  )
})

// ── PlaylistCardLarge — editorial 2-up card (Online Playlists) ──────────────
export function PlaylistCardLarge({ playlist, onOpen }: { playlist: AudiusPlaylist; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="gel-press flex flex-col rounded-2xl overflow-hidden text-left"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      title={`Open ${playlist.name}`}
    >
      <div className="w-full aspect-[2/1] overflow-hidden" style={{ background: 'var(--glass-2)' }}>
        {playlist.artworkUrl
          ? <img src={playlist.artworkUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <div className="w-full h-full flex items-center justify-center"><ListMusic size={26} style={{ color: 'var(--text-faint)' }} /></div>}
      </div>
      <div className="p-3">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{playlist.name}</p>
        <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-faint)' }}>
          {playlist.subtitle ? `${playlist.subtitle} · ` : ''}{playlist.trackCount} tracks
        </p>
      </div>
    </button>
  )
}
