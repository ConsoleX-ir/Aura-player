import { useState } from 'react'
import type { Song } from '@/types'
import { isTauriDesktop, tauriExportPlaylist } from '@/services/tauriLibrary'

// Sanitizes a playlist name into something safe to use as a filename across
// platforms — strips characters Windows/macOS/Linux all disallow or treat
// specially in file paths.
function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').trim() || 'Playlist'
}

// Builds a standard Extended M3U file — the one playlist format basically
// every media player (VLC, Winamp, foobar2000, iTunes, car head units, ...)
// can read, so playlists made in Aura aren't locked into Aura.
function buildM3U(songs: Song[]): string {
  const lines = ['#EXTM3U']
  for (const song of songs) {
    lines.push(`#EXTINF:${Math.round(song.duration)},${song.artist} - ${song.title}`)
    lines.push(song.path)
  }
  return lines.join('\n')
}

export function useLibraryExport() {
  const [exporting, setExporting] = useState(false)

  const exportPlaylist = async (playlistName: string, songs: Song[]) => {
    if (!isTauriDesktop() || songs.length === 0) return

    setExporting(true)
    try {
      const content = buildM3U(songs)
      await tauriExportPlaylist(`${sanitizeFileName(playlistName)}.m3u`, content)
    } finally {
      setExporting(false)
    }
  }

  return { exportPlaylist, exporting }
}
