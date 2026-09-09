import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/types'
import { ArtworkPlaceholder, UnknownValue } from '@/components/States/ArtworkPlaceholder'

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
      <div className="relative aspect-square overflow-hidden" style={{ background: 'var(--glass-1)' }}>
        {coverArt
          ? <img src={coverArt} alt={album} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-600" loading="lazy" />
          // Missing artwork → the album's own generated aura (stable per
          // album key), not a dead gray box.
          : <ArtworkPlaceholder seed={`${album}|||${artist}`} size="lg" />
        }

        {/* Overlay */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.40)' }}
        >
          <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{ background: 'var(--glass-3)', border: '1px solid var(--border-emphasis)', backdropFilter: 'blur(4px)' }}
          >
            <Play size={16} style={{ color: 'var(--text-on-accent)' }} className="ml-0.5" fill="currentColor" />
          </motion.div>
        </div>

        <div
          className="absolute bottom-2 right-2 px-2 py-0.5 rounded-pill text-[10px]"
          style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)', color: 'var(--text-secondary)' }}
        >
          {songs.length} {songs.length === 1 ? 'track' : 'tracks'}
        </div>
      </div>

      <div className="p-3">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{album}</p>
        <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          <UnknownValue>{artist}</UnknownValue>
        </p>
      </div>
    </>
  )

  const className = "content-auto card-3d group cursor-pointer rounded-2xl overflow-hidden"
  const cardStyle: React.CSSProperties = {
    background: 'var(--surface-card)',
    border: '1px solid var(--border-subtle)',
  }

  if (!animateIn) {
    return (
      <div className={className} style={cardStyle} onClick={() => playSong(songs[0], songs)}>
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
      style={cardStyle}
      onClick={() => playSong(songs[0], songs)}
    >
      {content}
    </motion.div>
  )
}
