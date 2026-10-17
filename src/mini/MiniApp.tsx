import { useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Maximize2, X, Music2, Volume2, VolumeX } from 'lucide-react'
import { formatTime } from '@/lib/utils'
import { applyThemeToDocument } from '@/theme/engine'

// ── Mini state contract ──────────────────────────────────────────────────────
// Pushed by the MAIN window's useMiniPlayerBridge over 'mini:state'. Kept as a
// flat, serializable snapshot — nothing live crosses the context bridge.
export interface MiniState {
  hasSong: boolean
  title: string
  artist: string
  coverArt: string | null
  isPlaying: boolean
  /** 0..1 playback progress — drives the artwork progress ring + seek bar. */
  progress: number
  /** Track duration in seconds (0 when unknown) — elapsed/remaining labels. */
  durationSec?: number
  /** v3.2.0 — mirrored volume/mute so the widget's controls agree with the app. */
  volume?: number
  muted?: boolean
  /** 'dark' | 'light' — applied as data-theme so tokens resolve correctly. */
  appearance: 'dark' | 'light'
  /** Aura 3.0 — theme identity (data-aura-theme) + resolved accent vars. */
  theme?: string
  accent?: { d1: string; d2: string; d3: string; glow: string; onAccent?: string }
  /** Honest next-up preview (null when shuffle/repeat make it unknowable). */
  nextTitle?: string | null
  /** v3.3.1 — Liquid Glass visual mode. FALSE = matte fallback. The main
   *  window's playerStore is the single source of truth; undefined (a stale
   *  pre-upgrade sender) resolves to the designed default: glass ON. */
  liquidGlass?: boolean
  /** v3.3.1 — app-wide Performance Mode (blur off, glow layer hidden). */
  perf?: boolean
}

const INITIAL: MiniState = {
  hasSong: false,
  title: 'Nothing playing',
  artist: 'Aura mini-player',
  coverArt: null,
  isPlaying: false,
  progress: 0,
  durationSec: 0,
  volume: 1,
  muted: false,
  appearance: 'dark',
  liquidGlass: true,
  perf: false,
}

// Progress ring geometry — same visual language as the in-app playbar.
const R = 23          // ring radius inside the 56px artwork box
const CIRC = 2 * Math.PI * R

