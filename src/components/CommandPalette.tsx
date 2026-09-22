import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Music2, Heart, Settings as SettingsIcon, ListMusic, Play, Pause, SkipForward, SkipBack,
  Shuffle, Repeat, Volume2, VolumeX, Mic2, BarChart2, PictureInPicture2, History,
  Gauge, SunMoon, Search, CornerDownLeft, Disc3, Radio, Clock,
} from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { startSmartRadio } from '@/lib/smartRadioActions'
import { usePlayerStore } from '@/store/playerStore'
import { setAppearanceAnimated } from '@/lib/appearance'
import { fuzzyScore, searchLibrary } from '@/lib/search'
import { cn } from '@/lib/utils'

// ── Command Palette (Wave 4, Phase 2 refresh) ───────────────────────────────
// One surface that can drive the whole app: navigation, playback, queue and
// panel toggles, settings switches, and a live library search that plays what
// you find. Opened with Ctrl+K (⌘K) from anywhere — including inside text
// inputs, which is what makes it feel native.
//
// Implementation notes:
//   • Zero new dependencies. The fuzzy scorer and the library search engine
//     live in lib/search (Phase 2 — shared with the Library view: one parser,
//     one matcher, one scorer, so search behaves identically everywhere).
//     Song results understand the Library's field operators, exact-miss
//     queries fall back to the same fuzzy close-matches (shown as a
//     "Close Matches" group), and a "Search library for …" row hands the
//     query to the Library view prefilled — navigation, not a dead end.
//   • Results are grouped but navigated FLAT (↑/↓ walks one combined list,
//     group headers are skipped) — the behavior every palette trains into
//     users. Active item scrolls into view, Enter runs it, Esc backs out.
//   • The palette never duplicates app state: every action funnels into the
//     existing stores/actions, exactly like pressing the equivalent button.
//   • ALL interactive state (query/active) lives in PalettePanel, which mounts
//     FRESH on every open — an open→close→open cycle can never inherit stale
//     text or selection, no matter how fast the user (or a test) moves.

