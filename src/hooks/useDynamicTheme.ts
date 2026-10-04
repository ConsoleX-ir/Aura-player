import { useEffect } from 'react'
import { THEME_PRESETS, DEFAULT_THEME_ID } from '@/lib/themePresets'

function toHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}
function lighten(r: number, g: number, b: number, f: number): [number, number, number] {
  return [
    Math.min(255, Math.round(r + (255 - r) * f)),
    Math.min(255, Math.round(g + (255 - g) * f)),
    Math.min(255, Math.round(b + (255 - b) * f)),
  ]
}
function applyVars(d1: string, d2: string, d3: string, glow: string) {
  const r = document.documentElement
  r.style.setProperty('--color-dynamic-1', d1)
  r.style.setProperty('--color-dynamic-2', d2)
  r.style.setProperty('--color-dynamic-3', d3)
  r.style.setProperty('--color-dynamic-glow', glow)
}

// ── Adaptive on-accent ink (v3.2.0 light-pass §3) ─────────────────────────
// --text-on-accent used to be a hard #FFFFFF, which fails the 3:1 target
// for meaningful graphics on LIGHT accents (the cloud-gray ConsoleX default,
// Cyan Frost, Amber, Mono, …): a white glyph on #B0B8C8 is 1.99:1. Rather
// than patching components one by one, the accent pipeline derives the
// readable ink from the accent's own luminance — dark ink on light accents,
// white on dark ones. One function, applied everywhere accents are written
// (built-in presets, Custom picker, artwork ambient), so every surface that
// consumes the token (play button, chips, badges, active sliders) is fixed
// at once without touching any hue.
export function onAccentInk(color: string): string {
  let hex = color.trim()
  const rgb = hex.startsWith('#')
    ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    : null
  if (!rgb || rgb.some((n) => !isFinite(n))) return '#FFFFFF'
  const lin = (c: number) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  // #FFFFFF clears 3:1 while L ≤ 0.30; above that, Aura's ink (#101017)
  // clears it by a wide margin (L>0.30 ⇒ ≥3.7:1 against the ink).
  return L > 0.30 ? '#101017' : '#FFFFFF'
}

// Every built-in preset's idle color, keyed by id — kept as a lookup rather
// than duplicating THEME_PRESETS' array-find logic on every effect run.
const PRESET_COLORS_BY_ID = new Map(THEME_PRESETS.map((p) => [p.id, p.color]))

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

// Turns a single hex color into the full d1/d2/d3/glow set the app's CSS
// vars need. This is the one formula both built-in presets AND a user's
// Custom accent color go through — a preset is really just "a hex color we
// picked for you", so there's no reason for it to be computed differently.
function colorToVars(hex: string) {
  const [r, g, b] = hexToRgb(hex)
  const [lr, lg, lb] = lighten(r, g, b, 0.35)
  return {
    d1: hex,
    d2: toHex(lr, lg, lb),
    d3: `rgba(${r},${g},${b},0.12)`,
    glow: `rgba(${r},${g},${b},0.06)`,
  }
}

// Dominant-color cache, keyed by image src. Covers repeat constantly (every
// entry into Now Playing re-requested + re-decoded the same album art in
// v1.x); the map turns that into a lookup. Keys are aura:// cover URLs
// (stable per song — the cache file path is a hash of the audio file) or
// data:/https: URLs. Successful decodes only; failures retry next time.
const dominantColorCache = new Map<string, [number, number, number]>()

// Extract dominant color from an image URL using a canvas — no library needed.
// `src` is either a data: URL or an aura:// cover path. crossOrigin is
// REQUIRED for the aura:// ones: without it the canvas is treated as tainted
// under webSecurity (production — dev runs with webSecurity off, which is why
// this only ever broke in packaged builds) and getImageData throws. The
// aura:// protocol handler answers with Access-Control-Allow-Origin: *, so
// the CORS request passes and the canvas stays readable.
function getDominantColor(src: string): Promise<[number, number, number]> {
  const cached = dominantColorCache.get(src)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 50
        canvas.height = 50
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, 50, 50)
        const data = ctx.getImageData(0, 0, 50, 50).data
        let r = 0, g = 0, b = 0, count = 0
        for (let i = 0; i < data.length; i += 16) { // sample every 4th pixel
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++
        }
        const rgb: [number, number, number] = [Math.round(r / count), Math.round(g / count), Math.round(b / count)]
        dominantColorCache.set(src, rgb)
        resolve(rgb)
      } catch (e) { reject(e) }
    }
    img.onerror = reject
    img.src = src
  })
}

export function useDynamicTheme(
  artworkUrl: string | null,
  theme: string,
  customAccentColor: string,
  // True only on the Now Playing view — everywhere else the app sticks to
  // the chosen theme's color, even while a song is playing. On Now Playing,
  // the ambient color switches to the current song's actual album art
  // instead, then reverts to the theme the moment you navigate away.
  useAlbumArtColor: boolean = false,
) {
  useEffect(() => {
    // Custom uses the user's own picked color; every built-in preset (Forest,
    // Ocean, Sunset, ...) is just a curated hex from the shared registry.
    // Both go through the exact same colorToVars() formula below.
    const themeHex = theme === 'custom'
      ? customAccentColor
      : (PRESET_COLORS_BY_ID.get(theme) ?? PRESET_COLORS_BY_ID.get(DEFAULT_THEME_ID)!)

    if (!useAlbumArtColor || !artworkUrl) {
      // Everywhere except Now Playing (or Now Playing with no song loaded):
      // always the chosen theme's color, regardless of whether music is
      // currently playing.
      const v = colorToVars(themeHex)
      applyVars(v.d1, v.d2, v.d3, v.glow)
      document.documentElement.style.setProperty('--text-on-accent', onAccentInk(themeHex))
      return
    }
    getDominantColor(artworkUrl)
      .then(([r, g, b]) => {
        // Boost saturation a bit so muted album art still produces a visible glow
        const max = Math.max(r, g, b)
        const boost = max > 0 ? Math.min(255 / max, 1.4) : 1
        const br = Math.min(255, Math.round(r * boost))
        const bg = Math.min(255, Math.round(g * boost))
        const bb = Math.min(255, Math.round(b * boost))
        const [lr, lg, lb] = lighten(br, bg, bb, 0.35)
        const boostedHex = toHex(br, bg, bb)
        applyVars(
          boostedHex,
          toHex(lr, lg, lb),
          `rgba(${br},${bg},${bb},0.15)`,
          `rgba(${br},${bg},${bb},0.07)`
        )
        document.documentElement.style.setProperty('--text-on-accent', onAccentInk(boostedHex))
      })
      .catch(() => {
        // Album art failed to load/decode — fall back to the theme's color
        const v = colorToVars(themeHex)
        applyVars(v.d1, v.d2, v.d3, v.glow)
        document.documentElement.style.setProperty('--text-on-accent', onAccentInk(themeHex))
      })
  }, [artworkUrl, theme, customAccentColor, useAlbumArtColor])
}