// ── Smart Queue continuation (Phase 8) ─────────────────────────────────────
// Mounted ONCE in App. Watches the live queue; when Smart Queue is enabled,
// repeat is off, and the queue is about to run dry, asks the engine for the
// next batch (seeded by the current track) and appends it.
//
// Guarantees:
//  - NEVER reorders, removes, or interrupts anything — append-only.
//  - A track the user removed from the queue is never re-added (smartRemovedIds).
//  - One in-flight extension at a time; a failed/empty extension is remembered
//    for that exact queue state so it does not loop.
//  - Online/radio playback (no local seed) is skipped — continuation is a
//    library feature.

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { shouldExtendQueue } from '@/lib/smartQueue'
import { buildContinuation } from '@/lib/smartRadioActions'

export function useSmartQueueContinuation(): void {
  const queue = usePlayerStore((s) => s.queue)
  const queueIndex = usePlayerStore((s) => s.queueIndex)
  const smartQueue = usePlayerStore((s) => s.smartQueue)
  const repeat = usePlayerStore((s) => s.repeat)
  const currentSong = usePlayerStore((s) => s.currentSong)

  const busy = useRef(false)
  const exhaustedKey = useRef<string | null>(null)

  useEffect(() => {
    if (!smartQueue || repeat !== 'none') return
    if (!currentSong || currentSong.source) return
    if (!shouldExtendQueue(queue.length, queueIndex, repeat, true)) return

    const key = `${queue.length}:${queueIndex}:${currentSong.id}`
    if (busy.current || exhaustedKey.current === key) return

    let cancelled = false
    busy.current = true
    const ids = queue.map((s) => s.id)
    const removed = usePlayerStore.getState().smartRemovedIds
    buildContinuation(currentSong, [...ids, ...removed])
      .then((picks) => {
        if (cancelled) return
        if (!picks || picks.length === 0) {
          exhaustedKey.current = key // don't hammer the engine for this state
          return
        }
        usePlayerStore.getState().extendWithSmartPicks(picks)
      })
      .catch(() => {
        // fail-soft: continuation must never break playback
        exhaustedKey.current = key
      })
      .finally(() => {
        busy.current = false
      })
    return () => { cancelled = true }
  }, [queue, queueIndex, smartQueue, repeat, currentSong])
}
