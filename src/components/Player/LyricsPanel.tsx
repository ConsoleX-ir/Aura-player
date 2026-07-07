import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { X, Mic2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useLyrics } from '@/hooks/useLyrics'

export function LyricsPanel({ onClose }: { onClose: () => void }) {
  const { currentSong, progress, duration } = usePlayerStore()
  const { lines, plain, loading } = useLyrics(currentSong)
  const currentTime = progress * duration
  const activeRef = useRef<HTMLDivElement>(null)

  const activeIdx = lines.reduce((best, line, i) => currentTime >= line.time ? i : best, -1)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIdx])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="fixed z-50 w-72 max-h-80 flex flex-col overflow-hidden"
      style={{
        bottom: 'calc(var(--spacing-player) + 12px)',
        right: '360px',
        background: 'rgba(14,14,20,0.92)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--color-border-mid)',
        borderRadius: 16,
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
      }}
    >
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
