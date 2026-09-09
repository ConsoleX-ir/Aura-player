import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

/* ── Shared state primitives (Wave 2) ───────────────────────────────────────
   Every asynchronous / no-data surface in Aura renders through these so the
   whole app speaks one visual language for loading, empty, and error.

   Loading  → Skeleton (shimmer via .skeleton in index.css; the animation
              itself already respects Performance Mode + reduced motion).
   Empty    → EmptyState (icon aura + title + hint + optional action).
   Error    → ErrorState (same shape as EmptyState, danger accent). */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={`skeleton ${className ?? ''}`} style={style} />
}

/** One library row worth of placeholder: index stub, square art, two text
 *  lines, duration stub. Matches SongRow's 52px rhythm. */
export function SongRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2" style={{ height: 52 }}>
      <Skeleton className="w-7 h-3 shrink-0" />
      <Skeleton className="w-9 h-9 rounded-lg shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/5" />
      </div>
      <Skeleton className="w-9 h-2.5 shrink-0" />
    </div>
  )
}

/** Screen-reader-friendly block of rows; used while the persisted library
 *  rehydrates from IndexedDB on cold boot. */
export function SongListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading your library" className="px-7 pt-2">
      {Array.from({ length: rows }, (_, i) => (
        <SongRowSkeleton key={i} />
      ))}
    </div>
  )
}

/* ── EmptyState / ErrorState ─────────────────────────────────────────────── */

interface EmptyStateProps {
  /** Usually a lucide icon node, rendered inside the aura ring. */
  icon?: ReactNode
  title: string
  hint?: string
  /** Optional CTA row (button(s)) below the copy. */
  action?: ReactNode
  /** Compact variant for small surfaces (playlist panel, sidebar). */
  compact?: boolean
  /** danger → error styling; default → calm cloud styling. */
  tone?: 'neutral' | 'danger'
}

export function EmptyState({ icon, title, hint, action, compact = false, tone = 'neutral' }: EmptyStateProps) {
  const ringColor = tone === 'danger' ? 'var(--danger-veil)' : 'var(--cloud-glow)'
  const iconColor = tone === 'danger' ? 'var(--danger)' : 'var(--cloud)'
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center justify-center text-center gap-4 px-7"
      style={compact ? { padding: '20px 14px' } : undefined}
    >
      {icon && (
        <div className="relative shrink-0">
          <div
            className={`flex items-center justify-center ${compact ? 'w-12 h-12 rounded-2xl' : 'w-20 h-20 rounded-3xl'}`}
            style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)' }}
          >
            <div className={compact ? 'scale-75' : ''} style={{ color: iconColor, opacity: 0.55 }}>
              {icon}
            </div>
          </div>
          {/* Aura ring — the idle glow that breathes once, then rests */}
          <div
            className="absolute inset-0 rounded-3xl animate-breathe pointer-events-none"
            style={{ boxShadow: `0 0 40px ${ringColor}`, borderRadius: 'inherit' }}
          />
        </div>
      )}
      <div>
        <p className={`font-medium ${compact ? 'text-xs' : 'text-sm'}`} style={{ color: 'var(--text-secondary)' }}>
          {title}
        </p>
        {hint && (
          <p className={`mt-1 ${compact ? 'text-[11px]' : 'text-xs'}`} style={{ color: 'var(--text-faint)' }}>
            {hint}
          </p>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </motion.div>
  )
}
