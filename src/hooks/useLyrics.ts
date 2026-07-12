import { useEffect, useState } from 'react'
import type { Song } from '@/types'

export interface LrcLine { time: number; text: string }

function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = []
  for (const line of lrc.split('\n')) {
    const m = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/)
    if (m) lines.push({ time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() })
  }
  return lines.sort((a, b) => a.time - b.time)
}

// Strip common junk that gets appended to metadata fields from filenames
// e.g. "Indila BEHMELODY.IN" → "Indila"
function cleanField(raw: string): string {
  return raw
    .replace(/\s+[A-Z0-9]{3,}\.[A-Z]{2,4}$/i, '') // remove "BEHMELODY.IN" suffix
    .replace(/\s*\(.*?\)\s*/g, '')                  // remove (feat. X), (Official), etc
    .replace(/\s*\[.*?\]\s*/g, '')                  // remove [Radio Edit] etc
    .trim()
}

export function useLyrics(song: Song | null) {
  const [lines, setLines]   = useState<LrcLine[]>([])
  const [plain, setPlain]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!song) { setLines([]); setPlain(null); return }

    // Guards against a race: if the user skips songs quickly, an older,
    // slower-to-resolve fetch for a previous song could otherwise resolve
    // *after* the current song's fetch and overwrite its lyrics with stale
    // data. The cleanup below flips this before the next effect run starts,
    // so a late response from an abandoned fetch is silently ignored.
    let cancelled = false

    setLoading(true)
    setLines([])
    setPlain(null)

    const artist = cleanField(song.artist)
    const title  = cleanField(song.title)
    const album  = cleanField(song.album)
    const dur    = Math.round(song.duration)

    const params = new URLSearchParams({
      artist_name: artist,
      track_name:  title,
      album_name:  album,
      duration:    String(dur),
    })

    fetch(`https://lrclib.net/api/get?${params}`)
      .then((r) => {
        if (!r.ok) {
          // Try again without album/duration as fallback
          return fetch(`https://lrclib.net/api/get?${new URLSearchParams({ artist_name: artist, track_name: title })}`)
        }
        return r
      })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled || !data) return
        if (data.syncedLyrics) setLines(parseLrc(data.syncedLyrics))
        else if (data.plainLyrics) setPlain(data.plainLyrics)
      })
      .catch(() => { /* no lyrics */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [song?.id])

  return { lines, plain, loading }
}
