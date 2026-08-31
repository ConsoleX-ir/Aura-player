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
import { Toaster } from '@/components/Toast/Toaster'
import { HelpModal } from '@/components/Modals/HelpModal'
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

export default function App() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const activeView  = usePlayerStore((s) => s.activeView)
  const theme = usePlayerStore((s) => s.theme)
  const customAccentColor = usePlayerStore((s) => s.customAccentColor)
  const performanceMode = usePlayerStore((s) => s.performanceMode)

  // Mount audio engine once — never unmounts
  useAudio()

  const isNowPlaying = activeView === 'nowplaying'
  const isPlaylistView = activeView === 'playlist'

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
  const { isDraggingFiles, dragHandlers } = useDragDropImport()

  useEffect(() => {
    document.documentElement.setAttribute('data-performance', performanceMode ? 'on' : 'off')
  }, [performanceMode])


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
              style={{ borderColor: 'var(--color-dynamic-1)', background: 'var(--color-chrome)' }}
            >
              <UploadCloud size={32} style={{ color: 'var(--color-dynamic-1)' }} />
              <p className="text-sm font-medium text-white/90">Drop to import</p>
              <p className="text-xs text-white/40">Audio files or folders</p>
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
          {!isNowPlaying && (
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

      <PlayerBar />

      {/* Global overlays — feedback toasts + the keyboard shortcuts guide.
          Rendered last so they layer above every view and the player bar. */}
      <Toaster />
      <HelpModal />
    </div>
  )
}

// Chunk loads happen from local disk in Electron, so this is only ever
// visible for a frame or two on someone's very first visit to a given
// page in a session — subsequent visits hit the module cache and this
// never shows at all. Deliberately minimal rather than a full loading screen.
function PageLoadingFallback() {
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-white/20" />
    </div>
  )
}
