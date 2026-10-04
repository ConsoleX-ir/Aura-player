// ── Aura LibraryService ─────────────────────────────────────────────────────
// Thin orchestration over the desktop boundary. The heavy lifting — scanning,
// metadata parsing, reconciliation, tombstones — lives in Rust now (Aura 4
// §3/§7); this module shapes the few UI-facing flows: dialogs, progress
// state, and drag-and-drop resolution.
//
// Explicit imports clear tombstones on the Rust side (a conscious re-import
// is a restore, not a resurrect). Folder Sync never bypasses that rule.

import { desktop } from '@/services/desktop'
import type { SyncResult } from '@/services/desktop'
import { useCatalogStore } from '@/store/catalogStore'

export interface ImportProgress { done: number; total: number }
export type { SyncResult }
type ProgressCb = (p: ImportProgress) => void

function applyResult(result: SyncResult) {
  const catalog = useCatalogStore.getState()
  if (result.upsertedTracks.length > 0) catalog.upsertTracks(result.upsertedTracks)
  if (result.removedTrackIds.length > 0) catalog.removeTrackIds(result.removedTrackIds)
  // Import results already carry Library membership on the DB side; mirror
  // the ids locally (additions = upserted tracks that are now members).
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

/** Import explicit file paths (dialog picks, file-association launches). */
export async function importFiles(
  paths: string[],
  onProgress?: ProgressCb,
): Promise<number> {
  if (!desktop.isDesktop() || paths.length === 0) return 0
  const unsubscribe = await desktop.events.onScanProgress((p) => onProgress?.(p))
  try {
    const result = await desktop.library.importFiles(paths)
    applyResult(result)
    return result.added
  } finally {
    unsubscribe()
    onProgress?.({ done: 0, total: 0 })
  }
}

/** Native folder picker → recursive scan + import → register for Folder Sync. */
export async function importFolderViaDialog(onProgress?: ProgressCb): Promise<void> {
  if (!desktop.isDesktop()) return
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, title: 'Select Music Folder' })
  if (typeof selected !== 'string') return

  await importFiles([selected], onProgress)
  await useCatalogStore.getState().addMusicFolder(selected)
}

/** Native file picker → import (no folder registration — loose files only). */
export async function importFilesViaDialog(onProgress?: ProgressCb): Promise<void> {
  if (!desktop.isDesktop()) return
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: true,
    title: 'Select Songs',
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma'] }],
  })
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
  if (paths.length === 0) return
  await importFiles(paths, onProgress)
}

/**
 * Drag-and-drop entry point: dropped items can be a mix of individual audio
 * files and whole folders (paths arrive from the Tauri drag-drop event, so
 * they are real filesystem paths). Any dropped folder is registered for
 * Folder Sync too, exactly like picking it via "Add Folder...".
 */
export async function importDroppedPaths(paths: string[], onProgress?: ProgressCb): Promise<void> {
  if (!desktop.isDesktop() || paths.length === 0) return
  const unsubscribe = await desktop.events.onScanProgress((p) => onProgress?.(p))
  try {
    const result = await desktop.library.importDropped(paths)
    applyResult(result)
    // Dropped folders join Folder Sync (mirrored by applyResult's absence —
    // the Rust side already added them; pull the fresh folder list).
    const snap = await desktop.library.snapshot()
    useCatalogStore.setState({ musicFolders: snap.musicFolders })
    await desktop.library.watchFolders()
  } finally {
    unsubscribe()
    onProgress?.({ done: 0, total: 0 })
  }
}

/**
 * Folder Sync — re-scan every tracked folder and reconcile the database:
 *   • files on disk with no matching catalog entry        → added
 *   • catalog entries under this folder no longer on disk → removed
 *   • files whose mtime changed since last scan           → re-parsed
 *   • paths the user DELETED from the library (tombstones) → never re-added
 * The watcher triggers the same reconciliation per folder automatically.
 */
export async function syncAllFolders(onProgress?: ProgressCb): Promise<SyncResult> {
  if (!desktop.isDesktop()) {
    return { added: 0, removed: 0, updated: 0, upsertedTracks: [], removedTrackIds: [], untrackedFolders: [] }
  }
  const unsubscribe = await desktop.events.onScanProgress((p) => onProgress?.(p))
  try {
    const result = await desktop.library.syncAll()
    applyResult(result)
    // Untracked folders (vanished drives) drop out of the mirror too.
    if (result.untrackedFolders.length > 0) {
      const snap = await desktop.library.snapshot()
      useCatalogStore.setState({ musicFolders: snap.musicFolders })
    }
    return result
  } finally {
    unsubscribe()
    onProgress?.({ done: 0, total: 0 })
  }
}

/**
 * Library Health: verify every library entry against the filesystem and
 * analyze the collection for duplicate recordings. Pure judgment lives in
 * lib/libraryHealth (unit-tested); this wrapper only gathers filesystem
 * facts and shapes the report.
 */
export async function runLibraryHealthCheck() {
  const { analyzeLibraryHealth } = await import('@/lib/libraryHealth')
  const catalog = useCatalogStore.getState()
  const tracks = selectAllLocal(catalog)
  const paths = tracks.map((t) => t.path).filter((p): p is string => !!p)

  let checks
  try {
    checks = paths.length > 0 ? await desktop.library.checkPaths(paths) : []
  } catch {
    return analyzeLibraryHealth(
      tracks as never,
      new Map(),
    )
  }
  const byPath = new Map(checks.map((c) => [c.path, c]))
  return analyzeLibraryHealth(tracks as never, byPath)
}


function selectAllLocal(catalog: ReturnType<typeof useCatalogStore.getState>) {
  return Object.values(catalog.tracks).filter((t) => t.kind === 'local' && t.path)
}