export function MiniApp() {
  const [state, setState] = useState<MiniState>(INITIAL)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onMiniState) return
    return api.onMiniState((s: MiniState) => {
      setState({ ...INITIAL, ...s })
    })
  }, [])

  // Document-level coherence (v3.3.1): the Theme Engine write path still runs
  // so native form controls/scrollbars stay coherent, but the widget's VISUAL
  // SYSTEM no longer consumes theme tokens at all — src/styles/mini.css is a
  // fixed neutral design that renders identically under all ten themes. The
  // theme id + accent vars therefore have zero effect on the glass surfaces.
  useEffect(() => {
    const root = document.documentElement
    applyThemeToDocument(state.theme ?? '', document, { customAppearance: state.appearance })
    const a = state.accent
    if (a?.d1) {
      root.style.setProperty('--color-dynamic-1', a.d1)
      root.style.setProperty('--color-dynamic-2', a.d2)
      root.style.setProperty('--color-dynamic-3', a.d3)
      root.style.setProperty('--color-dynamic-glow', a.glow)
      if (a.onAccent) root.style.setProperty('--text-on-accent', a.onAccent)
    }
  }, [state.appearance, state.theme, state.accent])

  // Performance Mode rides the snapshot: same attribute contract the main
  // window uses (App.tsx), same CSS hooks (mini.css gates blur + glow on it).
  useEffect(() => {
    document.documentElement.setAttribute('data-performance', state.perf ? 'on' : 'off')
  }, [state.perf])

  const glass = state.liquidGlass !== false // deterministic default: glass ON

  const act = (action: 'togglePlay' | 'next' | 'previous' | 'toggleMute' | 'restore' | 'close') =>
    window.electronAPI?.miniAction?.(action)

  return (
    <div className={`mini-root ${glass ? 'mini-root--glass' : 'mini-root--matte'}`}>
      {/* Artwork ambient glow — the ACTUAL cover, blurred, behind the glass.
          Glass mode only (matte fades it out; Performance Mode removes it). */}
      {glass && (
        <div className="mini-glow" aria-hidden>
          {state.coverArt
            ? <img src={state.coverArt} alt="" draggable={false} />
            : null}
        </div>
      )}

      <div
        data-mini-player
        data-mini-mode={glass ? 'glass' : 'matte'}
        className={`mini-card ${glass ? 'mini-card--glass' : 'mini-card--matte'}`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Artwork + progress ring + play/pause on hover */}
        <button
          onClick={() => act('togglePlay')}
          title={state.isPlaying ? 'Pause' : 'Play'}
          aria-label={state.isPlaying ? 'Pause' : 'Play'}
          className="mini-art"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {state.coverArt ? (
            <img src={state.coverArt} alt="" draggable={false} />
          ) : (
            <div className="mini-art-fallback">
              <Music2 size={18} style={{ color: 'rgba(255,255,255,0.45)' }} />
            </div>
          )}
          <svg className="mini-ring" width={56} height={56} viewBox="0 0 56 56" aria-hidden>
            <circle cx={28} cy={28} r={R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={2.5} />
            <circle
              cx={28} cy={28} r={R} fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - Math.min(Math.max(state.progress, 0), 1))}
              transform="rotate(-90 28 28)"
            />
          </svg>
          <div className="mini-art-overlay" aria-hidden>
            {state.isPlaying
              ? <Pause size={18} fill="white" color="white" />
              : <Play size={18} fill="white" color="white" className="ml-0.5" />}
          </div>
        </button>

        {/* Title / artist + seek bar + times (v3.2.0) */}
        <div className="mini-info">
          <p className="mini-title">
            {state.hasSong ? state.title : 'Nothing playing'}
          </p>
          <p className="mini-artist">
            {state.hasSong ? state.artist : 'Aura mini-player'}
          </p>
          {/* Next-up preview: revealed on hover, click to skip. Hidden when
              the honest answer is "unknown" (shuffle) or "none" (queue end). */}
          {state.hasSong && state.nextTitle && (
            <button
              onClick={() => act('next')}
              title={`Next: ${state.nextTitle}`}
              aria-label={`Skip to ${state.nextTitle}`}
              className="mini-next"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              Next: {state.nextTitle}
            </button>
          )}

          {/* Seek row — click/drag anywhere on the bar asks the MAIN window
              to seek (media:seek). The artwork ring stays the at-a-glance
              indicator; this is the precise control. */}
          <MiniSeek progress={state.progress} durationSec={state.durationSec ?? 0} hasSong={state.hasSong} />
        </div>

        {/* Transport + volume — no-drag so clicks work inside the draggable card */}
        <div
          className="mini-controls"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => act('previous')}
            disabled={!state.hasSong}
            title="Previous"
            aria-label="Previous song"
            className="mini-btn"
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={() => act('togglePlay')}
            disabled={!state.hasSong}
            title={state.isPlaying ? 'Pause' : 'Play'}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
            className="mini-play"
          >
            {state.isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
          </button>
          <button
            onClick={() => act('next')}
            disabled={!state.hasSong}
            title="Next"
            aria-label="Next song"
            className="mini-btn"
          >
            <SkipForward size={14} />
          </button>

          <span className="mini-div" aria-hidden />

          {/* Volume (v3.2.0) — mute toggle + compact slider. Both mirror the
              main window's state via the snapshot and act through the same
              store funnels, so volume is one shared value everywhere. */}
          <MiniVolume volume={state.volume ?? 1} muted={!!state.muted} />

          <span className="mini-div" aria-hidden />

          {/* Restore main window — never closes the app, just brings the big
              player back (and hides this widget). */}
          <button
            onClick={() => act('restore')}
            title="Restore Aura"
            aria-label="Restore main window"
            className="mini-btn"
          >
            <Maximize2 size={13} />
          </button>
          <button
            onClick={() => act('close')}
            title="Close mini player"
            aria-label="Close mini player"
            className="mini-btn"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MiniSeek (v3.2.0, re-skinned v3.3.1) ─────────────────────────────────────
// A thin seek bar with elapsed/remaining micro-labels. Pointer events are
// captured so a drag that leaves the tiny bar still tracks; the fraction is
// sent on every move for live scrubbing (the main renderer's seekTo already
// coalesces by writing audio.currentTime directly). Progress keeps updating
// from the snapshot while not dragging.
function MiniSeek({ progress, durationSec, hasSong }: { progress: number; durationSec: number; hasSong: boolean }) {
  const barRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [dragP, setDragP] = useState(0)
  const dragPRef = useRef(0)

  const fractionFrom = (clientX: number): number => {
    const el = barRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const shown = dragging ? dragP : progress

  const onDown = (e: React.PointerEvent) => {
    if (!hasSong) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    const f = fractionFrom(e.clientX)
    dragPRef.current = f
    setDragP(f)
    window.electronAPI?.miniSeek?.(f)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!dragging) return
    const f = fractionFrom(e.clientX)
    dragPRef.current = f
    setDragP(f)
    window.electronAPI?.miniSeek?.(f)
  }
  const onUp = () => setDragging(false)

  const elapsed = shown * durationSec
  const remaining = Math.max(0, (1 - shown) * durationSec)

  return (
    <div
      className="mini-seek"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      data-mini-seek
    >
      <span className="mini-time mini-time--elapsed">
        {hasSong && durationSec > 0 ? formatTime(elapsed) : '–:––'}
      </span>
      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (!hasSong) return
          if (e.key === 'ArrowRight') window.electronAPI?.miniSeek?.(Math.min(1, shown + 0.05))
          if (e.key === 'ArrowLeft') window.electronAPI?.miniSeek?.(Math.max(0, shown - 0.05))
        }}
        className="mini-seekbar"
      >
        <div className="mini-seek-track" />
        <div
          className="mini-seek-fill"
          style={{
            width: `${shown * 100}%`,
            transition: dragging ? 'none' : 'width 0.15s linear',
          }}
        />
        <div
          className="mini-seek-knob"
          style={{ left: `${shown * 100}%` }}
        />
      </div>
      <span className="mini-time mini-time--total">
        {hasSong && durationSec > 0 ? `−${formatTime(remaining)}` : '–:––'}
      </span>
    </div>
  )
}

