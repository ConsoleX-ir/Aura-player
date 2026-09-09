import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Shuffle, Repeat, Repeat1, Music2, Mic2, BarChart2, ListMusic,
  PictureInPicture2,
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'
import { formatTime } from '@/lib/utils'
import { AuraPulse } from './AuraPulse'

// ── The Pill Play Bar (Wave 3, refined v2.0.0) ──────────────────────────────
// Aura's signature transport: a floating capsule that hovers over the content
// instead of bricking it off. Artwork, title/artist and quick context live on
// the left; the transport sits dead center; queue/lyrics/visualizer/volume
// cluster on the right; the seek line rides the pill's top edge with hover
// time labels. AuraPulse wraps the whole thing in a living, engine-driven
// glow ring. All control titles/aria-labels are contracts (keyboard shortcut
// hints + regression tests) and are preserved verbatim from the v1 bar.
//
// v2.0.0 changes: panels moved to uiStore (one source for pill/shortcuts/
// palette), mini-player toggle, CSS-driven hover classes (no per-button JS
// handlers), and responsive side columns for narrow windows.
export function PlayerBar() {
  // Narrow selectors — PlayerBar legitimately re-renders on song/isPlaying/
  // volume/repeat changes, but NOT on the ~4-10Hz progress tick anymore:
  // v2.1.0 moved `progress`/`duration` subscriptions down into <PillSeek/>
  // (the only part of the pill that displays them), so the whole chrome —
  // artwork, transport, panels, volume — now holds still while a track
  // plays. Previously every tick re-rendered the entire pill.
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeat = usePlayerStore((s) => s.repeat)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const nextSong = usePlayerStore((s) => s.nextSong)
  const prevSong = usePlayerStore((s) => s.prevSong)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const activeView = usePlayerStore((s) => s.activeView)
  const performanceMode = usePlayerStore((s) => s.performanceMode)

  // Panel state lives in uiStore so Ctrl+K and the Q shortcut drive the same
  // surface as these buttons — and so the panels mount from App, not here.
  const openPanel = useUiStore((s) => s.openPanel)
  const togglePanel = useUiStore((s) => s.togglePanel)

  // Trigger anchors — measured at click time so each panel opens exactly on
  // its icon regardless of layout shifts (responsive side columns included).
  const queueAnchorRef = useRef<HTMLSpanElement>(null)
  const lyricsAnchorRef = useRef<HTMLSpanElement>(null)
  const visualizerAnchorRef = useRef<HTMLSpanElement>(null)

  // Volume OSD — a small percentage pill that appears whenever volume (or
  // mute) changes and fades out after a beat. Works for every source: the
  // slider, scroll-wheel, ↑/↓ keys, M mute… all funnel into store volume.
  const [showVolOsd, setShowVolOsd] = useState(false)
  const osdTimerRef = useRef<number | undefined>(undefined)
  const firstVolumeRender = useRef(true)

  useEffect(() => {
    // Skip the very first mount so the pill doesn't flash on app launch.
    if (firstVolumeRender.current) { firstVolumeRender.current = false; return }
    setShowVolOsd(true)
    window.clearTimeout(osdTimerRef.current)
    osdTimerRef.current = window.setTimeout(() => setShowVolOsd(false), 1200)
    return () => window.clearTimeout(osdTimerRef.current)
  }, [volume, muted])

  // Scroll wheel over the volume cluster adjusts volume — same fine-grained
  // ±5% steps as the keyboard shortcut. A native listener is used because
  // React's synthetic onWheel is passive and can't preventDefault().
  const volClusterRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = volClusterRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const step = e.deltaY < 0 ? 0.05 : -0.05
      setVolume(Math.min(1, Math.max(0, Number(usePlayerStore.getState().volume.toFixed(2)) + step)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setVolume])

  // Escape closes any open panel — Esc means "back out of what I opened",
  // everywhere in the app (modals, dropdowns, these popups).
  useEffect(() => {
    if (!openPanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUiStore.getState().setOpenPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPanel])

  const effectiveVolume = muted ? 0 : volume

  const isNowPlaying = activeView === 'nowplaying'

  // Measure the clicked icon's center so its panel opens anchored to it.
  const handleTogglePanel = (p: 'lyrics' | 'visualizer' | 'queue', el: HTMLElement | null) => {
    let anchorX: number | undefined
    if (el) {
      const rect = el.getBoundingClientRect()
      anchorX = rect.left + rect.width / 2
    }
    togglePanel(p, anchorX)
  }
  const openNowPlaying = () => {
    if (!currentSong) return
    setActiveView(isNowPlaying ? 'library' : 'nowplaying')
  }

  return (
    <motion.div
      initial={{ y: 110, opacity: 0, x: '-50%' }}
      animate={{ y: 0, opacity: 1, x: '-50%' }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="fixed bottom-2.5 left-1/2 z-50"
      style={{ width: 'min(1240px, calc(100vw - 24px))', height: 72 }}
      data-player-bar
    >
      <AuraPulse active={isPlaying && !performanceMode} />

      <div
        className="perf-blur relative h-full w-full flex flex-col overflow-hidden group/pill pb-lift"
        style={{
          borderRadius: 'var(--radius-pill)',
          background: 'color-mix(in srgb, var(--surface-chrome) 86%, transparent)',
          border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-overlay), inset 0 1px 0 var(--border-emphasis)',
          backdropFilter: 'blur(44px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(44px) saturate(1.4)',
        }}
      >
        {/* Seek line + hover time labels — their own component so the tick
            cadence never reaches this chrome (see PillSeek). */}
        <PillSeek />

        <div className="h-full flex items-center gap-4 px-5 pt-2">

          {/* ── Left: clickable song info → opens Now Playing ── */}
          <div
            className={`pb-info flex items-center gap-3 shrink-0 rounded-full p-1.5 -ml-1.5 transition-colors ${currentSong ? 'cursor-pointer hover-surface' : ''}`}
            onClick={openNowPlaying}
            title={currentSong ? (isNowPlaying ? 'Close Now Playing' : 'Open Now Playing') : ''}
          >
            <AnimatePresence mode="wait">
              {currentSong ? (
                <motion.div
                  key={currentSong.id}
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                  className="relative shrink-0"
                >
                  {currentSong.coverArt
                    ? <img
                        src={currentSong.coverArt}
                        alt=""
                        className="w-11 h-11 rounded-full object-cover"
                        style={{
                          boxShadow: isPlaying ? '0 0 18px var(--accent-veil)' : 'none',
                          transition: 'box-shadow 1s ease',
                        }}
                      />
                    : <div
                        className="w-11 h-11 rounded-full flex items-center justify-center"
                        style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)' }}
                      >
                        <Music2 size={16} style={{ color: 'var(--text-faint)' }} />
                      </div>
                  }
                  {isPlaying && !performanceMode && (
                    <motion.div
                      className="absolute inset-[-3px] rounded-full border border-dashed"
                      style={{ borderColor: 'var(--accent)', opacity: 0.3 }}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                    />
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence mode="wait">
              {currentSong ? (
                <motion.div
                  key={currentSong.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="min-w-0 flex-1"
                >
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{currentSong.title}</p>
                  <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{currentSong.artist}</p>
                  <p className="text-[10px] mt-0.5 truncate pb-hint" style={{ color: 'var(--text-faint)' }}>
                    {isNowPlaying ? 'Click to close ↓' : 'Click to expand ↑'}
                  </p>
                </motion.div>
              ) : (
                <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm" style={{ color: 'var(--text-faint)' }}>
                  Nothing playing
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* ── Center: transport ── */}
          <div className="flex-1 flex items-center justify-center gap-1.5">
            <IconBtn active={shuffle} onClick={toggleShuffle} title="Shuffle (S)" ariaLabel="Shuffle">
              <Shuffle size={14} />
            </IconBtn>
            <IconBtn onClick={prevSong} title="Previous (←)" ariaLabel="Previous song">
              <SkipBack size={17} />
            </IconBtn>

            <motion.button
              onClick={togglePlay}
              whileTap={{ scale: 0.92 }}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="w-11 h-11 rounded-full flex items-center justify-center transition-all pressable"
              style={{
                color: 'var(--text-primary)',
                background: 'var(--glass-3)',
                border: '1px solid var(--border-strong)',
                boxShadow: isPlaying ? '0 0 24px var(--accent-veil)' : undefined,
              }}
            >
              <AnimatePresence mode="wait">
                {isPlaying
                  ? <motion.div key="p" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Pause size={18} fill="currentColor" /></motion.div>
                  : <motion.div key="pl" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Play size={18} fill="currentColor" className="ml-0.5" /></motion.div>
                }
              </AnimatePresence>
            </motion.button>

            <IconBtn onClick={nextSong} title="Next (→)" ariaLabel="Next song">
              <SkipForward size={17} />
            </IconBtn>
            <IconBtn active={repeat !== 'none'} onClick={cycleRepeat} title={`Repeat: ${repeat} (R)`} ariaLabel="Repeat mode">
              {repeat === 'one' ? <Repeat1 size={14} /> : <Repeat size={14} />}
            </IconBtn>
          </div>

          {/* ── Right: panels + volume ── */}
          <div className="pb-side flex items-center gap-1 shrink-0 justify-end relative">

            {/* Volume OSD — floats above the right cluster, out of the way
                of the transport controls but visible where the eye already
                is when adjusting loudness. */}
            <AnimatePresence>
              {showVolOsd && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: -30, scale: 1 }}
                  exit={{ opacity: 0, y: -40, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  className="absolute bottom-6 right-14 px-2.5 py-1 rounded-lg text-[11px] font-semibold tabular-nums pointer-events-none"
                  style={{
                    background: 'var(--surface-chrome)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--accent)',
                    boxShadow: 'var(--shadow-2)',
                  }}
                >
                  {muted ? 'Muted' : `${Math.round(volume * 100)}%`}
                </motion.div>
              )}
            </AnimatePresence>

            <span ref={(el) => { queueAnchorRef.current = el }} className="inline-flex">
              <IconBtn active={openPanel === 'queue'} onClick={() => handleTogglePanel('queue', queueAnchorRef.current)} title="Queue" ariaLabel="Queue panel">
                <ListMusic size={14} />
              </IconBtn>
            </span>
            <span ref={(el) => { lyricsAnchorRef.current = el }} className="inline-flex pb-extra">
              <IconBtn active={openPanel === 'lyrics'} onClick={() => handleTogglePanel('lyrics', lyricsAnchorRef.current)} title="Lyrics" ariaLabel="Lyrics panel">
                <Mic2 size={14} />
              </IconBtn>
            </span>
            <span ref={(el) => { visualizerAnchorRef.current = el }} className="inline-flex pb-extra">
              <IconBtn active={openPanel === 'visualizer'} onClick={() => handleTogglePanel('visualizer', visualizerAnchorRef.current)} title="Visualizer" ariaLabel="Visualizer panel">
                <BarChart2 size={14} />
              </IconBtn>
            </span>

            <span className="inline-flex pb-extra">
              <IconBtn
                onClick={() => useUiStore.getState().setMiniPlayer(true)}
                title="Mini player (P)"
                ariaLabel="Mini player"
              >
                <PictureInPicture2 size={14} />
              </IconBtn>
            </span>

            <div ref={volClusterRef} className="flex items-center gap-2 cursor-ns-resize ml-1" title="Scroll to adjust volume">
              <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute (M)' : 'Mute (M)'}
                className="p-1.5 rounded-full icon-hover"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {effectiveVolume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>

              <Slider.Root
                value={[effectiveVolume]} min={0} max={1} step={0.01}
                onValueChange={([v]) => setVolume(v)}
                className="relative flex items-center w-20 h-5 cursor-pointer pb-vol"
                aria-label="Volume"
              >
                <Slider.Track className="relative h-[3px] flex-1 rounded-full" style={{ background: 'var(--glass-2)' }}>
                  <Slider.Range
                    className="absolute h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))' }}
                  />
                </Slider.Track>
                <Slider.Thumb className="block w-3 h-3 rounded-full shadow outline-none hover:scale-110 transition-transform" style={{ background: 'var(--text-on-accent)' }} />
              </Slider.Root>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── (anchor refs are component-scoped — see PlayerBar) ──────────────────────

// ── PillSeek (v2.1.0) ───────────────────────────────────────────────────────
// The seek line riding the pill's top edge + the flanking hover time labels,
// extracted from PlayerBar so the ~4-10Hz progress tick re-renders exactly
// these ~6 DOM nodes instead of the entire pill chrome. Drag state and the
// window mousemove/mouseup listeners live here too — the value goes through
// a ref so the mouseup handler never closes over a stale drag position.
function PillSeek() {
  const progress = usePlayerStore((s) => s.progress)
  const duration = usePlayerStore((s) => s.duration)
  const seekTo = usePlayerStore((s) => s.seekTo)
  const seekBarRef = useRef<HTMLDivElement>(null)
  const dragProgressRef = useRef(0)
  const [isSeekDragging, setIsSeekDragging] = useState(false)
  const [dragProgress, setDragProgress] = useState(0)

  useEffect(() => {
    if (!isSeekDragging) return
    const onMove = (e: MouseEvent) => {
      const el = seekBarRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const val = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
      dragProgressRef.current = val
      setDragProgress(val)
    }
    const onUp = () => {
      seekTo(dragProgressRef.current)
      setIsSeekDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [isSeekDragging, seekTo])

  const shownProgress = isSeekDragging ? dragProgress : progress

  return (
    <>
      {/* Seek line — rides the pill's top edge, inset for the curve */}
      <div
        ref={seekBarRef}
        className="absolute top-0 left-7 right-7 h-1 cursor-pointer"
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const val = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
          setDragProgress(val)
          setIsSeekDragging(true)
          e.preventDefault()
        }}
        onClick={(e) => {
          if (isSeekDragging) return
          const rect = e.currentTarget.getBoundingClientRect()
          seekTo((e.clientX - rect.left) / rect.width)
        }}
        title="Seek"
      >
        <div className="h-full w-full rounded-full" style={{ background: 'var(--glass-1)' }} />
        <div
          className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
          style={{
            width: `${shownProgress * 100}%`,
            background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))',
            transition: isSeekDragging ? 'none' : 'width 0.15s linear',
          }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover/pill:opacity-100 transition-opacity pointer-events-none"
          style={{ left: `${shownProgress * 100}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>

      {/* Hover time labels — flanking the seek line, revealed on pill
          hover (and pinned while dragging) */}
      <div
        className={`absolute top-2 left-7 text-[10px] tabular-nums pointer-events-none transition-opacity duration-200 ${isSeekDragging ? 'opacity-100' : 'opacity-0 group-hover/pill:opacity-100'}`}
        style={{ color: 'var(--text-faint)' }}
      >
        {formatTime(shownProgress * duration)}
      </div>
      <div
        className={`absolute top-2 right-7 text-[10px] tabular-nums pointer-events-none transition-opacity duration-200 ${isSeekDragging ? 'opacity-100' : 'opacity-0 group-hover/pill:opacity-100'}`}
        style={{ color: 'var(--text-faint)' }}
      >
        {formatTime(duration)}
      </div>
    </>
  )
}

function IconBtn({ children, onClick, active, title, ariaLabel }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean; title?: string; ariaLabel?: string
}) {
  return (
    <button
      onClick={() => onClick?.()}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`p-2 rounded-full transition-all duration-150 icon-hover ${active ? 'is-active' : ''}`}
      style={active
        ? { background: 'var(--glass-2)', color: 'var(--accent)' }
        : { color: 'var(--text-tertiary)' }}
    >
      {children}
    </button>
  )
}
