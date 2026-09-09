import { useEffect, useMemo, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { PlayerBar } from '@/components/Player/PlayerBar'
import { Library } from '@/pages/Library'
import { TitleBar } from '@/components/TitleBar'
import { useDynamicTheme } from '@/hooks/useDynamicTheme'
import { useAudio } from '@/hooks/useAudio'
import { usePlayerStore } from '@/store/playerStore'
import { useMediaShortcuts } from '@/hooks/useMediaShortcuts'
import { useFileAssociationLaunch } from '@/hooks/useFileAssociationLaunch'
import { useSleepTimer } from '@/hooks/useSleepTimer'
import { useMediaKeys } from '@/hooks/useMediaKeys'
import { useDragDropImport } from '@/hooks/useDragDropImport'
import { useStoreHydration } from '@/hooks/useStoreHydration'
import { Toaster } from '@/components/Toast/Toaster'
import { HelpModal } from '@/components/Modals/HelpModal'
import { CommandPalette } from '@/components/CommandPalette'
import { MiniPlayer } from '@/components/Player/MiniPlayer'
import { useFolderWatcher } from '@/hooks/useFolderWatcher'
import { useUiStore } from '@/store/uiStore'
import { UploadCloud, Loader2 } from 'lucide-react'

// Library is what's shown on launch almost every time, so it stays a normal
// eager import. The other three pages — and everything they pull in (Radix
// dropdown menus, the color picker, etc.) — are only ever needed once the
// user actually navigates there, so splitting them into separate chunks
// means the startup bundle has meaningfully less JS to parse and execute
// before the app can render anything at all.
const PlaylistPage = lazy(() => import('@/pages/Playlist').then((m) => ({ default: m.PlaylistPage })))
const NowPlaying = lazy(() => import('@/pages/NowPlaying').then((m) => ({ default: m.NowPlaying })))
const Settings = lazy(() => import('@/pages/Settings').then((m) => ({ default: m.Settings })))
const PropertiesPage = lazy(() => import('@/pages/PropertiesPage').then((m) => ({ default: m.PropertiesPage })))
const RewindPage = lazy(() => import('@/pages/RewindPage').then((m) => ({ default: m.default })))

export default function App() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const activeView  = usePlayerStore((s) => s.activeView)
  const theme = usePlayerStore((s) => s.theme)
  const customAccentColor = usePlayerStore((s) => s.customAccentColor)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const appearance = usePlayerStore((s) => s.appearance)
  const miniPlayer = useUiStore((s) => s.miniPlayer)

  // Mount audio engine once — never unmounts
  useAudio()

  const isNowPlaying = activeView === 'nowplaying'
  const isPlaylistView = activeView === 'playlist'
  const isPropertiesView = activeView === 'properties'
  const isRewindView = activeView === 'rewind'

  // Playlist view: derive the playlist's cover the same way the playlist hero
  // does — the first song in the playlist that has embedded artwork — so the
  // ambient glow can take its color from the playlist's own image. Any other
  // view: null, and the theme color is used as before.
  const playlists = usePlayerStore((s) => s.playlists)
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId)
  const library = usePlayerStore((s) => s.library)
  const playlistCover = useMemo(() => {
    if (!isPlaylistView) return null
    const pl = playlists.find((p) => p.id === selectedPlaylistId)
    for (const id of pl?.songIds ?? []) {
      const song = library.find((s) => s.id === id)
      if (song?.coverArt) return song.coverArt
    }
    return null
  }, [isPlaylistView, playlists, selectedPlaylistId, library])

  // Shift CSS color vars:
  // → Now Playing view, with a song loaded: pull the ambient color from that
  //   song's actual album art — an immersive, per-song effect.
  // → Playlist view, with cover art available: pull the ambient color from
  //   the playlist's cover image, so the background glow extends from the
  //   playlist art. Playlists without any artwork stay on the theme color.
  // → everywhere else: stick to the chosen theme's color (ConsoleX cloud
  //   gray, Forest green, Custom, ...), even while music is playing.
  const ambientCover = isNowPlaying ? currentSong?.coverArt ?? null : playlistCover
  useDynamicTheme(ambientCover, theme, customAccentColor, isNowPlaying || !!playlistCover)

  useMediaShortcuts()
  useFileAssociationLaunch()
  useSleepTimer()
  useMediaKeys()
  useFolderWatcher()
  const { isDraggingFiles, dragHandlers } = useDragDropImport()

  // Hold the shell on the boot screen until the persisted store (IndexedDB,
  // async since Wave 1) has rehydrated — otherwise the Library flashes its
  // empty state for a frame on every cold start.
  const hydrated = useStoreHydration()

  useEffect(() => {
    document.documentElement.setAttribute('data-performance', performanceMode ? 'on' : 'off')
  }, [performanceMode])

  // ── Appearance (v2.0.0) ─────────────────────────────────────────────────
  // data-theme drives the whole token layer, so switching is one attribute.
  // The visual cross-fade: .theme-anim is applied for the transition window
  // (see setAppearance below / index.css) so colors glide instead of snap.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', appearance)
  }, [appearance])

  if (!hydrated) return <BootScreen />

  return (
    <div
      className="dynamic-bg flex flex-col h-screen overflow-hidden select-none relative"
      {...dragHandlers}
    >
      <AnimatePresence>
        {isDraggingFiles && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[300] flex items-center justify-center pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center gap-3 px-12 py-10 rounded-3xl border-2 border-dashed"
              style={{ borderColor: 'var(--accent)', background: 'var(--surface-chrome)' }}
            >
              <UploadCloud size={32} style={{ color: 'var(--accent)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Drop to import</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Audio files or folders</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <TitleBar />

      <div
        className="flex flex-1 overflow-hidden"
        style={{ paddingBottom: 'var(--spacing-player)' }}
      >
        {/* Sidebar hidden in Now Playing view */}
        <AnimatePresence>
          {!isNowPlaying && !isPropertiesView && !isRewindView && (
            <motion.div
              key="sidebar"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 flex"
            >
              <Sidebar />
            </motion.div>
          )}
        </AnimatePresence>

        <main className="flex-1 overflow-hidden">
          <Suspense fallback={<PageLoadingFallback />}>
          <AnimatePresence mode="wait">
            {isNowPlaying ? (
              <motion.div
                key="nowplaying"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="h-full overflow-hidden"
              >
                <NowPlaying />
              </motion.div>
            ) : activeView === 'playlist' ? (
              <motion.div
                key="playlist"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
                className="h-full overflow-y-auto"
              >
                <PlaylistPage />
              </motion.div>
            ) : activeView === 'settings' ? (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
                className="h-full overflow-hidden"
              >
                <Settings />
              </motion.div>
            ) : isPropertiesView ? (
              <motion.div
                key="properties"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.2 }}
                className="h-full overflow-hidden"
              >
                <PropertiesPage />
              </motion.div>
            ) : isRewindView ? (
              <motion.div
                key="rewind"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.22 }}
                className="h-full overflow-hidden"
              >
                <RewindPage />
              </motion.div>
            ) : (
              <motion.div
                key="library"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
                className="h-full overflow-y-auto"
              >
                <Library />
              </motion.div>
            )}
          </AnimatePresence>
          </Suspense>
        </main>
      </div>

      {/* Player: pill bar or mini-player — the two never show together, and
          the crossfade keeps the handoff continuous. Panels (lyrics/queue/
          visualizer) stay mounted with the pill they anchor to. */}
      <AnimatePresence mode="wait">
        {miniPlayer
          ? <MiniPlayer key="mini" />
          : <PlayerBar key="pill" />}
      </AnimatePresence>
      {!miniPlayer && <PlayerBarPanels />}

      {/* Global overlays — feedback toasts, the keyboard shortcuts guide,
          and the Ctrl+K command palette. Rendered last so they layer above
          every view and the player bar. */}
      <Toaster />
      <HelpModal />
      <CommandPalette />
    </div>
  )
}

