import { useEffect, useRef, useState } from 'react'

// ── Generic virtual-window hook (Phase 10) ──────────────────────────────────
// The windowing math extracted from VirtualSongList so ANY fixed-row-height
// list (library, history, future queue pages) shares ONE implementation.
// Contract: attach `containerRef` to the element that owns scrolling (bounded
// height + overflow-y-auto); the hook tracks scrollTop/viewport and reports
// the [start, end) slice to render.

const DEFAULT_OVERSCAN = 6

export function useVirtualWindow(itemCount: number, rowHeight: number, overscan = DEFAULT_OVERSCAN) {
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

  const totalHeight = itemCount * rowHeight
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(itemCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan)

  return { containerRef, scrollTop, viewportHeight, totalHeight, start, end }
}

/** Below this count, windowing costs more than it saves — render everything. */
export const VIRTUALIZE_THRESHOLD = 60
