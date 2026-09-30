// ── Aura 3.0 · Audio FX — types, sanitization, presets (pure data) ──────────
// The effects ENGINE wiring lives in playbackController.ts (it owns the Web
// Audio graph); this module is the UI/store/test-facing contract, mirroring
// how lib/eq.ts relates to the reserved BiquadFilter chain. No audio code
// here, so it can be imported by the store, the Settings UI and tests
// without touching the graph.
//
// Bypass principle (same locked rule as the EQ): every effect parameter has
// an acoustically transparent neutral value — shelf gains at 0 dB, compressor
// at ratio 1, reverb wet at 0, stereo width at 1 — so a "Bypass" state is
// the neutral graph, never a routing branch.
//
// Honest capability note (spec §16): Aura applies these effects to PLAYBACK
// only. There is no offline audio rendering pipeline, so preset export means
// exporting the configuration (JSON), never processed audio.

export interface AudioFxState {
  /** Low-shelf gain in dB at ~120 Hz. 0 = off. Range 0..12 (a boost knob). */
  bassGain: number
  /** High-shelf gain in dB at ~5 kHz. 0 = off. Range 0..12. */
  trebleGain: number
  /** Compression amount 0..1 (0 = transparent). Maps to threshold/ratio. */
  compression: number
  /** Reverb wet mix 0..1 (0 = fully dry). Synthetic impulse response. */
  reverbMix: number
  /** Stereo width multiplier. 1 = untouched, >1 wider, <1 narrower. 0.5..2. */
  stereoWidth: number
}

export const NEUTRAL_FX: AudioFxState = {
  bassGain: 0,
  trebleGain: 0,
  compression: 0,
  reverbMix: 0,
  stereoWidth: 1,
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Normalize any input (corrupted/foreign persisted state) into a safe state. */
export function sanitizeFx(input: unknown): AudioFxState {
  if (!input || typeof input !== 'object') return { ...NEUTRAL_FX }
  const raw = input as Partial<Record<keyof AudioFxState, unknown>>
  const num = (v: unknown, lo: number, hi: number, neutral: number) =>
    typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : neutral
  return {
    bassGain: num(raw.bassGain, 0, 12, 0),
    trebleGain: num(raw.trebleGain, 0, 12, 0),
    compression: num(raw.compression, 0, 1, 0),
    reverbMix: num(raw.reverbMix, 0, 1, 0),
    stereoWidth: num(raw.stereoWidth, 0.5, 2, 1),
  }
}

/** True when every parameter sits at its transparent neutral value. */
export function isFxNeutral(fx: AudioFxState): boolean {
  return (
    Math.abs(fx.bassGain) < 0.01 &&
    Math.abs(fx.trebleGain) < 0.01 &&
    fx.compression < 0.01 &&
    fx.reverbMix < 0.01 &&
    Math.abs(fx.stereoWidth - 1) < 0.01
  )
}

// Engine mapping constants (consumed by playbackController; exposed here so
// the UI can explain what a knob does without importing the graph).
export const BASS_SHELF_HZ = 120
export const TREBLE_SHELF_HZ = 5000
/** compression 0..1 → threshold −1..−28 dB, ratio 1..8, knee 30 dB, fast attack. */
export function compressionParams(amount: number): { threshold: number; ratio: number; knee: number; attack: number; release: number } {
  const c = clamp(amount, 0, 1)
  return { threshold: -1 - 27 * c, ratio: 1 + 7 * c, knee: 30, attack: 0.006, release: 0.18 }

}

export interface FxPreset {
  id: string
  label: string
  state: AudioFxState
}

// Built-in presets — conservative nudges in the house style (same philosophy
// as the EQ curves: sound like a tweak, not a reshaping). 'off' is explicit
// so the UI always has a one-click return to the neutral graph.
export const FX_PRESETS: FxPreset[] = [
  { id: 'off',     label: 'Bypass',       state: { ...NEUTRAL_FX } },
  { id: 'bass',    label: 'Bass Boost',   state: { ...NEUTRAL_FX, bassGain: 7.5 } },
  { id: 'clarity', label: 'Clarity',      state: { ...NEUTRAL_FX, trebleGain: 4, compression: 0.3 } },
  { id: 'wide',    label: 'Wide Stage',   state: { ...NEUTRAL_FX, stereoWidth: 1.7 } },
  { id: 'hall',    label: 'Concert Hall', state: { ...NEUTRAL_FX, reverbMix: 0.3, stereoWidth: 1.35 } },
  { id: 'warm',    label: 'Warm',         state: { ...NEUTRAL_FX, bassGain: 4, compression: 0.2 } },
  { id: 'night',   label: 'Late Night',   state: { ...NEUTRAL_FX, compression: 0.75 } },
]

export function fxPresetById(id: string): FxPreset | undefined {
  return FX_PRESETS.find((p) => p.id === id)
}

/** A user-saved effect preset (Wave 12 UI — save/load/export/import as JSON). */
export interface FxUserPreset {
  name: string
  state: AudioFxState
  createdAt: number
}

/** Defensive reader for persisted user presets (never trust old snapshots). */
export function sanitizeUserPresets(list: unknown): FxUserPreset[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((p): p is FxUserPreset => !!p && typeof p === 'object' && typeof (p as FxUserPreset).name === 'string')
    .map((p) => ({ name: p.name, state: sanitizeFx(p.state), createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0 }))
}