// Player-bar flyout panels, lifted here so they mount/unmount from the
// single uiStore.openPanel source (shortcuts + palette + pill all agree).
// Lives in its own tiny component so App doesn't re-render on panel toggles.
import { LyricsPanel } from '@/components/Player/LyricsPanel'
import { VisualizerPanel } from '@/components/Player/VisualizerPanel'
import { QueuePanel } from '@/components/Player/QueuePanel'
function PlayerBarPanels() {
  const openPanel = useUiStore((s) => s.openPanel)
  const panelAnchorX = useUiStore((s) => s.panelAnchorX)
  const setOpenPanel = useUiStore((s) => s.setOpenPanel)

  return (
    <AnimatePresence>
      {openPanel === 'lyrics' && <LyricsPanel key="lyrics" anchorX={panelAnchorX} onClose={() => setOpenPanel(null)} />}
      {openPanel === 'visualizer' && <VisualizerPanel key="vis" anchorX={panelAnchorX} onClose={() => setOpenPanel(null)} />}
      {openPanel === 'queue' && <QueuePanel key="queue" anchorX={panelAnchorX} onClose={() => setOpenPanel(null)} />}
    </AnimatePresence>
  )
}

// Chunk loads happen from local disk in Electron, so this is only ever
// visible for a frame or two on someone's very first visit to a given
// page in a session — subsequent visits hit the module cache and this
// never shows at all. Deliberately minimal rather than a full loading screen.
function PageLoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--text-faint)' }} />
    </div>
  )
}

// Boot screen — shown only while the persisted store rehydrates from
// IndexedDB on cold start (a few ms, longer on cold caches). The brand
// glyph breathes once or twice; on fast boots most users never see it.
// Deliberately NOT a skeleton: skeletons imply known layout, and we don't
// yet know which view the user will land in.
function BootScreen() {
  return (
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--surface-base)' }}>
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center animate-breathe"
          style={{
            background: 'var(--glass-2)',
            border: '1px solid var(--border-strong)',
            boxShadow: '0 0 48px var(--accent-whisper)',
          }}
        >
          <div className="flex items-end gap-[2px] h-5">
            {[2, 3, 4, 3, 2].map((h, i) => (
              <div key={i} className="w-[2.5px] rounded-full" style={{ height: h * 5, background: 'var(--accent)', opacity: 0.85 }} />
            ))}
          </div>
        </div>
        <span
          className="text-[10px] font-semibold uppercase"
          style={{ color: 'var(--text-faint)', letterSpacing: '0.3em' }}
        >
          Aura
        </span>
      </div>
    </div>
  )
}
