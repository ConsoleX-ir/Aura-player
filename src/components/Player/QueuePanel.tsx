import { motion } from 'framer-motion'
import { X, ListMusic, Music2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useMemo } from 'react'

// Matches PlayerBar's panel width constant — w-72.
const PANEL_WIDTH = 288

// ── Queue popover — Wave 3's pill Play Bar extra action ─────────────────────
// The Now Playing page holds the full queue experience; this popover brings
// the essential part to wherever the user is: what's playing, what plays
// next, and one-click access to both. Same shell/anchor contract as the
// Lyrics and Visualizer panels.
export function QueuePanel({ anchorX, onClose }: { anchorX: number; onClose: () => void }) {
  const queue = usePlayerStore((s) => s.queue)
  const queueIndex = usePlayerStore((s) => s.queueIndex)
  const currentSong = usePlayerStore((s) => s.currentSong)
  const playSong = usePlayerStore((s) => s.playSong)
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue)

  // The store's `queue` IS the real play order (Wave 1 engine). Rotate it so
  // the playing song leads — identical semantics to the Now Playing panel.
  const upNext = useMemo(() => {
    const idx = queueIndex >= 0 && queueIndex < queue.length ? queueIndex : 0
    return [...queue.slice(idx), ...queue.slice(0, idx)]
  }, [queue, queueIndex])

  // Anchor to the trigger icon: center the panel on the icon's x position,
  // clamped so it never spills off either edge of the window.
  const left = Math.min(
    Math.max(anchorX - PANEL_WIDTH / 2, 16),
    (typeof window !== 'undefined' ? window.innerWidth : 1280) - PANEL_WIDTH - 16
  )
  const caretLeft = Math.min(Math.max(anchorX - left - 6, 14), PANEL_WIDTH - 26)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="fixed z-50 w-72 max-h-96 flex flex-col overflow-visible"
      style={{
        bottom: 'calc(var(--spacing-player) + 12px)',
        left: `${left}px`,
        background: 'var(--surface-chrome)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--border-strong)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-overlay)',
        transformOrigin: 'bottom center',
      }}
    >
      {/* Caret pointing at the queue icon in the pill */}
      <div
        aria-hidden
        className="absolute w-3 h-3 rotate-45"
        style={{
          top: -7,
          left: caretLeft,
          background: 'var(--color-chrome-solid)', // theme-aware opaque core (v2.1.0)
          borderTop: '1px solid var(--border-strong)',
          borderLeft: '1px solid var(--border-strong)',
        }}
      />
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <ListMusic size={13} style={{ color: 'var(--accent)' }} />
          <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-secondary)' }}>Up Next</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{queue.length}</span>
          <button onClick={onClose} className="w-5 h-5 rounded flex items-center justify-center hover:bg-ink/5 transition-all" style={{ color: 'var(--text-faint)' }}>
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {upNext.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8" style={{ color: 'var(--text-faint)' }}>
            <ListMusic size={20} />
            <p className="text-xs">Queue is empty</p>
          </div>
        )}
        {upNext.map((song, i) => {
          const isActive = song.id === currentSong?.id
          const realIdx = queue.findIndex((s) => s.id === song.id)
          return (
            <div
              key={`${song.id}-${i}`}
              className={`group flex items-center gap-2.5 px-3 py-1.5 cursor-pointer transition-colors ${isActive ? '' : 'hover-surface'}`}
              style={{ background: isActive ? 'var(--surface-inset)' : undefined }}
              onClick={() => playSong(song, queue)}
              title={isActive ? 'Now playing' : `Play ${song.title}`}
            >
              <div className="w-7 h-7 rounded-md overflow-hidden shrink-0" style={{ background: 'var(--glass-2)' }}>
                {song.coverArt
                  ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" loading="lazy" />
                  : <div className="w-full h-full flex items-center justify-center"><Music2 size={10} style={{ color: 'var(--text-faint)' }} /></div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate" style={{ color: isActive ? 'var(--accent)' : 'var(--text-primary)', fontWeight: isActive ? 500 : 400 }}>
                  {song.title}
                </p>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>{song.artist}</p>
              </div>
              {!isActive && realIdx !== -1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromQueue(realIdx) }}
                  title="Remove from queue"
                  className="p-1 rounded-md shrink-0 transition-colors opacity-0 group-hover:opacity-100 hover:bg-ink/5"
                  style={{ color: 'var(--text-faint)' }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
