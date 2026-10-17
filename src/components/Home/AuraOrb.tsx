import { useEffect, useMemo, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import { usePlayerStore } from '@/store/playerStore'
import { deriveOrbPalette, mixRgb, rgba, type OrbPalette, type RGB } from './orbPalette'

// ═══════════════════════════════════════════════════════════════════════════
// THE AURA ORB — an ambient piece of generative art, not a visualizer
// ═══════════════════════════════════════════════════════════════════════════
// A volumetric sphere woven from flowing filaments of light, wrapped in
// translucent membranes and a slow-breathing halo. NOTHING here reads audio:
// no analyser, no frequency bins, no beat detection — the motion is purely
// procedural time-based flow, so the Orb is equally alive in total silence.
//
// Why Canvas 2D (and not WebGL/Three.js): the project has no WebGL
// dependency, and the spec forbids adding a large one for decoration. The
// Orb's geometry is ~60 polylines + ~110 points per frame — trivially inside
// Canvas 2D's budget, leaving the entire GPU budget to the OS compositor
// that already carries Aura's glass layers. The visual is genuinely 3D
// (points on a sphere, perspective projection, depth-based luminosity) —
// just rasterized by the 2D pipeline.
//
// Motion language (deliberate):
//   • filament drift periods run 25–90 s per axis, scene precession ~100 s —
//     an obvious short loop is mathematically excluded (irrational ratios);
//   • radial undulation breathes at two layered, non-harmonic frequencies;
//   • depth drives alpha and width, which is what sells the volume;
//   • theme changes cross-fade by interpolating the palette over ~0.6 s.
//
// Accessibility & performance contracts:
//   • pointer-events: none + aria-hidden — the Orb can never intercept input;
//   • prefers-reduced-motion → one static frame, zero loop;
//   • Performance Mode → ~half the filaments/particles and a 30 fps cap;
//   • the loop pauses when the tab is hidden or the Orb scrolls out of view;
//   • rAF / observers / listeners are all torn down on unmount.
// ═══════════════════════════════════════════════════════════════════════════

interface StrandSpec {
  /** Rotation axis (unit vector) — the great circle the strand rides on. */
  ax: number; ay: number; az: number
  /** Precession speed, rad/s (slow by design). */
  speed: number
  phase: number
  /** Radial undulation: two non-harmonic spatial frequencies + drift speeds. */
  f1: number; f2: number
  w1: number; w2: number
  a1: number; a2: number
  /** Distance from the core (fraction of the Orb radius). */
  radius: number
  /** Position between palette.strandA and palette.strandB. */
  cmix: number
  /** Base stroke alpha before depth modulation. */
  alpha: number
}

interface ParticleSpec {
  /** Unit-sphere position (fibonacci lattice). */
  x: number; y: number; z: number
  phase: number
  size: number
  cmix: number
}

interface OrbConfig {
  strands: number
  segments: number
  particles: number
  membranes: number
  fps: number
}

const FULL_CONFIG: OrbConfig = { strands: 58, segments: 26, particles: 110, membranes: 3, fps: 60 }
const LITE_CONFIG: OrbConfig = { strands: 26, segments: 16, particles: 48, membranes: 2, fps: 30 }

/** Deterministic PRNG — the Orb's anatomy is identical every launch (identity, not dice). */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildStrands(count: number): StrandSpec[] {
  const rand = mulberry32(0xA0A3)
  return Array.from({ length: count }, () => {
    // Random unit axis — normalized below.
    let ax = rand() * 2 - 1, ay = rand() * 2 - 1, az = rand() * 2 - 1
    const len = Math.hypot(ax, ay, az) || 1
    ax /= len; ay /= len; az /= len
    return {
      ax, ay, az,
      speed: (0.05 + rand() * 0.2) * (rand() < 0.5 ? -1 : 1),
      phase: rand() * Math.PI * 2,
      f1: 2 + Math.floor(rand() * 3) * 2,   // 2 | 4 | 6
      f2: 3 + Math.floor(rand() * 3) * 2,   // 3 | 5 | 7
      w1: 0.14 + rand() * 0.2,
      w2: 0.1 + rand() * 0.16,
      a1: 0.03 + rand() * 0.045,
      a2: 0.018 + rand() * 0.03,
      radius: 0.58 + rand() * 0.42,
      cmix: rand(),
      alpha: 0.05 + rand() * 0.085,
    }
  })
}

/** Fibonacci-lattice particles: evenly distributed over the sphere surface. */
function sphereParticles(count: number): ParticleSpec[] {
  const rand = mulberry32(0x5EED)
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    return {
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
      phase: rand() * Math.PI * 2,
      size: 0.6 + rand() * 1.3,
      cmix: rand(),
    }
  })
}

