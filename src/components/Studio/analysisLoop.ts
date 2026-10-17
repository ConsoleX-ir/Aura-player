// ── Studio 4.0 — shared analysis frame loop ──────────────────────────────────
// The Audio Studio's live panels (spectrum, meters, response-curve ghost,
// chain gain-reduction) all animate off ONE requestAnimationFrame loop here —
// never one loop per canvas, never React state at audio-frame rate.
//
// Contract:
//   • subscribe(cb) → unsubscribe(). The loop runs only while at least one
//     subscriber exists; mounting the Studio starts it, unmounting stops it
//     (no stray rAF, no hidden-page work).
//   • Performance Mode caps the loop to ~20 fps (measured instruction: real
//     data, fewer repaints). Reduced Motion needs no handling here — meter
//     and spectrum motion IS the data, not decoration; every panel still
//     renders honestly, just without easing tricks.
//   • The loop never touches React: callbacks draw to canvases directly.
//     A throwing subscriber is dropped (with a console.warn) rather than
//     being allowed to kill the shared loop for everyone.

type FrameCb = (now: number) => void

import { usePlayerStore } from '@/store/playerStore'

const subs = new Set<FrameCb>()
let rafId = 0
let lastFrame = 0

// Performance Mode frame gate — the store is read live (cheap, one object
// hop) so toggling the setting takes effect on the next frame, and the
// cap survives across subscribe/unsubscribe cycles without listeners.
const PERF_MODE_MIN_FRAME_MS = 48 // ≈ 20 fps ceiling

function frame(now: number) {
  rafId = 0
  const perfMode = usePlayerStore.getState().performanceMode
  if (perfMode && now - lastFrame < PERF_MODE_MIN_FRAME_MS) {
    rafId = requestAnimationFrame(frame)
    return
  }
  lastFrame = now
  for (const cb of subs) {
    try {
      cb(now)
    } catch (err) {
      // One broken panel must not freeze the others — drop it and continue.
      console.warn('Studio analysis subscriber removed after error', err)
      subs.delete(cb)
    }
  }
  if (subs.size > 0) rafId = requestAnimationFrame(frame)
}

/** Join the shared loop. Returns the unsubscribe function (idempotent). */
export function subscribeAnalysis(cb: FrameCb): () => void {
  subs.add(cb)
  if (!rafId) {
    lastFrame = 0
    rafId = requestAnimationFrame(frame)
  }
  return () => {
    subs.delete(cb)
    if (subs.size === 0 && rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
  }
}

// ── Canvas helpers shared by the Studio panels ───────────────────────────────

/**
 * Hi-DPI canvas sizing. Returns the 2D context with the transform already
 * applied, or null when the canvas/element is gone. Callers draw in CSS
 * pixel space. Cheap enough to call per frame for small panels, but panels
 * size once per layout change (ResizeObserver) where practical.
 */
export function fitCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = c.clientWidth
  const h = c.clientHeight
  if (!w || !h) return null
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (c.width !== pw || c.height !== ph) {
    c.width = pw
    c.height = ph
  }
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

/** Cached CSS custom-property reader — resolves the whole set in one
 *  getComputedStyle call (the VisualizerPanel's measured pattern). */
export function readVizColors(): Record<string, string> {
  const s = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    accent: get('--color-dynamic-1', '#B0B8C8'),
    accent2: get('--color-dynamic-2', '#C8D0DC'),
    curve: get('--viz-curve', get('--color-dynamic-1', '#B0B8C8')),
    curveFill: get('--viz-curve-fill', 'rgba(176,184,200,0.18)'),
    ghost: get('--viz-ghost', 'rgba(176,184,200,0.26)'),
    spectrum: get('--viz-spectrum', 'rgba(176,184,200,0.55)'),
    spectrumPeak: get('--viz-spectrum-peak', get('--color-dynamic-2', '#C8D0DC')),
    grid: get('--viz-grid', 'rgba(255,255,255,0.06)'),
    gridStrong: get('--viz-grid-strong', 'rgba(255,255,255,0.08)'),
    text: get('--viz-text', get('--text-tertiary', 'rgba(255,255,255,0.32)')),
    meter: get('--viz-meter', get('--success', '#34D399')),
    meterHot: get('--viz-meter-hot', get('--warning', '#FBBF24')),
    meterClip: get('--viz-meter-clip', get('--danger', '#F87171')),
  }
}
