import { Radio, Heart, Play, Pause, Signal } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useRadioStore, type RadioStation } from '@/store/radioStore'
import { clickStation, toStationSong } from '@/services/providers/radiobrowser'
import { cn } from '@/lib/utils'

// ── StationList (v2.16.1) — live radio rows ──────────────────────────────────
// Playing a station makes it a ONE-item queue of a live Song (duration 0 —
// progress idles, seek is a no-op; streamCors:false so CORS-less streams
// load). The live-state UI never shows misleading playback progress for a
// stream. Favorites ride the persisted radioStore and render offline.

export function StationList({ stations }: { stations: RadioStation[] }) {
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
