import { useEffect, useRef, useState } from 'react'
import { AudioLines, Save, Trash2, Download, Upload } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import {
  FX_PRESETS, NEUTRAL_FX, isFxNeutral, sanitizeFx, type AudioFxState,
} from '@/lib/audioFx'

// ── Audio FX UI (Aura 3.0 Wave 12) — Settings → Playback ────────────────────
// The engine side has been live since Wave 3 (lowshelf → highshelf →
// compressor → dry/wet synthetic-IR reverb → mid/side widener, all neutral
// at rest). This card gives it a face:
//
//   • five direct controls (bass, treble, compression, reverb, stereo width)
//   • the seven built-in presets + the user's own saved presets
//   • save / delete / EXPORT / IMPORT of presets — JSON CONFIGURATION only
//     (spec §16: Aura has no offline audio rendering pipeline, so "export"
//     never means processed audio)
//
// Bypass is the honest zero-cost state: every knob at its transparent
// neutral value (same rule as the EQ).

const KNOBS: { key: keyof AudioFxState; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
  { key: 'bassGain',     label: 'Bass',        min: 0,   max: 12,  step: 0.5,  fmt: (v) => `${v.toFixed(1)} dB` },
  { key: 'trebleGain',   label: 'Treble',      min: 0,   max: 12,  step: 0.5,  fmt: (v) => `${v.toFixed(1)} dB` },
  { key: 'compression',  label: 'Compression', min: 0,   max: 1,   step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'reverbMix',    label: 'Reverb',      min: 0,   max: 1,   step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'stereoWidth',  label: 'Stereo Width', min: 0.5, max: 2,  step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
]

export function AudioFxCard() {
  const audioFx = usePlayerStore((s) => s.audioFx)
  const setAudioFx = usePlayerStore((s) => s.setAudioFx)
  const fxUserPresets = usePlayerStore((s) => s.fxUserPresets)
  const saveFxPreset = usePlayerStore((s) => s.saveFxPreset)
  const deleteFxPreset = usePlayerStore((s) => s.deleteFxPreset)

  const [presetName, setPresetName] = useState('')
  const [showSave, setShowSave] = useState(false)
  const [fxMsg, setFxMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const neutral = isFxNeutral(audioFx)
  const activeBuiltIn = FX_PRESETS.find((p) =>
    (Object.keys(p.state) as (keyof AudioFxState)[]).every((k) => Math.abs(p.state[k] - audioFx[k]) < 0.001))

  const flash = (msg: string) => {
    setFxMsg(msg)
    window.setTimeout(() => setFxMsg((m) => (m === msg ? null : m)), 2500)
  }

  const applyState = (state: AudioFxState) => setAudioFx(state)

  // ── Export / import — configuration as JSON (never processed audio) ────
  const exportPresets = async () => {
    const payload = {
      kind: 'aura-fx-presets',
      version: 1,
      exportedAt: new Date().toISOString(),
      presets: [
        ...fxUserPresets,
        // Include the CURRENT knob state as a convenience draft (if not neutral).
        ...(isFxNeutral(audioFx) ? [] : [{ name: 'Current Settings', state: audioFx, createdAt: Date.now() }]),
      ],
    }
    try {
      const path = await window.electronAPI?.savePlaylistFile?.('aura-fx-presets.json')
      if (path === null || path === undefined) return // user cancelled
      await window.electronAPI?.writeTextFile?.(path, JSON.stringify(payload, null, 2))
      flash('Presets exported')
    } catch {
      flash('Export failed — check the save location')
    }
  }

  const importPresets = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const list: { name?: unknown; state?: unknown }[] = Array.isArray(data?.presets) ? data.presets : []
      let added = 0
      for (const row of list) {
        if (typeof row.name !== 'string' || !row.name.trim()) continue
        // Sanitize on both sides of the round-trip — foreign files are input.
        usePlayerStore.getState().setAudioFx(NEUTRAL_FX) // no-op clarity; real write below
        const safe = sanitizeFx(row.state)
        const store = usePlayerStore.getState()
        store.setAudioFx(safe)
        store.saveFxPreset(row.name.trim())
        added++
      }
      if (fileRef.current) fileRef.current.value = ''
      flash(added > 0 ? `Imported ${added} preset${added === 1 ? '' : 's'}` : 'No presets found in that file')
    } catch {
      flash('Import failed — that file is not a valid Aura FX preset file')
    }
  }

  // Clear the transient save box when dismissed.
  useEffect(() => { if (!showSave) setPresetName('') }, [showSave])

  return (
    <div
      className="p-4 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      data-testid="audio-fx-card"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            <AudioLines size={14} style={{ color: 'var(--accent)' }} />
            Audio Effects
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Bass, treble, compression, hall reverb and stereo width on top of the Equalizer.
            Bypass is perfect transparency — every engine sits at its neutral point.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[340px] shrink-0">
          {FX_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyState(p.state)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all active:scale-95"
              data-fx-preset={p.id}
              style={
                activeBuiltIn?.id === p.id && neutral === (p.id === 'off')
                  ? (p.id === 'off'
                    ? { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }
                    : { background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' })
                  : { background: 'var(--glass-2)', color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' }
              }
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = activeBuiltIn?.id === p.id ? 'var(--accent)' : 'var(--text-tertiary)' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* User presets row */}
      {(fxUserPresets.length > 0 || showSave) && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3" data-fx-user-presets>
          {fxUserPresets.map((p) => (
            <span
              key={p.name}
              className="flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg text-[11px] font-medium"
              style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
            >
              <button onClick={() => applyState(p.state)} title={`Apply ${p.name}`} className="transition-colors" style={{ color: 'inherit' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'inherit' }}>
                {p.name}
              </button>
              <button
                onClick={() => deleteFxPreset(p.name)}
                aria-label={`Delete preset ${p.name}`}
                title={`Delete ${p.name}`}
                className="p-0.5 rounded transition-colors"
                style={{ color: 'var(--text-faint)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)' }}
              >
                <Trash2 size={10} />
              </button>
            </span>
          ))}
          {showSave && (
            <span className="flex items-center gap-1">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && presetName.trim()) { saveFxPreset(presetName); setShowSave(false) }
                  if (e.key === 'Escape') setShowSave(false)
                }}
                placeholder="Preset name"
                aria-label="Preset name"
                autoFocus
                className="px-2 py-1 rounded-lg text-[11px] outline-none w-32"
                style={{ background: 'var(--surface-inset)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={() => { if (presetName.trim()) { saveFxPreset(presetName); setShowSave(false) } }}
                className="px-2 py-1 rounded-lg text-[11px] font-medium"
                style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
              >
                Save
              </button>
            </span>
          )}
        </div>
      )}

      {/* The five knobs */}
      <div className="space-y-2.5" data-fx-knobs>
        {KNOBS.map((k) => {
          const v = audioFx[k.key]
          const atNeutral = Math.abs(v - NEUTRAL_FX[k.key]) < 0.001
          return (
            <div key={k.key} className="flex items-center gap-3">
              <span className="w-24 text-xs shrink-0" style={{ color: atNeutral ? 'var(--text-tertiary)' : 'var(--text-secondary)' }}>
                {k.label}
              </span>
              <input
                type="range"
                min={k.min} max={k.max} step={k.step}
                value={v}
                onChange={(e) => setAudioFx({ [k.key]: Number(e.target.value) })}
                onDoubleClick={() => setAudioFx({ [k.key]: NEUTRAL_FX[k.key] })}
                aria-label={`${k.label} effect`}
                className="flex-1 min-w-0 accent-[var(--accent)]"
                data-fx-knob={k.key}
              />
              <span className="w-16 text-right text-xs tabular-nums shrink-0" style={{ color: atNeutral ? 'var(--text-faint)' : 'var(--accent)' }}>
                {k.fmt(v)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Save / export / import */}
      <div className="flex items-center gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        {!showSave && (
          <button
            onClick={() => setShowSave(true)}
            disabled={neutral}
            title="Save the current effect state as a preset"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
            style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
          >
            <Save size={11} /> Save as Preset
          </button>
        )}
        <button
          onClick={exportPresets}
          title="Export your presets as a JSON configuration file"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
          style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
        >
          <Download size={11} /> Export
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => importPresets(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          title="Import presets from an Aura FX JSON file"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all"
          style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
        >
          <Upload size={11} /> Import
        </button>
        {fxMsg && (
          <span className="text-[11px] ml-auto" style={{ color: 'var(--accent)' }} role="status">{fxMsg}</span>
        )}
      </div>
    </div>
  )
}
