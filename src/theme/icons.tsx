// ═══════════════════════════════════════════════════════════════════════════
// AURA THEME ENGINE — theme emblems (v3.3 expansion: ten named themes)
// ═══════════════════════════════════════════════════════════════════════════
// One bespoke SVG emblem per theme, drawn on a shared visual language so the
// Settings picker reads as a designed set rather than a row of stock glyphs:
//   • 24×24 grid, drawn centered on (12,12), optically balanced per shape;
//   • 1.75 stroke weight, round caps + joins (matches the app's lucide
//     defaults, so the emblems sit naturally next to the existing icons);
//   • monochrome currentColor — the THEMED swatch gradient tile behind the
//     emblem carries the color identity, the emblem carries the SHAPE
//     identity (selected state additionally shows the check glyph, so
//     selection never relies on color alone);
//   • plain inline SVG components — zero new dependencies, no network, no
//     icon-font, resolution-independent at every DPI.
//
// Shape language per theme (identity first, recognizable at 12–14 px):
//   aurora   three flowing ribbon curtains (the northern-lights sweep)
//   ember    a refined flame with a lit inner tongue
//   abyss    three surface waves receding with depth (light falls from above)
//   vector   a precise construction: square, node circle, tie line, cross
//   nebula   an orbital ring around a core with two companion stars
//   verdant  a botanical leaf with midrib and paired side veins
//   obsidian a faceted stone: low-poly silhouette with facet lines
//   solstice a sun disc rising over a horizon with rays
//   cryo     a hexagonal ice crystal with spokes and a frost tick
//   sakura   a five-petal blossom with stamen dots
//   custom   tuning sliders — kept from the previous picker convention
//            (Custom = the user-tuned accent), redrawn in the set's language
//
// scripts/a33_theme_engine.test.ts asserts every ThemeId has an entry here —
// the emblem set cannot silently drift from the registry.
// ═══════════════════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react'
import type { ThemeId } from './types'

export interface ThemeIconProps {
  size?: number
  className?: string
  style?: CSSProperties
}

type Emblem = (p: ThemeIconProps) => ReturnType<React.FC<ThemeIconProps>>

const base = (size: number, className?: string, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  style,
  'aria-hidden': true,
})

