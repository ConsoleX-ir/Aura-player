import { useRef, useState } from 'react'
import { AudioWaveform } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { EQ_PRESETS, EQ_BAND_LABELS, EQ_MIN_DB, EQ_MAX_DB, isFlat } from '@/lib/eq'
import { UserPresetChip, SavePresetControl } from './UserPresetChip'

// ── Audio Studio → Equalizer (v3.2.0) ───────────────────────────────────────
// The Wave 3 card, upgraded for its new home as a Studio section:
//   • an honest ENABLE gate — disabled flattens the bands while the user's
//     curve stays intact in the store (the engine glides, nothing rebuilds)
//   • the built-in curves (now incl. Pop and Acoustic)
//   • FULL custom-preset CRUD: save the current curve, rename, duplicate,
//     delete, apply — persisted across launches (spec §5.7)
// "Flat" remains the true transparent state: every filter at 0 dB costs
// nothing, exactly as before.

const RANGE = EQ_MAX_DB - EQ_MIN_DB

export function EqualizerCard({ bypassed }: { bypassed: boolean }) {
  const eqGains = usePlayerStore((s) => s.eqGains)
  const eqPreset = usePlayerStore((s) => s.eqPreset)
  const eqEnabled = usePlayerStore((s) => s.eqEnabled)
  const setEqEnabled = usePlayerStore((s) => s.setEqEnabled)
  const setEqBand = usePlayerStore((s) => s.setEqBand)
  const applyEqPreset = usePlayerStore((s) => s.applyEqPreset)
  const eqUserPresets = usePlayerStore((s) => s.eqUserPresets)
  const saveEqPreset = usePlayerStore((s) => s.saveEqPreset)
  const renameEqPreset = usePlayerStore((s) => s.renameEqPreset)
  const duplicateEqPreset = usePlayerStore((s) => s.duplicateEqPreset)
  const deleteEqPreset = usePlayerStore((s) => s.deleteEqPreset)
  const applyEqUserPreset = usePlayerStore((s) => s.applyEqUserPreset)

  const inert = !eqEnabled || bypassed

  return (
    <div
      className="p-4 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      data-testid="equalizer-card"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            <AudioWaveform size={14} style={{ color: 'var(--accent)' }} />
            Equalizer
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Shapes the tone of everything Aura plays. Flat is perfect transparency — the filters
            sit at 0 dB and cost nothing.
          </p>
        </div>
        {/* Enable gate — the curve is preserved while off */}
        <button
          onClick={() => setEqEnabled(!eqEnabled)}
          role="switch"
          aria-checked={eqEnabled}
          aria-label="Toggle equalizer"
          data-eq-enabled-toggle
          className="relative w-11 h-6 rounded-full transition-all shrink-0 pressable mt-1"
          style={{ background: eqEnabled ? 'var(--accent)' : 'var(--glass-3)', transitionDuration: 'var(--dur-fast)' }}
          onMouseEnter={(e) => { if (!eqEnabled) e.currentTarget.style.background = 'var(--surface-selected)' }}
          onMouseLeave={(e) => { if (!eqEnabled) e.currentTarget.style.background = 'var(--glass-3)' }}
        >
          <span
            className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform"
            style={{ background: 'var(--text-on-accent)', transform: eqEnabled ? 'translateX(20px)' : 'translateX(0)' }}
          />
        </button>
      </div>

      {/* Built-in presets */}
      <div className="flex items-center gap-1.5 flex-wrap justify-start mb-2">
        {EQ_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyEqPreset(p.id)}
            disabled={inert}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all active:scale-95 disabled:opacity-40"
            style={
              eqPreset === p.id
                ? { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }
                : { background: 'var(--glass-2)', color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' }
            }
            onMouseEnter={(e) => { if (eqPreset !== p.id) e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { if (eqPreset !== p.id) e.currentTarget.style.color = 'var(--text-tertiary)' }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* User presets — full CRUD */}
      <div className="flex items-center gap-1.5 flex-wrap justify-start mb-3" data-eq-user-presets>
        {eqUserPresets.map((p) => (
          <UserPresetChip
            key={p.id}
            name={p.name}
            active={eqPreset === p.name}
            onApply={() => applyEqUserPreset(p.id)}
            onRename={(newName) => renameEqPreset(p.id, newName)}
            onDuplicate={() => duplicateEqPreset(p.id)}
            onDelete={() => deleteEqPreset(p.id)}
          />
        ))}
        <SavePresetControl
          label="Save Curve"
          disabled={inert}
          onSave={(name) => saveEqPreset(name)}
        />
      </div>

      {/* Bands */}
      <div
        className="flex items-stretch justify-between gap-1 pt-2 pb-0.5 px-1 rounded-lg"
        style={{
          background: 'var(--surface-inset)',
          opacity: inert ? 0.4 : 1,
          transition: 'opacity var(--dur-fast) var(--ease-smooth)',
          pointerEvents: inert ? 'none' : 'auto',
        }}
        aria-disabled={inert}
      >
        {eqGains.map((g, i) => (
          <EqBand
            key={i}
            index={i}
            label={EQ_BAND_LABELS[i]}
            value={g}
            onChange={(v) => setEqBand(i, v)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
          Drag a band · double-click resets it · arrow keys nudge ±1 dB
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: isFlat(eqGains) ? 'var(--text-faint)' : 'var(--accent)' }}>
          {!eqEnabled
            ? 'EQ off — curve kept'
            : eqPreset === 'custom' ? 'Custom curve' : EQ_PRESETS.find((p) => p.id === eqPreset)?.label ?? eqPreset}
          {eqEnabled && isFlat(eqGains) ? ' · bypassed' : ''}
        </span>
      </div>
    </div>
  )
}

// One vertical band. Pointer-driven: down/drag computes the value from the
// pointer's Y within the track (VST-style — center is 0, top is +12, bottom
// is −12). Double-click snaps back to 0; arrows nudge by 1 dB.
function EqBand({ index, label, value, onChange }: {
  index: number
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const valueFromPointer = (clientY: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const half = rect.height / 2
    const offset = (rect.top + half) - clientY     // + above center, − below
    const db = (offset / half) * (RANGE / 2)
    return Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, Math.round(db * 2) / 2))
  }

  const pct = Math.min(1, Math.abs(value) / (RANGE / 2)) * 50 // fill % from center

  return (
    <div className="flex flex-col items-center gap-1.5 select-none w-9">
      <span
        className="text-[9px] tabular-nums transition-opacity"
        style={{ color: value !== 0 ? 'var(--accent)' : 'var(--text-faint)', opacity: dragging ? 1 : 0.75 }}
      >
        {value > 0 ? `+${value}` : value}
      </span>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label} Hz band`}
        aria-valuemin={EQ_MIN_DB}
        aria-valuemax={EQ_MAX_DB}
        aria-valuenow={value}
        className="relative w-9 flex-1 min-h-24 cursor-ns-resize rounded-md outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring-color)]"
        style={{
          background: 'var(--glass-1)',
          touchAction: 'none',
        }}
        data-eq-band={index}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          onChange(valueFromPointer(e.clientY))
        }}
        onPointerMove={(e) => {
          if (!dragging) return
          onChange(valueFromPointer(e.clientY))
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => onChange(0)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { onChange(Math.min(EQ_MAX_DB, value + 1)); e.preventDefault() }
          if (e.key === 'ArrowDown') { onChange(Math.max(EQ_MIN_DB, value - 1)); e.preventDefault() }
        }}
      >
        {/* 0 dB reference line */}
        <div className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2" style={{ background: 'var(--border-default)' }} />
        {/* Fill from center toward the value */}
        <div
          className="absolute left-1/2 -translate-x-1/2 w-1.5 rounded-full pointer-events-none"
          style={
            value >= 0
              ? { bottom: '50%', height: `${pct}%`, background: 'linear-gradient(0deg, var(--accent), var(--accent-strong))' }
              : { top: '50%', height: `${pct}%`, background: 'linear-gradient(180deg, var(--accent), var(--accent-strong))' }
          }
        />
        {/* Thumb */}
        <div
          className="absolute left-1/2 w-2.5 h-2.5 rounded-full pointer-events-none"
          style={{
            top: `${50 - (value / (RANGE / 2)) * 50}%`,
            transform: 'translate(-50%, -50%)',
            background: 'var(--text-on-accent)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}
        />
      </div>

      <span className="text-[9px]" style={{ color: 'var(--text-faint)' }}>{label}</span>
    </div>
  )
}
