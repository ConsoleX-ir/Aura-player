import { useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { hashStr } from '@/lib/utils'
import type { Song } from '@/types'

export function useLibraryImport() {
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const addToLibrary = usePlayerStore((s) => s.addToLibrary)
  const addImportedFolder = usePlayerStore((s) => s.addImportedFolder)

  // Shared by importFolder and importFiles: parses metadata for whichever of
  // the given paths aren't already in the library (song IDs are a hash of
  // the file path, so this is a cheap check) and adds the results in.
  // Skipping known paths before parsing — not just deduping after — matters
  // for folder re-imports and Folder Sync: re-parsing metadata for
  // thousands of unchanged files on every scan would be wasted I/O and CPU.
  const importPaths = async (files: { path: string; mtimeMs?: number }[]) => {
    if (!window.electronAPI || files.length === 0) return

    const existingIds = new Set(usePlayerStore.getState().library.map((s) => s.id))
    const candidates = files
      .map((f) => ({ path: f.path, mtimeMs: f.mtimeMs, id: hashStr(f.path) }))
      .filter((c) => !existingIds.has(c.id))

    if (candidates.length === 0) return

    setImporting(true)
    setProgress({ done: 0, total: candidates.length })

    const unsubscribe = window.electronAPI.onMetadataProgress((done, total) => {
      setProgress({ done, total })
    })

    try {
      const metas = await window.electronAPI.parseMetadataBatch(candidates.map((c) => c.path))
      const songs: Song[] = candidates.map((c, i) => ({
        id: c.id,
        path: c.path,
        mtimeMs: c.mtimeMs,
        ...metas[i],
      }))
      addToLibrary(songs)
    } finally {
      unsubscribe()
      setImporting(false)
      setProgress({ done: 0, total: 0 })
    }
  }

  const importFolder = async () => {
    if (!window.electronAPI) return
    const folderPath = await window.electronAPI.openFolder()
    if (!folderPath) return

    const files = await window.electronAPI.scanFolder(folderPath)
    await importPaths(files)
    // Tracked so Folder Sync (Settings → Library) can re-scan this folder
    // later without the user having to pick it again.
    addImportedFolder(folderPath)
  }

  // Task 4: import one or more individual audio files directly, without
  // needing to import their whole containing folder.
  const importFiles = async () => {
    if (!window.electronAPI) return
    const filePaths = await window.electronAPI.openFiles()
    if (filePaths.length === 0) return
    await importPaths(filePaths.map((path) => ({ path })))
  }

  return {
    importFolder,
    importFiles,
    importing,
    progress,
  }
}
