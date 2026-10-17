import { useEffect, useRef } from 'react'
import { audioAnalyserRef } from '@/hooks/useAudio'
import { usePlayerStore } from '@/store/playerStore'

// ── StudioSpectrum (v4.0.0 — spec §9) ───────────────────────────────────────
// A compact spectrum strip for the Audio Studio, driven by the SAME analyser
// node the playbar visualizer uses (audioAnalyserRef — the real playback
// graph, post-EQ/post-FX: what you see is what the chain is doing to the
// signal right now).
//
// Resource rules (spec §10/§11):
//  • one rAF loop, ONLY while this strip is mounted (the Studio page
//    unmounts on navigation — no hidden-page work, ever);
//  • frequency buffer allocated once per mount (VisualizerPanel's v2.1.0
//    pattern — no per-frame GC churn);
//  • accent colors cached, refreshed ~1.5×/s (no getComputedStyle per frame);
//  • Performance Mode: the loop does not start — a single idle frame is
//    drawn instead, and the strip says so honestly.

const BARS = 48
const HEIGHT = 72

export function StudioSpectrum() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const performanceMode = usePlayerStore((s) => s.performanceMode)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = c.offsetWidth * dpr
    c.height = HEIGHT * dpr
    ctx.scale(dpr, dpr)

    const freq = new Uint8Array(audioAnalyserRef.current ? audioAnalyserRef.current.frequencyBinCount : 2048)

    const getColors = () => {
      const s = getComputedStyle(document.documentElement)
      return {
        c1: s.getPropertyValue('--color-dynamic-1').trim() || '#B0B8C8',
        faint: s.getPropertyValue('--border-strong').trim() || 'rgba(255,255,255,0.12)',
      }
    }
    let colors = getColors()
    let colorAge = 0

    const drawIdle = () => {
      ctx.clearRect(0, 0, c.offsetWidth, HEIGHT)
      const w = c.offsetWidth / BARS
      for (let i = 0; i < BARS; i++) {
        ctx.fillStyle = colors.faint
        ctx.fillRect(i * w + 1, HEIGHT - 2, Math.max(1, w - 2), 2)
      }
    }

    if (performanceMode) {
      drawIdle()
      return
    }

    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const wCss = c.offsetWidth
      ctx.clearRect(0, 0, wCss, HEIGHT)
      const analyser = audioAnalyserRef.current
      if (++colorAge >= 90) { colorAge = 0; colors = getColors() }
      if (!analyser || analyser.frequencyBinCount !== freq.length) {
        drawIdle()
        return
      }
      analyser.getByteFrequencyData(freq)
      // Log-spaced bar mapping so bass doesn't eat the whole width —
      // same idea as the playbar visualizer, studio scale.
      const w = wCss / BARS
      for (let i = 0; i < BARS; i++) {
        const t0 = Math.pow(i / BARS, 2)
        const t1 = Math.pow((i + 1) / BARS, 2)
        const bin0 = Math.floor(t0 * (freq.length - 1))
        const bin1 = Math.max(bin0 + 1, Math.floor(t1 * (freq.length - 1)))
        let peak = 0
        for (let b = bin0; b < bin1; b++) if (freq[b] > peak) peak = freq[b]
        const v = peak / 255
        const h = Math.max(2, v * (HEIGHT - 4))
        const grad = ctx.createLinearGradient(0, HEIGHT - h, 0, HEIGHT)
        grad.addColorStop(0, colors.c1)
        grad.addColorStop(1, 'transparent')
        ctx.fillStyle = grad
        ctx.fillRect(i * w + 1, HEIGHT - h, Math.max(1, w - 2), h)
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [performanceMode])

  return (
    <div
      className="p-3 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      data-testid="studio-spectrum"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Spectrum</p>
        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {performanceMode ? 'paused in Performance Mode' : 'live — post-EQ, post-effects signal'}
        </span>
      </div>
      <canvas ref={canvasRef} className="block w-full" style={{ height: HEIGHT }} aria-label="Live spectrum analyzer" />
    </div>
  )
}
