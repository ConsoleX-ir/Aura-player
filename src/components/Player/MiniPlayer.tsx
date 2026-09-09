import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, SkipForward, Maximize2, Music2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'

// ── Mini-player (Wave 4) ─────────────────────────────────────────────────────
// In-app compact mode: the pill Play Bar steps aside and this small widget
// takes over the bottom-right corner, freeing the full width of the window.
// It carries the essentials — artwork, progress, play/pause, next, and a way
// back — and nothing else. Full transport is one click (or P) away.
//
// Performance: progress arrives via the same ~4-10Hz store tick every player
// surface already uses; the component tree here is tiny (a handful of nodes)
// so re-rendering at that rate is measurably nothing. The progress ring is a
// single SVG circle with stroke-dashoffset — transform/opacity-free, one
// paint, no layout.

const R = 31          // ring radius (px) inside the 68px artwork box
const CIRC = 2 * Math.PI * R

export function MiniPlayer() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const progress = usePlayerStore((s) => s.progress)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const nextSong = usePlayerStore((s) => s.nextSong)
  const setMiniPlayer = useUiStore((s) => s.setMiniPlayer)

  return (
    <motion.div
      data-mini-player
      initial={{ y: 90, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 90, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="fixed bottom-4 right-4 z-50 perf-blur"
      style={{
        background: 'var(--surface-chrome)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-overlay)',
        backdropFilter: 'blur(var(--blur-chrome))',
        WebkitBackdropFilter: 'blur(var(--blur-chrome))',
      }}
    >
      <div className="flex items-center gap-3 p-2.5 pr-3">
        {/* Artwork + progress ring + hover play overlay */}
        <button
          onClick={togglePlay}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="relative w-[68px] h-[68px] shrink-0 group/mini rounded-2xl overflow-hidden"
          style={{ background: 'var(--glass-2)' }}
        >
          {currentSong?.coverArt ? (
            <img src={currentSong.coverArt} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music2 size={20} style={{ color: 'var(--text-faint)' }} />
            </div>
          )}
          {/* Progress ring — accent arc over the artwork's edge */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width={68} height={68} viewBox="0 0 68 68" aria-hidden
          >
            <circle cx={34} cy={34} r={R} fill="none" stroke="var(--glass-3)" strokeWidth={2.5} />
            <circle
              cx={34} cy={34} r={R} fill="none" stroke="var(--accent)" strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
              transform="rotate(-90 34 34)"
            />
          </svg>
          {/* Hover veil with the alternate transport icon */}
          <div
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/mini:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.42)', transitionDuration: 'var(--dur-fast)' }}
          >
            {isPlaying
              ? <Pause size={20} fill="white" color="white" />
              : <Play size={20} fill="white" color="white" className="ml-0.5" />}
          </div>
        </button>

        {/* Title / artist — the only text, truncated hard */}
        <div className="w-36 min-w-0">
          <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {currentSong ? currentSong.title : 'Nothing playing'}
          </p>
          <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {currentSong ? currentSong.artist : 'Aura mini-player'}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-0.5 ml-1">
          <button
            onClick={nextSong}
            title="Next (→)"
            aria-label="Next song"
            className="p-2 rounded-lg icon-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <SkipForward size={15} />
          </button>
          <button
            onClick={() => setMiniPlayer(false)}
            title="Restore player (P)"
            aria-label="Restore full player"
            className="p-2 rounded-lg icon-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* Playing indicator — a 2px accent bar breathing at the widget's top */}
      <AnimatePresence>
        {isPlaying && (
          <motion.div
            className="absolute top-1 left-3 right-3 h-[2px] rounded-pill overflow-hidden pointer-events-none"
            aria-hidden
          >
            <motion.div
              className="h-full w-1/3 rounded-pill"
              style={{ background: 'var(--accent)' }}
              animate={{ x: ['-140%', '340%'] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
