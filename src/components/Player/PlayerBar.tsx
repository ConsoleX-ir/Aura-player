import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Shuffle, Repeat, Repeat1, Music2, Mic2, BarChart2, ChevronUp
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { usePlayerStore } from '@/store/playerStore'
import { formatTime } from '@/lib/utils'
import { LyricsPanel } from './LyricsPanel'
import { VisualizerPanel } from './VisualizerPanel'

type PanelType = 'lyrics' | 'visualizer' | null

export function PlayerBar() {
  // Narrow selectors — PlayerBar legitimately re-renders often since it
  // displays live progress, but the previous full-store subscribe also
  // re-rendered it on completely unrelated changes (e.g. renaming a
  // playlist, importing songs) that have nothing to do with what it shows.
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const progress = usePlayerStore((s) => s.progress)
  const duration = usePlayerStore((s) => s.duration)
  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeat = usePlayerStore((s) => s.repeat)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const nextSong = usePlayerStore((s) => s.nextSong)
  const prevSong = usePlayerStore((s) => s.prevSong)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleMute = usePlayerStore((s) => s.toggleMute)
  const seekTo = usePlayerStore((s) => s.seekTo)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const activeView = usePlayerStore((s) => s.activeView)
  const performanceMode = usePlayerStore((s) => s.performanceMode)

  const [openPanel, setOpenPanel] = useState<PanelType>(null)
  // Horizontal anchor (px) the open panel should be centered on — measured
  // from the actual trigger icon at click time instead of hardcoded offsets,
  // so panels always open exactly on their icon regardless of layout shifts.
  const [panelAnchorX, setPanelAnchorX] = useState(0)
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
      if (e.key === 'Escape') setOpenPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openPanel])

  const effectiveVolume = muted ? 0 : volume

  const isNowPlaying = activeView === 'nowplaying'

  // Measure the clicked icon's center so its panel opens anchored to it.
  const togglePanel = (p: Exclude<PanelType, null>, el: HTMLElement | null) => {
    if (openPanel === p) { setOpenPanel(null); return }
    if (el) {
      const rect = el.getBoundingClientRect()
      setPanelAnchorX(rect.left + rect.width / 2)
    }
    setOpenPanel(p)
  }
  const openNowPlaying = () => {
    if (!currentSong) return
    setActiveView(isNowPlaying ? 'library' : 'nowplaying')
  }

  return (
    <>
      <AnimatePresence>
        {openPanel === 'lyrics' && <LyricsPanel key="lyrics" anchorX={panelAnchorX} onClose={() => setOpenPanel(null)} />}
        {openPanel === 'visualizer' && <VisualizerPanel key="vis" anchorX={panelAnchorX} onClose={() => setOpenPanel(null)} />}
      </AnimatePresence>

      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--color-border)] perf-blur"
        style={{
          height: 'var(--spacing-player)',
          background: 'var(--color-chrome)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
        }}
      >
        {/* Dynamic glow line at top */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--color-dynamic-1), transparent)',
            opacity: isPlaying ? 0.7 : 0.15,
            transition: 'opacity 1s ease',
          }}
        />

        {/* Seek bar */}
        <div
          className="absolute top-0 left-0 right-0 h-1 group cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            seekTo((e.clientX - rect.left) / rect.width)
          }}
          title="Seek"
        >
          <div className="h-full w-full bg-white/5" />
          <div
            className="absolute top-0 left-0 h-full pointer-events-none"
            style={{
              width: `${progress * 100}%`,
              background: 'linear-gradient(90deg, var(--color-dynamic-1), var(--color-dynamic-2))',
              transition: 'width 0.15s linear',
            }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ left: `${progress * 100}%`, transform: 'translate(-50%, -50%)' }}
          />
        </div>

        <div className="h-full flex items-center px-6 gap-4">

          {/* ── Left: clickable song info → opens Now Playing ── */}
          <div
            className={`flex items-center gap-3 w-64 shrink-0 rounded-xl p-1 -m-1 transition-all ${currentSong ? 'cursor-pointer hover:bg-white/5' : ''}`}
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
                  className="relative shrink-0"
                >
                  {currentSong.coverArt
                    ? <img
                        src={currentSong.coverArt}
                        alt=""
                        className="w-14 h-14 rounded-xl object-cover"
                        style={{
                          boxShadow: isPlaying ? '0 0 20px var(--color-dynamic-3)' : 'none',
                          transition: 'box-shadow 1s ease',
                        }}
                      />
                    : <div className="w-14 h-14 rounded-xl bg-[var(--color-glass-mid)] border border-[var(--color-border)] flex items-center justify-center">
                        <Music2 size={18} className="text-white/20" />
                      </div>
                  }
                  {isPlaying && !performanceMode && (
                    <motion.div
                      className="absolute inset-[-3px] rounded-[14px] border border-dashed"
                      style={{ borderColor: 'var(--color-dynamic-1)', opacity: 0.3 }}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                    />
                  )}
                  {/* Chevron hint on hover */}
                  <div className="absolute inset-0 rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <ChevronUp size={16} className="text-white" />
                  </div>
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
                  className="min-w-0 flex-1"
                >
                  <p className="text-sm font-medium text-white/90 truncate">{currentSong.title}</p>
                  <p className="text-xs text-white/40 truncate mt-0.5">{currentSong.artist}</p>
                  {currentSong && (
                    <p className="text-[10px] text-white/20 mt-0.5">
                      {isNowPlaying ? 'Click to close ↓' : 'Click to expand ↑'}
                    </p>
                  )}
                </motion.div>
              ) : (
                <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-white/20">
                  Nothing playing
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* ── Center: controls ── */}
          <div className="flex-1 flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-1.5">
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
                className="w-11 h-11 rounded-2xl flex items-center justify-center text-white/90 bg-[var(--color-glass-strong)] border border-[var(--color-border-mid)] hover:bg-white/15 transition-all"
                style={{ boxShadow: isPlaying ? '0 0 24px var(--color-dynamic-3)' : undefined }}
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

            <div className="flex items-center gap-2 text-[11px] text-white/25 tabular-nums">
              <span>{formatTime(progress * duration)}</span>
              <span>·</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* ── Right: panels + volume ── */}
          <div className="flex items-center gap-2 w-64 shrink-0 justify-end relative">

            {/* Volume OSD — floats above the right cluster, out of the way
                of the transport controls but visible where the eye already
                is when adjusting loudness. */}
            <AnimatePresence>
              {showVolOsd && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.9 }}
                  animate={{ opacity: 1, y: -34, scale: 1 }}
                  exit={{ opacity: 0, y: -44, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  className="absolute bottom-7 right-16 px-2.5 py-1 rounded-lg text-[11px] font-semibold tabular-nums pointer-events-none"
                  style={{
                    background: 'var(--color-chrome)',
                    border: '1px solid var(--color-border-mid)',
                    color: 'var(--color-dynamic-1)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                  }}
                >
                  {muted ? 'Muted' : `${Math.round(volume * 100)}%`}
                </motion.div>
              )}
            </AnimatePresence>

            <span ref={lyricsAnchorRef} className="inline-flex">
              <IconBtn active={openPanel === 'lyrics'} onClick={() => togglePanel('lyrics', lyricsAnchorRef.current)} title="Lyrics" ariaLabel="Lyrics panel">
                <Mic2 size={14} />
              </IconBtn>
            </span>
            <span ref={visualizerAnchorRef} className="inline-flex">
              <IconBtn active={openPanel === 'visualizer'} onClick={() => togglePanel('visualizer', visualizerAnchorRef.current)} title="Visualizer" ariaLabel="Visualizer panel">
                <BarChart2 size={14} />
              </IconBtn>
            </span>

            <div ref={volClusterRef} className="flex items-center gap-2 cursor-ns-resize" title="Scroll to adjust volume">
              <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute (M)' : 'Mute (M)'} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
                {effectiveVolume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>

              <Slider.Root
                value={[effectiveVolume]} min={0} max={1} step={0.01}
                onValueChange={([v]) => setVolume(v)}
                className="relative flex items-center w-24 h-5 cursor-pointer"
                aria-label="Volume"
              >
                <Slider.Track className="relative h-[3px] flex-1 rounded-full bg-white/10">
                  <Slider.Range
                    className="absolute h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, var(--color-dynamic-1), var(--color-dynamic-2))' }}
                  />
                </Slider.Track>
                <Slider.Thumb className="block w-3 h-3 rounded-full bg-white shadow outline-none hover:scale-110 transition-transform" />
              </Slider.Root>
            </div>
          </div>
        </div>
      </motion.div>
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
      className={`p-2 rounded-lg transition-all duration-150 ${active ? 'bg-[var(--color-glass-mid)]' : 'text-white/30 hover:text-white/70 hover:bg-white/5'}`}
      style={active ? { color: 'var(--color-dynamic-1)' } : undefined}
    >
      {children}
    </button>
  )
}
