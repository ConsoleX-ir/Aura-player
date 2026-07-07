import { useState, useRef } from 'react'
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
  const {
    currentSong, isPlaying, volume, progress, duration,
    shuffle, repeat, togglePlay, nextSong, prevSong,
    setVolume, seekTo, toggleShuffle, cycleRepeat, setActiveView, activeView,
    performanceMode,
  } = usePlayerStore()

  const [openPanel, setOpenPanel] = useState<PanelType>(null)
  const [muted, setMuted] = useState(false)
  const prevVolRef = useRef(volume)

  const isNowPlaying = activeView === 'nowplaying'

  const toggleMute = () => {
    if (muted) { setVolume(prevVolRef.current); setMuted(false) }
    else { prevVolRef.current = volume; setVolume(0); setMuted(true) }
  }
  const togglePanel = (p: PanelType) => setOpenPanel((x) => x === p ? null : p)
  const openNowPlaying = () => {
    if (!currentSong) return
    setActiveView(isNowPlaying ? 'library' : 'nowplaying')
  }

  return (
    <>
      <AnimatePresence>
        {openPanel === 'lyrics' && <LyricsPanel key="lyrics" onClose={() => setOpenPanel(null)} />}
        {openPanel === 'visualizer' && <VisualizerPanel key="vis" onClose={() => setOpenPanel(null)} />}
      </AnimatePresence>

      <motion.div
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-[var(--color-border)] perf-blur"
        style={{
          height: 'var(--spacing-player)',
          background: 'rgba(10,10,15,0.92)',
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
              <IconBtn active={shuffle} onClick={toggleShuffle}><Shuffle size={14} /></IconBtn>
              <IconBtn onClick={prevSong}><SkipBack size={17} /></IconBtn>

              <motion.button
                onClick={togglePlay}
                whileTap={{ scale: 0.92 }}
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

              <IconBtn onClick={nextSong}><SkipForward size={17} /></IconBtn>
              <IconBtn active={repeat !== 'none'} onClick={cycleRepeat}>
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
          <div className="flex items-center gap-2 w-64 shrink-0 justify-end">
            <IconBtn active={openPanel === 'lyrics'} onClick={() => togglePanel('lyrics')} title="Lyrics">
              <Mic2 size={14} />
            </IconBtn>
            <IconBtn active={openPanel === 'visualizer'} onClick={() => togglePanel('visualizer')} title="Visualizer">
              <BarChart2 size={14} />
            </IconBtn>

            <button onClick={toggleMute} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
              {volume === 0 || muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>

            <Slider.Root
              value={[volume]} min={0} max={1} step={0.01}
              onValueChange={([v]) => { setVolume(v); setMuted(false) }}
              className="relative flex items-center w-24 h-5 cursor-pointer"
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
      </motion.div>
    </>
  )
}

function IconBtn({ children, onClick, active, title }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean; title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 rounded-lg transition-all duration-150 ${active ? 'bg-[var(--color-glass-mid)]' : 'text-white/30 hover:text-white/70 hover:bg-white/5'}`}
      style={active ? { color: 'var(--color-dynamic-1)' } : undefined}
    >
      {children}
    </button>
  )
}
