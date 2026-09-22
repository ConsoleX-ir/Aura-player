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

// Progress ring geometry — same visual language as the in-app player pill.
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
  // window does this via App.tsx; here the appearance rides the state push.
  useEffect(() => {
    document.documentElement.dataset.theme = state.appearance
  }, [state.appearance])

  const act = (action: 'togglePlay' | 'next' | 'previous' | 'restore' | 'close') =>
    window.electronAPI?.miniAction?.(action)

  return (
    <div className="fixed inset-0 p-2">
      <div
        data-mini-player
        className="h-full flex items-center gap-3 px-3 perf-blur"
        style={{
          background: 'var(--color-chrome-solid, var(--surface-chrome))',
          border: '1px solid var(--border-strong)',
          borderRadius: 24,
          boxShadow: '0 12px 40px rgba(0,0,0,0.45), 0 2px 10px rgba(0,0,0,0.3)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
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

        {/* Title / artist — the only text, truncated hard */}
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {state.hasSong ? state.title : 'Nothing playing'}
          </p>
          <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {state.hasSong ? state.artist : 'Aura mini-player'}
          </p>
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
