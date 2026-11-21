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
import { analyzeLibraryHealth, type LibraryHealthReport, type PathCheck } from '@/lib/libraryHealth'
import type { Song } from '@/types'
import { isTauriDesktop, tauriCheckPaths, tauriOpenFiles, tauriOpenFolder, tauriParseMetadataBatch, tauriResolveDroppedPaths, tauriScanFolder } from '@/services/tauriLibrary'

export interface ImportProgress { done: number; total: number }
export interface SyncResult { added: number; removed: number; updated: number }
type ProgressCb = (p: ImportProgress) => void

/**
 * Separator-aware "is this path inside this folder?" check (v5 fix).
 * The previous plain `startsWith(folder)` mis-matched sibling folders whose
 * names share a prefix — `/Music/Rock` claimed every `/Music/Rockabilly`
 * file, which could both miscount a folder's songs and (dangerously) mark
 * files "deleted" during a sync of the wrong folder. Normalizing the
 * separators also makes a Windows-style path match regardless of which
 * slash flavor each API happened to return.
 */
export function isPathInside(path: string, folder: string): boolean {
  if (!folder) return false
  const p = path.replace(/\\/g, '/')
  const f = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  if (f === '') return p.startsWith('/') // folder is filesystem root
  return p.startsWith(f + '/')
}

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
  const isTauri = isTauriDesktop()
  let parseMeta: ((paths: string[]) => Promise<unknown>) | undefined
  if (!isTauri) {
    const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: { parseMetadataBatch?: (paths: string[]) => Promise<unknown> } }).electronAPI : undefined
    if (!api?.parseMetadataBatch) return 0
    parseMeta = api.parseMetadataBatch
  }
  if (!isTauri || files.length === 0) return 0

  const existingIds = new Set(usePlayerStore.getState().library.map((s) => s.id))
  const candidates = files
    .map((f) => ({ path: f.path, mtimeMs: f.mtimeMs, id: hashStr(f.path) }))
    .filter((c) => !existingIds.has(c.id))

  if (candidates.length === 0) return 0

  // Explicit import intent: anything the user deliberately adds through a
  // picker / drag-drop / file association is a conscious re-import, so
  // clear any tombstone those files carry (Wave 0). Folder Sync never calls
  // importFiles — its own inline path is the ONLY way to re-add files —
  // so tombstone clearing can't be bypassed by a mere library scan.
  usePlayerStore.getState().restoreImportedPaths(candidates.map((c) => c.path))

  onProgress?.({ done: 0, total: candidates.length })
  try {
    const paths = candidates.map((c) => c.path)
    const metas = isTauri
      ? await tauriParseMetadataBatch(paths, (done, total) => onProgress?.({ done, total }))
      : await parseMeta!(paths)
    const metasTyped = metas as Omit<Song, 'id' | 'path'>[]
    const songs: Song[] = candidates.map((c, i) => ({
      id: c.id,
      path: c.path,
      mtimeMs: c.mtimeMs,
      ...metasTyped[i],
    }))
    usePlayerStore.getState().addToLibrary(songs)
    return songs.length
  } finally {
    onProgress?.({ done: 0, total: 0 })
  }
}

/** Native folder picker → recursive scan → import → register for Folder Sync. */
export async function importFolderViaDialog(onProgress?: ProgressCb): Promise<void> {
  if (!isTauriDesktop()) return
  const folderPath = await tauriOpenFolder()
  if (!folderPath) return

  const files = await tauriScanFolder(folderPath)
  await importFiles(files, onProgress)
  // Tracked so Folder Sync (Settings → Library) can re-scan this folder
  // later without the user having to pick it again.
  usePlayerStore.getState().addImportedFolder(folderPath)
}

