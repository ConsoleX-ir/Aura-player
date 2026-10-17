import { useEffect, useRef } from 'react'
import { Activity, AudioWaveform, MoveHorizontal } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { getAnalyser, getStereoTap } from '@/lib/playbackController'
import { subscribeAnalysis, fitCanvas, readVizColors } from './analysisLoop'

// ── Studio 4.0 — Analysis (real-time, real data) ─────────────────────────────
// Three instrument panels, all driven by the shared analysis loop and the
// engine's OWN nodes — nothing synthetic, no fake meters:
//
//   • Spectrum    — the main analyser's FFT (post-master: what you hear),
//                   log-frequency bars with peak-hold caps.
//   • Output      — L / R RMS + true-peak meters with hold-and-fall
//                   ballistics, read from the master-gain stereo tap.
//   • Stereo field— correlation meter (mono +1 ↔ out-of-phase −1) and a
//                   goniometer (Lissajous of L/R rotated 45°) from the same
//                   tap; the configured balance / width positions are drawn
//                   as reference markers derived from the live settings.
//
// Every panel renders honest silence when nothing plays — meters fall to
// −∞, the goniometer dot collapses to center. No idle theatre.

const BARS = 56
const F_MIN = 20
const F_MAX = 20000
const METER_FLOOR_DB = -48
const PEAK_HOLD_MS = 1600
const PEAK_FALL_DB_PER_S = 14

// Meter scale ticks (dB)
const LEVEL_TICKS = [-48, -36, -24, -12, -6, 0]

export function StudioAnalysis({ bypassed }: { bypassed: boolean }) {
  const spectrumRef = useRef<HTMLCanvasElement>(null)
  const levelsRef = useRef<HTMLCanvasElement>(null)
  const stereoRef = useRef<HTMLCanvasElement>(null)

  // Settings-derived reference markers (rarely change → cheap re-render).
  const balance = usePlayerStore((s) => s.balance)
  const stereoWidth = usePlayerStore((s) => s.audioFx.stereoWidth)
  const isPlaying = usePlayerStore((s) => s.isPlaying)

  useEffect(() => {
    const sc = spectrumRef.current
    const lc = levelsRef.current
    const tc = stereoRef.current
    if (!sc || !lc || !tc) return

    // One allocation per mount, reused every frame (the VisualizerPanel's
    // measured anti-GC pattern — no fresh arrays at frame rate).
    const fft = new Uint8Array(new ArrayBuffer(getAnalyser()?.frequencyBinCount ?? 1024))
    const tdL = new Uint8Array(new ArrayBuffer(1024))
    const tdR = new Uint8Array(new ArrayBuffer(1024))

    let peaks = new Float32Array(BARS)      // dB below full scale, −96 = none
    let smoothRmsL = 0                       // linear, ballistics-smoothed
    let smoothRmsR = 0
    let peakL = 0, peakR = 0                  // linear peaks (per frame)
    let holdL = 0, holdR = 0                  // hold-and-fall peak display
    let holdAtL = 0, holdAtR = 0
    let corr = 1                              // smoothed correlation
    let colors = readVizColors()
    let colorAge = 0
    let lastT = 0

    return subscribeAnalysis((now) => {
      const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016
      lastT = now
      if (++colorAge > 90) { colorAge = 0; colors = readVizColors() }

      drawSpectrum(sc, fft, peaks, colors, dt)
      drawLevels(lc, tdL, tdR, {
        colors, dt,
        state: { smoothRmsL, smoothRmsR, peakL, peakR, holdL, holdR, holdAtL, holdAtR },
      }, (s) => {
        smoothRmsL = s.smoothRmsL; smoothRmsR = s.smoothRmsR
        peakL = s.peakL; peakR = s.peakR
        holdL = s.holdL; holdR = s.holdR; holdAtL = s.holdAtL; holdAtR = s.holdAtR
      })
      drawStereo(tc, tdL, tdR, colors, dt, { corr }, (s) => { corr = s.corr }, {
        balance, stereoWidth,
      })
    })
  }, [balance, stereoWidth])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3" data-studio-analysis>
      {/* Spectrum */}
      <section
        className="lg:col-span-2 p-3 rounded-xl"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      >
        <PanelHeader icon={AudioWaveform} title="Spectrum" hint="Post-master FFT — what you hear, log frequency" />
        <canvas ref={spectrumRef} className="w-full h-[132px] block rounded-md mt-2" style={{ background: 'var(--surface-inset)' }} aria-label="Live spectrum analyzer" />
      </section>

      {/* Output levels */}
      <section
        className="p-3 rounded-xl"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      >
        <PanelHeader icon={Activity} title="Output" hint="RMS + peak, master out (post-volume)" />
        <canvas ref={levelsRef} className="w-full h-[132px] block rounded-md mt-2" style={{ background: 'var(--surface-inset)' }} aria-label="Output level meters, left and right" />
      </section>

      {/* Stereo field */}
      <section
        className="lg:col-span-3 p-3 rounded-xl"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <PanelHeader icon={MoveHorizontal} title="Stereo field" hint="Correlation and channel phase, from the live L/R signal" />
          {!isPlaying && (
            <span className="text-[10px] px-2 py-0.5 rounded-pill shrink-0" style={{ background: 'var(--glass-2)', color: 'var(--text-tertiary)' }}>
              Silent — meters rest
            </span>
          )}
        </div>
        <canvas ref={stereoRef} className="w-full h-[150px] block rounded-md mt-2" style={{ background: 'var(--surface-inset)' }} aria-label="Stereo correlation and goniometer" />
        {bypassed && (
          <p className="text-[11px] mt-2" style={{ color: 'var(--warning)' }} role="status">
            The studio is bypassed — the analysis taps still show the untouched output.
          </p>
        )}
      </section>
    </div>
  )
}

