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
  // Tracks folders that triggered events while a sync is in flight, so the
  // pending re-sync can target only those folders instead of re-syncing all.
  const pendingRef = useRef<Set<string>>(new Set())
  const key = watchFolders ? importedFolders.join('\n') : ''

  useEffect(() => {
    const isTauri = isTauriDesktop()
    const folders = watchFolders ? usePlayerStore.getState().importedFolders : []
    let disposed = false
    let debounceTimer: ReturnType<typeof setTimeout> | undefined

    const runSync = (onlyFolder?: string) => {
      syncingRef.current = true
      syncAllFolders(undefined, onlyFolder)
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
        .catch((error: unknown) => {
          console.error('Folder sync failed:', error)
        })
        .finally(() => {
          if (pendingRef.current.size > 0 && !disposed) {
            const pending = [...pendingRef.current]
            pendingRef.current.clear()
            // If exactly one folder is pending, sync only it; otherwise sync all.
            runSync(pending.length === 1 ? pending[0] : undefined)
          } else {
            syncingRef.current = false
          }
        })
    }

    const scheduleSync = (onlyFolder?: string) => {
      if (syncingRef.current) {
        if (onlyFolder) pendingRef.current.add(onlyFolder)
        return
      }
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined
        if (!disposed) runSync(onlyFolder)
      }, 250)
    }

    if (isTauri) {
      void tauriWatchFolders(folders).catch(() => {})
      const unlisten = tauriOnWatchChange((change) => {
        if (!disposed) scheduleSync(change.folder)
        void change
      })
      return () => {
        disposed = true
        if (debounceTimer) clearTimeout(debounceTimer)
        pendingRef.current.clear()
        unlisten()
        void tauriWatchFolders([]).catch(() => {})
      }
    }
  }, [key, watchFolders])
}