interface Command {
  id: string
  group: string
  label: string
  hint?: string
  icon: typeof Music2
  keywords?: string
  run: () => void
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen)
  const setOpen = useUiStore((s) => s.setCommandOpen)

  // Close = blur FIRST, then flip state. If the input stayed focused through
  // the exit animation, every later keypress would target a dead <input> and
  // get swallowed by the app's input-guards — the palette would "haunt" the
  // keyboard. Blur hands focus back to <body> immediately.
  const close = () => {
    document.activeElement instanceof HTMLElement && document.activeElement.blur()
    setOpen(false)
  }

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[210]"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(3px)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={close}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            className="fixed inset-0 z-[220] flex items-start justify-center pt-[14vh] px-4 pointer-events-none"
            initial={{ opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <PalettePanel onClose={close} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ── Panel body — mounted fresh on every open ─────────────────────────────────
function PalettePanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Focus synchronously — the input is inline (no portal), so it exists by
  // the time this effect runs. A rAF fallback covers exotic re-mount timing.
  // Escape is handled at WINDOW level while open: whatever holds focus,
  // Esc always backs out — the contract every native palette honors.
  useEffect(() => {
    inputRef.current?.focus()
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    const onWinKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onWinKey)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onWinKey)
    }
  }, [onClose])

  const playSong = (songId: string) => {
    const s = usePlayerStore.getState()
    const song = s.library.find((x) => x.id === songId)
    if (song) s.playSong(song, s.library)
  }

  // ── The command set (built fresh per mount; cheap — static shape) ─────────
  const commands = useMemo<Command[]>(() => {
    const s = usePlayerStore.getState()
    const ui = useUiStore.getState()

    const nav: Command[] = [
      { id: 'nav.library', group: 'Navigate', label: 'Go to Library', icon: Music2, run: () => s.setActiveView('library') },
      { id: 'nav.favorites', group: 'Navigate', label: 'Go to Favorites', icon: Heart, run: () => s.setActiveView('favorites') },
      { id: 'nav.nowplaying', group: 'Navigate', label: 'Go to Now Playing', icon: Disc3, run: () => { if (s.currentSong) s.setActiveView('nowplaying') } },
      { id: 'nav.rewind', group: 'Navigate', label: 'Open Aura Rewind', hint: 'listening story', icon: History, run: () => s.setActiveView('rewind') },
      { id: 'nav.explore', group: 'Navigate', label: 'Go to Explore', hint: 'online music', icon: Search, run: () => s.setActiveView('explore') },
      { id: 'nav.smart', group: 'Navigate', label: 'Open Smart Playlists', hint: 'on-device picks', icon: Radio, run: () => s.setActiveView('smart') },
      { id: 'nav.history', group: 'Navigate', label: 'Open Listening History', hint: 'everything you played', icon: Clock, run: () => s.setActiveView('history') },
      { id: 'nav.settings', group: 'Navigate', label: 'Go to Settings', icon: SettingsIcon, run: () => s.setActiveView('settings') },
      ...s.playlists.map<Command>((pl) => ({
        id: `nav.pl.${pl.id}`, group: 'Navigate', label: `Open playlist — ${pl.name}`,
        hint: `${pl.songIds.length}`, icon: ListMusic, run: () => {
          usePlayerStore.getState().setSelectedPlaylistId(pl.id)
          usePlayerStore.getState().setActiveView('playlist')
        },
      })),
    ]

    const playback: Command[] = [
      { id: 'pb.toggle', group: 'Playback', label: s.isPlaying ? 'Pause' : 'Play', hint: 'Space', icon: s.isPlaying ? Pause : Play, keywords: 'play pause toggle', run: () => usePlayerStore.getState().togglePlay() },
      { id: 'pb.next', group: 'Playback', label: 'Next song', hint: '→', icon: SkipForward, run: () => { usePlayerStore.getState().nextSong(); } },
      { id: 'pb.prev', group: 'Playback', label: 'Previous song', hint: '←', icon: SkipBack, run: () => usePlayerStore.getState().prevSong() },
      { id: 'pb.shuffle', group: 'Playback', label: s.shuffle ? 'Shuffle — turn off' : 'Shuffle — turn on', hint: 'S', icon: Shuffle, keywords: 'shuffle random', run: () => usePlayerStore.getState().toggleShuffle() },
      { id: 'pb.repeat', group: 'Playback', label: `Repeat — cycle (now: ${s.repeat})`, hint: 'R', icon: Repeat, keywords: 'repeat loop', run: () => usePlayerStore.getState().cycleRepeat() },
      { id: 'pb.mute', group: 'Playback', label: s.muted ? 'Unmute' : 'Mute', hint: 'M', icon: s.muted ? Volume2 : VolumeX, keywords: 'mute sound volume', run: () => usePlayerStore.getState().toggleMute() },
      // Phase 7 — Smart Music Engine surfaces.
      { id: 'pb.smartmix', group: 'Playback', label: 'Play something for me', hint: 'smart mix', icon: Radio, keywords: 'smart radio mix recommend discover', run: () => { void startSmartRadio(null) } },
      ...(s.currentSong && !s.currentSong.source
        ? [{ id: 'pb.smartradio', group: 'Playback', label: `Start Radio from “${s.currentSong.title}”`, hint: 'smart radio', icon: Radio, keywords: 'smart radio seed similar', run: () => { void startSmartRadio(s.currentSong!) } }]
        : []),
    ]

    const panels: Command[] = [
      { id: 'pn.queue', group: 'Panels', label: 'Toggle Queue panel', hint: 'Q', icon: ListMusic, run: () => ui.togglePanel('queue') },
      { id: 'pn.lyrics', group: 'Panels', label: 'Toggle Lyrics panel', icon: Mic2, run: () => ui.togglePanel('lyrics') },
      { id: 'pn.visualizer', group: 'Panels', label: 'Toggle Visualizer panel', icon: BarChart2, run: () => ui.togglePanel('visualizer') },
    ]

    const toggles: Command[] = [
      { id: 'tg.mini', group: 'System', label: ui.miniPlayer ? 'Leave mini-player' : 'Switch to mini-player', hint: 'P', icon: PictureInPicture2, run: () => ui.setMiniPlayer(!ui.miniPlayer) },
      { id: 'tg.perf', group: 'System', label: s.performanceMode ? 'Performance Mode — turn off' : 'Performance Mode — turn on', icon: Gauge, run: () => usePlayerStore.getState().setPerformanceMode(!s.performanceMode) },
      { id: 'tg.theme', group: 'System', label: s.appearance === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: SunMoon, keywords: 'theme light dark appearance', run: () => setAppearanceAnimated(s.appearance === 'dark' ? 'light' : 'dark') },
    ]

    return [...nav, ...playback, ...panels, ...toggles]
  }, [])

  // Library song results — the SHARED search engine (operators + fuzzy
  // fallback), capped, fuzzy hits labeled as their own group.
  const songResults = useMemo(() => {
    if (query.trim().length < 1) return []
    const s = usePlayerStore.getState()
    const { matches, fuzzy } = searchLibrary(s.library, query, 8)
    return matches.slice(0, 8).map<Command>((song) => ({
      id: `song.${song.id}`,
      group: fuzzy ? 'Close Matches' : 'Songs',
      label: song.title,
      hint: song.artist, icon: Play, keywords: song.album,
      run: () => playSong(song.id),
    }))
  }, [query])

  // Phase 2: hand the query off to the Library — prefilled search + jump.
  // Always offered last (keyboard: keep ArrowDown-ing to reach it).
  const searchInLibrary = useMemo<Command[]>(() => {
    const q = query.trim()
    if (!q) return []
    return [{
      id: 'nav.search-library', group: 'Search', label: `Search library for “${q}”`,
      hint: 'open in Library', icon: Search, keywords: 'find filter open',
      run: () => {
        useUiStore.getState().setLibrarySearch(q)
        usePlayerStore.getState().setActiveView('library')
      },
    }]
  }, [query])

  const staticResults = useMemo(() => {
    if (!query.trim()) {
      // Empty query: show everything except songs (a wall of 5k rows helps
      // nobody) — navigation first, which is the 90% case for "just opened".
      return commands
    }
    return commands
      .map((c) => ({ c, score: Math.max(fuzzyScore(query, c.label), fuzzyScore(query, c.keywords ?? '') * 0.5) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.c)
  }, [commands, query])

  const results = useMemo(
    () => [...staticResults, ...songResults, ...searchInLibrary],
    [staticResults, songResults, searchInLibrary],
  )

  // Keep the active index inside bounds as the result set shrinks/grows.
  useEffect(() => { setActive((a) => Math.min(a, Math.max(results.length - 1, 0))) }, [results.length])

  const runCommand = (c: Command | undefined) => {
    // Enter on an empty result set must still back out — stranding the user
    // in the palette with a dead Enter is how the keyboard "breaks".
    onClose()
    if (!c) return
    // Run after close so view transitions start from a settled UI.
    requestAnimationFrame(() => c.run())
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runCommand(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // Active row follows the keyboard — the DOM's scrollIntoView (block:'nearest')
  // does the right thing in both directions without custom math.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  // Group headers, rendered only above the first item of each group.
  const visibleRows = useMemo(() => {
    let lastGroup = ''
    return results.map((c, i) => ({ c, i, showHeader: c.group !== lastGroup ? (lastGroup = c.group, true) : false }))
  }, [results])

  return (
    <div
      className="perf-blur pointer-events-auto w-full max-w-xl rounded-2xl overflow-hidden"
      style={{
        background: 'var(--surface-chrome)',
        border: '1px solid var(--border-strong)',
        boxShadow: 'var(--shadow-overlay), 0 0 80px var(--accent-whisper)',
        backdropFilter: 'blur(var(--blur-chrome))',
      }}
      onKeyDown={onKeyDown}
      data-command-panel
    >
      {/* Input row */}
      <div className="flex items-center gap-3 px-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <Search size={15} style={{ color: 'var(--text-faint)' }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          placeholder="Search songs or type a command…"
          aria-label="Command palette"
          className="flex-1 py-3.5 bg-transparent outline-none text-sm"
          style={{ color: 'var(--text-primary)' }}
          spellCheck={false}
        />
        <kbd
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums"
          style={{ background: 'var(--glass-2)', color: 'var(--text-faint)', border: '1px solid var(--border-subtle)' }}
        >
          ESC
        </kbd>
      </div>

      {/* Results */}
      <div ref={listRef} className="max-h-[46vh] overflow-y-auto p-1.5" data-command-list>
        {results.length === 0 && (
          <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
            Nothing matches “{query}”
          </p>
        )}
        {visibleRows.map(({ c, i, showHeader }) => (
          <div key={c.id}>
            {showHeader && (
              <p
                className="px-3 pt-2.5 pb-1 text-[9.5px] font-semibold uppercase"
                style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
              >
                {c.group}
              </p>
            )}
            <button
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => runCommand(c)}
              className={cn('w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors')}
              style={{
                background: i === active ? 'var(--accent-dim)' : 'transparent',
                transitionDuration: 'var(--dur-instant)',
              }}
            >
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: i === active ? 'var(--accent-veil)' : 'var(--glass-1)',
                  color: i === active ? 'var(--accent)' : 'var(--text-tertiary)',
                }}
              >
                <c.icon size={13} />
              </span>
              <span
                className="flex-1 min-w-0 truncate text-[13px]"
                style={{ color: i === active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
              >
                {c.label}
              </span>
              {c.hint && (
                <span className="text-[11px] truncate max-w-[140px] shrink-0" style={{ color: 'var(--text-faint)' }}>
                  {c.hint}
                </span>
              )}
              {i === active && <CornerDownLeft size={12} style={{ color: 'var(--accent)' }} className="shrink-0" />}
            </button>
          </div>
        ))}
      </div>

      {/* Footer — hints, not decoration */}
      <div
        className="flex items-center gap-4 px-4 py-2 border-t"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-inset)' }}
      >
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>
          <kbd className="font-semibold">↑↓</kbd> navigate
        </span>
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-faint)' }}>
          <kbd className="font-semibold">↵</kbd> run
        </span>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-faint)' }}>
          Aura
        </span>
      </div>
    </div>
  )
}
