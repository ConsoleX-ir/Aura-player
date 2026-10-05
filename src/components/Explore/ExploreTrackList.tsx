import { memo, useMemo } from 'react'
import { ExternalLink, Pause, Play } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { formatTime, cn } from '@/lib/utils'
import { toSong, type OnlineTrack } from '@/services/providers/audius'

// ── Explore track rows (v2.16.1) ─────────────────────────────────────────────
// Provider-agnostic: the queue plays these like local songs through the ONE
// playback funnel (playSong). Rows are memoized so a store tick (progress,
// queue edits) re-renders only rows whose ACTIVE state actually changed.

interface RowProps {
  track: OnlineTrack
  song: ReturnType<typeof toSong>
  active: boolean
  playing: boolean
  /** Rows are identical save for the active flag — group re-render only on change. */
  onPlay: (song: ReturnType<typeof toSong>, list: ReturnType<typeof toSong>[]) => void
  songs: ReturnType<typeof toSong>[]
}

const TrackRow = memo(function TrackRow({ track, song, active, playing, onPlay, songs }: RowProps) {
  const playable = track.isStreamable && !!track.streamUrl
  return (
    <div
      tabIndex={playable ? 0 : -1}
      aria-disabled={!playable}
      onKeyDown={(e) => {
        if (playable && e.key === 'Enter') { e.preventDefault(); onPlay(song, songs) }
      }}
      className={cn(
        'group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors',
        !playable && 'opacity-45 cursor-not-allowed',
      )}
      style={{ background: active ? 'var(--accent-dim)' : undefined }}
      onClick={() => { if (playable) onPlay(song, songs) }}
      title={playable ? `Play ${track.title}` : 'This track is not streamable'}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden" style={{ background: 'var(--glass-2)' }}>
        {track.artworkUrl
          ? <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          : <ArtworkPlaceholder seed={track.id} size="sm" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)', fontWeight: active ? 500 : 400 }}>
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
      <div className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center" style={{ background: active && playing ? 'var(--accent-veil)' : 'var(--glass-2)' }}>
        {active && playing
          ? <Pause size={11} style={{ color: 'var(--accent)' }} />
          : <Play size={11} style={{ color: playable ? 'var(--text-secondary)' : 'var(--text-faint)' }} fill="currentColor" />}
      </div>
    </div>
  )
})

export function TrackList({ tracks }: { tracks: OnlineTrack[] }) {
  const playSong = usePlayerStore((s) => s.playSong)
  const currentSongId = usePlayerStore((s) => s.currentSong?.id)
  const isPlaying = usePlayerStore((s) => s.isPlaying)

  const songs = useMemo(() => tracks.map(toSong), [tracks])

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
      {tracks.map((track, i) => {
        const song = songs[i]
        return (
          <div key={track.id} style={{ borderTop: i > 0 ? '1px solid var(--border-subtle)' : undefined }}>
            <TrackRow
              track={track}
              song={song}
              songs={songs}
              active={currentSongId === song.id}
              playing={isPlaying}
              onPlay={playSong}
            />
          </div>
        )
      })}
    </div>
  )
}
