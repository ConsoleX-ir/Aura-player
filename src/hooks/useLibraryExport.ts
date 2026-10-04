import { useState } from 'react'
import type { Track } from '@/types'
import { desktop } from '@/services/desktop'

// Sanitizes a playlist name into something safe to use as a filename across
// platforms — strips characters Windows/macOS/Linux all disallow or treat
// specially in file paths.
function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').trim() || 'Playlist'
}

// Builds a standard Extended M3U file — the one playlist format basically
// every media player (VLC, Winamp, foobar2000, iTunes, car head units, ...)
// can read, so playlists made in Aura aren't locked into Aura. Only LOCAL
// tracks export (remote streams have no file path to reference).
function buildM3U(tracks: Track[]): string {
  const lines = ['#EXTM3U']
  for (const track of tracks) {
    if (!track.path) continue
    lines.push(`#EXTINF:${Math.round(track.durationSecs)},${track.artist} - ${track.title}`)
    lines.push(track.path)
  }
  return lines.join('\n')
}

export function useLibraryExport() {
  const [exporting, setExporting] = useState(false)

  const exportPlaylist = async (playlistName: string, tracks: Track[]) => {
    if (!desktop.isDesktop() || tracks.length === 0) return

    setExporting(true)
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const filePath = await save({
        title: 'Export Playlist',
        defaultPath: `${sanitizeFileName(playlistName)}.m3u`,
        filters: [{ name: 'M3U Playlist', extensions: ['m3u'] }],
      })
      if (!filePath) return // user cancelled the dialog

      const content = buildM3U(tracks)
      await desktop.system.exportFile(filePath, content, 'text')
    } finally {
      setExporting(false)
    }
  }

  return { exportPlaylist, exporting }
}