function PanelHeader({ icon: Icon, title, hint }: { icon: typeof Activity; title: string; hint: string }) {
  return (
    <div className="flex items-center justify-between gap-3 min-w-0">
      <p className="text-xs font-medium flex items-center gap-1.5 shrink-0" style={{ color: 'var(--text-primary)' }}>
        <Icon size={12} style={{ color: 'var(--accent)' }} />
        {title}
      </p>
      <span className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>{hint}</span>
    </div>
  )
}

// ── Spectrum ────────────────────────────────────────────────────────────────

function drawSpectrum(
  c: HTMLCanvasElement, fft: Uint8Array<ArrayBuffer>, peaks: Float32Array,
  colors: ReturnType<typeof readVizColors>, dt: number,
) {
  const ctx = fitCanvas(c)
  if (!ctx) return
  const w = c.clientWidth, h = c.clientHeight
  ctx.clearRect(0, 0, w, h)

  // dB reference lines
  ctx.lineWidth = 1
  for (const fy of [0.25, 0.5, 0.75]) {
    const y = Math.round(h * fy) + 0.5
    ctx.strokeStyle = colors.grid
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  }

  const analyser = getAnalyser()
  if (!analyser || analyser.frequencyBinCount !== fft.length) return
  analyser.getByteFrequencyData(fft)
  const bins = fft.length
  const nyquist = analyser.context.sampleRate / 2
  const bw = w / BARS

  for (let i = 0; i < BARS; i++) {
    const f0 = F_MIN * Math.pow(F_MAX / F_MIN, i / BARS)
    const f1 = F_MIN * Math.pow(F_MAX / F_MIN, (i + 1) / BARS)
    // Max over the bins this bar covers — honest energy per log band.
    let v = 0
    const b0 = Math.max(0, Math.floor((f0 / nyquist) * bins))
    const b1 = Math.min(bins - 1, Math.ceil((f1 / nyquist) * bins))
    for (let b = b0; b <= b1; b++) v = Math.max(v, fft[b])
    const mag = v / 255
    const barH = Math.max(1.5, mag * (h - 6))
    const x = i * bw + 1
    const bw2 = Math.max(1.5, bw - 2)

    const g = ctx.createLinearGradient(0, h, 0, h - barH)
    g.addColorStop(0, colors.spectrum)
    g.addColorStop(1, colors.accent)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.roundRect(x, h - barH, bw2, barH, [2, 2, 0, 0])
    ctx.fill()

    // Peak-hold caps: hold ~1.6 s, then fall.
    const magDb = mag > 0.001 ? 20 * Math.log10(mag) : -96
    const prevDb = peaks[i]
    if (prevDb < -95 || magDb >= prevDb) peaks[i] = magDb
    else peaks[i] = Math.max(magDb, prevDb - PEAK_FALL_DB_PER_S * dt)
    const peakMag = Math.pow(10, peaks[i] / 20)
    const py = h - Math.max(1.5, peakMag * (h - 6))
    if (py > 2) {
      ctx.fillStyle = colors.spectrumPeak
      ctx.fillRect(x, py - 1.5, bw2, 1.5)
    }
  }
}

