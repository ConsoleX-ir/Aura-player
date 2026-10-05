import { useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { syncAllFolders, type SyncResult, type ImportProgress } from '@/services/libraryService'

// Thin UI wrapper around LibraryService.syncAllFolders — all reconciliation
// logic lives in src/services/libraryService.ts. This hook only holds view
// state (syncing flag + progress + last result) for the Settings screen.
export function useLibrarySync() {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<ImportProgress>({ done: 0, total: 0 })
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)

  // Reactive so the Settings screen updates as folders are added/removed
  // (e.g. a sync that discovers a deleted folder stops tracking it).
  const folderCount = usePlayerStore((s) => s.importedFolders.length)

  const syncAll = async () => {
    if (!window.electronAPI) return
    setSyncing(true)
    try {
      const result = await syncAllFolders((p) => setProgress(p))
      setLastResult(result)
    } finally {
      setSyncing(false)
      setProgress({ done: 0, total: 0 })
    }
  }

  return {
    syncAll,
    syncing,
    progress,
    lastResult,
    folderCount,
  }
}
