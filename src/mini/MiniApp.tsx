import { useEffect, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Maximize2, X, Music2 } from 'lucide-react'

// ── Mini state contract ──────────────────────────────────────────────────────
// Pushed by the MAIN window's useMiniPlayerBridge over 'mini:state'. Kept as a
// flat, serializable snapshot — nothing live crosses the context bridge.
export interface MiniState {
  hasSong: boolean
  title: string
  artist: string
  coverArt: string | null
  isPlaying: boolean
  /** 0..1 playback progress — drives the artwork progress ring. */
  progress: number
  /** 'dark' | 'light' — applied as data-theme so tokens resolve correctly. */
  appearance: 'dark' | 'light'
  /** Aura 3.0 — theme identity (data-aura-theme) + resolved accent vars. */
  theme?: string
  accent?: { d1: string; d2: string; d3: string; glow: string }
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
  // on Now Playing, theme color everywhere else).
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
    }
  }, [state.appearance, state.theme, state.accent])

  const act = (action: 'togglePlay' | 'next' | 'previous' | 'restore' | 'close') =>
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

        {/* Title / artist + hover-revealed next-up strip (queue access) */}
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
        </div>

        {/* Transport — no-drag so clicks work inside the draggable card */}
        <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
