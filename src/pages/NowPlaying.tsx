import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Heart, ListMusic, Music2, Mic2
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { usePlayerStore } from '@/store/playerStore'
import { useLyrics } from '@/hooks/useLyrics'
import { formatTime } from '@/lib/utils'

export function NowPlaying() {
  const {
    currentSong, isPlaying, progress, duration, volume, shuffle, repeat,
    favorites, togglePlay, nextSong, prevSong, seekTo, setVolume,
    toggleShuffle, cycleRepeat, toggleFavorite, setActiveView, queue, queueIndex,
  } = usePlayerStore()

  const { lines, plain, loading } = useLyrics(currentSong)
  const currentTime = progress * duration
  const isFav = currentSong ? favorites.includes(currentSong.id) : false
  const lyricsRef = useRef<HTMLDivElement>(null)
  const activeLineRef = useRef<HTMLDivElement>(null)

  // Active lyric line index
  const activeIdx = lines.reduce((best, line, i) => currentTime >= line.time ? i : best, -1)

  // Auto-scroll lyrics to active line
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIdx])

  if (!currentSong) return null

  const hasLyrics = lines.length > 0 || !!plain

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="h-full flex flex-col overflow-hidden relative"
    >
      {/* Blurred album art background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {currentSong.coverArt && (
          <motion.img
            key={currentSong.id}
            src={currentSong.coverArt}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 w-full h-full object-cover blur-3xl scale-110"
            style={{ opacity: 0.12 }}
          />
        )}
        {/* Dark overlay so text stays readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--color-base)]/60 via-transparent to-[var(--color-base)]/80" />
      </div>

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-8 pt-6 pb-2 shrink-0">
        <button
          onClick={() => setActiveView('library')}
          className="flex items-center gap-1.5 text-white/40 hover:text-white/80 transition-colors"
        >
          <ChevronDown size={18} />
          <span className="text-xs font-medium">Back</span>
        </button>
        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/30">Now Playing</p>
        </div>
        <button
          onClick={() => toggleFavorite(currentSong.id)}
          className={`p-1.5 rounded-lg transition-all ${isFav ? 'text-red-400' : 'text-white/30 hover:text-white/70'}`}
        >
          <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Main content */}
      <div className="relative flex-1 flex gap-8 px-8 pb-4 overflow-hidden">

        {/* Left: Album art + controls */}
        <div className="flex flex-col items-center justify-center gap-6 w-72 shrink-0">

          {/* Album art — big, with glow */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSong.id}
              initial={{ scale: 0.88, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.88, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="relative"
            >
              {currentSong.coverArt ? (
                <img
                  src={currentSong.coverArt}
                  alt={currentSong.title}
                  className="w-64 h-64 rounded-3xl object-cover shadow-2xl"
                  style={{
                    boxShadow: isPlaying
                      ? '0 0 60px var(--color-dynamic-3), 0 24px 60px rgba(0,0,0,0.6)'
                      : '0 24px 60px rgba(0,0,0,0.6)',
                    transition: 'box-shadow 1.2s ease',
                  }}
                />
              ) : (
                <div
                  className="w-64 h-64 rounded-3xl bg-[var(--color-glass-mid)] border border-[var(--color-border)] flex items-center justify-center shadow-2xl"
                >
                  <Music2 size={64} className="text-white/10" />
                </div>
              )}

              {/* Spin ring when playing */}
              {isPlaying && (
                <motion.div
                  className="absolute inset-[-6px] rounded-[calc(1.5rem+6px)] border-2 border-dashed"
                  style={{ borderColor: 'var(--color-dynamic-1)', opacity: 0.25 }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Song info */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSong.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-center w-full"
            >
              <p className="text-lg font-semibold text-white/90 truncate">{currentSong.title}</p>
              <p className="text-sm text-white/40 mt-1 truncate">{currentSong.artist}</p>
              {currentSong.album && (
                <p className="text-xs text-white/20 mt-0.5 truncate">{currentSong.album}</p>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Seek bar */}
          <div className="w-full space-y-1.5">
            <div
              className="relative w-full h-1.5 rounded-full bg-white/10 cursor-pointer group"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                seekTo((e.clientX - rect.left) / rect.width)
              }}
            >
              <div
                className="absolute top-0 left-0 h-full rounded-full transition-all"
                style={{
                  width: `${progress * 100}%`,
                  background: 'linear-gradient(90deg, var(--color-dynamic-1), var(--color-dynamic-2))',
                }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1/2"
                style={{ left: `${progress * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-white/25 tabular-nums">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-3">
            <NpBtn active={shuffle} onClick={toggleShuffle}><Shuffle size={15} /></NpBtn>
            <NpBtn onClick={prevSong}><SkipBack size={20} /></NpBtn>

            <motion.button
              onClick={togglePlay}
              whileTap={{ scale: 0.92 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white bg-[var(--color-glass-strong)] border border-[var(--color-border-mid)] hover:bg-white/15 transition-all shadow-xl"
              style={{ boxShadow: isPlaying ? '0 0 32px var(--color-dynamic-3)' : undefined }}
            >
              <AnimatePresence mode="wait">
                {isPlaying
                  ? <motion.div key="p" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Pause size={22} fill="currentColor" /></motion.div>
                  : <motion.div key="pl" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Play size={22} fill="currentColor" className="ml-0.5" /></motion.div>
                }
              </AnimatePresence>
            </motion.button>

            <NpBtn onClick={nextSong}><SkipForward size={20} /></NpBtn>
            <NpBtn active={repeat !== 'none'} onClick={cycleRepeat}>
              {repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
            </NpBtn>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-3 w-full">
            <span className="text-[11px] text-white/20">Vol</span>
            <Slider.Root
              value={[volume]} min={0} max={1} step={0.01}
              onValueChange={([v]) => setVolume(v)}
              className="relative flex items-center flex-1 h-5 cursor-pointer"
            >
              <Slider.Track className="relative h-[3px] flex-1 rounded-full bg-white/10">
                <Slider.Range
                  className="absolute h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, var(--color-dynamic-1), var(--color-dynamic-2))' }}
                />
              </Slider.Track>
              <Slider.Thumb className="block w-3 h-3 rounded-full bg-white shadow outline-none hover:scale-125 transition-transform" />
            </Slider.Root>
            <span className="text-[11px] text-white/20 w-8 text-right">{Math.round(volume * 100)}</span>
          </div>
        </div>

        {/* Right: Lyrics + Queue */}
        <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-hidden">

          {/* Lyrics panel */}
          <div className="flex-1 flex flex-col bg-[var(--color-glass)] border border-[var(--color-border)] rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--color-border)] shrink-0">
              <Mic2 size={13} style={{ color: 'var(--color-dynamic-1)' }} />
              <span className="text-xs font-semibold text-white/50 tracking-wide">Lyrics</span>
              {loading && (
                <div className="flex gap-0.5 ml-2 items-end h-3">
                  {[0, 1, 2].map((i) => (
                    <motion.div key={i} className="w-0.5 rounded-full"
                      style={{ background: 'var(--color-dynamic-1)' }}
                      animate={{ height: ['3px', '10px', '3px'] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div ref={lyricsRef} className="flex-1 overflow-y-auto py-6 px-5 space-y-2">
                  {!loading && !hasLyrics && (
                    <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
                    <Mic2 size={28} className="text-white/40" />
                    <p className="text-xs text-white/40">No lyrics found</p>
                  </div>
                )}

              {lines.map((line, i) => (
                <div key={i} ref={i === activeIdx ? activeLineRef : null}>
                  <motion.p
                    animate={{
                      color: i === activeIdx ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.20)',
                      scale: i === activeIdx ? 1.03 : 1,
                    }}
                    transition={{ duration: 0.3 }}
                    className="text-base leading-relaxed text-center cursor-default"
                    style={{ fontWeight: i === activeIdx ? 600 : 400 }}
                  >
                    {line.text || '·'}
                  </motion.p>
                </div>
              ))}

              {plain && lines.length === 0 && (
                <pre className="text-sm text-white/30 leading-7 whitespace-pre-wrap font-sans text-center">
                  {plain}
                </pre>
              )}
            </div>
          </div>

          {/* Queue */}
          <div className="h-52 flex flex-col bg-[var(--color-glass)] border border-[var(--color-border)] rounded-2xl overflow-hidden shrink-0">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--color-border)] shrink-0">
              <ListMusic size={13} style={{ color: 'var(--color-dynamic-1)' }} />
              <span className="text-xs font-semibold text-white/50 tracking-wide">Queue</span>
              <span className="text-xs text-white/20 ml-auto">{queue.length} songs</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {queue.map((song, i) => {
                const isActive = i === queueIndex
                return (
                  <div
                    key={`${song.id}-${i}`}
                    className={`flex items-center gap-3 px-4 py-1.5 cursor-pointer transition-all ${isActive ? 'bg-white/5' : 'hover:bg-white/[0.03]'}`}
                    onDoubleClick={() => usePlayerStore.getState().playSong(song, queue)}
                  >
                    {song.coverArt
                      ? <img src={song.coverArt} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
                      : <div className="w-7 h-7 rounded-md bg-[var(--color-glass-mid)] shrink-0 flex items-center justify-center"><Music2 size={10} className="text-white/20" /></div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" style={{ color: isActive ? 'var(--color-dynamic-1)' : 'rgba(255,255,255,0.70)', fontWeight: isActive ? 500 : 400 }}>
                        {song.title}
                      </p>
                      <p className="text-[10px] text-white/25 truncate">{song.artist}</p>
                    </div>
                    {isActive && (
                      <div className="flex items-end gap-0.5 h-3 shrink-0">
                        {[0, 1, 2].map((j) => (
                          <motion.div key={j} className="w-0.5 rounded-full"
                            style={{ background: 'var(--color-dynamic-1)' }}
                            animate={{ height: ['3px', '10px', '3px'] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: j * 0.18 }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function NpBtn({ children, onClick, active }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`p-2.5 rounded-xl transition-all duration-150 ${active ? 'bg-[var(--color-glass-mid)]' : 'text-white/30 hover:text-white/70 hover:bg-white/5'}`}
      style={active ? { color: 'var(--color-dynamic-1)' } : undefined}
    >
      {children}
    </button>
  )
}