const EMBLEMS: Record<ThemeId, Emblem> = {
  /* Aurora — three flowing ribbon curtains, staggered heights */
  aurora: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M8 3.5 C5.5 8.5, 10.5 13.5, 8 20.5" />
        <path d="M13 3 C15.5 8, 10.5 13, 13.5 20" />
        <path d="M18 4.5 C16.3 8.5, 19.3 12.5, 17.6 17.5" opacity={0.8} />
      </svg>
    )
  },

  /* Ember — refined flame, filled inner tongue */
  ember: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M12 3.5 C15.2 6.8, 18 9.6, 18 13.9 A6 6 0 0 1 6 13.9 C6 9.6, 8.8 6.8, 12 3.5 Z" />
        <path
          d="M12 10.2 C13.4 11.9, 14.6 13.1, 14.6 14.9 A2.6 2.6 0 0 1 9.4 14.9 C9.4 13.1, 10.6 11.9, 12 10.2 Z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    )
  },

  /* Abyss — surface waves receding with depth (top wave catches the light) */
  abyss: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M3.5 7 C6 5.2, 9 5.2, 12 7 C15 8.8, 18 8.8, 20.5 7" />
        <path d="M5 12.5 C7.2 11, 9.8 11, 12 12.5 C14.2 14, 16.8 14, 19 12.5" opacity={0.72} />
        <path d="M7 18 C8.8 16.8, 10.7 16.8, 12.5 18 C14.3 19.2, 16.2 19.2, 18 18" opacity={0.48} />
      </svg>
    )
  },

  /* Vector — construction: plate, node circle, tie line, center cross */
  vector: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <rect x="4.75" y="9.25" width="10" height="10" rx="1" />
        <circle cx="17.25" cy="6.75" r="2.75" />
        <path d="M14.75 9.25 L15.55 8.45" />
        <path d="M9.75 12.6 V15.9 M8.1 14.25 H11.4" />
      </svg>
    )
  },

  /* Nebula — orbital ring, glowing core, companion stars */
  nebula: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <ellipse cx="12" cy="12" rx="9" ry="3.8" transform="rotate(-24 12 12)" />
        <circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none" />
        <circle cx="18.6" cy="5.2" r="0.95" fill="currentColor" stroke="none" />
        <circle cx="5.8" cy="17.6" r="0.7" fill="currentColor" stroke="none" opacity={0.7} />
      </svg>
    )
  },

  /* Verdant — botanical leaf, midrib, paired side veins */
  verdant: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M12 21 C6.2 17.6, 5 10.6, 12 3.8 C19 10.6, 17.8 17.6, 12 21 Z" />
        <path d="M12 20.2 V6.8" />
        <path d="M12 16.2 C10.6 15.6, 9.5 14.6, 8.9 13.3" opacity={0.85} />
        <path d="M12 16.2 C13.4 15.6, 14.5 14.6, 15.1 13.3" opacity={0.85} />
        <path d="M12 11.6 C11 11.1, 10.2 10.4, 9.7 9.5" opacity={0.85} />
        <path d="M12 11.6 C13 11.1, 13.8 10.4, 14.3 9.5" opacity={0.85} />
      </svg>
    )
  },

  /* Obsidian — faceted stone: low-poly silhouette, facet lines from one apex */
  obsidian: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M6.8 4.6 L14.8 3.4 L20.2 8.6 L18.4 16.9 L10.4 20.4 L4.6 14.2 Z" />
        <path d="M6.8 4.6 L11.2 10.6 L4.6 14.2" opacity={0.85} />
        <path d="M14.8 3.4 L11.2 10.6 M11.2 10.6 L20.2 8.6 M11.2 10.6 L18.4 16.9" opacity={0.85} />
      </svg>
    )
  },

  /* Solstice — sun rising over the horizon line, three rays */
  solstice: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M3.5 17.5 H20.5" />
        <path d="M7.6 17.5 A4.4 4.4 0 0 1 16.4 17.5" />
        <path d="M12 10.6 V7.8" opacity={0.9} />
        <path d="M6.91 12.41 L5.21 10.71" opacity={0.9} />
        <path d="M17.09 12.41 L18.79 10.71" opacity={0.9} />
      </svg>
    )
  },

  /* Cryo — hexagonal ice crystal with spokes and a frost tick */
  cryo: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M12 3.6 L19.27 7.8 V16.2 L12 20.4 L4.73 16.2 V7.8 Z" />
        <path d="M12 12 L12 3.6 M12 12 L4.73 16.2 M12 12 L19.27 16.2" opacity={0.85} />
        <path d="M9.9 6.2 L12 8.3 L14.1 6.2" opacity={0.85} />
      </svg>
    )
  },

  /* Sakura — five-petal blossom with stamen dots */
  sakura: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M11.25 10.04 Q9.23 6.56 12 3.6 Q14.77 6.56 12.75 10.04 Z" />
        <path d="M13.63 10.68 Q16.31 7.69 19.99 9.4 Q18.02 12.95 14.1 12.11 Z" />
        <path d="M13.76 13.14 Q17.44 14.77 16.94 18.8 Q12.95 18.02 12.54 14.03 Z" />
        <path d="M11.46 14.03 Q11.05 18.02 7.06 18.8 Q6.56 14.77 10.24 13.14 Z" />
        <path d="M9.9 12.11 Q5.98 12.95 4.01 9.4 Q7.69 7.69 10.37 10.68 Z" />
        <circle cx="12" cy="12" r="0.4" fill="currentColor" stroke="none" />
        <circle cx="14.06" cy="9.17" r="0.75" fill="currentColor" stroke="none" opacity={0.9} />
        <circle cx="15.33" cy="13.08" r="0.75" fill="currentColor" stroke="none" opacity={0.9} />
        <circle cx="12" cy="15.5" r="0.75" fill="currentColor" stroke="none" opacity={0.9} />
        <circle cx="8.67" cy="13.08" r="0.75" fill="currentColor" stroke="none" opacity={0.9} />
        <circle cx="9.94" cy="9.17" r="0.75" fill="currentColor" stroke="none" opacity={0.9} />
      </svg>
    )
  },

  /* Custom — tuning sliders (kept convention: the user-tuned accent) */
  custom: (p) => {
    const { size = 13, className, style } = p
    return (
      <svg {...base(size, className, style)}>
        <path d="M4.5 8.25 H19.5" />
        <path d="M4.5 15.75 H19.5" />
        <circle cx="9.4" cy="8.25" r="2.1" fill="currentColor" stroke="none" />
        <circle cx="14.6" cy="15.75" r="2.1" fill="currentColor" stroke="none" />
      </svg>
    )
  },
}

/** The emblem for a theme id — total over the registry (compile-checked). */
export function ThemeIcon({ id, size = 13, className, style }: ThemeIconProps & { id: ThemeId }) {
  return EMBLEMS[id]({ size, className, style })
}
