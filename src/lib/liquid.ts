// ── liquid.ts — Aura's native liquid/gel motion kit (v2.16.1) ────────────────
// A careful, dependency-free port of the TECHNIQUES from the liquid-taffy
// reference implementation (github.com/arknow91/liquid-taffy — a reference,
// not a package): the shared travelling pill with squash & stretch, and the
// sampled "house spring" settle curve. What is deliberately NOT ported: the
// SVG goo filter/metaball system and the grab-stretch gesture engine — both
// are beautiful but far outside Aura's performance budget and restrained
// visual language for this pass.
//
// Why WAAPI instead of GSAP/rAF:
//   • transform-only keyframes run on the COMPOSITOR — no main-thread frames,
//     no rAF loop, zero JS between frames (gsap would run per-frame JS).
//   • Chromium's `linear()` easing lets us play the exact 36-point sampled
//     spring curve liquid-taffy solved (ζ=0.434, ω=22.46 — 22% overshoot,
//     ring, settle) as a first-class easing function.
//   • Animations are self-cleaning; cancelling is `getAnimations()` — no
//     tween bookkeeping to leak.
//
// Budget guard: every helper here asks `liquidMotionAllowed()` first, which
// respects BOTH Aura's Performance Mode (data-performance="on") and the OS
// prefers-reduced-motion setting. When either is active, motion collapses to
// instant placement — the pill/press still renders correctly, it just never
// travels or squashes.

// ── The sampled house spring ─────────────────────────────────────────────────
// Verbatim sample points from liquid-taffy's springs.ts (x sampled at i/36).
// As a WAAPI `linear()` easing we prepend 0 and append 1: Chromium places N
// easing values evenly at i/(N-1), which reproduces the curve exactly.
export const HOUSE_SPRING_SAMPLES: readonly number[] = [
  0.0289, 0.1062, 0.2182, 0.3519, 0.4957, 0.6396, 0.7755, 0.8974,
  1.0013, 1.0849, 1.1474, 1.1896, 1.213, 1.22, 1.2134, 1.1961,
  1.1714, 1.1419, 1.1102, 1.0786, 1.0487, 1.022, 0.9992, 0.981,
  0.9673, 0.9581, 0.9531, 0.9516, 0.9531, 0.957, 0.9624, 0.969,
  0.9759, 0.9829, 0.9894, 1,
]

let cachedSpringEasing: string | null = null
let linearSupported: boolean | null = null

function linearEasingSupported(): boolean {
  if (linearSupported === null) {
    try {
      linearSupported = typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', 'linear(0, 1)')
    } catch {
      linearSupported = false
    }
  }
  return linearSupported
}

/** The house spring as a WAAPI/CSS easing string (falls back to Aura's spring bezier). */
export function houseSpringEasing(): string {
  if (cachedSpringEasing === null) {
    cachedSpringEasing = linearEasingSupported()
      ? `linear(0, ${HOUSE_SPRING_SAMPLES.join(', ')})`
      : 'cubic-bezier(0.34, 1.56, 0.64, 1)' // Aura's existing --ease-spring
  }
  return cachedSpringEasing
}

// ── Guards ───────────────────────────────────────────────────────────────────

/** True when liquid motion may play at all (Performance Mode + reduced-motion aware). */
export function liquidMotionAllowed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    if (document.documentElement.getAttribute('data-performance') === 'on') return false
    return true
  } catch {
    return false
  }
}

// ── The gel travel — a shared pill flying between two slots ─────────────────
// One absolutely-positioned pill element carries the SELECTION background
// between slots (tabs, nav rows). The flight: take off with a directional
// squash (long, low, leaning into travel), arrive slightly oversized, ring
// back to rest on the house spring. Transform-only — width is baked into
// scaleX so nothing here triggers layout.
//
// The pill ALWAYS ends exactly on the slot (even when guards disable the
// animation): callers render it as the selection background, so a snap is
// visually identical to the settled end state.

export interface GelSlot { x: number; width: number }

export interface GelTravelOptions {
  /** Travel duration in ms (whole choreography, settle included). */
  durationMs?: number
  /** Squash depth mid-flight (scaleY). Lower = stiffer gel. */
  squash?: number
  /** Directional lean mid-flight (skewX degrees, auto-signed by direction). */
  lean?: number
}

