import { useEffect, useRef, useState } from 'react'
import { getAnalyser } from '@/lib/playbackController'
import { usePlayerStore } from '@/store/playerStore'

// ── Aurora Bar Field (Aura 3.0 Playbar — Wave 5 redesign of Aura Pulse) ─────
// The living glow behind the Playbar 3.0. The v2 three-layer construction
// (two concentric rings + orbiting light + energy pool) read as a *capsule
// decoration*; the 3.0 bar is a wide glass slab, so the aura became a FIELD:
//
//   1. THE AURORA FIELD — a broad accent gradient blooming behind the whole
//      bar, breathing with the track's REAL low-frequency energy (read
//      straight from the engine's AnalyserNode). Artwork/theme-aware via the
//      --accent family.
//   2. THE RIM LIGHT — a hairline of light along the bar's top edge that
//      brightens with the same bass signal: reads as the glass catching the
//      music. Subtle by design — ambience, not a light show.
//
// Design constraints (locked rules, unchanged from v2):
//   • Performance first: the loop writes `transform`/`opacity` directly on
//     TWO DOM nodes via refs — no React state, no re-renders, no layout
//     thrash. One Uint8Array, allocated once. getByteFrequencyData is a
//     stateless read, so sharing the analyser with the visualizer is safe.
//   • Paused = still. No rAF runs when nothing is playing; layers settle to
//     a calm resting glow via CSS transitions (graceful, not abrupt).
//   • prefers-reduced-motion and Performance Mode both freeze the field at
//     its resting state (CSS stillness rules hide the rim entirely).
//
// Test hooks: [data-aura-pulse] root carries data-mode="live"|"static" and
// data-active="true"|"false" so functional tests can verify the states
// without pixel-hunting a glow.

const BASS_BINS = 24          // ≈ 0–500 Hz of the 2048-fft analyser
const REST_OPACITY = 0.22     // field resting glow
const MAX_OPACITY = 0.66      // field at full bass
const REST_SCALE = 1
const MAX_SCALE = 1.028
const RIM_REST = 0.30         // rim light resting brightness
const RIM_MAX = 0.85

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function AuraPulse({ active }: { active: boolean }) {
  const fieldRef = useRef<HTMLDivElement>(null)
  const rimRef = useRef<HTMLDivElement>(null)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const [reduced, setReduced] = useState(prefersReducedMotion)

  // Track the OS-level reduced-motion setting live (users can flip it while
  // Aura is open; the media query fires an event when they do).
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  const staticMode = performanceMode || reduced

  useEffect(() => {
    const field = fieldRef.current
    const rim = rimRef.current
    if (!field || !rim) return

    // ── Static mode: calm resting glow, no loop, ever. ──
    if (staticMode) {
      field.style.transition = 'opacity 800ms ease'
      rim.style.transition = 'opacity 800ms ease'
      field.style.opacity = String(REST_OPACITY * 0.6)
      field.style.transform = 'scale(1)'
      rim.style.opacity = String(RIM_REST * 0.6)
      return
    }

    // ── Paused: settle to rest with a soft transition, no loop. ──
    if (!active) {
      field.style.transition = 'opacity 900ms ease, transform 900ms ease'
      rim.style.transition = 'opacity 900ms ease'
      field.style.opacity = String(REST_OPACITY)
      field.style.transform = `scale(${REST_SCALE})`
      rim.style.opacity = String(RIM_REST)
      return
    }

    // ── Playing: the aurora. Direct per-frame writes, engine-driven. ──
    let raf = 0
    let intensity = 0
    const analyserNow = getAnalyser()
    const full = new Uint8Array(analyserNow?.frequencyBinCount ?? 1024)

    const tick = () => {
      const analyser = getAnalyser()
      if (analyser) {
        analyser.getByteFrequencyData(full)
        let sum = 0
        for (let i = 0; i < BASS_BINS; i++) sum += full[i]
        const target = Math.min(1, (sum / (BASS_BINS * 255)) * 2.2)
        // Ease toward the target — attack fast, release slow, like a VU meter.
        intensity += (target - intensity) * (target > intensity ? 0.35 : 0.08)
      }

      const o = REST_OPACITY + intensity * (MAX_OPACITY - REST_OPACITY)
      const s = REST_SCALE + intensity * (MAX_SCALE - REST_SCALE)
      field.style.opacity = String(o)
      field.style.transform = `scale(${s})`
      // The rim brightens faster than the field — it reads as specular light.
      rim.style.opacity = String(RIM_REST + intensity * (RIM_MAX - RIM_REST))

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [active, staticMode])

  return (
    <div
      data-aura-pulse
      data-mode={staticMode ? 'static' : 'live'}
      data-active={active ? 'true' : 'false'}
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{ borderRadius: 'var(--radius-2xl)' }}
    >
      {/* Aurora field — wide accent gradient blooming from behind the bar */}
      <div
        ref={fieldRef}
        className="aurora-field absolute"
        style={{
          inset: -18,
          borderRadius: 40,
          background: 'radial-gradient(ellipse 78% 120% at 50% 62%, var(--accent) 0%, var(--accent-2, var(--accent)) 34%, transparent 74%)',
          filter: 'blur(34px)',
          opacity: REST_OPACITY,
          transform: `scale(${REST_SCALE})`,
        }}
      />
      {/* Rim light — hairline along the top edge, brightens with bass */}
      <div
        ref={rimRef}
        className="aurora-rim absolute"
        style={{
          top: -1, left: 26, right: 26, height: 1.5,
          borderRadius: 'var(--radius-pill)',
          background: 'linear-gradient(90deg, transparent, var(--accent-strong) 22%, rgba(255,255,255,0.85) 50%, var(--accent-strong) 78%, transparent)',
          filter: 'blur(0.4px)',
          opacity: RIM_REST,
        }}
      />
    </div>
  )
}
