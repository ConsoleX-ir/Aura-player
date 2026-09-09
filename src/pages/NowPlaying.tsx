import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Heart, ListMusic, Music2, Mic2, Moon, X
} from 'lucide-react'
import * as Slider from '@radix-ui/react-slider'
import { usePlayerStore } from '@/store/playerStore'
import { useLyrics } from '@/hooks/useLyrics'
import { formatTime } from '@/lib/utils'

// ── Now Playing (Wave 3 redesign) ───────────────────────────────────────────
// The immersive view. Structure is the Wave-2-approved split — big glowing
// artwork + transport on the left, lyrics and the real play-order queue on
// the right — now fully on the design system: semantic tokens everywhere,
// display-font title, accent-edged queue rows, and a proper entrance
// choreography (staggered panels) that respects Performance Mode.
//
// Wave 1 engine contract kept intact: the queue panel renders the REAL
// playback order (the store's `queue` is what plays — shuffle physically
// reorders it), so what you see is what you hear.

export function NowPlaying() {
  // Narrow selectors. v2.1.0: the ~4-10Hz progress/duration tick subscriptions
  // moved OUT of this page into the two components that actually display
  // time — <NowPlayingSeek/> (bar + labels) and <NowPlayingLyrics/> (active
  // line highlight). The rest of this immersive view — artwork, transport,
  // volume, queue — now holds completely still while a track plays, instead
  // of re-rendering several times a second.
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const volume = usePlayerStore((s) => s.volume)
  const shuffle = usePlayerStore((s) => s.shuffle)
  const repeat = usePlayerStore((s) => s.repeat)
  const favorites = usePlayerStore((s) => s.favorites)
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const nextSong = usePlayerStore((s) => s.nextSong)
  const prevSong = usePlayerStore((s) => s.prevSong)
  const setVolume = usePlayerStore((s) => s.setVolume)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat)
  const sleepTimerEndsAt = usePlayerStore((s) => s.sleepTimerEndsAt)
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const queue = usePlayerStore((s) => s.queue)
  const queueIndex = usePlayerStore((s) => s.queueIndex)
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue)

  // v2 engine: `queue` in the store IS the real playback order (shuffle
  // physically reorders it), so the panel simply reads it in true play
  // order — the playing song leads, followed by what actually plays next,
  // wrapping past the queue's end back to the top.
  const upNextQueue = useMemo(() => {
    const idx = queueIndex >= 0 && queueIndex < queue.length ? queueIndex : 0
    return [...queue.slice(idx), ...queue.slice(0, idx)]
  }, [queue, queueIndex])

  const displayQueue = upNextQueue

  const { lines, plain, loading } = useLyrics(currentSong)
  const isFav = currentSong ? favorites.includes(currentSong.id) : false

  // Active lyric line index + auto-scroll now live inside <NowPlayingLyrics/>
  // (they tick with progress; this page doesn't need to know).

  if (!currentSong) return null

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
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1.1 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="absolute inset-0 w-full h-full object-cover blur-3xl"
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
          className="flex items-center gap-1.5 transition-colors active:scale-95"
          style={{ color: 'var(--text-tertiary)', transitionDuration: 'var(--dur-fast)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
        >
          <ChevronDown size={18} />
          <span className="text-xs font-medium">Back</span>
        </button>
        <div className="text-center">
          <p
            className="text-[10px] font-semibold uppercase"
            style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
          >
            Now Playing
          </p>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                title={sleepTimerEndsAt ? `Sleeps at ${new Date(sleepTimerEndsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Sleep Timer'}
                className="p-1.5 rounded-lg transition-all"
                style={{ color: sleepTimerEndsAt ? 'var(--accent)' : 'var(--text-tertiary)' }}
                onMouseEnter={(e) => { if (!sleepTimerEndsAt) e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={(e) => { if (!sleepTimerEndsAt) e.currentTarget.style.color = 'var(--text-tertiary)' }}
              >
                <Moon size={15} fill={sleepTimerEndsAt ? 'currentColor' : 'none'} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="min-w-44 p-1 rounded-xl text-sm"
                style={{
                  zIndex: 'var(--z-dropdown)',
                  background: 'var(--surface-chrome)',
                  border: '1px solid var(--border-strong)',
                  backdropFilter: 'blur(var(--blur-glass))',
                  boxShadow: 'var(--shadow-overlay)',
                }}
                sideOffset={6} align="end">
                {[15, 30, 45, 60].map((min) => (
                  <DropdownMenu.Item key={min} onClick={() => setSleepTimer(min)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
                    style={{ color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent' }}>
                    <Moon size={13} />
                    {min} minutes
                  </DropdownMenu.Item>
                ))}
                {sleepTimerEndsAt && (
                  <>
                    <DropdownMenu.Separator className="my-1" style={{ height: 1, background: 'var(--border-default)' }} />
                    <DropdownMenu.Item onClick={() => setSleepTimer(null)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent' }}>
                      Turn Off
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <button
            onClick={() => toggleFavorite(currentSong.id)}
            className="p-1.5 rounded-lg transition-all active:scale-90"
            style={{ color: isFav ? 'var(--favorite)' : 'var(--text-tertiary)', transitionDuration: 'var(--dur-fast)' }}
            onMouseEnter={(e) => { if (!isFav) e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { if (!isFav) e.currentTarget.style.color = 'var(--text-tertiary)' }}
            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={16} fill={isFav ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="relative flex-1 flex gap-8 px-8 pb-4 overflow-hidden">

        {/* Left: Album art + controls */}
        <div className="flex flex-col items-center justify-center gap-5 w-72 shrink-0">

          {/* Album art — big, with glow. Track-change morph: the old art
              springs out while the new one springs in, no crossfade mush. */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSong.id}
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: -6 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="relative"
            >
              {currentSong.coverArt ? (
                <img
                  src={currentSong.coverArt}
                  alt={currentSong.title}
                  className="w-64 h-64 rounded-3xl object-cover"
                  style={{
                    boxShadow: isPlaying
                      ? '0 0 64px var(--accent-veil), 0 24px 60px rgba(0,0,0,0.6)'
                      : '0 24px 60px rgba(0,0,0,0.6)',
                    transition: 'box-shadow 1.2s ease',
                  }}
                />
              ) : (
                <div
                  className="w-64 h-64 rounded-3xl flex items-center justify-center"
                  style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-3)' }}
                >
                  <Music2 size={64} className="text-ink-faint" />
                </div>
              )}

              {/* Spin ring when playing — the artwork "wears" the music */}
              {isPlaying && (
                <motion.div
                  className="absolute inset-[-6px] rounded-[calc(1.5rem+6px)] border-2 border-dashed"
                  style={{ borderColor: 'var(--accent)', opacity: 0.25 }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {/* Song info — display-font title, keyed morph per track */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentSong.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              className="text-center w-full"
            >
              <p
                className="text-xl font-semibold truncate"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
              >
                {currentSong.title}
              </p>
              <p className="text-sm mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>{currentSong.artist}</p>
              {currentSong.album && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{currentSong.album}</p>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Seek bar + time labels — own component (progress-tick isolated) */}
          <NowPlayingSeek />

          {/* Controls */}
          <div className="flex items-center gap-3">
            <NpBtn active={shuffle} onClick={toggleShuffle}><Shuffle size={15} /></NpBtn>
            <NpBtn onClick={prevSong}><SkipBack size={20} /></NpBtn>

            <motion.button
              onClick={togglePlay}
              whileTap={{ scale: 0.92 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all"
              style={{
                color: 'var(--text-primary)',
                background: 'var(--glass-3)',
                border: '1px solid var(--border-strong)',
                boxShadow: isPlaying ? '0 0 32px var(--accent-veil)' : undefined,
              }}
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
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>Vol</span>
            <Slider.Root
              value={[volume]} min={0} max={1} step={0.01}
              onValueChange={([v]) => setVolume(v)}
              className="relative flex items-center flex-1 h-5 cursor-pointer"
            >
              <Slider.Track className="relative h-[3px] flex-1 rounded-full" style={{ background: 'var(--glass-2)' }}>
                <Slider.Range
                  className="absolute h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))' }}
                />
              </Slider.Track>
              <Slider.Thumb className="block w-3 h-3 rounded-full bg-white shadow outline-none hover:scale-125 transition-transform" />
            </Slider.Root>
            <span className="text-[11px] w-8 text-right tabular-nums" style={{ color: 'var(--text-faint)' }}>{Math.round(volume * 100)}</span>
          </div>
        </div>

        {/* Right: Lyrics + Queue — staggered entrance, one-shot per view */}
        <motion.div
          className="flex-1 flex flex-col gap-4 min-w-0 overflow-hidden"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
        >
          {/* Lyrics panel */}
          <motion.div
            variants={panelVariants}
            className="flex-1 flex flex-col rounded-2xl overflow-hidden"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2 px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <Mic2 size={13} style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-secondary)' }}>Lyrics</span>
              {loading && (
                <div className="flex gap-0.5 ml-2 items-end h-3">
                  {[0, 1, 2].map((i) => (
                    <motion.div key={i} className="w-0.5 rounded-full"
                      style={{ background: 'var(--accent)' }}
                      animate={{ height: ['3px', '10px', '3px'] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto py-6 px-5 space-y-2">
              <NowPlayingLyrics lines={lines} plain={plain} />
            </div>
          </motion.div>

          {/* Queue — h-52 class is a Wave 1 test contract (queue rows are
              located via it), and the height is right anyway. */}
          <motion.div
            variants={panelVariants}
            className="h-52 flex flex-col rounded-2xl overflow-hidden shrink-0"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-2 px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <ListMusic size={13} style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-secondary)' }}>Queue</span>
              <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--text-faint)' }}>{queue.length} songs</span>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {displayQueue.map((song, i) => {
                const isActive = song.id === currentSong.id
                return (
                  <div
                    key={`${song.id}-${i}`}
                    className={`group relative flex items-center gap-3 px-4 py-1.5 cursor-pointer transition-all ${isActive ? '' : 'hover:bg-ink/300'}`}
                    style={{ background: isActive ? 'var(--surface-inset)' : undefined }}
                    onDoubleClick={() => usePlayerStore.getState().playSong(song, queue)}
                  >
                    {/* Active-row accent edge */}
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
                        style={{ background: 'var(--accent)' }}
                      />
                    )}
                    {song.coverArt
                      ? <img src={song.coverArt} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
                      : <div className="w-7 h-7 rounded-md shrink-0 flex items-center justify-center" style={{ background: 'var(--glass-2)' }}><Music2 size={10} style={{ color: 'var(--text-faint)' }} /></div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: isActive ? 500 : 400 }}>
                        {song.title}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>{song.artist}</p>
                    </div>
                    {!isActive && (
                      <button
                        onClick={(e) => { e.stopPropagation(); const realIdx = queue.findIndex(s => s.id === song.id); if (realIdx !== -1) removeFromQueue(realIdx) }}
                        title="Remove from queue"
                        className="p-1 rounded-md shrink-0 transition-colors opacity-0 group-hover:opacity-100 hover:bg-ink/5"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <X size={11} />
                      </button>
                    )}
                    {isActive && (
                      <div className="flex items-end gap-0.5 h-3 shrink-0">
                        {[0, 1, 2].map((j) => (
                          <motion.div key={j} className="w-0.5 rounded-full"
                            style={{ background: 'var(--accent)' }}
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
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  )
}

// One-shot entrance for the right-hand panels (staggered by the parent).
const panelVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] as const } },
}

// ── NowPlayingSeek (v2.1.0) ─────────────────────────────────────────────────
// The wide seek bar + flanking time labels, extracted from the page so the
// ~4-10Hz progress tick re-renders this subtree alone. Drag state lives here
// (ref-backed so mouseup never reads a stale position); the visual contract
// of the old inline bar is preserved exactly.
function NowPlayingSeek() {
  const progress = usePlayerStore((s) => s.progress)
  const duration = usePlayerStore((s) => s.duration)
  const seekTo = usePlayerStore((s) => s.seekTo)
  const barRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [dragVal, setDragVal] = useState(0)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const el = barRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const val = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
      dragRef.current = val
      setDragVal(val)
    }
    const onUp = () => {
      seekTo(dragRef.current)
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragging, seekTo])

  const shown = dragging ? dragVal : progress

  return (
    <div className="w-full space-y-1.5">
      <div
        ref={barRef}
        className="relative w-full h-1.5 rounded-full cursor-pointer group"
        style={{ background: 'var(--glass-2)' }}
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const val = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
          dragRef.current = val
          setDragVal(val)
          setDragging(true)
          e.preventDefault()
        }}
        onClick={(e) => {
          if (dragging) return
          const rect = e.currentTarget.getBoundingClientRect()
          seekTo((e.clientX - rect.left) / rect.width)
        }}
      >
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{
            width: `${shown * 100}%`,
            background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))',
            transition: dragging ? 'none' : 'width 0.15s linear',
          }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1/2"
          style={{ left: `${shown * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
        <span>{formatTime(shown * duration)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

// ── NowPlayingLyrics (v2.1.0) ───────────────────────────────────────────────
// Lyric lines + the active-line highlight, extracted from the page for the
// same reason as the seek bar: only this subtree needs to know the playback
// clock. `lines`/`plain` arrive as props (they change per song, not per
// tick); the active-line index is derived from the live progress here.
function NowPlayingLyrics({ lines, plain }: {
  lines: { time: number; text: string }[]
  plain: string | null
}) {
  const progress = usePlayerStore((s) => s.progress)
  const duration = usePlayerStore((s) => s.duration)
  const activeLineRef = useRef<HTMLDivElement>(null)

  const activeIdx = lines.reduce((best, line, i) => progress * duration >= line.time ? i : best, -1)

  // Auto-scroll lyrics to active line
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeIdx])

  return (
    <>
      {lines.length === 0 && !plain && (
        <div className="flex flex-col items-center justify-center h-full gap-3 opacity-30">
          <Mic2 size={28} className="text-ink-ter" />
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No lyrics found</p>
        </div>
      )}

      {lines.map((line, i) => (
        <div key={i} ref={i === activeIdx ? activeLineRef : null}>
          <motion.p
            animate={{
              color: i === activeIdx ? 'var(--text-primary)' : 'var(--text-faint)',
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
        <pre className="text-sm leading-7 whitespace-pre-wrap font-sans text-center" style={{ color: 'var(--text-tertiary)' }}>
          {plain}
        </pre>
      )}
    </>
  )
}

function NpBtn({ children, onClick, active }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="p-2.5 rounded-xl transition-all duration-150 active:scale-90"
      style={active
        ? { background: 'var(--glass-2)', color: 'var(--accent)' }
        : { color: 'var(--text-tertiary)' }
      }
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-1)' } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent' } }}
    >
      {children}
    </button>
  )
}
