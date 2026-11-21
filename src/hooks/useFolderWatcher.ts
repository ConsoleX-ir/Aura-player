import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { syncAllFolders } from '@/services/libraryService'
import { toast } from '@/store/toastStore'
import { isTauriDesktop, tauriWatchFolders, onWatchChange as tauriOnWatchChange } from '@/services/tauriLibrary'

// Keep the native watcher set aligned with imported folders and funnel all
// changes through the existing Folder Sync reconciliation pipeline.
export function useFolderWatcher() {
  const importedFolders = usePlayerStore((s) => s.importedFolders)
  const watchFolders = usePlayerStore((s) => s.watchFolders)
  const syncingRef = useRef(false)
  const pendingRef = useRef(false)
  const key = watchFolders ? importedFolders.join('\n') : ''

  useEffect(() => {
    const isTauri = isTauriDesktop()
    const folders = watchFolders ? usePlayerStore.getState().importedFolders : []
    let disposed = false
    let debounceTimer: ReturnType<typeof setTimeout> | undefined

    const runSync = () => {
      syncingRef.current = true
      syncAllFolders()
        .then((result) => {
          if (disposed) return
          if (result.added || result.removed || result.updated) {
            const parts: string[] = []
            if (result.added) parts.push(`+${result.added} added`)
            if (result.removed) parts.push(`−${result.removed} removed`)
            if (result.updated) parts.push(`${result.updated} updated`)
            toast({ kind: 'library-synced', title: 'Library updated', subtitle: parts.join(' · ') })
          }
        })
        .catch(() => {})
        .finally(() => {
          if (pendingRef.current && !disposed) {
            pendingRef.current = false
            runSync()
          } else {
            syncingRef.current = false
          }
        })
    }

    const scheduleSync = () => {
      if (syncingRef.current) {
        pendingRef.current = true
        return
      }
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined
        if (!disposed) runSync()
      }, 250)
    }

    if (isTauri) {
      void tauriWatchFolders(folders).catch(() => {})
      const unlisten = tauriOnWatchChange((change) => {
        if (!disposed) scheduleSync()
        void change
      })
      return () => {
        disposed = true
        if (debounceTimer) clearTimeout(debounceTimer)
        unlisten()
        void tauriWatchFolders([]).catch(() => {})
      }
    }
  }, [key, watchFolders])
}
