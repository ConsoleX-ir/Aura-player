import { useEffect } from 'react'

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

const CLOUD = {
  d1: '#B0B8C8', d2: '#C8D0DC',
  d3: 'rgba(176,184,200,0.12)', glow: 'rgba(176,184,200,0.06)'
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

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

// Extract dominant color from a data URL using a canvas — no library needed
function getDominantColor(dataUrl: string): Promise<[number, number, number]> {
  return new Promise((resolve, reject) => {
    const img = new Image()
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
        resolve([Math.round(r / count), Math.round(g / count), Math.round(b / count)])
      } catch (e) { reject(e) }
    }
    img.onerror = reject
    img.src = dataUrl
  })
}

export function useDynamicTheme(
  coverArt: string | null,
  theme: 'default' | 'custom',
  customAccentColor: string,
) {
  useEffect(() => {
    if (!coverArt) {
      // No song playing — use the idle color based on theme mode
      if (theme === 'custom') {
        const v = colorToVars(customAccentColor)
        applyVars(v.d1, v.d2, v.d3, v.glow)
      } else {
        applyVars(CLOUD.d1, CLOUD.d2, CLOUD.d3, CLOUD.glow)
      }
      return
    }
    getDominantColor(coverArt)
      .then(([r, g, b]) => {
        // Boost saturation a bit so muted album art still produces a visible glow
        const max = Math.max(r, g, b)
        const boost = max > 0 ? Math.min(255 / max, 1.4) : 1
        const br = Math.min(255, Math.round(r * boost))
        const bg = Math.min(255, Math.round(g * boost))
        const bb = Math.min(255, Math.round(b * boost))
        const [lr, lg, lb] = lighten(br, bg, bb, 0.35)
        applyVars(
          toHex(br, bg, bb),
          toHex(lr, lg, lb),
          `rgba(${br},${bg},${bb},0.15)`,
          `rgba(${br},${bg},${bb},0.07)`
        )
      })
      .catch(() => {
        // On error, fall back to the idle color for the current theme mode
        if (theme === 'custom') {
          const v = colorToVars(customAccentColor)
          applyVars(v.d1, v.d2, v.d3, v.glow)
        } else {
          applyVars(CLOUD.d1, CLOUD.d2, CLOUD.d3, CLOUD.glow)
        }
      })
  }, [coverArt, theme, customAccentColor])
}