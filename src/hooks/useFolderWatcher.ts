import { useEffect } from 'react'
import { useCatalogStore } from '@/store/catalogStore'
import { usePlayerStore } from '@/store/playerStore'
import { desktop } from '@/services/desktop'
import { toast } from '@/store/toastStore'

// ── Folder watching (§7) ────────────────────────────────────────────────────
// The renderer side of the live library. The WATCHER is only a change
// trigger: Rust debounces events per folder, rescans, diffs the database,
// and pushes the resulting SyncResult here — the renderer just applies the
// diff to its mirror. This hook also keeps the Rust watch set in sync with
// (musicFolders x watchFolders).
//
// Cost profile: zero polling — the watcher is event-driven; the renderer
// only re-invokes watchFolders when the folder list or the toggle changes.
export function useFolderWatcher() {
  const musicFolders = useCatalogStore((s) => s.musicFolders)
  const watchFolders = usePlayerStore((s) => s.watchFolders)

  const key = watchFolders ? musicFolders.join('\n') : ''

  useEffect(() => {
    if (!desktop.isDesktop()) return
    const folders = watchFolders ? useCatalogStore.getState().musicFolders : []
    desktop.library.watchFolders().catch(() => {})
    void folders
  }, [key, watchFolders])

  useEffect(() => {
    if (!desktop.isDesktop()) return
    const off = desktop.events.onLibraryChanged((result) => {
      // Apply the database diff straight into the mirror.
      const catalog = useCatalogStore.getState()
      if (result.upsertedTracks.length > 0) catalog.upsertTracks(result.upsertedTracks)
      if (result.removedTrackIds.length > 0) catalog.removeTrackIds(result.removedTrackIds)
      if (result.added > 0) {
        const known = new Set(catalog.libraryIds)
        const additions = result.upsertedTracks
          .filter((t) => !known.has(t.id))
          .map((t) => t.id)
        if (additions.length > 0) {
          useCatalogStore.setState((s) => ({
            libraryIds: [...s.libraryIds, ...additions.filter((id) => !s.libraryIds.includes(id))],
          }))
        }
      }
      if (result.untrackedFolders.length > 0) {
        useCatalogStore.setState((s) => ({
          musicFolders: s.musicFolders.filter((f) => !result.untrackedFolders.includes(f)),
        }))
      }
      if (result.added || result.removed || result.updated) {
        const parts: string[] = []
        if (result.added) parts.push(`+${result.added} added`)
        if (result.removed) parts.push(`−${result.removed} removed`)
        if (result.updated) parts.push(`${result.updated} updated`)
        toast({
          kind: 'library-synced',
          title: 'Library updated',
          subtitle: parts.join(' · '),
        })
      }
    })
    return () => { off.then((u) => u()).catch(() => {}) }
  }, [])
}
