import { motion } from 'framer-motion'
import { Play, Music2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/types'

interface AlbumCardProps {
  album: string; artist: string; songs: Song[]; coverArt: string | null; index: number
  // False for large libraries (see Library.tsx's ANIMATE_GRID_THRESHOLD) —
  // skips framer-motion's spring entrance animation entirely rather than
  // just setting its values to no-ops, since constructing 150+ concurrent
  // spring animation instances has a real JS cost of its own, separate from
  // whatever the browser then has to paint.
  animateIn?: boolean
}

export function AlbumCard({ album, artist, songs, coverArt, index, animateIn = true }: AlbumCardProps) {
  const playSong = usePlayerStore((s) => s.playSong)

  const content = (
    <>
      <div className="relative aspect-square overflow-hidden bg-[var(--color-glass)]">
        {coverArt
          ? <img src={coverArt} alt={album} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-600" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center">
              <Music2 size={36} className="text-white/10" />
            </div>
        }

        {/* Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
            className="w-11 h-11 rounded-full bg-white/15 border border-white/20 backdrop-blur-sm flex items-center justify-center">
            <Play size={16} className="text-white ml-0.5" fill="white" />
          </motion.div>
        </div>

        <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-white/60 text-[10px]">
          {songs.length} {songs.length === 1 ? 'track' : 'tracks'}
        </div>
      </div>

      <div className="p-3">
        <p className="text-sm font-medium text-white/80 truncate">{album}</p>
        <p className="text-xs text-white/30 truncate mt-0.5">{artist}</p>
      </div>
    </>
  )

  const className = "content-auto card-3d group cursor-pointer rounded-2xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-base-3)]"

  if (!animateIn) {
    return (
      <div className={className} onClick={() => playSong(songs[0], songs)}>
        {content}
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.4), type: 'spring', stiffness: 300, damping: 28 }}
      className={className}
      onClick={() => playSong(songs[0], songs)}
    >
      {content}
    </motion.div>
  )
}
