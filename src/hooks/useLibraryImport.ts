import { useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import type { Song } from '@/types'

// Simple hash from string (for stable song IDs without crypto deps)
function hashStr(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

export function useLibraryImport() {
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const addToLibrary = usePlayerStore((s) => s.addToLibrary)

  const importFolder = async () => {
    if (!window.electronAPI) return
    const folderPath = await window.electronAPI.openFolder()
    if (!folderPath) return

    setImporting(true)
    const files = await window.electronAPI.scanFolder(folderPath)
    setProgress({ done: 0, total: files.length })

    // Progress arrives as events while the batch runs in the main process —
    // subscribe before starting so we don't miss early updates
    const unsubscribe = window.electronAPI.onMetadataProgress((done, total) => {
      setProgress({ done, total })
    })

    const metas = await window.electronAPI.parseMetadataBatch(files.map((f) => f.path))
    unsubscribe()

    const songs: Song[] = files.map((file, i) => ({
      id: hashStr(file.path),
      path: file.path,
      ...metas[i],
    }))

    addToLibrary(songs)
    setImporting(false)
    setProgress({ done: 0, total: 0 })
  }

  return { importFolder, importing, progress }
}
