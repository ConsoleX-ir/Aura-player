import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useCatalogStore, selectLibraryTracks } from '@/store/catalogStore'
import { desktop } from '@/services/desktop'
import { importFiles } from '@/services/libraryService'

// File associations (§17): Aura launched (or focused) via double-clicking an
// associated audio file. If the track is already in the catalog it just
// plays; otherwise it's imported first (which also lifts any tombstone —
// a conscious open is a restore), exactly like a normal import, then played.
export function useFileAssociationLaunch() {
  useEffect(() => {
    if (!desktop.isDesktop()) return

    const off = desktop.events.onFileOpened(async (filePath) => {
      try {
        const catalog = useCatalogStore.getState()
        const existingLocal = Object.values(catalog.tracks).find((t) => t.path === filePath)

        if (existingLocal) {
          const library = selectLibraryTracks(catalog)
          usePlayerStore.getState().playSong(existingLocal, library)
          return
        }

        await importFiles([filePath])
        const fresh = useCatalogStore.getState()
        const imported = Object.values(fresh.tracks).find((t) => t.path === filePath)
        if (imported) {
          usePlayerStore.getState().playSong(imported, selectLibraryTracks(fresh))
        }
      } catch (e) {
        console.error('Failed to open file from association launch:', filePath, e)
      }
    })
    return () => { off.then((u) => u()).catch(() => {}) }
  }, [])
}
