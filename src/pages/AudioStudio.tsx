import { Power, RotateCcw, Sliders } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { isFlat as isFlatEq } from '@/lib/eq'
import { MasterCard, isStudioNeutral } from '@/components/Studio/MasterCard'
import { EqualizerCard } from '@/components/Studio/EqualizerCard'
import { AudioFxCard } from '@/components/Studio/AudioFxCard'

// ── Audio Studio (Aura 3.2.0) ───────────────────────────────────────────────
// The dedicated audio workspace — a real Sidebar destination, not a Settings
// subsection. Sections:
//
//   Audio Studio
//   ├── Master      — preamp, balance, output limiter
//   ├── Equalizer   — 10-band graphic EQ + built-in & custom curves
//   └── Effects     — bass / treble / compression / reverb / stereo width
//       + Bypass & Reset live in the page header (spec §5.1's "Reset/Bypass")
//
// Everything here edits the SAME authoritative playback graph the main
// player, Playbar and Mini Player use — the studio is a control surface,
// never a second engine (spec §5.4). All state lives in playerStore as
// serializable values; runtime AudioNodes stay inside playbackController.
// The layout language (sections, cards, toggles) is Settings' — the page
// reads as native to Aura rather than a bolted-on mixing desk.

export function AudioStudio() {
  const studioBypass = usePlayerStore((s) => s.studioBypass)
  const setStudioBypass = usePlayerStore((s) => s.setStudioBypass)
  const resetStudio = usePlayerStore((s) => s.resetStudio)
  // Status pill inputs — subscribed individually so the pill stays live
  // without re-rendering the cards on every band drag.
  const eqEnabled = usePlayerStore((s) => s.eqEnabled)
  const eqGains = usePlayerStore((s) => s.eqGains)
  const audioFx = usePlayerStore((s) => s.audioFx)
  const preampDb = usePlayerStore((s) => s.preampDb)
  const balance = usePlayerStore((s) => s.balance)
  const limiterEnabled = usePlayerStore((s) => s.limiterEnabled)

  const neutral = isStudioNeutral({ eqEnabled, eqGains, audioFx, preampDb, balance, limiterEnabled })
  const activeCount = [
    eqEnabled && !isFlatEq(eqGains),
    preampDb !== 0,
    balance !== 0,
    limiterEnabled,
    audioFx.bassGain !== 0,
    audioFx.trebleGain !== 0,
    audioFx.compression !== 0,
    audioFx.reverbMix !== 0,
    audioFx.stereoWidth !== 1,
  ].filter(Boolean).length

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      {/* Header — title, live status, and the two global controls */}
      <div className="flex items-start justify-between gap-4 mb-6 max-w-2xl">
        <div className="min-w-0">
          <h1
            className="text-2xl font-semibold tracking-tight flex items-center gap-2.5"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
          >
            <Sliders size={22} style={{ color: 'var(--accent)' }} />
            Audio Studio
          </h1>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
            Shape the sound of everything Aura plays — one live signal chain, applied in real time.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setStudioBypass(!studioBypass)}
            aria-pressed={studioBypass}
            data-studio-bypass
            title={studioBypass ? 'Re-enable the whole studio' : 'Suspend the whole studio (perfect transparency)'}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium active:scale-95 transition-all"
            style={{
              background: studioBypass ? 'var(--warning-veil)' : 'var(--glass-1)',
              border: `1px solid ${studioBypass ? 'var(--warning)' : 'var(--border-default)'}`,
              color: studioBypass ? 'var(--warning)' : 'var(--text-secondary)',
              transitionDuration: 'var(--dur-fast)',
            }}
          >
            <Power size={13} />
            {studioBypass ? 'Bypassed' : 'Bypass'}
          </button>
          <button
            onClick={resetStudio}
            data-studio-reset
            title="Reset every stage to its neutral point"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium active:scale-95 transition-all"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', transitionDuration: 'var(--dur-fast)' }}
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>

      {/* Live status pill — what the engine is actually doing right now */}
      <div className="max-w-2xl mb-5">
        <span
          data-studio-status
          role="status"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
          style={{
            background: studioBypass ? 'var(--warning-veil)' : neutral ? 'var(--glass-1)' : 'var(--accent-dim)',
            border: `1px solid ${studioBypass ? 'var(--warning)' : neutral ? 'var(--border-default)' : 'var(--accent-border)'}`,
            color: studioBypass ? 'var(--warning)' : neutral ? 'var(--text-tertiary)' : 'var(--accent)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: studioBypass ? 'var(--warning)' : neutral ? 'var(--text-faint)' : 'var(--accent)' }}
            aria-hidden
          />
          {studioBypass
            ? 'Bypassed — the chain is transparent, your settings are kept'
            : neutral
              ? 'Neutral — every stage is at its transparent point'
              : `Active — ${activeCount} stage${activeCount === 1 ? '' : 's'} shaping the sound`}
        </span>
      </div>

      <div className="max-w-2xl space-y-8">
        <StudioSection title="Master">
          <MasterCard bypassed={studioBypass} />
        </StudioSection>

        <StudioSection title="Equalizer">
          <EqualizerCard bypassed={studioBypass} />
        </StudioSection>

        <StudioSection title="Effects">
          <AudioFxCard bypassed={studioBypass} />
        </StudioSection>
      </div>
    </div>
  )
}

function StudioSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2
          className="text-[11px] font-semibold uppercase whitespace-nowrap"
          style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
        >
          {title}
        </h2>
        <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
