import { useEffect, useRef, useState } from 'react'
import { getAnalyser } from '@/lib/playbackController'
import { usePlayerStore } from '@/store/playerStore'

// ── VisualStage — the Now Playing visualizer (Aura 3.0 Wave 8) ──────────────
// A single-canvas stage with three honest, analyser-driven modes (spec §11:
// not merely equalizer bars):
//
//   aurora    — layered smooth waves (3 offset harmonics of the spectrum)
//   particles — a drifting field whose dots pulse with their frequency band
//   radial    — a frequency ring breathing around a glowing core
//
// Efficiency contract (locked):
//   • ONE canvas, DPR-aware, sized by a ResizeObserver (no per-frame layout).
//   • The rAF loop runs ONLY while the stage is mounted AND the track is
//     playing; paused/unmount draws one resting frame and stops — zero
//     continuous work when idle (same rule as AuraPulse).
//   • Accent colors are CSS-var reads cached and refreshed ~2×/s inside the
//     loop (not per frame).
//   • Performance Mode / prefers-reduced-motion: draw ONE calm rest frame,
//     never loop.
//
// The pill-flyout VisualizerPanel keeps its own implementation — this stage
// is the big-surface experience; sharing the analyser is safe (stateless
// reads).

type StageMode = 'aurora' | 'particles' | 'radial'

const MODES: { id: StageMode; label: string }[] = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'particles', label: 'Particles' },
  { id: 'radial', label: 'Radial' },
]

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function VisualStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const [modeIdx, setModeIdx] = useState(0)
  const [reduced, setReduced] = useState(prefersReducedMotion)
  const mode = MODES[modeIdx].id
  const staticMode = performanceMode || reduced

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let w = 0
    let h = 0
    let dpr = 1

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.floor(rect.width))
      h = Math.max(1, Math.floor(rect.height))
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // Particle field — seeded once, persists across frames (positions live
    // in this closure; no per-frame allocation).
    const PARTICLES = 110
    const px = new Float32Array(PARTICLES)
    const py = new Float32Array(PARTICLES)
    const pvx = new Float32Array(PARTICLES)
    const pvy = new Float32Array(PARTICLES)
    const pBand = new Uint8Array(PARTICLES)
    for (let i = 0; i < PARTICLES; i++) {
      px[i] = Math.random(); py[i] = Math.random()
      pvx[i] = (Math.random() * 2 - 1) * 0.0006
      pvy[i] = (Math.random() * 2 - 1) * 0.0006
      pBand[i] = Math.floor((i / PARTICLES) * 96)
    }

    const full = new Uint8Array(getAnalyser()?.frequencyBinCount ?? 1024)

    // Accent cache — refreshed ~2×/s inside the loop.
    let accent = '#B0B8C8'
    let accent2 = '#FFFFFF'
    let lastColorRead = 0
    const readColors = (force = false) => {
      const now = performance.now()
      if (!force && now - lastColorRead < 480) return
      lastColorRead = now
      const cs = getComputedStyle(document.documentElement)
      accent = cs.getPropertyValue('--color-dynamic-1').trim() || accent
      accent2 = cs.getPropertyValue('--color-dynamic-2').trim() || accent2
    }
    readColors(true)

    const drawRest = () => {
      // Calm rest frame — the stage never looks broken when still.
      ctx.clearRect(0, 0, w, h)
      readColors(true)
      const midY = h * 0.62
      ctx.strokeStyle = accent
      ctx.globalAlpha = 0.28
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let x = 0; x <= w; x += 4) {
        const y = midY + Math.sin(x / 46) * 3
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    const draw = (t: number) => {
      const analyser = getAnalyser()
      if (analyser) analyser.getByteFrequencyData(full)
      readColors()

      ctx.clearRect(0, 0, w, h)

      if (mode === 'aurora') {
        // Three harmonics of the spectrum, mirrored around a low baseline —
        // reads as layered light, not bars.
        const layers = [
          { amp: 0.34, alpha: 0.5, lw: 2, step: 6, off: 0 },
          { amp: 0.22, alpha: 0.32, lw: 1.5, step: 8, off: 26 },
          { amp: 0.13, alpha: 0.2, lw: 1, step: 10, off: 52 },
        ]
        for (const L of layers) {
          const baseY = h * 0.66
          ctx.beginPath()
          for (let x = 0; x <= w; x += L.step) {
            const bin = Math.floor((x / w) * 180)
            const v = (full[bin] ?? 0) / 255
            const y = baseY - v * h * L.amp - Math.sin(x / 90 + t / 2400 + L.off) * 4
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
          }
          const grad = ctx.createLinearGradient(0, 0, w, 0)
          grad.addColorStop(0, accent)
          grad.addColorStop(1, accent2)
          ctx.strokeStyle = grad
          ctx.globalAlpha = L.alpha
          ctx.lineWidth = L.lw
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      } else if (mode === 'particles') {
        for (let i = 0; i < PARTICLES; i++) {
          px[i] += pvx[i]; py[i] += pvy[i]
          if (px[i] < 0 || px[i] > 1) pvx[i] *= -1
          if (py[i] < 0 || py[i] > 1) pvy[i] *= -1
          const v = (full[pBand[i]] ?? 0) / 255
          const r = 1 + v * 3.2
          ctx.globalAlpha = 0.22 + v * 0.6
          ctx.fillStyle = i % 3 === 0 ? accent2 : accent
          ctx.beginPath()
          ctx.arc(px[i] * w, py[i] * h, r, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      } else {
        // Radial: frequency ring around a breathing core.
        const cx = w / 2
        const cy = h / 2
        const base = Math.min(w, h) * 0.26
        const bars = 96
        ctx.strokeStyle = accent
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        for (let i = 0; i < bars; i++) {
          const v = (full[Math.floor((i / bars) * 160)] ?? 0) / 255
          const a = (i / bars) * Math.PI * 2 - Math.PI / 2
          const r1 = base
          const r2 = base + v * Math.min(w, h) * 0.2 + 2
          ctx.globalAlpha = 0.25 + v * 0.6
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
          ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        const coreR = base * 0.5 + ((full[2] ?? 0) / 255) * base * 0.2
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
        cg.addColorStop(0, accent2)
        cg.addColorStop(1, 'transparent')
        ctx.fillStyle = cg
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      raf = requestAnimationFrame(draw)
    }

    if (staticMode || !isPlaying) {
      drawRest()
    } else {
      raf = requestAnimationFrame(draw)
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [mode, isPlaying, staticMode])

  return (
    <div className="flex-1 flex flex-col min-h-0" data-visual-stage data-mode={mode}>
      <div className="flex-1 min-h-0 relative">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden />
      </div>
      {/* Mode switch — a quiet text control; no heavy chrome on the stage */}
      <div className="flex items-center justify-center gap-1 py-2 shrink-0">
        {MODES.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setModeIdx(i)}
            aria-label={`${m.label} visualizer`}
            aria-pressed={i === modeIdx}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
            style={{
              transitionDuration: 'var(--dur-fast)',
              color: i === modeIdx ? 'var(--accent)' : 'var(--text-faint)',
              background: i === modeIdx ? 'var(--accent-dim)' : 'transparent',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  )
}
