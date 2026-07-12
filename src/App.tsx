import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from '@/components/Sidebar/Sidebar'
import { PlayerBar } from '@/components/Player/PlayerBar'
import { Library } from '@/pages/Library'
import { PlaylistPage } from '@/pages/Playlist'
import { NowPlaying } from '@/pages/NowPlaying'
import { Settings } from '@/pages/Settings'
import { TitleBar } from '@/components/TitleBar'
import { useDynamicTheme } from '@/hooks/useDynamicTheme'
import { useAudio } from '@/hooks/useAudio'
import { usePlayerStore } from '@/store/playerStore'
import { useMediaShortcuts } from '@/hooks/useMediaShortcuts'
import { useFileAssociationLaunch } from '@/hooks/useFileAssociationLaunch'

export default function App() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const activeView  = usePlayerStore((s) => s.activeView)
  const theme = usePlayerStore((s) => s.theme)
  const customAccentColor = usePlayerStore((s) => s.customAccentColor)
  const performanceMode = usePlayerStore((s) => s.performanceMode)

  // Mount audio engine once — never unmounts
  useAudio()

  // Shift CSS color vars when song changes:
  // → has cover art: use its dominant color
  // → no cover art: idle ambient color for the current theme preset
  //   (ConsoleX cloud gray, Forest green) — unless a custom accent is set
  useDynamicTheme(currentSong?.coverArt ?? null, theme, customAccentColor)

  const isNowPlaying = activeView === 'nowplaying'

  useMediaShortcuts()
  useFileAssociationLaunch()

  useEffect(() => {
    document.documentElement.setAttribute('data-performance', performanceMode ? 'on' : 'off')
  }, [performanceMode])


  return (
    <div className="dynamic-bg flex flex-col h-screen overflow-hidden select-none">
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
        </main>
      </div>

      <PlayerBar />
    </div>
  )
}
