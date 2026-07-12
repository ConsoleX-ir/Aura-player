import { memo, useState } from 'react'
import { Play, Heart, MoreHorizontal, Music2, ListX, Trash2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { formatTime, cn } from '@/lib/utils'
import type { Song } from '@/types'
import { ConfirmModal } from '@/components/Modals/ConfirmModal'

interface SongRowProps {
  song: Song
  index: number
  queue: Song[]
  showAlbumArt?: boolean
  /** When the row is rendered inside a specific playlist's view, this enables
   *  a "Remove from Playlist" action scoped to just that playlist. */
  playlistId?: string
}

// Narrow selectors only — the previous full `usePlayerStore()` destructure
// subscribed every row to the ENTIRE store, so all N rows re-rendered on
// every single state change, including the ~4-10Hz progress tick during
// playback. `memo` alone does NOT prevent this: memo only skips a re-render
// triggered by the *parent* passing the same props — it has no effect on a
// re-render triggered by the component's own store subscription firing.
// Selecting individual primitives (and a per-song boolean for `favorites`,
// rather than the whole array) means each row only re-renders when something
// about *that row* actually changed.
export const SongRow = memo(function SongRow({ song, index, queue, showAlbumArt = true, playlistId }: SongRowProps) {
  const currentSongId = usePlayerStore((s) => s.currentSong?.id)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isFav = usePlayerStore((s) => s.favorites.includes(song.id))
  const playlists = usePlayerStore((s) => s.playlists)
  const playSong = usePlayerStore((s) => s.playSong)
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite)
  const addToPlaylist = usePlayerStore((s) => s.addToPlaylist)
  const removeFromPlaylist = usePlayerStore((s) => s.removeFromPlaylist)
  const removeFromLibrary = usePlayerStore((s) => s.removeFromLibrary)
  const isActive = currentSongId === song.id
  const [confirmRemoveLibrary, setConfirmRemoveLibrary] = useState(false)

  return (
    <div
      onDoubleClick={() => playSong(song, queue)}
      className={cn(
        'group flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors duration-100',
        isActive ? 'bg-white/5' : 'hover:bg-white/[0.03]'
      )}
    >
      {/* Index / play */}
      <div className="w-7 shrink-0 flex items-center justify-center">
        {isActive && isPlaying
          ? <PlayingBars />
          : <span className={cn('text-xs tabular-nums group-hover:hidden', isActive ? 'text-[var(--color-dynamic-1)]' : 'text-white/20')}>
              {index + 1}
            </span>
        }
        <button onClick={() => playSong(song, queue)}
          className={cn('hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full text-white/90 bg-white/10 hover:bg-white/20 transition-all',
            isActive && isPlaying ? '!hidden' : ''
          )}>
          <Play size={9} fill="currentColor" className="ml-px" />
        </button>
      </div>

      {showAlbumArt && (
        <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden">
          {song.coverArt
            ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full bg-[var(--color-glass-mid)] flex items-center justify-center">
                <Music2 size={12} className="text-white/20" />
              </div>
          }
        </div>
      )}

      {/* Title */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm truncate', isActive ? 'font-medium' : '')}
          style={{ color: isActive ? 'var(--color-dynamic-1)' : 'rgba(255,255,255,0.80)' }}>
          {song.title}
        </p>
        <p className="text-xs text-white/30 truncate">{song.artist}</p>
      </div>

      {/* Album */}
      <p className="text-xs text-white/25 truncate w-36 hidden md:block">{song.album}</p>

      {/* Duration */}
      <span className="text-xs text-white/20 tabular-nums shrink-0 w-9 text-right">{formatTime(song.duration)}</span>

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={(e) => { e.stopPropagation(); toggleFavorite(song.id) }}
          className={cn('p-1.5 rounded-lg transition-all', isFav ? 'text-red-400' : 'text-white/20 hover:text-red-400')}>
          <Heart size={12} fill={isFav ? 'currentColor' : 'none'} />
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="p-1.5 rounded-lg text-white/20 hover:text-white/60 hover:bg-white/5 transition-all">
              <MoreHorizontal size={12} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-[200] min-w-44 p-1 rounded-xl border border-[var(--color-border-mid)] text-sm"
              style={{ background: 'var(--color-chrome)', backdropFilter: 'blur(20px)' }}
              sideOffset={4} align="end">

              {playlists.map((pl) => (
                <DropdownMenu.Item key={pl.id} onClick={() => addToPlaylist(pl.id, song.id)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-white/50 hover:text-white/90 hover:bg-white/5 outline-none transition-colors">
                  Add to {pl.name}
                </DropdownMenu.Item>
              ))}
              {playlists.length === 0 && (
                <div className="px-3 py-2 text-white/20 text-xs">No playlists yet</div>
              )}

              <DropdownMenu.Separator className="h-px bg-[var(--color-border)] my-1" />

              {playlistId && (
                <DropdownMenu.Item
                  onClick={() => removeFromPlaylist(playlistId, song.id)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-white/50 hover:text-white/90 hover:bg-white/5 outline-none transition-colors"
                >
                  <ListX size={13} />
                  Remove from Playlist
                </DropdownMenu.Item>
              )}

              <DropdownMenu.Item
                onClick={() => setConfirmRemoveLibrary(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-red-400/80 hover:text-red-400 hover:bg-red-500/10 outline-none transition-colors"
              >
                <Trash2 size={13} />
                Remove from Library
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <ConfirmModal
        open={confirmRemoveLibrary}
        title="Remove from Library"
        description={`"${song.title}" will be removed from your library, playlists, and favorites. The file on your device is not deleted.`}
        confirmLabel="Remove"
        onConfirm={() => removeFromLibrary(song.id)}
        onClose={() => setConfirmRemoveLibrary(false)}
      />
    </div>
  )
})

// CSS-only animation (see .animate-playing-bar in index.css) — avoids a
// framer-motion instance per visible row just for three bouncing bars
function PlayingBars() {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-0.5 rounded-full animate-playing-bar perf-spin"
          style={{ height: '100%', background: 'var(--color-dynamic-1)', animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  )
}
