import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { syncAllFolders } from '@/services/libraryService'
import { toast } from '@/store/toastStore'

// ── Folder watching (Wave 4) ─────────────────────────────────────────────────
// The renderer side of the live library: keeps the main process's watcher set
// in sync with (importedFolders × watchFolders), and reconciles the library
// through the EXISTING Folder Sync pipeline when the main process reports a
// debounced change. No new sync logic is invented here — the watcher simply
// pulls the same lever the Settings button pulls, so behavior is identical
// by construction (add / remove / mtime-update, playlists+queue cleanup).
//
// Cost profile: zero polling — fs.watch is event-driven; this hook only
// re-invokes watchFolders when the folder list or the toggle actually
// changes, and one reconciliation per real change burst (already debounced
// 1.2s in main). A quiet library costs literally nothing.
export function useFolderWatcher() {
  // One reactive subscription per input, matching the narrow-selector house
  // style — this hook lives as long as the app and must not re-run on
  // unrelated store churn (the ~4-10Hz progress tick above all).
  const importedFolders = usePlayerStore((s) => s.importedFolders)
  const watchFolders = usePlayerStore((s) => s.watchFolders)
  const syncingRef = useRef(false)

  const key = watchFolders ? importedFolders.join('\n') : ''

  useEffect(() => {
    const api = window.electronAPI
    // Method-level guard, not just API-level: the watcher is a Wave 4
    // addition, so anything that predates it (test mocks, exotic embedded
    // webviews) must degrade to a silent no-op rather than crash the shell.
    if (!api?.watchFolders || !api?.onWatchChange) return

    const folders = watchFolders ? usePlayerStore.getState().importedFolders : []
    let disposed = false

    // Fire-and-forget: a watcher failure must never break the app. The main
    // process per-folder try/catch already isolates vanishing folders.
    if (folders.length > 0) {
      api.watchFolders(folders).catch(() => {})
    } else {
      api.watchFolders([]).catch(() => {})
    }

    const onWatchChange = api.onWatchChange((change) => {
      if (disposed || syncingRef.current) return
      syncingRef.current = true
      // Reconcile quietly; surface a toast only when something actually
      // changed — silence for a no-op scan keeps the feature invisible.
      syncAllFolders()
        .then((result) => {
          if (disposed) return
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
        .catch(() => {})
        .finally(() => { syncingRef.current = false })
      void change
    })

    return () => {
      disposed = true
      onWatchChange()
    }
    // `key` collapses (folders × toggle) into one dependency that only
    // changes when the watch set genuinely needs to change.
  }, [key, watchFolders])
}