/** Apply a slot instantly (first paint, re-park, or guards active). */
export function gelPlace(pill: HTMLElement, slot: GelSlot): void {
  pill.getAnimations().forEach((a) => a.cancel())
  pill.style.width = `${slot.width}px`
  pill.style.transform = `translateX(${slot.x}px)`
}

/** Cancel any running flight, committing its live mid-flight state first so an
 * interrupted flight RESUMES from where it visually was instead of snapping. */
function cancelFlights(pill: HTMLElement): void {
  pill.getAnimations().forEach((a) => {
    try { (a as Animation & { commitStyles?: () => void }).commitStyles?.() } catch { /* not rendered — nothing to commit */ }
    a.cancel()
  })
}

/**
 * Fly the pill from `from` to `to`. Returns the Animation (or null when
 * guards disabled motion and the pill was placed instantly). Starts from
 * wherever the pill actually is (current committed transform), so
 * interrupting a flight mid-way never snaps.
 */
export function gelTravel(
  pill: HTMLElement,
  from: GelSlot,
  to: GelSlot,
  opts: GelTravelOptions = {},
): Animation | null {
  if (!liquidMotionAllowed()) {
    gelPlace(pill, to)
    return null
  }

  cancelFlights(pill)

  // Start from the pill's ACTUAL current visual slot when it differs from the
  // nominal `from` (interrupted flight): read it off the live transform.
  const start = currentSlot(pill) ?? from
  // Identity run (same slot — a re-render, not a selection change): never
  // pulse the pill in place, just settle it exactly on the slot.
  if (Math.abs(start.x - to.x) < 0.5 && Math.abs(start.width - to.width) < 0.5) {
    gelPlace(pill, to)
    return null
  }
  pill.style.width = `${to.width}px`

  const dir = to.x >= start.x ? 1 : -1
  const travel = Math.abs(to.x - start.x)
  const duration = opts.durationMs ?? 440
  const squash = opts.squash ?? 0.8
  const lean = opts.lean ?? 7

  // scaleX must express the WIDTH ratio (the element's layout width is
  // already the destination's), so the pill visually starts at the old width.
  const startScaleX = start.width / to.width
  const midX = (start.x + to.x) / 2
  // Mid-flight stretch: longer travel = more elongation, clamped.
  const stretch = Math.min(1.45, Math.max(1.12, startScaleX + travel / Math.max(to.width, 1) * 0.35))

  const spring = houseSpringEasing()
  const animation = pill.animate(
    [
      { transform: `translateX(${start.x}px) scaleX(${startScaleX}) scaleY(1) skewX(0deg)`, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', offset: 0 },
      { transform: `translateX(${midX}px) scaleX(${stretch}) scaleY(${squash}) skewX(${-lean * dir}deg)`, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', offset: 0.42 },
      { transform: `translateX(${to.x}px) scaleX(1.05) scaleY(0.93) skewX(${lean * 0.3 * dir}deg)`, easing: spring, offset: 0.58 },
      { transform: `translateX(${to.x}px) scaleX(1) scaleY(1) skewX(0deg)`, offset: 1 },
    ],
    { duration, fill: 'both' },
  )
  animation.finished.then(() => {
    // Commit the end state into the inline style and drop the fill.
    pill.style.transform = `translateX(${to.x}px)`
    animation.cancel()
  }).catch(() => { /* cancelled by a newer flight — expected */ })
  return animation
}

/** The pill's current visual slot derived from its live inline/animated transform. */
function currentSlot(pill: HTMLElement): GelSlot | null {
  const width = pill.offsetWidth
  if (width === 0) return null
  const m = /translateX\((-?[\d.]+)px\)/.exec(pill.style.transform)
  if (!m) return null
  return { x: parseFloat(m[1]), width }
}

// ── Gel press — squash on press, spring settle on release ────────────────────
// Implemented in CSS (.gel-press in index.css); this helper exists for the
// rare JS-driven case and for tests. Kept token-true: press uses the fast
// duration, release rides --ease-spring.

export const GEL_PRESS_CLASS = 'gel-press'
