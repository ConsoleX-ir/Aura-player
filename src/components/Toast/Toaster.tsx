import { AnimatePresence, motion } from 'framer-motion'
import { Heart, Shuffle, Repeat, Repeat1, VolumeX, Volume2, MoonStar, Music2, BadgeCheck } from 'lucide-react'
import { useToastStore, type ToastKind } from '@/store/toastStore'

// Maps each toast kind to its icon + accent color. Kept as a plain record so
// adding a new kind is a one-line change plus the kind in the union type.
const TOAST_STYLE: Record<ToastKind, { icon: typeof Music2; color: string; bg: string }> = {
  'favorite-add':      { icon: Heart,    color: '#FB7185', bg: 'rgba(251,113,133,0.14)' },
  'favorite-remove':   { icon: Heart,    color: 'rgba(255,255,255,0.4)', bg: 'var(--color-glass-mid)' },
  'shuffle-on':        { icon: Shuffle,  color: 'var(--color-dynamic-1)', bg: 'var(--color-glass-strong)' },
  'shuffle-off':       { icon: Shuffle,  color: 'rgba(255,255,255,0.4)', bg: 'var(--color-glass-mid)' },
  'repeat-none':       { icon: Repeat,   color: 'rgba(255,255,255,0.4)', bg: 'var(--color-glass-mid)' },
  'repeat-all':        { icon: Repeat,   color: 'var(--color-dynamic-1)', bg: 'var(--color-glass-strong)' },
  'repeat-one':        { icon: Repeat1,  color: 'var(--color-dynamic-1)', bg: 'var(--color-glass-strong)' },
  'mute':              { icon: VolumeX,  color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
  'unmute':            { icon: Volume2,  color: 'var(--color-dynamic-1)', bg: 'var(--color-glass-strong)' },
  'sleep-timer':       { icon: MoonStar, color: '#A5B4FC', bg: 'rgba(165,180,252,0.12)' },
  'now-playing':       { icon: Music2,   color: 'var(--color-dynamic-1)', bg: 'var(--color-glass-strong)' },
  'metadata-updated':  { icon: BadgeCheck, color: 'var(--color-dynamic-1)', bg: 'var(--color-glass-strong)' },
}

// Purely presentational — auto-dismiss timers live in toastStore, so this
// never manages timeouts itself (see the note there for why).

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[250] flex flex-col items-center gap-2 pointer-events-none"
      style={{ bottom: 'calc(var(--spacing-player) + 18px)' }}
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const style = TOAST_STYLE[t.kind]
          const Icon = style.icon
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 480, damping: 34 }}
              className="flex items-center gap-3 pl-2.5 pr-5 py-2 rounded-2xl border border-[var(--color-border-mid)]"
              style={{
                background: 'var(--color-chrome)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: '0 16px 44px rgba(0,0,0,0.55)',
                minWidth: 240,
              }}
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: style.bg }}>
                <Icon size={14} style={{ color: style.color }} fill={t.kind === 'favorite-add' ? style.color : 'none'} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white/85 leading-tight">{t.title}</p>
                {t.subtitle && (
                  <p className="text-[11px] text-white/35 truncate mt-0.5 max-w-[260px]">{t.subtitle}</p>
                )}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
