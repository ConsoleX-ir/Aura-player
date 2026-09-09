import { useState } from 'react'
import {
  importFolderViaDialog, importFilesViaDialog, importDroppedPaths,
  type ImportProgress,
} from '@/services/libraryService'

// Thin UI wrapper around LibraryService — all actual ingestion logic lives
// in src/services/libraryService.ts so the folder watcher (Wave 4) and any
// future surface can reuse it. This hook only holds view state (importing
// flag + progress) and forwards callbacks.
export function useLibraryImport() {
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<ImportProgress>({ done: 0, total: 0 })

  const onProgress = (p: ImportProgress) => setProgress(p)

  const importFolder = async () => {
    if (!window.electronAPI) return
    setImporting(true)
    try { await importFolderViaDialog(onProgress) } finally { setImporting(false) }
  }

  const importFiles = async () => {
    if (!window.electronAPI) return
    setImporting(true)
    try { await importFilesViaDialog(onProgress) } finally { setImporting(false) }
  }

  const importDropped = async (paths: string[]) => {
    if (!window.electronAPI || paths.length === 0) return
    setImporting(true)
    try { await importDroppedPaths(paths, onProgress) } finally { setImporting(false) }
  }

  return {
    importFolder,
    importFiles,
    importDroppedPaths: importDropped,
    importing,
    progress,
  }
}
