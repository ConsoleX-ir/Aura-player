// ── Aura queue engine ────────────────────────────────────────────────────────
// Pure, side-effect-free queue/ordering logic. No React, no store, no audio,
// no I/O — every function here is unit-testable with plain node:test.
//
// Core invariant this module exists to guarantee:
//   ** The queue IS the actual playback order. ** What the queue view shows
//   is exactly what will play, in the order it will play it — shuffle ON or
//   OFF. (v1.x violated this: shuffle was re-rolled with Math.random() on
//   every skip while the UI displayed a different, cosmetic shuffle.)
//
// Rules (locked in AURA_V2_ROADMAP.md §Wave 1):
//   • Shuffle OFF  → the queue follows the caller's natural ordering.
//   • Shuffle ON   → the queue is a real permutation of the natural order:
//                    no repeats within a pass, current song stays put.
//   • Toggling shuffle never destroys playback state — the current song and
//     its queue position survive the switch in both directions.
//   • Auto-advance (track ended): repeat=all wraps, repeat=none STOPS at the
//     end of the queue (v1.x silently restarted the last song here).
//   • Manual skip (next button / media key): wraps at the end so navigation
//     is never stuck; repeat=one only affects AUTO behavior, a manual next
//     always advances.

export type RepeatMode = 'none' | 'one' | 'all'

export interface QueueItem {
  id: string
}

/**
 * Fisher–Yates shuffle that returns a NEW array (input untouched).
 * The item whose id === keepId keeps its original index — the currently
 * playing song doesn't jump around when shuffle is engaged.
 */
export function shuffledAround<T extends QueueItem>(
  items: readonly T[],
  keepId: string | null,
): T[] {
  const arr = [...items]
  const keepIndex = keepId ? arr.findIndex((x) => x.id === keepId) : -1
  for (let i = arr.length - 1; i > 0; i--) {
    if (i === keepIndex) continue // current song stays anchored
    const j = Math.floor(Math.random() * (i + 1))
    if (j === keepIndex) continue // never drag the anchored item into a swap
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Index to play after the current one, following the queue's REAL order.
 *   auto=false (manual skip): wraps at the end — always a valid index.
 *   auto=true  (track ended naturally):
 *     repeat 'all' → wraps,
 *     repeat 'one' → caller restarts the same track (never reaches here),
 *     repeat 'none'→ null meaning "stop playback" at the end of the queue.
 */
export function nextIndex(
  queueLength: number,
  currentIndex: number,
  repeat: RepeatMode,
  auto: boolean,
): number | null {
  if (queueLength <= 0) return null
  if (auto) {
    if (repeat === 'all') return (currentIndex + 1) % queueLength
    if (currentIndex + 1 >= queueLength) return null // end of queue → stop
    return currentIndex + 1
  }
  return (currentIndex + 1) % queueLength
}

/**
 * Index to play on "previous" (past the restart-current threshold the
 * caller enforces). Steps back in real queue order; wraps to the last item
 * only when repeat=all, otherwise clamps at 0.
 */
export function prevIndex(
  queueLength: number,
  currentIndex: number,
  repeat: RepeatMode,
): number {
  if (queueLength <= 0) return 0
  if (repeat === 'all') return (currentIndex - 1 + queueLength) % queueLength
  return Math.max(currentIndex - 1, 0)
}

/**
 * Result of removing the item at `removeIndex` from a queue whose playhead
 * sits at `currentIndex`. Keeps the playhead pointing at the same song:
 * removing something before it shifts the pointer down; removing the
 * playing item itself is the caller's policy decision (v1.x UI hides the
 * remove button on the active row, and that stays true).
 */
export function indexAfterRemoval(
  currentIndex: number,
  removeIndex: number,
): number {
  if (removeIndex < currentIndex) return currentIndex - 1
  return currentIndex
}

/**
 * Drop every item whose id is in `removedIds` from a queue + playhead pair.
 * Returns null for the new index if the playing item itself was removed —
 * the caller decides what that means (v1.x stops playback).
 */
export function removeByIds<T extends QueueItem>(
  items: readonly T[],
  removedIds: ReadonlySet<string>,
  currentIndex: number,
): { items: T[]; currentIndex: number | null } {
  const currentId = currentIndex >= 0 && currentIndex < items.length
    ? items[currentIndex]?.id
    : undefined
  const next = items.filter((x) => !removedIds.has(x.id))
  if (currentId && removedIds.has(currentId)) return { items: next, currentIndex: null }
  const newIndex = currentId ? next.findIndex((x) => x.id === currentId) : -1
  return { items: next, currentIndex: newIndex >= 0 ? newIndex : 0 }
}

/**
 * Where does `id` sit in `items`? -1 when absent. The caller decides the
 * fallback (the store prepends the song to the queue in that case so
 * next/prev always have a valid anchor — fixing v1.x's silent mispoint to 0).
 */
export function indexOfId<T extends QueueItem>(items: readonly T[], id: string): number {
  return items.findIndex((x) => x.id === id)
}
