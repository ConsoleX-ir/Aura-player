import { motion } from 'framer-motion'
import { Play, Heart, MoreHorizontal, Music2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { formatTime, cn } from '@/lib/utils'
import type { Song } from '@/types'

interface SongRowProps { song: Song; index: number; queue: Song[]; showAlbumArt?: boolean }

export function SongRow({ song, index, queue, showAlbumArt = true }: SongRowProps) {
  const { currentSong, isPlaying, playSong, toggleFavorite, favorites, playlists, addToPlaylist } = usePlayerStore()
  const isActive = currentSong?.id === song.id
  const isFav = favorites.includes(song.id)

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.015, 0.3) }}
      onDoubleClick={() => playSong(song, queue)}
      className={cn(
        'group flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all duration-150',
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
            ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" />
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
              className="z-[200] min-w-40 p-1 rounded-xl border border-[var(--color-border-mid)] text-sm"
              style={{ background: 'rgba(14,14,20,0.96)', backdropFilter: 'blur(20px)' }}
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
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </motion.div>
  )
}

function PlayingBars() {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[0,1,2].map((i) => (
        <motion.div key={i} className="w-0.5 rounded-full"
          style={{ background: 'var(--color-dynamic-1)' }}
          animate={{ scaleY: [0.3, 1, 0.3] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
          initial={{ height: '100%', originY: 1 }} />
      ))}
    </div>
  )
}
