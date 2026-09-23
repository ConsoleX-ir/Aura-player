import { useEffect, useRef, useState } from 'react'
import type { RadioFacet } from '@/services/providers/radiobrowser'

// ── RadioFilters (v2.16.1) — facet dropdowns ─────────────────────────────────
// Country / Language / Genre popovers with live counts. Extracted from the
// RadioTab monolith so the filter voice can never drift from the rest of
// Explore's popover language (same surface, radius, shadow tokens).

type FacetKey = 'country' | 'language' | 'tag'

export function RadioFilters({ configs, active, disabled, onSelect, onClear }: {
  configs: { key: FacetKey; label: string; options: RadioFacet[] }[]
  active: { country?: string; language?: string; tag?: string }
  disabled: boolean
  onSelect: (key: FacetKey, value: string | null) => void
  onClear: (key: FacetKey) => void
}) {
  return (
    <>
      {configs.map(({ key, label, options }) => (
        <FacetDropdown
          key={key}
          label={label}
          options={options}
          active={active[key]}
          disabled={disabled}
          onSelect={(v) => onSelect(key, v)}
          onClear={() => onClear(key)}
        />
      ))}
    </>
  )
}

export function FacetDropdown({ label, options, active, disabled, onSelect, onClear }: {
  label: string
  options: RadioFacet[]
  active?: string
  disabled?: boolean
  onSelect: (value: string | null) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-40"
        style={{
          background: active ? 'var(--accent-dim)' : 'var(--glass-1)',
          border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border-default)'}`,
          color: active ? 'var(--accent)' : 'var(--text-secondary)',
        }}
        title={`Filter by ${label.toLowerCase()}`}
        aria-expanded={open}
      >
        <span className="max-w-20 truncate">{active ?? label}</span>
        {active && (
          <span
            role="button"
            aria-label={`Clear ${label} filter`}
            onClick={(e) => { e.stopPropagation(); onClear(); setOpen(false) }}
            className="hover:opacity-70 text-[10px]"
          >
            ✕
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 min-w-48 max-h-64 overflow-y-auto p-1 rounded-xl text-sm right-0"
          style={{
            zIndex: 'var(--z-dropdown)',
            background: 'var(--surface-chrome)',
            border: '1px solid var(--border-strong)',
            boxShadow: 'var(--shadow-overlay)',
          }}
        >
          {options.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-faint)' }}>Loading…</p>
          )}
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onSelect(o.value === active ? null : o.value); setOpen(false) }}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors text-left"
              style={{ color: active === o.value ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              <span className="truncate">{o.label}</span>
              <span className="text-[10px] tabular-nums shrink-0" style={{ color: 'var(--text-faint)' }}>{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
