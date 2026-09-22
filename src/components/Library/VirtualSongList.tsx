import { SongRow } from './SongRow'
import { useVirtualWindow, VIRTUALIZE_THRESHOLD } from '@/hooks/useVirtualWindow'
import type { Song } from '@/types'
import type { ReactNode } from 'react'

// Must match SongRow's actual rendered height (px-3 py-2 padding + 36px cover art).
// If SongRow's padding or art size ever changes, update this to match or rows
// will visually overlap/gap.
const ROW_HEIGHT = 52

interface VirtualSongListProps {
  songs: Song[]
  queue: Song[]
  playlistId?: string
  /** Must include a bounded height and overflow-y-auto (e.g. 'h-full overflow-y-auto
   *  px-7 pb-4') — this element IS the scroll container the windowing math measures. */
  className?: string
  /** Rendered once above the list, scrolls away with it (matches the old
   *  non-virtualized layout where the column header wasn't sticky). */
  header?: ReactNode
}

export function VirtualSongList({ songs, queue, playlistId, className, header }: VirtualSongListProps) {
  // Windowing math lives in the SHARED hook (Phase 10) — the Listening
  // History page uses the same implementation, so a fix here fixes both.
  // The hook binds scroll/resize listeners once on mount and always attaches
  // the same ref (regardless of branch below), so a list that grows past the
  // virtualize threshold while mounted still measures correctly.
  const vw = useVirtualWindow(songs.length, ROW_HEIGHT)
  const isVirtualized = songs.length >= VIRTUALIZE_THRESHOLD
  const visible = isVirtualized ? songs.slice(vw.start, vw.end) : songs

  return (
    <div ref={vw.containerRef} className={className}>
      {header}
      {isVirtualized ? (
        <div style={{ position: 'relative', height: vw.totalHeight }}>
          {visible.map((song, i) => {
            const realIndex = vw.start + i
            return (
              <div
                key={song.id}
                style={{ position: 'absolute', top: realIndex * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}
              >
                <SongRow song={song} index={realIndex} queue={queue} playlistId={playlistId} />
              </div>
            )
          })}
        </div>
      ) : (
        visible.map((song, i) => (
          <SongRow key={song.id} song={song} index={i} queue={queue} playlistId={playlistId} />
        ))
      )}
    </div>
  )
}
