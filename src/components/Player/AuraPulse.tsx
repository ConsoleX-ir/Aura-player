import { useEffect, useRef, useState } from 'react'
import { getAnalyser } from '@/lib/playbackController'
import { usePlayerStore } from '@/store/playerStore'

// ── Aura Pulse ──────────────────────────────────────────────────────────────
// The living glow around the Play Bar — the component that makes Aura feel
// like Aura. While music plays, the pill is wrapped in an engine-driven aura
// built from three layers:
//
//   1. TWO CONCENTRIC RINGS — breathe with the track's REAL low-frequency
//      energy, read straight from the playback engine's AnalyserNode.
//   2. THE ENERGY POOL — a soft accent field blooming underneath the pill,
//      scaling and brightening with the same bass signal; the "sound has
//      weight" layer.
//   3. THE ORBIT — a faint light slowly circling behind the pill (pure CSS
//      keyframes, transform-only) that reads as motion even between beats.
//
// Design constraints (locked roadmap rules):
//   • Performance first: the loop writes `transform`/`opacity` directly on
//     THREE DOM nodes via refs — no React state, no re-renders, no layout
//     thrash. One Uint8Array, allocated once. getByteFrequencyData is a
//     stateless read, so sharing the analyser with the visualizer is safe.
//   • Paused = still. No rAF runs when nothing is playing; layers settle to
//     a calm resting glow via CSS transitions (graceful, not abrupt).
//   • prefers-reduced-motion and Performance Mode both freeze the pulse at
//     its resting state and remove the orbit/pool entirely — visible, calm,
//     zero animation.
//
// Test hooks: [data-aura-pulse] root carries data-mode="live"|"static" and
// data-active="true"|"false" so functional tests can verify the states
// without pixel-hunting a glow.

const BASS_BINS = 24          // ≈ 0–500 Hz of the 2048-fft analyser
// v2.1.0: presence retuned — the aura was so quiet it read as "off" to anyone
// not staring at the pill; lifted rest/play ceilings so the breathing is
// clearly visible at a glance while staying ambience, not a light show.
const REST_OPACITY = 0.20
const MAX_OPACITY = 0.72
const REST_SCALE = 1
const MAX_SCALE = 1.034
const POOL_REST = 0.12
const POOL_MAX = 0.42

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function AuraPulse({ active }: { active: boolean }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const poolRef = useRef<HTMLDivElement>(null)
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
    const outer = outerRef.current
    const inner = innerRef.current
    const pool = poolRef.current
    if (!outer || !inner || !pool) return

    // ── Static mode: calm resting glow, no loop, ever. ──
    if (staticMode) {
      outer.style.transition = 'opacity 800ms ease'
      inner.style.transition = 'opacity 800ms ease'
      outer.style.opacity = String(REST_OPACITY * 0.6)
      inner.style.opacity = String(REST_OPACITY * 0.6)
      outer.style.transform = 'scale(1)'
      inner.style.transform = 'scale(1)'
      pool.style.opacity = String(POOL_REST * 0.6)
      pool.style.transform = 'scale(1)'
      return
    }

    // ── Paused: settle to rest with a soft transition, no loop. ──
    if (!active) {
      outer.style.transition = 'opacity 900ms ease, transform 900ms ease'
      inner.style.transition = 'opacity 900ms ease, transform 900ms ease'
      pool.style.transition = 'opacity 900ms ease, transform 900ms ease'
      outer.style.opacity = String(REST_OPACITY)
      inner.style.opacity = String(REST_OPACITY * 0.8)
      outer.style.transform = `scale(${REST_SCALE})`
      inner.style.transform = `scale(${REST_SCALE})`
      pool.style.opacity = String(POOL_REST)
      pool.style.transform = 'scale(1)'
      return
    }

    // ── Playing: the pulse. Direct per-frame writes, engine-driven. ──
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
      outer.style.opacity = String(o)
      outer.style.transform = `scale(${s})`
      // The inner ring trails slightly behind for depth.
      inner.style.opacity = String(o * 0.55)
      inner.style.transform = `scale(${1 + (s - 1) * 1.8})`
      // The pool underneath breathes the same bass, slightly gentler.
      pool.style.opacity = String(POOL_REST + intensity * (POOL_MAX - POOL_REST))
      pool.style.transform = `scaleX(${1 + intensity * 0.06}) scaleY(${1 + intensity * 0.14})`

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
      style={{ borderRadius: 'var(--radius-pill)' }}
    >
      {/* Energy pool — a wide accent field blooming from beneath the pill */}
      <div
        ref={poolRef}
        className="aura-pulse-pool absolute"
        style={{
          left: '4%', right: '4%', bottom: -14, height: 46,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse closest-side, var(--accent), transparent 78%)',
          filter: 'blur(18px)',
          opacity: POOL_REST,
        }}
      />
      {/* Orbit — a faint light circling behind the pill while playing.
          Pure CSS (transform keyframes); visibility is driven by the root's
          data-active so pause fades it out via the class rules in index.css. */}
      <div className="aura-pulse-orbit absolute inset-[-26px]" style={{ borderRadius: 'var(--radius-pill)' }}>
        <div className="aura-orb" />
      </div>
      <div
        ref={outerRef}
        className="absolute inset-0"
        style={{
          borderRadius: 'var(--radius-pill)',
          border: '1.5px solid var(--accent)',
          opacity: REST_OPACITY,
          boxShadow: '0 0 34px var(--accent-whisper), inset 0 0 26px var(--accent-whisper)',
        }}
      />
      <div
        ref={innerRef}
        className="absolute inset-[-3px]"
        style={{
          borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--accent)',
          opacity: REST_OPACITY * 0.8,
        }}
      />
    </div>
  )
}
