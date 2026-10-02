// ── Aura 3.2.0 · Audio Studio — types, ranges, sanitization (pure data) ─────
// The ENGINE wiring lives in playbackController.ts (it owns the Web Audio
// graph); this module is the UI/store/test-facing contract, mirroring how
// lib/eq.ts and lib/audioFx.ts relate to their reserved nodes. No audio code
// here, so it can be imported by the store, the Studio UI and tests without
// touching the graph.
//
// Bypass principle (same locked rule as the EQ/FX): every new stage has an
// acoustically transparent neutral value — preamp at 0 dB, balance centered,
// limiter at ratio 1/threshold 0 — so "Bypass" is the neutral graph, never a
// routing branch. Nothing is rebuilt when a knob moves; only AudioParam
// values glide.

import { sanitizeGains } from './eq'

export const PREAMP_MIN_DB = -12
export const PREAMP_MAX_DB = 12

export const BALANCE_MIN = -1
export const BALANCE_MAX = 1

export function clampPreampDb(v: number): number {
  return Math.min(PREAMP_MAX_DB, Math.max(PREAMP_MIN_DB, v))
}

export function clampBalance(v: number): number {
  return Math.min(BALANCE_MAX, Math.max(BALANCE_MIN, v))
}

// ── Limiter (safe output stage) ─────────────────────────────────────────────
// Engaged: a true brickwall-ish safety stage (fast attack, high ratio, low
// threshold) that only acts on peaks that would otherwise clip after the
// preamp/EQ boosts. Neutral: threshold 0 dB + ratio 1 — transparent, the
// same zero-cost convention as every other stage.
export function limiterEngagedParams(): { threshold: number; knee: number; ratio: number; attack: number; release: number } {
  return { threshold: -2, knee: 3, ratio: 12, attack: 0.002, release: 0.12 }
}

export function limiterNeutralParams(): { threshold: number; knee: number; ratio: number; attack: number; release: number } {
  return { threshold: 0, knee: 0, ratio: 1, attack: 0.003, release: 0.25 }
}

// ── Custom EQ presets (user-saved curves) ───────────────────────────────────
export interface EqUserPreset {
  id: string
  name: string
  /** 10 band gains in dB — sanitized through lib/eq's sanitizeGains. */
  gains: number[]
  createdAt: number
}

/** Defensive reader for persisted user EQ presets (never trust old snapshots). */
export function sanitizeEqUserPresets(list: unknown): EqUserPreset[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((p): p is EqUserPreset =>
      !!p && typeof p === 'object' && typeof (p as EqUserPreset).name === 'string')
    .map((p, i) => ({
      id: typeof p.id === 'string' && p.id ? p.id : `user-${i}-${p.createdAt ?? 0}`,
      name: p.name,
      gains: sanitizeGains(p.gains),
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
    }))
    .filter((p) => p.name.trim().length > 0)
}
