import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Shuffle, Repeat, Repeat1, Music2, Mic2, BarChart2, ListMusic,
  PictureInPicture2, Heart,
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'
import { formatTime } from '@/lib/utils'
import { useArtworkStore } from '@/store/artworkStore'

// ── Playbar 4.0.1 (Sidebar & Playback Bar redesign) ─────────────────────────
// The floating liquid-glass capsule is GONE. The transport is now a compact
// DOCKED bottom bar — a normal row of the app-frame grid (see App.tsx), 56px
// tall, under the main content column only. Structure is a three-region grid:
//
//   [ track info ……… ] [ transport + seek ] [ ……… utilities ]
//        minmax(0,1fr)        auto                minmax(0,1fr)
//
// Because the bar spans only the CONTENT column (the full-height sidebar
// owns its own column), the centered transport reads as centered on the
// content area — not offset by the sidebar the way the old window-centered
// pill was. Visual treatment is deliberately restrained: one hairline top
// separator over a near-opaque chrome surface. No aurora glow field, no
// gradient hairline borders, no 24px rounding, no floating shadow — the
// compact proportions and clear information hierarchy do the work.
//
// Mechanics preserved from 3.x (unchanged contracts):
//   • Panels live in uiStore — one source for pill/shortcuts/palette — and
//     mount from App, anchored by uiStore.panelAnchorX measured at click.
//   • Progress isolation: the ~4-10Hz tick re-renders ONLY <SeekCluster/>
//     (the sole progress consumer), never the bar chrome.
//   • Volume OSD for every volume source; scroll-wheel fine adjust; Esc
//     closes any open panel; mini-player toggle drives the desktop widget.
//   • All titles/aria-labels are keyboard-shortcut contracts — verbatim.
//   NEW in 4.0.1: a favorite control in the info region (store's existing
//   toggleFavorite — the L shortcut's action, no new state).

