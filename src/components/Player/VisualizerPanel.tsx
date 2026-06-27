import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, BarChart2 } from 'lucide-react'
import { audioAnalyserRef } from '@/hooks/useAudio'

type Mode = 'bars' | 'circle' | 'wave'

export function VisualizerPanel({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const [mode, setMode] = useState<Mode>('bars')

  useEffect(() => {
    if (!canvasRef.current) return
    // Capture as a non-null typed local — TS can't narrow refs across closure boundaries
    const c: HTMLCanvasElement = canvasRef.current
    const ctx = c.getContext('2d')!

    function getColors() {
      const s = getComputedStyle(document.documentElement)
      return {
        c1: s.getPropertyValue('--color-dynamic-1').trim() || '#B0B8C8',
        c2: s.getPropertyValue('--color-dynamic-2').trim() || '#C8D0DC',
      }
    }

    function draw() {
      rafRef.current = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, c.width, c.height)
      const analyser = audioAnalyserRef.current
      const { c1, c2 } = getColors()

      if (!analyser) {
        drawIdle(ctx, c, mode, c1)
        return
      }

      const freq = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(freq)

      if (mode === 'bars') drawBars(ctx, c, freq, c1, c2)
      else if (mode === 'circle') drawCircle(ctx, c, freq, c1)
      else drawWave(ctx, c, analyser, c1)
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [mode])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="fixed z-50 w-72 flex flex-col overflow-hidden"
      style={{
        bottom: 'calc(var(--spacing-player) + 12px)',
        right: '80px',
        background: 'rgba(14,14,20,0.92)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid var(--color-border-mid)',
        borderRadius: 16,
        boxShadow: '0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <BarChart2 size={13} style={{ color: 'var(--color-dynamic-1)' }} />
          <span className="text-xs font-semibold text-white/70 tracking-wide">Visualizer</span>
        </div>
        <button onClick={onClose} className="w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-white/50 hover:bg-white/5 transition-all">
          <X size={11} />
        </button>
      </div>

      <div className="flex gap-1 px-3 pt-2.5">
        {(['bars', 'circle', 'wave'] as Mode[]).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium capitalize transition-all ${mode === m ? 'text-white/90 bg-[var(--color-glass-strong)]' : 'text-white/30 hover:text-white/60 hover:bg-white/5'}`}
            style={mode === m ? { color: 'var(--color-dynamic-1)' } : undefined}>
            {m}
          </button>
        ))}
      </div>

      <div className="p-3 pt-2">
        <canvas ref={canvasRef} width={264} height={110}
          className="w-full rounded-xl" style={{ background: 'rgba(255,255,255,0.02)' }} />
      </div>

      <div className="h-0.5 shrink-0"
        style={{ background: 'linear-gradient(90deg, transparent, var(--color-dynamic-1), transparent)', opacity: 0.3 }} />
    </motion.div>
  )
}

// ── Draw functions — canvas is guaranteed non-null here (early return above) ──

function drawBars(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: Uint8Array, c1: string, c2: string) {
  const bars = 48
  const step = Math.floor(data.length / bars)
  const w = canvas.width / bars - 1.5
  const g = ctx.createLinearGradient(0, canvas.height, 0, 0)
  g.addColorStop(0, c1 + 'cc')
  g.addColorStop(1, c2 + '66')
  ctx.fillStyle = g
  for (let i = 0; i < bars; i++) {
    const val = data[i * step] / 255
    const h = Math.max(2, val * canvas.height * 0.9)
    ctx.beginPath()
    ctx.roundRect(i * (w + 1.5), canvas.height - h, w, h, [Math.min(w / 2, 3), Math.min(w / 2, 3), 0, 0])
    ctx.fill()
  }
}

function drawCircle(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: Uint8Array, c1: string) {
  const cx = canvas.width / 2, cy = canvas.height / 2
  const r = Math.min(cx, cy) * 0.38
  const bars = 72
  const step = Math.floor(data.length / bars)
  ctx.strokeStyle = c1 + 'aa'
  ctx.lineWidth = 1.5
  for (let i = 0; i < bars; i++) {
    const val = data[i * step] / 255
    const angle = (i / bars) * Math.PI * 2 - Math.PI / 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
    ctx.lineTo(cx + Math.cos(angle) * (r + val * r * 1.2), cy + Math.sin(angle) * (r + val * r * 1.2))
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(cx, cy, 3, 0, Math.PI * 2)
  ctx.fillStyle = c1
  ctx.fill()
}

function drawWave(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, analyser: AnalyserNode, c1: string) {
  const td = new Uint8Array(analyser.fftSize)
  analyser.getByteTimeDomainData(td)
  ctx.strokeStyle = c1 + 'cc'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const sw = canvas.width / td.length
  for (let i = 0; i < td.length; i++) {
    const y = canvas.height / 2 + ((td[i] / 128) - 1) * (canvas.height / 2.4)
    i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sw, y)
  }
  ctx.stroke()
}

function drawIdle(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, mode: Mode, c1: string) {
  const t = Date.now() / 1000
  if (mode === 'wave') {
    ctx.strokeStyle = c1 + '55'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let x = 0; x < canvas.width; x++) {
      const y = canvas.height / 2 + Math.sin(x * 0.04 + t * 2) * 8 * Math.sin(x * 0.012 + t * 0.5)
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
  } else {
    const bars = 48, w = canvas.width / bars - 1.5
    ctx.fillStyle = c1 + '44'
    for (let i = 0; i < bars; i++) {
      const h = Math.max(3, (Math.sin(i * 0.35 + t * 1.5) * 0.5 + 0.5) * canvas.height * 0.5)
      ctx.beginPath()
      ctx.roundRect(i * (w + 1.5), canvas.height - h, w, h, [2, 2, 0, 0])
      ctx.fill()
    }
  }
}
