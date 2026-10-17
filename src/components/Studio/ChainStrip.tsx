import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { getDynamicsReduction } from '@/lib/playbackController'
import { isFlat } from '@/lib/eq'
import { subscribeAnalysis, fitCanvas, readVizColors } from './analysisLoop'

// ── Studio 4.0 — signal chain strip ──────────────────────────────────────────
// One glance = the state of the WHOLE chain, exactly as the engine holds it:
//
//   [source] → [preamp ±dB] → [EQ n bands / off] → [dynamics & FX] →
//   [balance] → [limiter] → [output]
//
// The two dynamics blocks carry LIVE gain-reduction meters read straight
// from DynamicsCompressorNode.reduction — the same numbers the DSP applies
// right now. Everything else is the real persisted setting, not a copy:
// change a stage anywhere in the app and this strip moves.

const GR_SPAN_DB = 12

export function ChainStrip({ bypassed }: { bypassed: boolean }) {
  const preampDb = usePlayerStore((s) => s.preampDb)
  const eqEnabled = usePlayerStore((s) => s.eqEnabled)
  const eqGains = usePlayerStore((s) => s.eqGains)
  const audioFx = usePlayerStore((s) => s.audioFx)
  const balance = usePlayerStore((s) => s.balance)
  const limiterEnabled = usePlayerStore((s) => s.limiterEnabled)
  const hasSong = usePlayerStore((s) => !!s.currentSong)

  const grCompRef = useRef<HTMLCanvasElement>(null)
  const grLimRef = useRef<HTMLCanvasElement>(null)

  // Live gain-reduction slivers under the two dynamics blocks. ONE shared-loop
  // subscription draws both canvases; no React state at frame rate. When the
  // studio is bypassed the engine's stages sit at their neutral params, so
  // reduction is genuinely 0 — the meters tell the truth by construction.
  useEffect(() => {
    return subscribeAnalysis(() => {
      const { comp, limiter } = getDynamicsReduction()
      drawGr(grCompRef.current, comp)
      drawGr(grLimRef.current, limiter)
    })
  }, [])

  const eqActive = bypassed || !eqEnabled
    ? null
    : isFlat(eqGains) ? null : eqGains.filter((g) => Math.abs(g) >= 0.25).length
  const fxActive = bypassed ? 0 : (
    (audioFx.bassGain !== 0 ? 1 : 0) +
    (audioFx.trebleGain !== 0 ? 1 : 0) +
    (audioFx.compression !== 0 ? 1 : 0) +
    (audioFx.reverbMix !== 0 ? 1 : 0) +
    (audioFx.stereoWidth !== 1 ? 1 : 0)
  )

  return (
    <div
      className="flex items-stretch gap-1 p-3 rounded-xl overflow-x-auto"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      data-studio-chain
      aria-label="Signal chain overview"
    >
      <Stage label="Source" state={hasSong ? 'playing' : 'silent'} tone={hasSong ? 'ok' : 'idle'} />
      <Arrow />
      <Stage label="Preamp" state={bypassed ? '0.0 dB' : `${preampDb > 0 ? '+' : ''}${preampDb.toFixed(1)} dB`} tone={bypassed || preampDb === 0 ? 'idle' : 'hot'} />
      <Arrow />
      <Stage label="Equalizer" state={eqActive ? `${eqActive} band${eqActive === 1 ? '' : 's'}` : bypassed || !eqEnabled ? 'off' : 'flat'} tone={eqActive ? 'hot' : 'idle'} />
      <Arrow />
      <Stage
        label="Dynamics & FX"
        state={fxActive === 0 ? 'neutral' : `${fxActive} active`}
        tone={fxActive ? 'hot' : 'idle'}
        grRef={grCompRef}
        grTitle="Compressor gain reduction"
      />
      <Arrow />
      <Stage label="Balance" state={bypassed ? 'center' : balance === 0 ? 'center' : balance < 0 ? `${Math.round(-balance * 100)}% L` : `${Math.round(balance * 100)}% R`} tone={bypassed || balance === 0 ? 'idle' : 'hot'} />
      <Arrow />
      <Stage label="Limiter" state={bypassed || !limiterEnabled ? 'off' : 'guarding'} tone={bypassed || !limiterEnabled ? 'idle' : 'ok'} grRef={grLimRef} grTitle="Limiter gain reduction" />
      <Arrow />
      <Stage label="Output" state={hasSong ? 'live' : 'silent'} tone={hasSong ? 'ok' : 'idle'} />
    </div>
  )
}

function Stage({ label, state, tone, grRef, grTitle }: {
  label: string; state: string; tone: 'ok' | 'hot' | 'idle'
  grRef?: React.RefObject<HTMLCanvasElement | null>; grTitle?: string
}) {
  const accent = tone === 'hot' ? 'var(--accent)'
    : tone === 'ok' ? 'var(--success)'
    : 'var(--text-faint)'
  return (
    <div
      className="flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-lg min-w-[92px] shrink-0"
      style={{
        background: 'var(--surface-inset)',
        border: `1px solid ${tone === 'idle' ? 'var(--border-subtle)' : tone === 'ok' ? 'color-mix(in srgb, var(--success) 30%, transparent)' : 'var(--accent-border)'}`,
      }}
    >
      <span className="text-[9px] font-semibold uppercase whitespace-nowrap" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
        {label}
      </span>
      <span className="text-xs font-medium tabular-nums whitespace-nowrap" style={{ color: accent }}>
        {state}
      </span>
      {grRef && (
        <canvas
          ref={grRef}
          className="w-[72px] h-[5px] mt-1"
          aria-hidden
          title={grTitle}
        />
      )}
    </div>
  )
}

function Arrow() {
  return (
    <div className="flex items-center px-0.5 shrink-0" aria-hidden>
      <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-40">
        <path d="M2 2 L6 5 L2 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-faint)' }} />
      </svg>
    </div>
  )
}

/** Gain-reduction sliver: fills right-to-left as GR deepens (0…12 dB span). */
function drawGr(c: HTMLCanvasElement | null, grDb: number) {
  if (!c || !c.isConnected) return
  const ctx = fitCanvas(c)
  if (!ctx) return
  const w = c.clientWidth
  ctx.clearRect(0, 0, w, c.clientHeight)
  const clamped = Math.min(GR_SPAN_DB, Math.max(0, grDb))
  if (clamped < 0.05) return
  const frac = clamped / GR_SPAN_DB
  ctx.fillStyle = readVizColors().meterHot
  ctx.beginPath()
  ctx.roundRect(w - frac * w, 0, frac * w, 5, [2, 2, 2, 2])
  ctx.fill()
}
