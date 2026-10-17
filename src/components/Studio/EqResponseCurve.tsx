import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { getChainFrequencyResponse, getAnalyser, EQ_BAND_FREQS } from '@/lib/playbackController'
import { subscribeAnalysis, fitCanvas, readVizColors } from './analysisLoop'

// ── Studio 4.0 — EQ transfer-response curve ──────────────────────────────────
// The curve is the chain's REAL magnitude response: getChainFrequencyResponse()
// multiplies the live BiquadFilterNode.getFrequencyResponse() of every filter
// actually sitting in the signal path (10 EQ bands + bass/treble shelves +
// preamp). Nothing here is decorative or hand-drawn — flat chain, flat line.
//
// Two layers on one canvas:
//   • the response curve — redrawn when the tonal SETTINGS change (EQ
//     gains/enable, preamp, FX shelves, bypass, theme). No rAF involved.
//   • a soft live-spectrum ghost underlay — REAL analyser data, riding the
//     Studio's shared frame loop only while this panel is mounted and
//     Performance Mode allows it. The ghost shows what the material puts
//     into the chain; the curve shows what the chain does to it.

const F_MIN = 20
const F_MAX = 20000
const CURVE_POINTS = 160 // log-spaced samples across the axis
const DB_TOP = 18 // drawn ceiling (EQ range is ±12; headroom shows shelf drive)
const DB_BOTTOM = -24

// Log-spaced sample frequencies, allocated once.
const CURVE_FREQS = (() => {
  const f = new Float32Array(CURVE_POINTS) as Float32Array<ArrayBuffer>
  for (let i = 0; i < CURVE_POINTS; i++) {
    f[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / (CURVE_POINTS - 1))
  }
  return f
})()

const FREQ_TICKS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
const DB_TICKS = [12, 6, 0, -6, -12, -18]

interface CurveColors {
  accent: string; curveFill: string; ghost: string
  grid: string; gridStrong: string; text: string
  on: boolean
}

function readColors(): CurveColors {
  const c = readVizColors()
  const s = usePlayerStore.getState()
  return {
    accent: c.accent,
    curveFill: c.curveFill,
    ghost: c.ghost,
    grid: c.grid,
    gridStrong: c.gridStrong,
    text: c.text,
    // Bypass / EQ-off is drawn in neutral graphite — the honest "not shaping" look.
    on: s.eqEnabled && !s.studioBypass,
  }
}

export function EqResponseCurve({ inert }: { inert: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Layout changes re-fit the Hi-DPI backing store and repaint. Once per
  // mount; observed through the element's own size.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    drawStatic(c)
    const ro = new ResizeObserver(() => drawStatic(c))
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  // Setting changes repaint the static curve. No dependency array: the host
  // card re-renders exactly when a tonal input changed, so this effect is
  // the redraw trigger (one getFrequencyResponse pass over 160 points —
  // trivial even at drag rate).
  useEffect(() => {
    const c = canvasRef.current
    if (c) drawStatic(c)
  })

  // The live ghost: joins the shared loop; unsubscribes on unmount (the
  // loop stops with it if no other panel remains). Performance Mode mutes
  // the ghost entirely — the static curve stays, nothing animates.
  useEffect(() => {
    if (inert) return
    const c = canvasRef.current
    if (!c) return
    const binCount = getAnalyser()?.frequencyBinCount ?? 1024
    const freq = new Uint8Array(new ArrayBuffer(binCount))
    let colors = readColors()
    let colorAge = 0
    return subscribeAnalysis(() => {
      const ctx = fitCanvas(c)
      if (!ctx) return
      if (++colorAge > 90) { colorAge = 0; colors = readColors() }
      drawStaticInto(ctx, c, colors)
      drawGhost(ctx, c, freq, colors.ghost)
      drawCurveLine(ctx, c, colors)
    })
  }, [inert])

  return (
    <div
      className="relative rounded-lg overflow-hidden"
      style={{ background: 'var(--surface-inset)', border: '1px solid var(--border-subtle)' }}
      data-eq-response
    >
      <canvas ref={canvasRef} className="w-full h-[148px] block" aria-hidden />
      {/* Axis captions — DOM text, so screen readers and themes follow the app */}
      <div className="absolute inset-x-0 top-1 flex justify-between px-2 pointer-events-none select-none">
        <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-faint)' }}>+{DB_TOP} dB</span>
        <span className="text-[9px]" style={{ color: 'var(--text-faint)' }}>dB</span>
        <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{DB_BOTTOM} dB</span>
      </div>
      <div className="absolute inset-x-0 bottom-1 flex justify-between px-2 pointer-events-none select-none">
        <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-faint)' }}>20</span>
        <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-faint)' }}>100</span>
        <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-faint)' }}>1k</span>
        <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-faint)' }}>10k</span>
        <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-faint)' }}>20k Hz</span>
      </div>
    </div>
  )
}