export function PlayerBar() {
  // Narrow selectors — PlayerBar re-renders on song/isPlaying/volume/repeat
  // changes, but NOT on the progress tick (that lives in <SeekCluster/>).
  const currentSong = usePlayerStore((s) => s.currentSong)
  // Aura 3.0 — the user's artwork override wins over embedded/provider art.
  const coverOverride = useArtworkStore((s) => (s.overrides[currentSong?.id ?? '']?.url ?? null))
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

  // Panel state lives in uiStore so Ctrl+K and the Q shortcut drive the same
  // surface as these buttons — and so the panels mount from App, not here.
  const openPanel = useUiStore((s) => s.openPanel)
  const togglePanel = useUiStore((s) => s.togglePanel)

  // Trigger anchors — measured at click time so each panel opens exactly on
  // its icon regardless of layout shifts.
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
    // v5 — the bar is a FLOATING GLASS SLAB, still docked in normal grid
    // flow (the 4.0.1 guarantee stands: nothing floats over content, the
    // layout reservation is exactly the slab's height + inset), but now
    // with the layered liquid-chrome material: 18px radius, top sheen,
    // accent-tinted hairline, elevation shadow.
    <motion.div
      initial={{ y: 12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="relative w-full"
      style={{
        height: 'calc(var(--playerbar-height) + var(--playerbar-inset))',
        paddingLeft: 'var(--playerbar-inset)',
        paddingRight: 'var(--playerbar-inset)',
        paddingBottom: 'var(--playerbar-inset)',
      }}
      data-player-bar
    >
      <div
        className="perf-blur chrome-sheen playerbar-slab relative grid items-center h-[var(--playerbar-height)] w-full"
        style={{
          gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
          columnGap: 12,
          paddingLeft: 12,
          paddingRight: 12,
          // Liquid chrome: translucent material + blur + accent-tinted
          // hairline (v5). Token-driven — every theme remaps it for free.
          background: 'var(--surface-chrome)',
          border: '1px solid var(--chrome-hairline)',
          backdropFilter: 'blur(var(--blur-chrome)) saturate(1.15)',
          WebkitBackdropFilter: 'blur(var(--blur-chrome)) saturate(1.15)',
        }}
      >
        {/* ── LEFT: track information ─────────────────────────────────────── */}
        <div className="pb-info flex items-center gap-1.5 min-w-0 justify-self-start">
          <div
            className={`flex items-center gap-2.5 min-w-0 rounded-lg p-1 -ml-1 transition-colors ${currentSong ? 'cursor-pointer hover-surface' : ''}`}
            onClick={openNowPlaying}
            title={currentSong ? (isNowPlaying ? 'Close Now Playing' : 'Open Now Playing') : ''}
          >
            <AnimatePresence mode="wait">
              {currentSong ? (
                <motion.div
                  key={currentSong.id}
                  initial={{ scale: 0.88, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.88, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                  className="relative shrink-0"
                >
                  {(coverOverride ?? currentSong.coverArt)
                    ? <img
                        src={(coverOverride ?? currentSong.coverArt)!}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover"
                        style={{ boxShadow: '0 0 0 1px var(--border-default)' }}
                      />
                    : <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)' }}
                      >
                        <Music2 size={17} style={{ color: 'var(--text-faint)' }} />
                      </div>
                  }
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
                  <p className="text-[13px] font-medium leading-tight truncate" style={{ color: 'var(--text-primary)' }}>{currentSong.title}</p>
                  <p className="text-[11px] leading-tight truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{currentSong.artist}</p>
                </motion.div>
              ) : (
                <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] whitespace-nowrap" style={{ color: 'var(--text-faint)' }}>
                  Nothing playing
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Favorite — the L shortcut's action as a visible control. */}
          <FavoriteToggle />
        </div>

        {/* ── CENTER: transport + seek ──────────────────────────────────────
            Two tight rows inside the 56px bar: the transport buttons, then
            an always-readable seek (elapsed · slider · duration). The bar
            spans only the content column, so this cluster is centered on
            the CONTENT area by construction. */}
        <div className="flex flex-col items-center justify-center gap-[3px] min-w-0 py-1">
          <div className="flex items-center gap-0.5">
            <IconBtn active={shuffle} onClick={toggleShuffle} title="Shuffle (S)" ariaLabel="Shuffle" hit={30}>
              <Shuffle size={16} />
            </IconBtn>
            <IconBtn onClick={prevSong} title="Previous (←)" ariaLabel="Previous song" hit={32}>
              <SkipBack size={19} />
            </IconBtn>

            <motion.button
              onClick={togglePlay}
              whileTap={{ scale: 0.92 }}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all pressable mx-0.5"
              style={{
                color: isPlaying ? 'var(--text-on-accent)' : 'var(--text-primary)',
                background: isPlaying
                  ? 'linear-gradient(140deg, var(--accent), var(--accent-strong))'
                  : 'var(--glass-3)',
                border: '1px solid var(--border-strong)',
                boxShadow: isPlaying ? '0 0 18px var(--accent-veil)' : undefined,
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isPlaying
                  ? <motion.span key="p" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex"><Pause size={17} fill="currentColor" /></motion.span>
                  : <motion.span key="pl" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex"><Play size={17} fill="currentColor" className="ml-0.5" /></motion.span>
                }
              </AnimatePresence>
            </motion.button>

            <IconBtn onClick={nextSong} title="Next (→)" ariaLabel="Next song" hit={32}>
              <SkipForward size={19} />
            </IconBtn>
            <IconBtn active={repeat !== 'none'} onClick={cycleRepeat} title={`Repeat: ${repeat} (R)`} ariaLabel="Repeat mode" hit={30}>
              {repeat === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
            </IconBtn>
          </div>

          <SeekCluster />
        </div>

        {/* ── RIGHT: playback utilities ───────────────────────────────────── */}
        <div className="pb-side flex items-center gap-0.5 min-w-0 justify-self-end justify-end relative">

          {/* Volume OSD — floats just above the right cluster. The docked
              bar doesn't clip (no rounded overflow shell), so the pill may
              rise past the bar's top edge like a tooltip. */}
          <AnimatePresence>
            {showVolOsd && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.94 }}
                animate={{ opacity: 1, y: -12, scale: 1 }}
                exit={{ opacity: 0, y: -16, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                className="absolute bottom-4 right-12 px-2.5 py-1 rounded-lg text-[11px] font-semibold tabular-nums pointer-events-none z-10"
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
            <IconBtn active={openPanel === 'queue'} onClick={() => handleTogglePanel('queue', queueAnchorRef.current)} title="Queue" ariaLabel="Queue panel" hit={32}>
              <ListMusic size={17} />
            </IconBtn>
          </span>
          <span ref={(el) => { lyricsAnchorRef.current = el }} className="inline-flex pb-extra">
            <IconBtn active={openPanel === 'lyrics'} onClick={() => handleTogglePanel('lyrics', lyricsAnchorRef.current)} title="Lyrics" ariaLabel="Lyrics panel" hit={32}>
              <Mic2 size={17} />
            </IconBtn>
          </span>
          <span ref={(el) => { visualizerAnchorRef.current = el }} className="inline-flex pb-extra">
            <IconBtn active={openPanel === 'visualizer'} onClick={() => handleTogglePanel('visualizer', visualizerAnchorRef.current)} title="Visualizer" ariaLabel="Visualizer panel" hit={32}>
              <BarChart2 size={17} />
            </IconBtn>
          </span>

          <span className="inline-flex pb-extra">
            <IconBtn
              onClick={() => {
                // v2.1.2: toggles the DESKTOP mini player window (an
                // independent frameless BrowserWindow), not an in-app mode.
                const ui = useUiStore.getState()
                ui.setMiniPlayer(!ui.miniPlayer)
              }}
              title="Mini player (P)"
              ariaLabel="Toggle mini player"
              hit={32}
            >
              <PictureInPicture2 size={17} />
            </IconBtn>
          </span>

          <div ref={volClusterRef} className="flex items-center gap-1.5 cursor-ns-resize ml-1" title="Scroll to adjust volume">
            <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute (M)' : 'Mute (M)'}
              className="p-1.5 rounded-full icon-hover"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {effectiveVolume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>

            <Slider.Root
              value={[effectiveVolume]} min={0} max={1} step={0.01}
              onValueChange={([v]) => setVolume(v)}
              className="relative flex items-center w-20 h-5 cursor-pointer pb-vol"
              aria-label="Volume"
            >
              <Slider.Track className="relative h-[3px] flex-1 rounded-pill" style={{ background: 'var(--glass-2)' }}>
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
    </motion.div>
  )
}

// ── FavoriteToggle ──────────────────────────────────────────────────────────
// The bar's one NEW control: mirrors the L shortcut (store.toggleFavorite).
// Filled rose heart + favorite token while the current song is loved.
function FavoriteToggle() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const favorites = usePlayerStore((s) => s.favorites)
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite)
  if (!currentSong) return <span className="w-7 shrink-0" />
  const isFav = favorites.includes(currentSong.id)
  return (
    <button
      onClick={() => toggleFavorite(currentSong.id)}
      title={isFav ? 'Remove from Favorites (L)' : 'Favorite (L)'}
      aria-label={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
      aria-pressed={isFav}
      className="w-7 h-7 rounded-full icon-hover flex items-center justify-center shrink-0"
      style={{ color: isFav ? 'var(--favorite)' : 'var(--text-tertiary)' }}
    >
      <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
    </button>
  )
}

// ── SeekCluster (4.0.1) ─────────────────────────────────────────────────────
// The seek now lives INSIDE the center region — elapsed · slider · duration —
// always readable instead of the old hover-only edge labels. It is the only
// progress subscriber in the bar: the ~4-10Hz tick re-renders these few
// nodes and nothing else. Radix gives keyboard seeking (arrows/Home/End) and
// an accessible slider role for free; drag previews locally and commits on
// release (onValueCommit), so the store's seekTo fires once per gesture.
function SeekCluster() {
  const progress = usePlayerStore((s) => s.progress)
  const duration = usePlayerStore((s) => s.duration)
  const seekTo = usePlayerStore((s) => s.seekTo)
  const [dragValue, setDragValue] = useState<number | null>(null)
  const shown = dragValue ?? progress

  return (
    <div className="pb-seek flex items-center gap-2 w-full" style={{ maxWidth: 440 }}>
      <span
        className="text-[10px] leading-none font-medium tabular-nums text-right shrink-0"
        style={{ color: 'var(--text-tertiary)', width: 34 }}
      >
        {formatTime(shown * duration)}
      </span>
      <Slider.Root
        value={[Math.min(Math.max(shown, 0), 1)]}
        min={0} max={1} step={0.001}
        onValueChange={([v]) => setDragValue(v)}
        onValueCommit={() => {
          if (dragValue != null) { seekTo(dragValue); setDragValue(null) }
        }}
        className="relative flex items-center flex-1 h-4 group/seek"
        aria-label="Seek"
      >
        <Slider.Track className="relative h-[3px] flex-1 rounded-pill" style={{ background: 'var(--glass-2)' }}>
          <Slider.Range
            className="absolute h-full rounded-pill"
            style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))' }}
          />
        </Slider.Track>
        <Slider.Thumb
          className="block w-2.5 h-2.5 rounded-full opacity-0 group-hover/seek:opacity-100 focus-visible:opacity-100 transition-opacity"
          style={{ background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4), 0 0 0 1px var(--border-strong)' }}
          aria-label="Seek position"
        />
      </Slider.Root>
      <span
        className="text-[10px] leading-none font-medium tabular-nums shrink-0"
        style={{ color: 'var(--text-tertiary)', width: 34 }}
      >
        {formatTime(duration)}
      </span>
    </div>
  )
}

function IconBtn({ children, onClick, active, title, ariaLabel, hit = 32 }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean; title?: string; ariaLabel?: string; hit?: number
}) {
  return (
    <button
      onClick={() => onClick?.()}
      title={title}
      aria-label={ariaLabel ?? title}
      className={`rounded-full transition-all duration-150 icon-hover flex items-center justify-center ${active ? 'is-active' : ''}`}
      style={{ width: hit, height: hit }}
    >
      {children}
    </button>
  )
}