/** Rotate (x,y,z) around the Y axis, then around X — the scene camera. */
function sceneTransform(x: number, y: number, z: number, cosY: number, sinY: number, cosX: number, sinX: number): [number, number, number] {
  const x1 = x * cosY + z * sinY
  const z1 = -x * sinY + z * cosY
  const y2 = y * cosX - z1 * sinX
  const z2 = y * sinX + z1 * cosX
  return [x1, y2, z2]
}

/**
 * Render one frame. Pure with respect to React — the animation loop (or the
 * reduced-motion static painter) just calls it with a time value.
 */
function paintOrb(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  cfg: OrbConfig,
  palette: OrbPalette,
  strands: StrandSpec[],
  particles: ParticleSpec[],
): void {
  ctx.clearRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.335
  if (R < 8) return

  const dark = palette.dark
  const breath = 1 + 0.024 * Math.sin(t * (2 * Math.PI / 11.3)) // 11.3 s breathing
  const radius = R * breath

  // Slow scene precession — the whole volume drifts through space.
  const rotY = t * 0.062
  const rotX = 0.32 + 0.16 * Math.sin(t * 0.045)
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY)
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX)
  const FOV = 3.6 // perspective: camera distance in radii

  // ── Halo — the wide, calm field the volume floats in ────────────────────
  const haloAlpha = dark
    ? 0.11 + 0.025 * Math.sin(t * (2 * Math.PI / 17.1))
    : 0.13 + 0.02 * Math.sin(t * (2 * Math.PI / 17.1))
  const haloR = R * 1.62
  const haloGrad = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, haloR)
  haloGrad.addColorStop(0, rgba(palette.halo, haloAlpha))
  haloGrad.addColorStop(0.55, rgba(palette.halo, haloAlpha * 0.4))
  haloGrad.addColorStop(1, rgba(palette.halo, 0))
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = haloGrad
  ctx.fillRect(cx - haloR, cy - haloR, haloR * 2, haloR * 2)

  // ── Membranes — translucent shells at three depths ──────────────────────
  const membraneFactors = [1.0, 0.87, 0.72]
  for (let m = 0; m < cfg.membranes; m++) {
    const mr = radius * membraneFactors[m]
    // Each shell is a 3D circle: a fixed-ish inclination that precesses
    // slowly, plus a gentle breathing of the plane itself so the shells
    // never read as mechanical rings.
    const incl = 0.42 + m * 0.62 + 0.09 * Math.sin(t * 0.05 + m * 1.3)
    const spin = t * (0.05 + m * 0.023) * (m % 2 === 0 ? 1 : -1)
    const sinI = Math.sin(incl), cosI = Math.cos(incl)
    const cosS = Math.cos(spin), sinS = Math.sin(spin)
    ctx.beginPath()
    const steps = cfg.segments * 2
    for (let s = 0; s <= steps; s++) {
      const u = (s / steps) * Math.PI * 2
      const px0 = Math.cos(u) * mr
      const pz0 = Math.sin(u) * mr
      // Incline the ring's plane around the X axis, then spin it around Y.
      const py0 = pz0 * sinI
      const pz1 = pz0 * cosI
      const px = px0 * cosS + pz1 * sinS
      const pz = -px0 * sinS + pz1 * cosS
      const [tx, ty, tz] = sceneTransform(px, py0, pz, cosY, sinY, cosX, sinX)
      const persp = FOV / (FOV - tz / radius)
      const sx = cx + tx * persp
      const sy = cy + ty * persp
      if (s === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.closePath()
    const mAlpha = dark ? 0.05 - m * 0.012 : 0.075 - m * 0.02
    ctx.strokeStyle = rgba(m % 2 === 0 ? palette.strandB : palette.strandA, Math.max(0.012, mAlpha))
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.fillStyle = rgba(m % 2 === 0 ? palette.strandA : palette.strandB, Math.max(0.008, mAlpha * 0.35))
    ctx.fill()
  }

  // ── Filaments — the body of the Orb ──────────────────────────────────────
  // 'lighter' compositing lets overlapping strands accumulate into real
  // luminosity on dark themes; light themes use plain alpha (luminosity
  // accumulation would blow out to white on paper).
  ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
  ctx.lineCap = 'round'

  for (let i = 0; i < strands.length; i++) {
    const st = strands[i]
    // Precess the strand's axis around Y at its own leisurely rate.
    const cosA = Math.cos(t * st.speed)
    const sinA = Math.sin(t * st.speed)
    // Rotate the axis vector around Y.
    const axX = st.ax * cosA + st.az * sinA
    const axZ = -st.ax * sinA + st.az * cosA
    // Orthonormal basis ⊥ axis for the great circle.
    let ux = -axZ, uy = 0, uz = axX
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul; uy /= ul; uz /= ul
    let vx = st.ay * uz - st.az * uy
    let vy = st.az * ux - st.ax * uz
    let vz = st.ax * uy - st.ay * ux

    const strandColor = mixRgb(palette.strandA, palette.strandB, st.cmix)
    const sr = radius * st.radius

    // Sample the whole strand once into a flat screen-space buffer, keeping
    // point order (polyline continuity — NEVER bucket points into separate
    // paths, that would chord across the sphere and read as a mesh).
    const n = cfg.segments + 1
    const sx = new Float32Array(n)
    const sy = new Float32Array(n)
    const dz = new Float32Array(n)
    for (let s = 0; s < n; s++) {
      const u = (s / cfg.segments) * Math.PI * 2
      const wob = 1
        + st.a1 * Math.sin(st.f1 * u + t * st.w1 + st.phase)
        + st.a2 * Math.sin(st.f2 * u - t * st.w2 + st.phase * 1.7)
      const r = sr * wob
      const px = (ux * Math.cos(u) + vx * Math.sin(u)) * r
      const py = (uy * Math.cos(u) + vy * Math.sin(u)) * r
      const pz = (uz * Math.cos(u) + vz * Math.sin(u)) * r
      const [tx, ty, tz] = sceneTransform(px, py, pz, cosY, sinY, cosX, sinX)
      const persp = FOV / (FOV - tz / radius)
      sx[s] = cx + tx * persp
      sy[s] = cy + ty * persp
      dz[s] = (tz / radius + 1) / 2 // 0 back → 1 front
    }

    // Pass 1 — the body: one continuous, quiet stroke (the filament).
    ctx.strokeStyle = rgba(strandColor, st.alpha * (dark ? 0.7 : 0.65))
    ctx.lineWidth = dark ? 0.75 : 0.85
    ctx.beginPath()
    ctx.moveTo(sx[0], sy[0])
    for (let s = 1; s < n; s++) ctx.lineTo(sx[s], sy[s])
    ctx.stroke()

    // Pass 2 — the front glow: only the front-facing spans are re-stroked,
    // segment by segment, with depth-graded luminosity. This is what sells
    // the volume (near sides read brighter) without breaking the strand
    // into disconnected depth buckets.
    for (let s = 1; s < n; s++) {
      const depth = (dz[s] + dz[s - 1]) / 2
      if (depth < 0.52) continue
      const glow = (depth - 0.52) / 0.48 // 0..1 toward the camera
      ctx.strokeStyle = rgba(strandColor, st.alpha * glow * (dark ? 1.15 : 0.85))
      ctx.lineWidth = dark ? 0.8 + glow * 1.1 : 0.9 + glow * 0.8
      ctx.beginPath()
      ctx.moveTo(sx[s - 1], sy[s - 1])
      ctx.lineTo(sx[s], sy[s])
      ctx.stroke()
    }
  }

  // ── Particles — spores drifting on the sphere's skin ─────────────────────
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    // Each particle drifts a little off its lattice position — slow, personal.
    const drift = 0.035
    const px = (p.x + drift * Math.sin(t * 0.11 + p.phase)) * radius
    const py = (p.y + drift * Math.sin(t * 0.09 + p.phase * 1.6)) * radius
    const pz = (p.z + drift * Math.cos(t * 0.1 + p.phase)) * radius
    const [tx, ty, tz] = sceneTransform(px / radius, py / radius, pz / radius, cosY, sinY, cosX, sinX)
    const depth = Math.max(0, Math.min(1, (tz + 1) / 2))
    const persp = FOV / (FOV - tz)
    const sx = cx + tx * persp * radius
    const sy = cy + ty * persp * radius
    const particleColor = mixRgb(palette.strandA, palette.strandB, p.cmix)
    const a = (dark ? 0.14 + depth * 0.4 : 0.16 + depth * 0.3) * (0.75 + 0.25 * Math.sin(t * 0.4 + p.phase * 2))
    ctx.fillStyle = rgba(particleColor, Math.max(0.02, a))
    ctx.beginPath()
    ctx.arc(sx, sy, p.size * (dark ? 0.6 + depth * 0.7 : 0.6 + depth * 0.5), 0, Math.PI * 2)
    ctx.fill()
  }

  // ── Core — the quiet heart of the volume ─────────────────────────────────
  ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
  const coreR = R * 0.55
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
  const coreAlpha = dark ? 0.13 + 0.03 * Math.sin(t * (2 * Math.PI / 8.7)) : 0.1
  coreGrad.addColorStop(0, rgba(palette.core, coreAlpha))
  coreGrad.addColorStop(1, rgba(palette.core, 0))
  ctx.fillStyle = coreGrad
  ctx.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2)

  ctx.globalCompositeOperation = 'source-over'
}