// ── Drawing ──────────────────────────────────────────────────────────────────

const xOf = (f: number, w: number) =>
  (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * w
const yOf = (db: number, h: number) =>
  ((DB_TOP - db) / (DB_TOP - DB_BOTTOM)) * h

function responseDb(): Float32Array | null {
  // The response only changes when a TONAL INPUT changes — cache it by a
  // cheap all-primitive key so the live ghost frames re-stroke the cached
  // polyline (160 points) instead of re-running the biquad math every frame.
  const s = usePlayerStore.getState()
  const fx = s.audioFx
  const key = `${s.eqGains.join()}|${fx.bassGain},${fx.trebleGain}|${s.preampDb}|${s.eqEnabled}|${s.studioBypass}`
  if (key !== cacheKey) {
    cacheKey = key
    cacheResp = getChainFrequencyResponse(CURVE_FREQS)
  }
  return cacheResp
}
let cacheKey = '\u0000' // impossible live key → first call computes
let cacheResp: Float32Array | null = null

function drawStatic(c: HTMLCanvasElement) {
  const ctx = fitCanvas(c)
  if (!ctx) return
  const colors = readColors()
  drawStaticInto(ctx, c, colors)
  drawCurveLine(ctx, c, colors)
}

function drawStaticInto(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, colors: CurveColors) {
  const w = c.clientWidth, h = c.clientHeight
  ctx.clearRect(0, 0, w, h)

  // Grid — verticals at the frequency ticks, horizontals at the dB ticks.
  ctx.lineWidth = 1
  for (const f of FREQ_TICKS) {
    const x = Math.round(xOf(f, w)) + 0.5
    ctx.strokeStyle = colors.grid
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
  }
  for (const db of DB_TICKS) {
    const y = Math.round(yOf(db, h)) + 0.5
    ctx.strokeStyle = db === 0 ? colors.gridStrong : colors.grid
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  }

  // Fill under the response — toward the 0 dB line, the same cut/boost
  // grammar the band sliders use.
  const resp = responseDb()
  if (!resp) return
  ctx.beginPath()
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = xOf(CURVE_FREQS[i], w)
    const y = yOf(Math.max(DB_BOTTOM, Math.min(DB_TOP, resp[i])), h)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.lineTo(w, yOf(0, h))
  ctx.lineTo(0, yOf(0, h))
  ctx.closePath()
  ctx.fillStyle = colors.curveFill
  ctx.fill()

  // Band center dots — the response value AT each band's frequency (real
  // cumulative response, not the knob position).
  ctx.fillStyle = colors.on ? colors.accent : colors.text
  for (let b = 0; b < 10; b++) {
    const f = EQ_BAND_FREQS[b]
    const idx = Math.max(0, Math.min(CURVE_POINTS - 1, Math.round(
      (Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)) * (CURVE_POINTS - 1)
    )))
    const y = yOf(Math.max(DB_BOTTOM, Math.min(DB_TOP, resp[idx])), h)
    ctx.beginPath(); ctx.arc(xOf(f, w), y, 2, 0, Math.PI * 2); ctx.fill()
  }
}

function drawCurveLine(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, colors: CurveColors) {
  const w = c.clientWidth, h = c.clientHeight
  const resp = responseDb()
  if (!resp) return
  ctx.beginPath()
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = xOf(CURVE_FREQS[i], w)
    const y = yOf(Math.max(DB_BOTTOM, Math.min(DB_TOP, resp[i])), h)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.strokeStyle = colors.on ? colors.accent : colors.text
  ctx.lineWidth = 1.75
  ctx.lineJoin = 'round'
  ctx.stroke()
}

/** Live spectrum ghost — real FFT data from the ONE main analyser. */
function drawGhost(ctx: CanvasRenderingContext2D, c: HTMLCanvasElement, freq: Uint8Array<ArrayBuffer>, color: string) {
  const analyser = getAnalyser()
  if (!analyser || analyser.frequencyBinCount !== freq.length) return
  analyser.getByteFrequencyData(freq)

  const w = c.clientWidth, h = c.clientHeight
  const bins = freq.length
  // Sample the analyser's linear bins along the log axis, using the REAL
  // Nyquist frequency of the live AudioContext.
  const nyquist = analyser.context.sampleRate / 2
  ctx.beginPath()
  ctx.moveTo(0, h)
  for (let px = 0; px <= w; px += 3) {
    const f = F_MIN * Math.pow(F_MAX / F_MIN, px / w)
    const bin = Math.min(bins - 1, Math.round((f / nyquist) * bins))
    const v = freq[bin] / 255
    ctx.lineTo(px, h - v * h * 0.92)
  }
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}