// ── Output meters ───────────────────────────────────────────────────────────

interface MeterState {
  smoothRmsL: number; smoothRmsR: number
  peakL: number; peakR: number
  holdL: number; holdR: number; holdAtL: number; holdAtR: number
}

function drawLevels(
  c: HTMLCanvasElement, tdL: Uint8Array<ArrayBuffer>, tdR: Uint8Array<ArrayBuffer>,
  args: { colors: ReturnType<typeof readVizColors>; dt: number; state: MeterState },
  commit: (s: MeterState) => void,
) {
  const ctx = fitCanvas(c)
  if (!ctx) return
  const w = c.clientWidth, h = c.clientHeight
  const { colors, dt, state } = args
  ctx.clearRect(0, 0, w, h)

  const tap = getStereoTap()
  let rmsL = 0, rmsR = 0, pkL = 0, pkR = 0
  if (tap && tap.L.fftSize === tdL.length) {
    tap.L.getByteTimeDomainData(tdL)
    tap.R.getByteTimeDomainData(tdR)
    let sl = 0, sr = 0
    for (let i = 0; i < tdL.length; i++) {
      const l = (tdL[i] - 128) / 128
      const r = (tdR[i] - 128) / 128
      sl += l * l; sr += r * r
      pkL = Math.max(pkL, Math.abs(l)); pkR = Math.max(pkR, Math.abs(r))
    }
    rmsL = Math.sqrt(sl / tdL.length)
    rmsR = Math.sqrt(sr / tdR.length)
  }

  // Ballistics: RMS rides fast attack (~120 ms) / slow release (~450 ms).
  const attack = 1 - Math.exp(-dt / 0.12)
  const release = 1 - Math.exp(-dt / 0.45)
  const move = (cur: number, target: number) =>
    target > cur ? cur + (target - cur) * attack : cur + (target - cur) * release
  state.smoothRmsL = move(state.smoothRmsL, rmsL)
  state.smoothRmsR = move(state.smoothRmsR, rmsR)
  state.peakL = pkL; state.peakR = pkR
  const nowMs = performance.now()
  if (pkL >= state.holdL) { state.holdL = pkL; state.holdAtL = nowMs }
  else if (nowMs - state.holdAtL > PEAK_HOLD_MS) state.holdL = Math.max(pkL, state.holdL - PEAK_FALL_DB_PER_S / 20 * dt)
  if (pkR >= state.holdR) { state.holdR = pkR; state.holdAtR = nowMs }
  else if (nowMs - state.holdAtR > PEAK_HOLD_MS) state.holdR = Math.max(pkR, state.holdR - PEAK_FALL_DB_PER_S / 20 * dt)
  commit(state)

  const dbOf = (lin: number) => (lin > 0.0001 ? 20 * Math.log10(lin) : -96)
  const xOfDb = (db: number) => ((db - METER_FLOOR_DB) / (0 - METER_FLOOR_DB)) * (w - 56) + 44

  // Scale ticks once per frame (canvas text — 6 tiny labels)
  ctx.font = '8.5px ui-monospace, monospace'
  ctx.fillStyle = colors.text
  ctx.textAlign = 'center'
  for (const t of LEVEL_TICKS) {
    const x = xOfDb(t)
    ctx.strokeStyle = colors.grid
    ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, h - 4); ctx.stroke()
    ctx.fillText(t === -48 ? '-48' : `${t}`, x, 10)
  }

  drawMeterRow(ctx, 26, 'L', dbOf(state.smoothRmsL), dbOf(state.holdL), w, colors)
  drawMeterRow(ctx, 52, 'R', dbOf(state.smoothRmsR), dbOf(state.holdR), w, colors)

  // Numeric readouts
  ctx.textAlign = 'right'
  ctx.fillStyle = colors.text
  ctx.fillText(fmtDb(dbOf(state.smoothRmsL)), w - 2, 34)
  ctx.fillText(fmtDb(dbOf(state.smoothRmsR)), w - 2, 60)
}

