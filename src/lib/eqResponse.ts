// ── Aura 4.0 · EQ chain transfer response (pure math, no audio deps) ────────
// The Audio Studio's response curve must show what the chain DOES to the
// signal. This module computes the exact magnitude response of the chain's
// biquad stages — the same RBJ cookbook formulas the Web Audio BiquadFilter
// implements — from the REAL persisted settings:
//
//   preamp (scalar dB) × 10 × peaking EQ bands (Q = 1) × bass low-shelf ×
//   treble high-shelf, gated by eqEnabled / studioBypass exactly as the
//   engine gates them.
//
// Why math and not getFrequencyResponse()? Reading the live nodes reports
// the params as the AUDIO CLOCK sees them: while the context is suspended
// (nothing playing yet) a scheduled setTargetAtTime has not landed, so the
// nodes would read transparent even though the user just shaped a curve —
// the display would silently disagree with the settings. The math response
// is derived from the same values the engine glides to, so it is ALWAYS the
// settled truth, and it is unit-testable without a Web Audio context.
//
// Zero dependencies, zero DOM — importable by the store, UI and node tests.

export interface ChainResponseInput {
  /** 10 band gains in dB (the store's sanitized values). */
  eqGains: readonly number[]
  /** EQ enable gate — false contributes 0 dB per band (curve kept, not applied). */
  eqEnabled: boolean
  /** Whole-studio bypass gate — everything neutral, exactly like the engine. */
  bypass: boolean
  /** Preamp gain in dB (−12…+12). */
  preampDb: number
  /** FX low-shelf gain in dB at 120 Hz (0 = transparent). */
  bassGain: number
  /** FX high-shelf gain in dB at 5 kHz (0 = transparent). */
  trebleGain: number
  /** Sample rate the response is evaluated at (Hz). */
  sampleRate: number
}

export const EQ_BAND_FREQS_HZ: readonly number[] = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const BASS_SHELF_FREQ_HZ = 120
export const TREBLE_SHELF_FREQ_HZ = 5000
const PEAKING_Q = 1 // matches playbackController's reserved bands

/** Complex magnitude of a biquad H(z) = (b0 + b1 z⁻¹ + b2 z⁻²)/(a0 + a1 z⁻¹ + a2 z⁻²) at w. */
function biquadMag(b: [number, number, number], a: [number, number, number], w: number): number {
  const cw = Math.cos(w), sw = Math.sin(w)
  const c2w = Math.cos(2 * w), s2w = Math.sin(2 * w)
  const numRe = b[0] + b[1] * cw + b[2] * c2w
  const numIm = b[1] * sw + b[2] * s2w
  const denRe = a[0] + a[1] * cw + a[2] * c2w
  const denIm = a[1] * sw + a[2] * s2w
  const num = Math.sqrt(numRe * numRe + numIm * numIm)
  const den = Math.sqrt(denRe * denRe + denIm * denIm)
  return den < 1e-12 ? 1 : num / den
}

function peakingCoeffs(f0: number, gainDb: number, Q: number, fs: number) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const alpha = Math.sin(w0) / (2 * Q)
  const cosW0 = Math.cos(w0)
  return [
    [1 + alpha * A, -2 * cosW0, 1 - alpha * A],
    [1 + alpha / A, -2 * cosW0, 1 - alpha / A],
  ] as [[number, number, number], [number, number, number]]
}

function lowShelfCoeffs(f0: number, gainDb: number, fs: number) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const cosW0 = Math.cos(w0)
  const alpha = (Math.sin(w0) / 2) * Math.SQRT2 // S = 1
  const sq = 2 * Math.sqrt(A) * alpha
  return [
    [A * ((A + 1) - (A - 1) * cosW0 + sq), 2 * A * ((A - 1) - (A + 1) * cosW0), A * ((A + 1) - (A - 1) * cosW0 - sq)],
    [(A + 1) + (A - 1) * cosW0 + sq, -2 * ((A - 1) + (A + 1) * cosW0), (A + 1) + (A - 1) * cosW0 - sq],
  ] as [[number, number, number], [number, number, number]]
}

function highShelfCoeffs(f0: number, gainDb: number, fs: number) {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const cosW0 = Math.cos(w0)
  const alpha = (Math.sin(w0) / 2) * Math.SQRT2
  const sq = 2 * Math.sqrt(A) * alpha
  return [
    [A * ((A + 1) + (A - 1) * cosW0 + sq), -2 * A * ((A - 1) + (A + 1) * cosW0), A * ((A + 1) + (A - 1) * cosW0 - sq)],
    [(A + 1) - (A - 1) * cosW0 + sq, 2 * ((A - 1) - (A + 1) * cosW0), (A + 1) - (A - 1) * cosW0 - sq],
  ] as [[number, number, number], [number, number, number]]
}

/**
 * The chain's magnitude response in dB at each frequency of `freqs` (Hz).
 * Gates mirror the engine exactly: bypass → 0 dB everywhere; EQ off → bands
 * contribute nothing; FX shelves gate with the studio bypass only.
 */
export function chainResponseDb(freqs: Float32Array, input: ChainResponseInput): Float32Array {
  const out = new Float32Array(freqs.length)
  const eqOn = input.eqEnabled && !input.bypass
  const shelvesOn = !input.bypass
  const fs = Math.max(8000, input.sampleRate || 48000)

  const stages: { b: [number, number, number]; a: [number, number, number] }[] = []
  if (eqOn) {
    for (let i = 0; i < 10; i++) {
      const g = input.eqGains[i] ?? 0
      if (Math.abs(g) < 0.001) continue // 0 dB peaking = transparent, skip the work
      const [b, a] = peakingCoeffs(EQ_BAND_FREQS_HZ[i], g, PEAKING_Q, fs)
      stages.push({ b, a })
    }
  }
  if (shelvesOn) {
    if (Math.abs(input.bassGain) >= 0.001) {
      const [b, a] = lowShelfCoeffs(BASS_SHELF_FREQ_HZ, input.bassGain, fs)
      stages.push({ b, a })
    }
    if (Math.abs(input.trebleGain) >= 0.001) {
      const [b, a] = highShelfCoeffs(TREBLE_SHELF_FREQ_HZ, input.trebleGain, fs)
      stages.push({ b, a })
    }
  }

  const preampLin = input.bypass ? 1 : Math.pow(10, input.preampDb / 20)
  for (let i = 0; i < freqs.length; i++) {
    const w = (2 * Math.PI * freqs[i]) / fs
    let mag = preampLin
    for (const s of stages) mag *= biquadMag(s.b, s.a, w)
    out[i] = 20 * Math.log10(Math.max(mag, 1e-6))
  }
  return out
}
