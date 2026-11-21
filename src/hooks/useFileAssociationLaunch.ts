import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { tauriTakePendingAudioFiles, onFileOpened } from '@/services/tauriLibrary'
import { importFiles } from '@/services/libraryService'

// ── Windows file association launch ─────────────────────────────────────────
// When the user double-clicks an audio file in Explorer, Tauri main routes
// the path to the running instance (single-instance queue). The renderer
// drains that queue and imports/plays the file.
export function useFileAssociationLaunch() {
  const playSong = usePlayerStore((s) => s.playSong)
  const addToLibrary = usePlayerStore((s) => s.addToLibrary)

  useEffect(() => {
    // Rust queues startup and forwarded second-instance paths until the
    // renderer is ready. The event is only a wake-up signal; draining the
    // queue prevents a launch racing listener registration from being lost.
    let disposed = false
    let running = false
    let requested = false
    const drain = async () => {
      requested = true
      if (running) return
      running = true
      try {
        while (requested && !disposed) {
          requested = false
          const paths = await tauriTakePendingAudioFiles()
          if (paths.length === 0) continue
          try {
            await importFiles(paths.map((path) => ({ path })))
            const library = usePlayerStore.getState().library
            const first = library.find((song) => song.path === paths[0])
            if (first) playSong(first, library)
          } catch (error: unknown) {
            console.error('Failed to import files opened through Windows:', paths, error)
          }
        }
      } finally {
        running = false
        if (requested && !disposed) void drain()
      }
    }

    const unlisten = onFileOpened(() => {
      // Single file opened via association — drain the queue to pick it up
      void drain()
    })
    void drain()
    return () => { disposed = true; unlisten() }
  }, [playSong, addToLibrary])
}