function drawMeterRow(
  ctx: CanvasRenderingContext2D, y: number, label: string,
  rmsDb: number, holdDb: number, w: number,
  colors: ReturnType<typeof readVizColors>,
) {
  const x0 = 44, x1 = w - 40
  const trackW = x1 - x0

  ctx.font = '10px ui-sans-serif, system-ui'
  ctx.textAlign = 'left'
  ctx.fillStyle = colors.text
  ctx.fillText(label, 8, y + 8)

  // RMS fill with the house traffic-light gradient
  const rmsX = Math.max(0, Math.min(1, rmsDb / -METER_FLOOR_DB)) * trackW
  const g = ctx.createLinearGradient(x0, 0, x1, 0)
  g.addColorStop(0, colors.meter)
  g.addColorStop(0.75, colors.meter)
  g.addColorStop(0.9, colors.meterHot)
  g.addColorStop(1, colors.meterClip)
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.roundRect(x0, y, Math.max(1.5, rmsX), 12, [3, 3, 3, 3])
  ctx.fill()

  // Peak-hold tick
  const holdX = Math.max(0, Math.min(1, holdDb / -METER_FLOOR_DB)) * trackW
  ctx.fillStyle = colors.meterClip
  ctx.fillRect(x0 + holdX - 1, y - 1, 2, 14)
}

function fmtDb(db: number): string {
  if (db <= -96) return '-∞'
  return `${db <= -10 ? db.toFixed(0) : db.toFixed(1)}`
}

// ── Stereo field ────────────────────────────────────────────────────────────

