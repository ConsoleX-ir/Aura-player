import { Gauge, ShieldCheck } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import {
  PREAMP_MIN_DB, PREAMP_MAX_DB, BALANCE_MIN, BALANCE_MAX,
} from '@/lib/audioStudio'
import { NEUTRAL_FX } from '@/lib/audioFx'
import { isFlat } from '@/lib/eq'

// ── Audio Studio → Master (v3.2.0) ──────────────────────────────────────────
// The stages that shape the WHOLE signal rather than its tone:
//   • Preamp   — input gain ahead of the EQ, so EQ boosts can be compensated
//                (−12…+12 dB, 0 = transparent, double-click resets)
//   • Balance  — stereo position (−1 hard left … +1 hard right, center snaps)
//   • Limiter  — the protection stage that catches the peaks a boosted EQ or
//                heavy preamp would otherwise clip (honest toggle, real
//                DynamicsCompressor params, never a fake knob)
// Every control writes a plain number/boolean through the store; the engine
// glides the matching AudioParam. Nothing here rebuilds the graph.

export function MasterCard({ bypassed }: { bypassed: boolean }) {
  const preampDb = usePlayerStore((s) => s.preampDb)
  const setPreampDb = usePlayerStore((s) => s.setPreampDb)
  const balance = usePlayerStore((s) => s.balance)
  const setBalance = usePlayerStore((s) => s.setBalance)
  const limiterEnabled = usePlayerStore((s) => s.limiterEnabled)
  const setLimiterEnabled = usePlayerStore((s) => s.setLimiterEnabled)

  const preampPct = ((preampDb - PREAMP_MIN_DB) / (PREAMP_MAX_DB - PREAMP_MIN_DB)) * 100
  const balancePct = ((balance - BALANCE_MIN) / (BALANCE_MAX - BALANCE_MIN)) * 100
  const dim = bypassed

  return (
    <div
      className="p-4 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      data-testid="studio-master-card"
    >
      <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
        <Gauge size={14} style={{ color: 'var(--accent)' }} />
        Master
      </p>
      <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Input gain, stereo position and the output protection stage — applied to everything Aura plays.
      </p>

      <div className="space-y-3.5" style={{ opacity: dim ? 0.45 : 1, transition: 'opacity var(--dur-fast) var(--ease-smooth)' }}>
        {/* Preamp */}
        <div className="flex items-center gap-3" data-studio-preamp>
          <span className="w-20 text-xs shrink-0" style={{ color: preampDb !== 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
            Preamp
          </span>
          <div className="relative flex-1 min-w-0 flex items-center">
            <input
              type="range"
              min={PREAMP_MIN_DB} max={PREAMP_MAX_DB} step={0.5}
              value={preampDb}
              onChange={(e) => setPreampDb(Number(e.target.value))}
              onDoubleClick={() => setPreampDb(0)}
              onKeyDown={(e) => { if (e.key === '0') setPreampDb(0) }}
              aria-label="Preamp gain in decibels"
              aria-valuetext={`${preampDb > 0 ? '+' : ''}${preampDb.toFixed(1)} dB`}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
              style={{
                background: `linear-gradient(to right, var(--accent) ${preampPct}%, var(--glass-3) ${preampPct}%)`,
              }}
            />
            {/* 0 dB reference tick */}
            <div className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 pointer-events-none" style={{ left: '50%', background: 'var(--border-strong)' }} />
          </div>
          <button
            onClick={() => setPreampDb(0)}
            disabled={preampDb === 0}
            className="w-16 text-right text-xs tabular-nums shrink-0 disabled:cursor-default"
            style={{ color: preampDb !== 0 ? 'var(--accent)' : 'var(--text-faint)' }}
            title="Reset preamp to 0 dB"
          >
            {preampDb > 0 ? '+' : ''}{preampDb.toFixed(1)} dB
          </button>
        </div>

        {/* Balance */}
        <div className="flex items-center gap-3" data-studio-balance>
          <span className="w-20 text-xs shrink-0" style={{ color: balance !== 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
            Balance
          </span>
          <div className="relative flex-1 min-w-0 flex items-center">
            <input
              type="range"
              min={BALANCE_MIN} max={BALANCE_MAX} step={0.05}
              value={balance}
              onChange={(e) => setBalance(Number(e.target.value))}
              onDoubleClick={() => setBalance(0)}
              onKeyDown={(e) => { if (e.key === '0') setBalance(0) }}
              aria-label="Stereo balance"
              aria-valuetext={balance === 0 ? 'Center' : balance < 0 ? `${Math.round(-balance * 100)}% left` : `${Math.round(balance * 100)}% right`}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
              style={{
                background: `linear-gradient(to right, var(--glass-3) ${balancePct}%, var(--accent) ${balancePct}%)`,
              }}
            />
            <div className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 pointer-events-none" style={{ left: '50%', background: 'var(--border-strong)' }} />
          </div>
          <button
            onClick={() => setBalance(0)}
            disabled={balance === 0}
            className="w-16 text-right text-xs tabular-nums shrink-0 disabled:cursor-default"
            style={{ color: balance !== 0 ? 'var(--accent)' : 'var(--text-faint)' }}
            title="Recenter balance"
          >
            {balance === 0 ? 'Center' : balance < 0 ? `${Math.round(-balance * 100)}% L` : `${Math.round(balance * 100)}% R`}
          </button>
        </div>

        {/* Limiter */}
        <div className="flex items-center justify-between gap-4" data-studio-limiter>
          <div className="min-w-0">
            <p className="text-xs flex items-center gap-1.5" style={{ color: limiterEnabled ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
              <ShieldCheck size={12} style={{ color: limiterEnabled ? 'var(--success)' : 'var(--text-faint)' }} />
              Output Limiter
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
              Catches peaks before they clip when the preamp or EQ adds gain. Transparent when off.
            </p>
          </div>
          <button
            onClick={() => setLimiterEnabled(!limiterEnabled)}
            role="switch"
            aria-checked={limiterEnabled}
            aria-label="Toggle output limiter"
            className="relative w-11 h-6 rounded-full transition-all shrink-0 pressable"
            style={{ background: limiterEnabled ? 'var(--accent)' : 'var(--glass-3)', transitionDuration: 'var(--dur-fast)' }}
            onMouseEnter={(e) => { if (!limiterEnabled) e.currentTarget.style.background = 'var(--surface-selected)' }}
            onMouseLeave={(e) => { if (!limiterEnabled) e.currentTarget.style.background = 'var(--glass-3)' }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform"
              style={{ background: 'var(--text-on-accent)', transform: limiterEnabled ? 'translateX(20px)' : 'translateX(0)' }}
            />
          </button>
        </div>
      </div>

      {dim && (
        <p className="text-[11px] mt-3" style={{ color: 'var(--warning)' }} role="status">
          The studio is bypassed — these controls are suspended.
        </p>
      )}
    </div>
  )
}

/** Whether the whole studio sits at its neutral graph (for the status pill). */
export function isStudioNeutral(s: {
  eqGains: number[]; eqEnabled: boolean; audioFx: { bassGain: number; trebleGain: number; compression: number; reverbMix: number; stereoWidth: number }
  preampDb: number; balance: number; limiterEnabled: boolean
}): boolean {
  return (
    s.eqEnabled &&
    isFlat(s.eqGains) &&
    s.preampDb === 0 &&
    s.balance === 0 &&
    !s.limiterEnabled &&
    s.audioFx.bassGain === NEUTRAL_FX.bassGain &&
    s.audioFx.trebleGain === NEUTRAL_FX.trebleGain &&
    s.audioFx.compression === NEUTRAL_FX.compression &&
    s.audioFx.reverbMix === NEUTRAL_FX.reverbMix &&
    s.audioFx.stereoWidth === NEUTRAL_FX.stereoWidth
  )
}