/** Native file picker → import (no folder registration — loose files only). */
export async function importFilesViaDialog(onProgress?: ProgressCb): Promise<void> {
  if (!isTauriDesktop()) return
  const filePaths = await tauriOpenFiles()
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
  if (!isTauriDesktop() || paths.length === 0) return
  const { files, folders } = await tauriResolveDroppedPaths(paths)
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
 *   • paths the user DELETED from the library (tombstones) → never re-added
 *
 * The mtime check keeps this fast on large libraries: a folder scan is a
 * directory walk + stat per file (cheap), so re-syncing an unchanged folder
 * costs almost nothing — full tag parsing only runs for new/changed files.
 */
export async function syncAllFolders(onProgress?: ProgressCb): Promise<SyncResult> {
  const result: SyncResult = { added: 0, removed: 0, updated: 0 }
  const isTauri = isTauriDesktop()
  let scanFolder: ((folder: string) => Promise<{ path: string; name: string; mtimeMs: number }[]>) | undefined
  let parseMetaBatch: ((paths: string[]) => Promise<Omit<Song, 'id' | 'path'>[]>) | undefined
  if (!isTauri) {
    const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: { scanFolder?: (folder: string) => Promise<{ path: string; name: string; mtimeMs: number }[]>; parseMetadataBatch?: (paths: string[]) => Promise<Omit<Song, 'id' | 'path'>[]> } }).electronAPI : undefined
    if (!api?.scanFolder) return result
    scanFolder = api.scanFolder
    parseMetaBatch = api.parseMetadataBatch
  }

  const { importedFolders } = usePlayerStore.getState()
  if (importedFolders.length === 0) return result

  for (const folder of importedFolders) {
    let scanned: { path: string; name: string; mtimeMs: number }[]
    try {
      scanned = isTauri
        ? await tauriScanFolder(folder)
        : await scanFolder!(folder)
    } catch {
      // A missing, offline, or no-longer-authorized folder is unknown, not an
      // empty library. Skip reconciliation so we never remove its song rows.
      continue
    }
    const scannedByPath = new Map(scanned.map((f) => [f.path, f]))

    // Tombstone maintenance (Wave 0): paths under this folder the user
    // removed from the library while the file still exists must NOT come
    // back below; and once a tombstoned file disappears from disk, the
    // tombstone has done its job — drop it so a future file re-created at
    // the same path is treated as fresh import material.
    const tombstones = usePlayerStore.getState().removedPaths
    if (tombstones.length > 0) {
      const staleTombstones = tombstones.filter(
        (p) => isPathInside(p, folder) && !scannedByPath.has(p)
      )
      if (staleTombstones.length > 0) {
        usePlayerStore.getState().restoreImportedPaths(staleTombstones)
      }
    }
    const tombstonedPaths = new Set(
      usePlayerStore.getState().removedPaths
    )

    const library = usePlayerStore.getState().library
    const librarySongsInFolder = library.filter((s) => isPathInside(s.path, folder))
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
    // Tombstoned paths (user-deleted from the library) are skipped — that
    // is the whole point of the tombstone: sync reconciles the library
    // with disk, but it must never override an explicit removal decision.
    const toParse: { path: string; id: string; mtimeMs: number; isUpdate: boolean; addedAt?: number }[] = []
    for (const file of scanned) {
      if (tombstonedPaths.has(file.path)) continue
      const existing = existingByPath.get(file.path)
      if (!existing) {
        toParse.push({ path: file.path, id: hashStr(file.path), mtimeMs: file.mtimeMs, isUpdate: false })
      } else if (existing.mtimeMs !== file.mtimeMs) {
        // v5 fix: carry the original addedAt through the re-parse so a
        // changed file keeps its original "entered the library" date —
        // refreshing it reshuffled the Recently Added sort on every
        // Folder Sync that merely touched a file's mtime.
        toParse.push({ path: file.path, id: existing.id, mtimeMs: file.mtimeMs, isUpdate: true, addedAt: existing.addedAt })
      }
    }

    if (deletedIds.length > 0) {
      usePlayerStore.getState().removeSongsFromLibrary(deletedIds)
      result.removed += deletedIds.length
    }

    if (toParse.length > 0) {
      onProgress?.({ done: 0, total: toParse.length })
      let metas: Omit<Song, 'id' | 'path'>[]
      const paths = toParse.map((c) => c.path)
      metas = isTauri
        ? await tauriParseMetadataBatch(paths, (done, total) => onProgress?.({ done, total }))
        : await parseMetaBatch!(paths)

      const newSongs: Song[] = []
      const changedSongs: Song[] = []
      const now = Date.now()
      toParse.forEach((c, i) => {
        // addedAt (v2.1.0): when the song entered the library — powers the
        // Library's "Recently Added" sort. Set only on first import; a
        // re-parse of a changed file preserves the original value (v5 fix,
        // see the toParse collection above). The metadata spread runs FIRST
        // and the library-owned identity fields are asserted after it, so a
        // provider/parser can never overwrite them.
        const song: Song = {
          ...metas[i],
          id: c.id,
          path: c.path,
          mtimeMs: c.mtimeMs,
          addedAt: c.isUpdate ? (c.addedAt ?? now) : now,
        }
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

/**
 * Library Health (Phase 1 — Library 2.0): verifies every library entry
 * against the filesystem and analyzes the whole collection for duplicate
 * recordings. Pure judgment lives in lib/libraryHealth (unit-tested); this
 * wrapper only gathers the filesystem facts and shapes the report.
 *
 * Without Tauri (plain browser / tests) the scan
 * degrades honestly: every entry counts as checked-and-present, duplicates
 * are still analyzed, and nothing is flagged missing.
 */
export async function runLibraryHealthCheck(): Promise<LibraryHealthReport> {
  const songs = usePlayerStore.getState().library

  const isTauri = isTauriDesktop()
  let checkPaths: ((paths: string[]) => Promise<{ path: string; exists: boolean; sizeBytes: number; mtimeMs: number }[]>) | undefined
  if (!isTauri) {
    const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: { checkPaths?: (paths: string[]) => Promise<{ path: string; exists: boolean; sizeBytes: number; mtimeMs: number }[]> } }).electronAPI : undefined
    if (!api?.checkPaths) {
      return analyzeLibraryHealth(songs, new Map())
    }
    checkPaths = api.checkPaths
  }
  if (songs.length === 0) {
    return analyzeLibraryHealth(songs, new Map())
  }

  let checks: PathCheck[]
  try {
    checks = isTauri
      ? await tauriCheckPaths(songs.map((s) => s.path))
      : await checkPaths!(songs.map((s) => s.path))
  } catch {
    return analyzeLibraryHealth(songs, new Map())
  }
  const byPath = new Map(checks.map((c) => [c.path, c]))
  return analyzeLibraryHealth(songs, byPath)
}
