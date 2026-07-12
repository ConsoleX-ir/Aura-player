import { useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { hashStr } from '@/lib/utils'
import type { Song } from '@/types'

export interface SyncResult {
  added: number
  removed: number
  updated: number
}

// Task 5 — Folder Sync. For every folder the user has previously imported
// (tracked in importedFolders), re-scans it and reconciles the library:
//   • files on disk with no matching library entry           → added
//   • library entries under this folder no longer on disk    → removed
//   • files whose mtime changed since last import/sync       → re-parsed, updated
//   • everything else                                        → left untouched
//
// The mtime check is what keeps this fast on large libraries: a folder scan
// is just a directory walk + stat per file (cheap), so re-syncing a folder
// where nothing changed costs almost nothing — full tag parsing only runs
// for files that are actually new or actually changed.
export function useLibrarySync() {
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)

  const importedFolders = usePlayerStore((s) => s.importedFolders)
  const addToLibrary = usePlayerStore((s) => s.addToLibrary)
  const updateSongs = usePlayerStore((s) => s.updateSongs)
  const removeSongsFromLibrary = usePlayerStore((s) => s.removeSongsFromLibrary)
  const removeImportedFolder = usePlayerStore((s) => s.removeImportedFolder)

  const syncAll = async () => {
    if (!window.electronAPI || importedFolders.length === 0) return

    setSyncing(true)
    const result: SyncResult = { added: 0, removed: 0, updated: 0 }

    try {
      for (const folder of importedFolders) {
        const scanned = await window.electronAPI.scanFolder(folder)
        const scannedByPath = new Map(scanned.map((f) => [f.path, f]))

        const library = usePlayerStore.getState().library
        const librarySongsInFolder = library.filter((s) => s.path.startsWith(folder))
        const existingByPath = new Map(librarySongsInFolder.map((s) => [s.path, s]))

        // A folder that previously had songs but now scans back completely
        // empty has most likely been deleted or unmounted (moved drive,
        // removed directory) rather than had every file individually
        // deleted. Stop tracking it so future syncs don't keep re-scanning
        // a path that no longer exists.
        if (scanned.length === 0 && librarySongsInFolder.length > 0) {
          removeImportedFolder(folder)
        }

        // Deleted: was in the library under this folder, isn't on disk anymore.
        const deletedIds = librarySongsInFolder
          .filter((s) => !scannedByPath.has(s.path))
          .map((s) => s.id)

        // New or changed: not in the library at all, or mtime moved on.
        const toParse: { path: string; id: string; mtimeMs: number; isUpdate: boolean }[] = []
        for (const file of scanned) {
          const existing = existingByPath.get(file.path)
          if (!existing) {
            toParse.push({ path: file.path, id: hashStr(file.path), mtimeMs: file.mtimeMs, isUpdate: false })
          } else if (existing.mtimeMs !== file.mtimeMs) {
            toParse.push({ path: file.path, id: existing.id, mtimeMs: file.mtimeMs, isUpdate: true })
          }
        }

        if (deletedIds.length > 0) {
          removeSongsFromLibrary(deletedIds)
          result.removed += deletedIds.length
        }

        if (toParse.length > 0) {
          setProgress({ done: 0, total: toParse.length })
          const unsubscribe = window.electronAPI.onMetadataProgress((done, total) => {
            setProgress({ done, total })
          })

          let metas: Omit<Song, 'id' | 'path'>[]
          try {
            metas = await window.electronAPI.parseMetadataBatch(toParse.map((c) => c.path))
          } finally {
            unsubscribe()
          }

          const newSongs: Song[] = []
          const changedSongs: Song[] = []
          toParse.forEach((c, i) => {
            const song: Song = { id: c.id, path: c.path, mtimeMs: c.mtimeMs, ...metas[i] }
            if (c.isUpdate) changedSongs.push(song)
            else newSongs.push(song)
          })

          if (newSongs.length > 0) { addToLibrary(newSongs); result.added += newSongs.length }
          if (changedSongs.length > 0) { updateSongs(changedSongs); result.updated += changedSongs.length }
        }
      }

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
    folderCount: importedFolders.length,
  }
}
