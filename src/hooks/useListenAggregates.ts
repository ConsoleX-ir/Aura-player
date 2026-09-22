import { useEffect, useRef, useState } from 'react'
import { getListenAggregates, SCROBBLE_APPENDED_EVENT, type ListenAggregates } from '@/lib/scrobbleStore'

// ── useListenAggregates (Phase 1 — Library 2.0) ─────────────────────────────
// Reactive bridge to the whole-history listening aggregates. Loads once on
// mount, then refreshes (debounced) whenever the playback engine appends a
// scrobble — so "Most Played" reorders itself naturally after you listen,
// without any polling.
//
// The map is shared, cached state from scrobbleStore (a cursor walk of the
// history DB); the hook only owns the React subscription. Until the first
// load resolves it hands out an EMPTY map — every stats-backed sort key
// degrades to a stable tie (library order), which is exactly the right
// "no data yet" behavior for both fresh installs and the pre-hydration frame.

export function useListenAggregates(): ListenAggregates {
  const [map, setMap] = useState<ListenAggregates>(() => new Map())
  const reloadTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let alive = true

    const load = () => {
      getListenAggregates().then((m) => {
        if (alive) setMap(m)
      }).catch(() => { /* fail-soft — empty map is the designed degradation */ })
    }
    load()

    const onAppended = () => {
      window.clearTimeout(reloadTimer.current)
      reloadTimer.current = window.setTimeout(load, 800)
    }
    window.addEventListener(SCROBBLE_APPENDED_EVENT, onAppended)

    return () => {
      alive = false
      window.clearTimeout(reloadTimer.current)
      window.removeEventListener(SCROBBLE_APPENDED_EVENT, onAppended)
    }
  }, [])

  return map
}
