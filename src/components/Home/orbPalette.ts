// ═══════════════════════════════════════════════════════════════════════════
// AURA ORB — theme palette derivation
// ═══════════════════════════════════════════════════════════════════════════
// The Orb never owns a color of its own. Everything it paints is derived from
// the SAME source the rest of the app consumes — the Theme Engine registry
// (src/theme/registry.ts) plus the Custom-accent override — so the Orb is a
// citizen of whatever identity the user has chosen, not a fixed-accent
// decoration pasted on top of it.
//
//   • Named themes: accent.primary / accent.secondary straight from the
//     registry entry (Aurora's boreal green, Abyss's ocean teal, ...).
//   • Custom: the user-picked accent hex for the primary strand endpoint,
//     Custom's registry secondary as the other endpoint — mirroring exactly
//     how useDynamicTheme resolves --color-dynamic-1 on non-Now-Playing
//     surfaces, so the Orb always matches the app's accent pipes.
//   • Light appearances deepen the filament colors toward Aura's ink so the
//     strands keep contrast against paper (dark themes render a luminous
//     form; light themes render a pigmented, ink-washed one).
// ═══════════════════════════════════════════════════════════════════════════

import { getTheme, resolveThemeId, themeAppearance } from '@/theme/registry'
import type { ThemeAppearance } from '@/theme/types'

/** Linear RGB triplet, 0-255 per channel. */
export type RGB = [number, number, number]

export interface OrbPalette {
  /** Designed brightness of the ACTIVE theme — the Orb's two render voices. */
  dark: boolean
  /** The two filament endpoints — strands interpolate between them. */
  strandA: RGB
  strandB: RGB
  /** The luminous core at the sphere's heart. */
  core: RGB
  /** The wide ambient halo field behind the volume. */
  halo: RGB
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.substring(0, 2), 16),
    parseInt(full.substring(2, 4), 16),
    parseInt(full.substring(4, 6), 16),
  ]
}

export function mixRgb(a: RGB, b: RGB, f: number): RGB {
  const k = Math.min(1, Math.max(0, f))
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ]
}

export function rgba(c: RGB, alpha: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}

/** Aura's ink primitive (tokens.css --aura-ink-800), used to deepen light-theme colors. */
const INK: RGB = [16, 16, 23]

/**
 * Resolve the Orb palette for the current theme state. Same resolution order
 * as useDynamicTheme: exact modern id → custom accent → safe default; never
 * throws, so a stale theme value can never blank the Orb.
 */
export function deriveOrbPalette(
  theme: string,
  customAccentColor: string,
  storeAppearance: ThemeAppearance,
): OrbPalette {
  const id = resolveThemeId(theme)
  // 'custom' has no designed brightness — the store preserves the user's
  // live appearance for it (the same rule applyThemeToDocument applies).
  const dark = id === 'custom'
    ? storeAppearance !== 'light'
    : themeAppearance(id) === 'dark'

  const themeDef = getTheme(id)
  const primary = id === 'custom' && customAccentColor
    ? customAccentColor
    : themeDef.accent.primary
  const secondary = themeDef.accent.secondary

  let strandA = hexToRgb(primary)
  const strandB = hexToRgb(secondary)
  const core = mixRgb(strandA, [255, 255, 255], 0.45)
  const halo = strandA

  if (!dark) {
    // Light voice: pigment the strands toward ink so translucent strokes keep
    // legible contrast over paper, and unify the core/halo into a quiet
    // watercolor wash rather than a light source.
    const a = mixRgb(strandA, INK, 0.34)
    const b = mixRgb(strandB, INK, 0.34)
    return { dark, strandA: a, strandB: b, core: mixRgb(a, b, 0.5), halo: mixRgb(a, b, 0.5) }
  }

  return { dark, strandA, strandB, core, halo }
}
