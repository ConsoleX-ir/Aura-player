// ── Aura LibraryService ─────────────────────────────────────────────────────
// All library ingestion + reconciliation business logic in ONE plain-TS
// module: importing files/folders, drag-and-drop resolution, and Folder
// Sync. React hooks stay thin UI wrappers (loading/progress state only) —
// the logic itself no longer lives inside components (locked rule #3), and
// Wave 4's folder watcher can call these same functions directly from an
// Electron event instead of simulating a UI flow.
//
// Behavior is intentionally byte-for-byte identical to the v1.x hook logic
// this was extracted from (useLibraryImport.importPaths / importFolder /
// importFiles / importDroppedPaths, useLibrarySync.syncAll).

import { usePlayerStore } from '@/store/playerStore'
import { hashStr } from '@/lib/utils'
import type { Song } from '@/types'

export interface ImportProgress { done: number; total: number }
export interface SyncResult { added: number; removed: number; updated: number }
type ProgressCb = (p: ImportProgress) => void

/**
 * Parses metadata for whichever of the given files aren't already in the
 * library (song IDs are a hash of the file path, so this is a cheap check)
 * and adds the results. Skipping known paths BEFORE parsing — not just
 * deduping after — matters for folder re-imports and Folder Sync:
 * re-parsing thousands of unchanged files would be wasted I/O and CPU.
 * Returns the number of songs actually added.
 */
export async function importFiles(
  files: { path: string; mtimeMs?: number }[],
  onProgress?: ProgressCb,
): Promise<number> {
  if (!window.electronAPI || files.length === 0) return 0

  const existingIds = new Set(usePlayerStore.getState().library.map((s) => s.id))
  const candidates = files
    .map((f) => ({ path: f.path, mtimeMs: f.mtimeMs, id: hashStr(f.path) }))
    .filter((c) => !existingIds.has(c.id))

  if (candidates.length === 0) return 0

  onProgress?.({ done: 0, total: candidates.length })
  const unsubscribe = window.electronAPI.onMetadataProgress((done, total) => {
    onProgress?.({ done, total })
  })

  try {
    const metas = await window.electronAPI.parseMetadataBatch(candidates.map((c) => c.path))
    const songs: Song[] = candidates.map((c, i) => ({
      id: c.id,
      path: c.path,
      mtimeMs: c.mtimeMs,
      ...metas[i],
    }))
    usePlayerStore.getState().addToLibrary(songs)
    return songs.length
  } finally {
    unsubscribe()
    onProgress?.({ done: 0, total: 0 })
  }
}

/** Native folder picker → recursive scan → import → register for Folder Sync. */
export async function importFolderViaDialog(onProgress?: ProgressCb): Promise<void> {
  if (!window.electronAPI) return
  const folderPath = await window.electronAPI.openFolder()
  if (!folderPath) return

  const files = await window.electronAPI.scanFolder(folderPath)
  await importFiles(files, onProgress)
  // Tracked so Folder Sync (Settings → Library) can re-scan this folder
  // later without the user having to pick it again.
  usePlayerStore.getState().addImportedFolder(folderPath)
}

/** Native file picker → import (no folder registration — loose files only). */
export async function importFilesViaDialog(onProgress?: ProgressCb): Promise<void> {
  if (!window.electronAPI) return
  const filePaths = await window.electronAPI.openFiles()
  if (filePaths.length === 0) return
  await importFiles(filePaths.map((path) => ({ path })), onProgress)
}

/**
 * Drag-and-drop entry point: dropped items can be a mix of individual audio
 * files and whole folders (Explorer hands both back as plain paths the same
 * way). Any dropped folder is registered for Folder Sync too, exactly like
 * picking it via "Add Folder...".
 */
export async function importDroppedPaths(paths: string[], onProgress?: ProgressCb): Promise<void> {
  if (!window.electronAPI || paths.length === 0) return
  const { files, folders } = await window.electronAPI.resolveDroppedPaths(paths)
  await importFiles(files, onProgress)
  folders.forEach((f) => usePlayerStore.getState().addImportedFolder(f))
}

/**
 * Folder Sync — for every folder the user has previously imported
 * (tracked in importedFolders), re-scan it and reconcile the library:
 *   • files on disk with no matching library entry        → added
 *   • library entries under this folder no longer on disk → removed
 *   • files whose mtime changed since last import/sync    → re-parsed, updated
 *   • everything else                                     → left untouched
 *
 * The mtime check keeps this fast on large libraries: a folder scan is a
 * directory walk + stat per file (cheap), so re-syncing an unchanged folder
 * costs almost nothing — full tag parsing only runs for new/changed files.
 */
export async function syncAllFolders(onProgress?: ProgressCb): Promise<SyncResult> {
  const result: SyncResult = { added: 0, removed: 0, updated: 0 }
  if (!window.electronAPI) return result

  const { importedFolders } = usePlayerStore.getState()
  if (importedFolders.length === 0) return result

  for (const folder of importedFolders) {
    const scanned = await window.electronAPI.scanFolder(folder)
    const scannedByPath = new Map(scanned.map((f) => [f.path, f]))

    const library = usePlayerStore.getState().library
    const librarySongsInFolder = library.filter((s) => s.path.startsWith(folder))
    const existingByPath = new Map(librarySongsInFolder.map((s) => [s.path, s]))

    // A folder that previously had songs but now scans back completely
    // empty has most likely been deleted or unmounted (moved drive,
    // removed directory) rather than had every file individually deleted.
    // Stop tracking it so future syncs don't keep re-scanning a path that
    // no longer exists.
    if (scanned.length === 0 && librarySongsInFolder.length > 0) {
      usePlayerStore.getState().removeImportedFolder(folder)
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
      usePlayerStore.getState().removeSongsFromLibrary(deletedIds)
      result.removed += deletedIds.length
    }

    if (toParse.length > 0) {
      onProgress?.({ done: 0, total: toParse.length })
      const unsubscribe = window.electronAPI.onMetadataProgress((done, total) => {
        onProgress?.({ done, total })
      })

      let metas: Omit<Song, 'id' | 'path'>[]
      try {
        metas = await window.electronAPI.parseMetadataBatch(toParse.map((c) => c.path))
      } finally {
        unsubscribe()
      }

      const newSongs: Song[] = []
      const changedSongs: Song[] = []
      const now = Date.now()
      toParse.forEach((c, i) => {
        // addedAt (v2.1.0): when the song entered the library — powers the
        // Library's "Recently Added" sort. Set only on first import; a
        // re-parse of a changed file must not refresh it (that would reshuffle
        // the user's Recently Added view on every Folder Sync touch). Songs
        // from before this field existed fall back to mtimeMs at sort time.
        const song: Song = { id: c.id, path: c.path, mtimeMs: c.mtimeMs, addedAt: now, ...metas[i] }
        if (c.isUpdate) changedSongs.push(song)
        else newSongs.push(song)
      })

      if (newSongs.length > 0) {
        usePlayerStore.getState().addToLibrary(newSongs)
        result.added += newSongs.length
      }
      if (changedSongs.length > 0) {
        usePlayerStore.getState().updateSongs(changedSongs)
        result.updated += changedSongs.length
      }
    }
  }

  return result
}
