import { AnimatePresence, motion } from 'framer-motion'
import { Heart, Shuffle, Repeat, Repeat1, VolumeX, Volume2, MoonStar, Music2, BadgeCheck, RefreshCw, ImageDown } from 'lucide-react'
import { useToastStore, type ToastKind } from '@/store/toastStore'

// Maps each toast kind to its icon + accent color. Kept as a plain record so
// adding a new kind is a one-line change plus the kind in the union type.
// Colors come from the token layer (status family + live accent).
const TOAST_STYLE: Record<ToastKind, { icon: typeof Music2; color: string; bg: string }> = {
  'favorite-add':      { icon: Heart,    color: 'var(--favorite)', bg: 'var(--favorite-veil)' },
  'favorite-remove':   { icon: Heart,    color: 'var(--text-tertiary)', bg: 'var(--glass-2)' },
  'shuffle-on':        { icon: Shuffle,  color: 'var(--accent)', bg: 'var(--glass-3)' },
  'shuffle-off':       { icon: Shuffle,  color: 'var(--text-tertiary)', bg: 'var(--glass-2)' },
  'repeat-none':       { icon: Repeat,   color: 'var(--text-tertiary)', bg: 'var(--glass-2)' },
  'repeat-all':        { icon: Repeat,   color: 'var(--accent)', bg: 'var(--glass-3)' },
  'repeat-one':        { icon: Repeat1,  color: 'var(--accent)', bg: 'var(--glass-3)' },
  'mute':              { icon: VolumeX,  color: 'var(--warning)', bg: 'var(--warning-veil)' },
  'unmute':            { icon: Volume2,  color: 'var(--accent)', bg: 'var(--glass-3)' },
  'sleep-timer':       { icon: MoonStar, color: 'var(--accent-strong)', bg: 'var(--accent-veil)' },
  'now-playing':       { icon: Music2,   color: 'var(--accent)', bg: 'var(--glass-3)' },
  'metadata-updated':  { icon: BadgeCheck, color: 'var(--accent)', bg: 'var(--glass-3)' },
  'library-synced':    { icon: RefreshCw, color: 'var(--success)', bg: 'var(--success-veil)' },
  'rewind-saved':      { icon: ImageDown, color: 'var(--accent)', bg: 'var(--glass-3)' },
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
              className="flex items-center gap-3 pl-2.5 pr-5 py-2 rounded-2xl"
              style={{
                zIndex: 'var(--z-toast)',
                background: 'var(--surface-chrome)',
                border: '1px solid var(--border-strong)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                boxShadow: 'var(--shadow-overlay)',
                minWidth: 240,
              }}
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: style.bg }}>
                <Icon size={14} style={{ color: style.color }} fill={t.kind === 'favorite-add' ? style.color : 'none'} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
                {t.subtitle && (
                  <p className="text-[11px] truncate mt-0.5 max-w-[260px]" style={{ color: 'var(--text-tertiary)' }}>{t.subtitle}</p>
                )}
              </div>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