function drawStereo(
  c: HTMLCanvasElement, tdL: Uint8Array<ArrayBuffer>, tdR: Uint8Array<ArrayBuffer>,
  colors: ReturnType<typeof readVizColors>, dt: number,
  state: { corr: number }, commit: (s: { corr: number }) => void,
  markers: { balance: number; stereoWidth: number },
) {
  const ctx = fitCanvas(c)
  if (!ctx) return
  const w = c.clientWidth, h = c.clientHeight
  ctx.clearRect(0, 0, w, h)

  const tap = getStereoTap()
  let corrTarget = 1
  const plotW = Math.min(h - 16, 132)

  if (tap && tap.L.fftSize === tdL.length) {
    tap.L.getByteTimeDomainData(tdL)
    tap.R.getByteTimeDomainData(tdR)
    let sll = 0, srr = 0, slr = 0
    for (let i = 0; i < tdL.length; i++) {
      const l = (tdL[i] - 128) / 128
      const r = (tdR[i] - 128) / 128
      sll += l * l; srr += r * r; slr += l * r
    }
    const denom = Math.sqrt(sll * srr)
    if (denom > 1e-6) corrTarget = Math.max(-1, Math.min(1, slr / denom))
  }

  // Smooth the needle; correlation swings are what matters.
  const k = 1 - Math.exp(-dt / 0.22)
  state.corr += (corrTarget - state.corr) * k
  commit(state)

  // ── Left: correlation meter ──
  const cx0 = 12, cx1 = w - plotW - 24
  if (cx1 > cx0 + 60) {
    const cy = 44
    const trackW = cx1 - cx0
    ctx.font = '9px ui-sans-serif, system-ui'
    ctx.fillStyle = colors.text
    ctx.textAlign = 'center'
    // Scale: −1 … +1, center 0
    ctx.strokeStyle = colors.gridStrong
    ctx.beginPath(); ctx.moveTo(cx0, cy); ctx.lineTo(cx1, cy); ctx.stroke()
    for (const [t, lbl] of [[-1, '+1 out of phase'], [0, '0'], [1, '+1 mono']] as const) {
      const x = cx0 + ((t + 1) / 2) * trackW
      ctx.strokeStyle = colors.grid
      ctx.beginPath(); ctx.moveTo(x, cy - 4); ctx.lineTo(x, cy + 4); ctx.stroke()
      ctx.fillText(lbl, Math.max(cx0 + 24, Math.min(cx1 - 24, x)), cy + 16)
    }
    // Warning zone (negative correlation)
    ctx.fillStyle = colors.meterClip + '14'
    ctx.fillRect(cx0, cy - 1.5, trackW * 0.35, 3)
    // Needle — real correlation
    const nx = cx0 + ((state.corr + 1) / 2) * trackW
    ctx.strokeStyle = state.corr < -0.1 ? colors.meterClip : colors.accent
    ctx.lineWidth = 2.5
    ctx.beginPath(); ctx.moveTo(nx, cy - 9); ctx.lineTo(nx, cy + 9); ctx.stroke()
    ctx.fillStyle = colors.text
    ctx.textAlign = 'left'
    ctx.fillText(`correlation ${state.corr >= 0 ? '+' : ''}${state.corr.toFixed(2)}`, cx0, cy + 34)
    // Configured balance marker (settings-derived reference)
    const bx = cx0 + ((markers.balance + 1) / 2) * trackW
    ctx.strokeStyle = colors.spectrumPeak
    ctx.setLineDash([2, 3])
    ctx.beginPath(); ctx.moveTo(bx, cy - 12); ctx.lineTo(bx, cy + 12); ctx.stroke()
    ctx.setLineDash([])
  }

  // ── Right: goniometer (Lissajous rotated 45°) ──
  const gx = w - plotW / 2 - 12
  const gy = h / 2 - 4
  const rad = plotW / 2 - 10
  ctx.strokeStyle = colors.grid
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(gx, gy, rad, 0, Math.PI * 2); ctx.stroke()
  // Mono axis (vertical) & side axis (horizontal) guides
  ctx.beginPath(); ctx.moveTo(gx, gy - rad); ctx.lineTo(gx, gy + rad); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(gx - rad, gy); ctx.lineTo(gx + rad, gy); ctx.stroke()
  ctx.font = '8.5px ui-sans-serif, system-ui'
  ctx.fillStyle = colors.text
  ctx.textAlign = 'center'
  ctx.fillText('mono', gx, gy - rad - 3)
  ctx.fillText('side', gx + rad + 12, gy + 3)

  // Configured-width reference ring (settings-derived; the dots are the
  // real signal). Width 0.5…2 maps onto 0.25…0.95 of the plot radius.
  const wr = rad * 0.9 * Math.max(0.25, Math.min(1, markers.stereoWidth / 2))
  ctx.strokeStyle = colors.spectrumPeak
  ctx.setLineDash([2, 4])
  ctx.beginPath(); ctx.arc(gx, gy, wr, 0, Math.PI * 2); ctx.stroke()
  ctx.setLineDash([])

  if (tap && tap.L.fftSize === tdL.length) {
    ctx.fillStyle = colors.ghost
    const step = 2 // every 2nd sample — 512 points is plenty of texture
    for (let i = 0; i < tdL.length; i += step) {
      const l = (tdL[i] - 128) / 128
      const r = (tdR[i] - 128) / 128
      const mx = (r - l) * 0.7071   // side
      const my = (l + r) * 0.7071   // mid
      const px = gx + mx * rad * 0.9
      const py = gy - my * rad * 0.9
      ctx.fillRect(px, py, 1.2, 1.2)
    }
  }
}