// ── MiniVolume (v3.2.0, re-skinned v3.3.1) ───────────────────────────────────
// Mute toggle + a compact slider. While the user is dragging, a local value
// leads (the store echo can take up to one heartbeat); on release the
// snapshot becomes authoritative again.
function MiniVolume({ volume, muted }: { volume: number; muted: boolean }) {
  const [dragging, setDragging] = useState(false)
  const [local, setLocal] = useState(volume)
  useEffect(() => { if (!dragging) setLocal(volume) }, [volume, dragging])

  const effective = muted ? 0 : (dragging ? local : volume)
  const pct = Math.min(1, Math.max(0, effective)) * 100

  return (
    <div className="mini-volume" data-mini-volume>
      <button
        onClick={() => window.electronAPI?.miniAction?.('toggleMute')}
        title={muted ? 'Unmute' : 'Mute'}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="mini-btn"
        style={{ padding: 5 }}
      >
        {effective === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
      <input
        type="range"
        min={0} max={1} step={0.01}
        value={muted ? 0 : effective}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onChange={(e) => {
          const v = Number(e.target.value)
          setLocal(v)
          window.electronAPI?.setMiniVolume?.(v)
        }}
        aria-label="Volume"
        style={{
          background: `linear-gradient(to right, rgba(255,255,255,0.92) ${pct}%, rgba(255,255,255,0.18) ${pct}%)`,
        }}
      />
    </div>
  )
}
