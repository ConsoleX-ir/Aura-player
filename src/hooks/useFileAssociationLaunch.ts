import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { hashStr } from '@/lib/utils'
import type { Song } from '@/types'

// Task 3 — handles Aura being launched (or focused) via double-clicking an
// associated audio file in Windows Explorer. If the file's already in the
// library it just plays it; otherwise it's parsed and added first, exactly
// like a normal individual-file import, then played.
export function useFileAssociationLaunch() {
  const playSong = usePlayerStore((s) => s.playSong)
  const addToLibrary = usePlayerStore((s) => s.addToLibrary)

  useEffect(() => {
    if (!window.electronAPI?.onFileOpened) return

    const unsubscribe = window.electronAPI.onFileOpened(async (filePath) => {
      const id = hashStr(filePath)
      const existing = usePlayerStore.getState().library.find((s) => s.id === id)

      if (existing) {
        playSong(existing, usePlayerStore.getState().library)
        return
      }

      try {
        const [meta] = await window.electronAPI.parseMetadataBatch([filePath])
        const song: Song = { id, path: filePath, ...meta }
        addToLibrary([song])
        // addToLibrary updates the store synchronously (Zustand's set() is
        // not async), so re-reading it here already includes `song` — no
        // need to append it again.
        playSong(song, usePlayerStore.getState().library)
      } catch (e) {
        console.error('Failed to open file from association launch:', filePath, e)
      }
    })

    return unsubscribe
  }, [playSong, addToLibrary])
}
