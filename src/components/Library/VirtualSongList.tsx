import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SongRow } from './SongRow'
import type { Song } from '@/types'

// Must match SongRow's actual rendered height (px-3 py-2 padding + 36px cover art).
// If SongRow's padding or art size ever changes, update this to match or rows
// will visually overlap/gap.
const ROW_HEIGHT = 52
const OVERSCAN = 6
const VIRTUALIZE_THRESHOLD = 60

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
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onScroll = () => setScrollTop(el.scrollTop)
    const ro = new ResizeObserver(() => setViewportHeight(el.clientHeight))

    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)
    setViewportHeight(el.clientHeight)

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  // Small lists: skip windowing entirely, render exactly like before.
  // Most playlists fall here — this keeps the common case simple and risk-free.
  //
  // Both branches below share ONE containerRef, attached in a single return
  // (rather than two separate early-returns each with their own JSX). This
  // matters: the scroll/resize effect above only runs once on mount (empty
  // deps). If the ref were only attached in the virtualized branch, a
  // library that starts under VIRTUALIZE_THRESHOLD and later grows past it
  // (e.g. importing more songs while this page is open) would cross into
  // virtualized rendering with no scroll/resize listeners ever bound to it —
  // the list would appear frozen when scrolled, since scrollTop/viewportHeight
  // would still be stuck at their initial 0 values.
  const isVirtualized = songs.length >= VIRTUALIZE_THRESHOLD

  const totalHeight = songs.length * ROW_HEIGHT
  const startIndex = isVirtualized ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN) : 0
  const endIndex = isVirtualized
    ? Math.min(songs.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
    : songs.length
  const visible = songs.slice(startIndex, endIndex)

  return (
    <div ref={containerRef} className={className}>
      {header}
      {isVirtualized ? (
        <div style={{ position: 'relative', height: totalHeight }}>
          {visible.map((song, i) => {
            const realIndex = startIndex + i
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
