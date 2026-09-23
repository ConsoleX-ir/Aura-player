import { ListMusic, Mic2, BadgeCheck } from 'lucide-react'
import type { AudiusArtist, AudiusPlaylist } from '@/services/providers/audius'

// ── Explore cards (v2.16.1) ──────────────────────────────────────────────────
// Discovery cards share one voice: glass surface, hairline border, spring
// press (gel-press), identical radii — so artists and playlists read as the
// same family of objects even though their bodies differ (round avatar vs
// square artwork).

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
