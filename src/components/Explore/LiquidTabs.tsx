import { useLayoutEffect, useRef } from 'react'
import { gelPlace, gelTravel, type GelSlot } from '@/lib/liquid'
import { cn } from '@/lib/utils'

// ── LiquidTabs — the gel selection pill (v2.16.1) ───────────────────────────
// The selection is not painted on the buttons: ONE pill element sits under
// the labels and travels from slot to slot with a directional squash +
// house-spring settle (lib/liquid.ts — the liquid-taffy technique, ported to
// compositor-only WAAPI). Buttons always render correct semantics
// (role=tab / aria-selected / arrow-key roving focus); the pill is purely
// the selection's body.
//
// Guards: Performance Mode and prefers-reduced-motion collapse travel to
// instant placement — the pill still renders exactly the same at rest, it
// just never animates. Interruption-safe: a click mid-flight resumes from
// the pill's live position (commitStyles before cancel).
//
// Re-render discipline: the travel effect keys on `value` ONLY. Hosts that
// re-render at playback-tick frequency (the sidebar) must not cancel an
// in-flight travel — slot geometry is read live from the DOM at travel
// time, and the ResizeObserver re-parks the pill if the row's layout
// actually changes.

export interface LiquidTabItem<T extends string = string> {
  id: T
  label: string
  icon?: React.ReactNode
  /** Trailing node — a count badge, for example. */
  trailing?: React.ReactNode
  /** Leading node rendered before the icon (e.g. the sidebar's accent bar).
   * Receives the item's active flag so hosts keep their own state furniture. */
  leading?: (active: boolean) => React.ReactNode
}

interface LiquidTabsProps<T extends string> {
  items: readonly LiquidTabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Names the tablist for screen readers. */
  ariaLabel: string
  /** chip = compact segmented control (Explore tabs); row = full-width nav row (sidebar). */
  variant?: 'chip' | 'row'
  className?: string
}

export function LiquidTabs<T extends string>({ items, value, onChange, ariaLabel, variant = 'chip', className }: LiquidTabsProps<T>) {
  const rowRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const tabRefs = useRef(new Map<T, HTMLButtonElement>())
  const placedRef = useRef(false)
  const prevSlotRef = useRef<GelSlot | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const slotOf = (id: T): GelSlot | null => {
    const el = tabRefs.current.get(id)
    if (!el) return null
    const x = el.offsetLeft
    const width = el.offsetWidth
    if (width === 0) return null
    return { x, width }
  }

  // Selection travel — value is the only dependency (see the re-render
  // discipline note above). A value OUTSIDE the item set (e.g. the sidebar's
  // user is in Settings) tucks the pill away: this group simply has no
  // selection right now.
  useLayoutEffect(() => {
    const pill = pillRef.current
    if (!pill) return
    const to = slotOf(value)
    if (!to) {
      prevSlotRef.current = null
      pill.style.opacity = '0'
      gelPlace(pill, { x: 0, width: 0 })
      return
    }
    const prev = prevSlotRef.current
    prevSlotRef.current = to
    if (!placedRef.current || !prev) {
      pill.style.opacity = '1'
      gelPlace(pill, to)
      placedRef.current = true
      return
    }
    pill.style.opacity = '1'
    gelTravel(pill, prev, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Re-park on layout changes (resize, label growth) WITHOUT animating —
  // the same selection being re-measured, not a selection change. Observed
  // once for the row's life, reading the live selection off a ref.
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || typeof ResizeObserver === 'undefined') return
    let lastWidth = row.offsetWidth
    const ro = new ResizeObserver(() => {
      if (row.offsetWidth === lastWidth) return
      lastWidth = row.offsetWidth
      const pill = pillRef.current
      const to = slotOf(valueRef.current)
      if (pill && to) gelPlace(pill, to)
    })
    ro.observe(row)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Roving focus: Left/Right move focus AND selection (tablist convention
  // for an automatic-activation tablist). Up/Down serve the column layout.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    if (!forward && !backward) return
    const ids = items.map((i) => i.id)
    const at = ids.indexOf(valueRef.current)
    if (at === -1) return
    const next = forward ? (at + 1) % ids.length : (at - 1 + ids.length) % ids.length
    e.preventDefault()
    onChange(ids[next])
    tabRefs.current.get(ids[next])?.focus()
  }

  return (
    <div
      ref={rowRef}
      role="tablist"
      aria-label={ariaLabel}
      data-liquid-tabs=""
      onKeyDown={onKeyDown}
      className={cn(
        'relative inline-flex items-center',
        variant === 'chip' ? 'rounded-xl p-1 gap-0.5' : 'flex-col rounded-xl p-1 gap-0.5 w-full items-stretch',
        className,
      )}
      style={variant === 'chip'
        ? { background: 'var(--glass-1)', border: '1px solid var(--border-default)' }
        : undefined}
    >
      <span
        ref={pillRef}
        aria-hidden="true"
        data-liquid-pill=""
        className="absolute top-1 bottom-1 left-0 rounded-lg will-change-transform"
        style={{
          background: 'var(--glass-3)',
          border: '1px solid var(--border-emphasis)',
          boxShadow: 'inset 0 1px 0 var(--border-emphasis)',
        }}
      />
      {items.map((item) => {
        const active = item.id === value
        const anySelected = items.some((i) => i.id === value)
        return (
          <button
            key={item.id}
            ref={(node) => { if (node) tabRefs.current.set(item.id, node); else tabRefs.current.delete(item.id) }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${item.label} tab`}
            tabIndex={active || !anySelected ? 0 : -1}
            onClick={() => onChange(item.id)}
            title={item.label}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            className={cn(
              'relative flex items-center rounded-lg text-xs font-medium transition-colors outline-none',
              variant === 'chip' ? 'gap-1.5 px-3.5 py-1.5' : 'gap-3 px-3 py-2 text-sm w-full',
            )}
            style={{
              transitionDuration: 'var(--dur-fast)',
              color: active ? 'var(--text-primary)' : 'var(--text-faint)',
            }}
          >
            {item.leading?.(active)}
            {item.icon}
            <span className={variant === 'row' ? 'flex-1 text-left' : undefined}>{item.label}</span>
            {item.trailing}
          </button>
        )
      })}
    </div>
  )
}
