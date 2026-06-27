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

    const songs: Song[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const meta = await window.electronAPI.parseMetadata(file.path)
      songs.push({ id: hashStr(file.path), path: file.path, ...meta })
      setProgress({ done: i + 1, total: files.length })
    }

    addToLibrary(songs)
    setImporting(false)
    setProgress({ done: 0, total: 0 })
  }

  return { importFolder, importing, progress }
}
