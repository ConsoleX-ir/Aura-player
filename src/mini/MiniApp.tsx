import { useEffect, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Maximize2, X, Music2, Volume2, VolumeX } from 'lucide-react'
import { formatTime } from '@/lib/utils'

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
}

// Progress ring geometry — same visual language as the in-app playbar.
const R = 27          // ring radius inside the 60px artwork box
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

  // Theme tokens resolve under [data-theme] on the root element. The main
  // window does this via App.tsx; here the appearance AND the Aura 3.0 theme
  // identity ride the state push, plus the resolved accent vars so the
  // widget's accent lighting always matches the main window (artwork-aware
  // on Now Playing, theme color everywhere else) — and v3.2.0 adds the
  // adaptive on-accent ink.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = state.appearance
    if (state.theme && state.theme !== 'custom') root.dataset.auraTheme = state.theme
    else delete root.dataset.auraTheme
    const a = state.accent
    if (a?.d1) {
      root.style.setProperty('--color-dynamic-1', a.d1)
      root.style.setProperty('--color-dynamic-2', a.d2)
      root.style.setProperty('--color-dynamic-3', a.d3)
      root.style.setProperty('--color-dynamic-glow', a.glow)
      if (a.onAccent) root.style.setProperty('--text-on-accent', a.onAccent)
    }
  }, [state.appearance, state.theme, state.accent])

  const act = (action: 'togglePlay' | 'next' | 'previous' | 'toggleMute' | 'restore' | 'close') =>
    window.electronAPI?.miniAction?.(action)

  return (
    <div className="fixed inset-0 p-2">
      <div
        data-mini-player
        className="group/mini relative h-full flex items-center gap-3 px-3 perf-blur transition-transform duration-200"
        style={{
          // Liquid-glass card (Playbar 3.0 recipe, widget scale): gradient
          // hairline border over translucent chrome, top sheen baked in.
          background: `
            linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%),
            color-mix(in srgb, var(--surface-chrome) 88%, transparent) padding-box,
            linear-gradient(155deg, var(--border-emphasis), var(--border-subtle) 40%, var(--accent-border)) border-box`,
          border: '1px solid transparent',
          borderRadius: 24,
          boxShadow: '0 12px 40px rgba(0,0,0,0.45), 0 2px 10px rgba(0,0,0,0.3), inset 0 1px 0 var(--border-emphasis)',
          backdropFilter: 'blur(28px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(28px) saturate(1.4)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        {/* Artwork-aware accent wash — the glass catches the music's color */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none transition-opacity duration-1000"
          style={{
            borderRadius: 24,
            background: 'radial-gradient(ellipse 62% 120% at 18% 55%, var(--accent-whisper), transparent 70%)',
            opacity: state.isPlaying ? 1 : 0.35,
          }}
        />

        {/* Artwork + progress ring + play/pause on hover */}
        <button
          onClick={() => act('togglePlay')}
          title={state.isPlaying ? 'Pause' : 'Play'}
          aria-label={state.isPlaying ? 'Pause' : 'Play'}
          className="relative w-[60px] h-[60px] shrink-0 group/mini rounded-[15px] overflow-hidden"
          style={{ background: 'var(--glass-2)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {state.coverArt ? (
            <img src={state.coverArt} alt="" className="w-full h-full object-cover" draggable={false} />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music2 size={18} style={{ color: 'var(--text-faint)' }} />
            </div>
          )}
          <svg className="absolute inset-0 pointer-events-none" width={60} height={60} viewBox="0 0 60 60" aria-hidden>
            <circle cx={30} cy={30} r={R} fill="none" stroke="var(--glass-3)" strokeWidth={2.5} />
            <circle
              cx={30} cy={30} r={R} fill="none" stroke="var(--accent)" strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - Math.min(Math.max(state.progress, 0), 1))}
              transform="rotate(-90 30 30)"
            />
          </svg>
          <div
            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/mini:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.42)', transitionDuration: 'var(--dur-fast)' }}
          >
            {state.isPlaying
              ? <Pause size={18} fill="white" color="white" />
              : <Play size={18} fill="white" color="white" className="ml-0.5" />}
          </div>
        </button>

        {/* Title / artist + seek bar + times (v3.2.0) */}
        <div className="flex-1 min-w-0 relative">
          <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {state.hasSong ? state.title : 'Nothing playing'}
          </p>
          <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {state.hasSong ? state.artist : 'Aura mini-player'}
          </p>
          {/* Next-up preview: revealed on hover, click to skip. Hidden when
              the honest answer is "unknown" (shuffle) or "none" (queue end). */}
          {state.hasSong && state.nextTitle && (
            <button
              onClick={() => act('next')}
              title={`Next: ${state.nextTitle}`}
              aria-label={`Skip to ${state.nextTitle}`}
              className="absolute left-0 right-0 -bottom-0.5 text-[9.5px] truncate text-left opacity-0 group-hover/mini:opacity-100 transition-opacity pointer-events-auto cursor-pointer"
              style={{
                color: 'var(--accent)',
                WebkitAppRegion: 'no-drag',
                transitionDuration: 'var(--dur-fast)',
              } as React.CSSProperties}
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
        <div className="flex items-center gap-0.5 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => act('previous')}
            title="Previous"
            aria-label="Previous song"
            className="p-1.5 rounded-lg icon-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={() => act('togglePlay')}
            title={state.isPlaying ? 'Pause' : 'Play'}
            aria-label={state.isPlaying ? 'Pause' : 'Play'}
            className="p-1.5 rounded-lg icon-hover"
            style={{ color: 'var(--text-primary)' }}
          >
            {state.isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <button
            onClick={() => act('next')}
            title="Next"
            aria-label="Next song"
            className="p-1.5 rounded-lg icon-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <SkipForward size={14} />
          </button>

          <span className="w-px h-5 mx-1" style={{ background: 'var(--border-default)' }} />

          {/* Volume (v3.2.0) — mute toggle + compact slider. Both mirror the
              main window's state via the snapshot and act through the same
              store funnels, so volume is one shared value everywhere. */}
          <MiniVolume volume={state.volume ?? 1} muted={!!state.muted} />

          <span className="w-px h-5 mx-1" style={{ background: 'var(--border-default)' }} />

          {/* Restore main window — never closes the app, just brings the big
              player back (and hides this widget). */}
          <button
            onClick={() => act('restore')}
            title="Restore Aura"
            aria-label="Restore main window"
            className="p-1.5 rounded-lg icon-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <Maximize2 size={13} />
          </button>
          <button
            onClick={() => act('close')}
            title="Close mini player"
            aria-label="Close mini player"
            className="p-1.5 rounded-lg icon-hover"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MiniSeek (v3.2.0) ────────────────────────────────────────────────────────
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
      className="flex items-center gap-1.5 mt-1"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      data-mini-seek
    >
      <span className="text-[9px] tabular-nums w-7 text-right shrink-0" style={{ color: 'var(--text-tertiary)' }}>
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
        className="relative flex-1 h-2.5 flex items-center cursor-pointer group/seek"
        style={{ touchAction: 'none' }}
      >
        <div className="h-1 w-full rounded-full" style={{ background: 'var(--glass-3)' }} />
        <div
          className="absolute h-1 rounded-full pointer-events-none"
          style={{
            width: `${shown * 100}%`,
            background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))',
            transition: dragging ? 'none' : 'width 0.15s linear',
          }}
        />
        <div
          className="absolute w-2 h-2 rounded-full opacity-0 group-hover/seek:opacity-100 transition-opacity pointer-events-none"
          style={{
            left: `${shown * 100}%`,
            transform: 'translate(-50%, -50%)',
            background: 'var(--text-on-accent)',
            boxShadow: '0 0 0 1px var(--border-strong)',
          }}
        />
      </div>
      <span className="text-[9px] tabular-nums w-7 shrink-0" style={{ color: 'var(--text-tertiary)' }}>
        {hasSong && durationSec > 0 ? `−${formatTime(remaining)}` : '–:––'}
      </span>
    </div>
  )
}

// ── MiniVolume (v3.2.0) ──────────────────────────────────────────────────────
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
    <div className="flex items-center gap-1" data-mini-volume>
      <button
        onClick={() => window.electronAPI?.miniAction?.('toggleMute')}
        title={muted ? 'Unmute' : 'Mute'}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="p-1.5 rounded-lg icon-hover"
        style={{ color: 'var(--text-tertiary)' }}
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
        className="w-12 h-1 rounded-full appearance-none cursor-pointer accent-[var(--accent)]"
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, var(--glass-3) ${pct}%)`,
        }}
      />
    </div>
  )
}
