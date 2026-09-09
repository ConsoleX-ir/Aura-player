// ── Aura EQ — preset definitions for the 10 reserved bands ──────────────────
// The playback controller reserved 10 peaking BiquadFilter nodes back in
// Wave 1; this module supplies the UI-facing curves and range constants for
// them. Pure data — no audio code here, so it can be imported by the store,
// the Settings UI, and tests without touching the Web Audio graph.
//
// Zero-cost bypass (locked roadmap rule): a peaking filter at 0 dB gain is
// acoustically transparent — the engine leaves all nodes in the chain and
// "off" simply means every band sits at 0. No extra routing, no branches,
// no audible or measurable difference vs. a filter-less graph.

export const EQ_MIN_DB = -12
export const EQ_MAX_DB = 12

// Band center frequencies in Hz — must match EQ_BAND_FREQS in
// playbackController.ts (the order the BiquadFilters were chained in).
export const EQ_BAND_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'] as const

export interface EqPreset {
  id: string
  label: string
  gains: number[] // 10 values, one per band, in dB
}

const flat = (): number[] => new Array(10).fill(0)

// Preset curves are classic hardware/Winamp-style starting points, tuned
// conservative — everything is meant to sound like a nudge, not a reshaping.
export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat',       label: 'Flat',       gains: flat() },
  { id: 'bass',       label: 'Bass Boost', gains: [6, 5, 3.5, 1.5, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal',      label: 'Vocal',      gains: [-2, -1, 0, 2.5, 4, 4, 2.5, 1, 0, -1] },
  { id: 'treble',     label: 'Treble',     gains: [0, 0, 0, 0, 0, 1, 2.5, 4.5, 5.5, 6] },
  { id: 'rock',       label: 'Rock',       gains: [5, 4, 2, -1, -2, 0, 2, 3.5, 4.5, 5] },
  { id: 'jazz',       label: 'Jazz',       gains: [3.5, 2.5, 1, 1.5, -1, -1, 0, 1.5, 3, 4] },
  { id: 'electronic', label: 'Electronic', gains: [5.5, 4.5, 1.5, 0, -1.5, 1, 1.5, 2.5, 4.5, 5.5] },
  { id: 'classical',  label: 'Classical',  gains: [3, 2.5, 2, 1.5, -1, -1, 0, 1.5, 2.5, 3] },
]

export function eqPresetById(id: string): EqPreset | undefined {
  return EQ_PRESETS.find((p) => p.id === id)
}

export function clampDb(v: number): number {
  return Math.min(EQ_MAX_DB, Math.max(EQ_MIN_DB, v))
}

/** True when every band sits at 0 dB — the zero-cost bypass condition. */
export function isFlat(gains: number[]): boolean {
  return gains.length === 10 && gains.every((g) => Math.abs(g) < 0.01)
}

/** Normalize any 10-length input into a safe 10×number array of clamped dB. */
export function sanitizeGains(gains: unknown): number[] {
  if (!Array.isArray(gains) || gains.length !== 10) return flat()
  return gains.map((g) => (typeof g === 'number' && isFinite(g) ? clampDb(g) : 0))
}
