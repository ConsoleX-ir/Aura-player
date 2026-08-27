import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { X, Mic2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useLyrics } from '@/hooks/useLyrics'

// Matches PlayerBar's panel width constant — w-72.
const PANEL_WIDTH = 288

export function LyricsPanel({ anchorX, onClose }: { anchorX: number; onClose: () => void }) {
  // Narrow selectors — this panel genuinely needs progress/duration for the
  // active-line highlight, but the previous full-store subscribe also
  // re-rendered it on totally unrelated changes (e.g. toggling a favorite
  // on some other song while this panel happened to be open).
  const currentSong = usePlayerStore((s) => s.currentSong)
  const progress = usePlayerStore((s) => s.progress)
  const duration = usePlayerStore((s) => s.duration)
  const { lines, plain, loading } = useLyrics(currentSong)
  const currentTime = progress * duration
  const activeRef = useRef<HTMLDivElement>(null)

  const activeIdx = lines.reduce((best, line, i) => currentTime >= line.time ? i : best, -1)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIdx])

  // Anchor to the trigger icon: center the panel on the icon's x position,
  // clamped so it never spills off either edge of the window. Computed once
  // per mount (panels remount each time they open), and the caret sits
  // wherever the icon ended up inside the clamped panel.
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
      className="fixed z-50 w-72 max-h-80 flex flex-col overflow-visible"
      style={{
        bottom: 'calc(var(--spacing-player) + 12px)',
        left: `${left}px`,
        background: 'var(--color-chrome)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--color-border-mid)',
        borderRadius: 16,
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        transformOrigin: 'bottom center',
      }}
    >
      {/* Caret pointing at the triggering icon in the play bar */}
      <div
        aria-hidden
        className="absolute w-3 h-3 rotate-45"
        style={{
          top: -7,
          left: caretLeft,
          background: '#17171e', // opaque core of --color-chrome so no seam shows where it overlaps the panel
          borderTop: '1px solid var(--color-border-mid)',
          borderLeft: '1px solid var(--color-border-mid)',
        }}
      />
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <Mic2 size={13} style={{ color: 'var(--color-dynamic-1)' }} />
          <span className="text-xs font-semibold text-white/70 tracking-wide">Lyrics</span>
        </div>
        <button onClick={onClose} className="w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-white/50 hover:bg-white/5 transition-all">
          <X size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-3 px-4 space-y-1.5">
        {loading && (
          <div className="flex justify-center py-8">
            <div className="flex gap-1 items-end h-4">
              {[0,1,2].map((i) => (
                <motion.div key={i} className="w-1 rounded-full"
                  style={{ background: 'var(--color-dynamic-1)' }}
                  animate={{ height: ['4px','14px','4px'] }}
                  transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }} />
              ))}
            </div>
          </div>
        )}

        {!loading && lines.length === 0 && !plain && (
          <div className="flex flex-col items-center py-8 gap-2">
            <Mic2 size={20} className="text-white/10" />
            <p className="text-xs text-white/20">No lyrics found</p>
          </div>
        )}

        {lines.map((line, i) => (
          <div key={i} ref={i === activeIdx ? activeRef : null}>
            <motion.p
              animate={{
                color: i === activeIdx ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.22)',
                scale: i === activeIdx ? 1.02 : 1,
              }}
              transition={{ duration: 0.25 }}
              className="text-sm leading-relaxed text-center"
              style={{ fontWeight: i === activeIdx ? 500 : 400 }}
            >
              {line.text || '·'}
            </motion.p>
          </div>
        ))}

        {plain && lines.length === 0 && (
          <pre className="text-xs text-white/30 leading-6 whitespace-pre-wrap font-sans text-center">{plain}</pre>
        )}
      </div>

      {/* Bottom color strip */}
      <div className="h-0.5 shrink-0" style={{ background: 'linear-gradient(90deg, transparent, var(--color-dynamic-1), transparent)', opacity: 0.4 }} />
    </motion.div>
  )
}