export function AuraOrb({ className }: { className?: string }) {
  const theme = usePlayerStore((s) => s.theme)
  const customAccentColor = usePlayerStore((s) => s.customAccentColor)
  const appearance = usePlayerStore((s) => s.appearance)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const reduceMotion = useReducedMotion()

  const targetPalette = useMemo(
    () => deriveOrbPalette(theme, customAccentColor, appearance),
    [theme, customAccentColor, appearance],
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The Orb's clock and the theme TARGET live OUTSIDE the render effect: theme
  // changes update refs instead of re-running the effect, so the loop keeps its
  // timebase and the palette chase genuinely cross-fades colors (~0.6 s) while
  // time flows on — instead of snapping by re-initializing everything.
  const clockRef = useRef(0)
  const targetRef = useRef(targetPalette)
  targetRef.current = targetPalette
  // Reduced-motion repaints: the main effect registers its one-frame painter
  // here; a separate effect re-invokes it when the theme target changes so the
  // static still follows theme switches (a color change is not motion).
  const paintStillRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cfg = performanceMode ? LITE_CONFIG : FULL_CONFIG
    const strands = buildStrands(cfg.strands)
    const particles = sphereParticles(cfg.particles)

    // Palette cross-fade state: start from the target so the first frame is
    // already correct, then chase future targets with exponential smoothing.
    const initial = targetRef.current
    const paletteCur: OrbPalette = {
      dark: initial.dark,
      strandA: [...initial.strandA] as RGB,
      strandB: [...initial.strandB] as RGB,
      core: [...initial.core] as RGB,
      halo: [...initial.halo] as RGB,
    }

    let cssW = 0
    let cssH = 0
    let dpr = 1

    const resize = () => {
      cssW = container.clientWidth
      cssH = container.clientHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(1, Math.round(cssW * dpr))
      canvas.height = Math.max(1, Math.round(cssH * dpr))
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      if (reduceMotion) paintOnce()
    }

    const paintOnce = () => {
      if (cssW < 4 || cssH < 4) return
      ctx.save()
      ctx.scale(dpr, dpr)
      paintOrb(ctx, cssW, cssH, clockRef.current, cfg, paletteCur, strands, particles)
      ctx.restore()
    }
    paintStillRef.current = paintOnce

    let raf = 0
    let running = false
    let inView = true
    let docVisible = !document.hidden
    let lastTs = 0
    let acc = 0
    const frameInterval = 1000 / cfg.fps

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame)
      if (!lastTs) lastTs = ts
      const dt = Math.min((ts - lastTs) / 1000, 0.05)
      lastTs = ts
      clockRef.current += dt

      // FPS cap (Performance Mode) — accumulate, draw when due.
      acc += dt * 1000
      if (acc < frameInterval - 1) return
      acc = 0

      // Exponential palette chase → themes cross-fade in ~0.6 s.
      const tgt = targetRef.current
      const k = 1 - Math.exp(-dt * 5)
      const chase = (cur: RGB, goal: RGB) => {
        cur[0] += (goal[0] - cur[0]) * k
        cur[1] += (goal[1] - cur[1]) * k
        cur[2] += (goal[2] - cur[2]) * k
      }
      chase(paletteCur.strandA, tgt.strandA)
      chase(paletteCur.strandB, tgt.strandB)
      chase(paletteCur.core, tgt.core)
      chase(paletteCur.halo, tgt.halo)
      paletteCur.dark = tgt.dark

      if (cssW < 4 || cssH < 4) return
      ctx.save()
      ctx.scale(dpr, dpr)
      paintOrb(ctx, cssW, cssH, clockRef.current, cfg, paletteCur, strands, particles)
      ctx.restore()
    }

    const sync = () => {
      const shouldRun = inView && docVisible && !reduceMotion
      if (shouldRun && !running) {
        running = true
        lastTs = 0
        acc = frameInterval // paint immediately on (re)start
        raf = requestAnimationFrame(frame)
      } else if (!shouldRun && running) {
        running = false
        cancelAnimationFrame(raf)
      }
    }

    // Pause the loop entirely when the Orb leaves the viewport — scrolling
    // down Home must not keep paying for an animation nobody sees.
    const io = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true
      sync()
    }, { threshold: 0.02 })
    io.observe(container)

    const onVis = () => { docVisible = !document.hidden; sync() }
    document.addEventListener('visibilitychange', onVis)

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()

    if (reduceMotion) {
      // Reduced motion: one honest, composed still — the Orb at rest, no loop.
      paintOnce()
    } else {
      sync()
    }

    return () => {
      cancelAnimationFrame(raf)
      running = false
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      paintStillRef.current = null
    }
  }, [performanceMode, reduceMotion])

  // Reduced motion: repaint the composed still when the theme target changes
  // (colors only — no movement is introduced). Live loops ignore this effect;
  // they chase the target through the ref every frame.
  useEffect(() => {
    if (reduceMotion) paintStillRef.current?.()
  }, [targetPalette, reduceMotion])

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={className}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  )
}
