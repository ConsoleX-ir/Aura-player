import { useMemo } from 'react'
import { Music2 } from 'lucide-react'

/* ── Deterministic artwork placeholder ──────────────────────────────────────
   Songs without embedded cover art used to get a flat gray box with a faint
   glyph — technically honest, visually dead. Aura's answer: every track
   without artwork gets its OWN generated "aura" — a calm two-tone gradient
   derived deterministically from a stable key (song id / album key), so the
   same song always wears the same colors everywhere it appears (rows, cards,
   player bar, now playing).

   Design rules:
   • Low saturation, low lightness — reads as premium artwork, never as
     noise next to real covers.
   • Analogous hues (small offset) — harmonious, not rainbow.
   • Pure inline style, zero cost beyond the string hash; no deps.
   • The hue survives light mode untouched (artwork is artwork). */

/** FNV-1a — small, well-distributed, stable across sessions. */
function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function artworkGradient(key: string): string {
  const h1 = hashString(key) % 360
  const h2 = (h1 + 28 + (hashString(key + '::b') % 34)) % 360
  return [
    `radial-gradient(130% 130% at 28% 18%, hsl(${h1} 38% 30% / 0.85), transparent 58%)`,
    `linear-gradient(135deg, hsl(${h1} 30% 19%), hsl(${h2} 28% 11%))`,
  ].join(', ')
}

interface ArtworkPlaceholderProps {
  /** Stable key deciding the colors — song.id preferred, or album key. */
  seed: string
  /** Rendered size class of the container (icon scales with it). */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const GLYPH_SIZE = { sm: 11, md: 15, lg: 26 } as const

export function ArtworkPlaceholder({ seed, size = 'sm', className }: ArtworkPlaceholderProps) {
  const gradient = useMemo(() => artworkGradient(seed), [seed])
  return (
    <div
      aria-hidden
      className={className ?? 'w-full h-full flex items-center justify-center'}
      style={{ background: gradient }}
    >
      <Music2
        size={GLYPH_SIZE[size]}
        className="shrink-0"
        style={{ color: 'rgba(255,255,255,0.28)' }}
      />
    </div>
  )
}

/* ── Missing-metadata text ─────────────────────────────────────────────────
   Unknown Artist / Unknown Album get their own quieter voice so a library
   full of untagged files still reads as designed, not broken. */
export function UnknownValue({ children, className }: { children: string; className?: string }) {
  return (
    <span className={className} style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
      {children}
    </span>
  )
}
