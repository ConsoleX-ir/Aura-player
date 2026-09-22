// ── Smart Queue helpers (Phase 8) ───────────────────────────────────────────
// Pure logic for the queue auto-continuation, kept out of the store so it is
// unit-testable and the store stays a thin shell over it.
//
// Design contract (roadmap): the USER's queue is sovereign. Continuation only
// ever APPENDS marked recommendations when the queue is about to run dry and
// repeat is off; explicit removals are respected (never silently re-added).

import type { Song } from '@/types'

/** How close to the end continuation kicks in (tracks remaining). */
export const CONTINUE_THRESHOLD = 3
/** How many recommendations one continuation appends. */
export const CONTINUE_COUNT = 10

export function shouldExtendQueue(
  queueLength: number,
  queueIndex: number,
  repeat: string,
  enabled: boolean,
): boolean {
  if (!enabled) return false
  if (repeat !== 'none') return false
  if (queueLength === 0) return false
  if (queueIndex < 0 || queueIndex >= queueLength) return false
  return queueLength - 1 - queueIndex < CONTINUE_THRESHOLD
}

export interface SmartPickPayload {
  song: Song
  /** Most significant human-readable reason (for the queue badge tooltip). */
  reason: string
}

/**
 * Appends continuation picks to the queue + natural-order snapshot.
 * - Never touches existing queue members or the index (user priority).
 * - Never appends a song already in the queue or already appended.
 * Returns null when there is nothing to change — the store can skip the set.
 */
export function appendSmartPicks(
  queue: Song[],
  naturalQueue: Song[],
  picks: SmartPickPayload[],
): { queue: Song[]; naturalQueue: Song[]; addedIds: string[]; reasons: Record<string, string> } | null {
  const existing = new Set(queue.map((s) => s.id))
  const added: SmartPickPayload[] = []
  for (const p of picks) {
    if (existing.has(p.song.id)) continue
    existing.add(p.song.id)
    added.push(p)
  }
  if (added.length === 0) return null
  const songs = added.map((p) => p.song)
  const reasons: Record<string, string> = {}
  for (const p of added) reasons[p.song.id] = p.reason
  return {
    queue: [...queue, ...songs],
    naturalQueue: [...naturalQueue, ...songs],
    addedIds: added.map((p) => p.song.id),
    reasons,
  }
}

/** Keep only the smart ids that are still actually in the queue. */
export function pruneSmartIds(ids: string[], queue: Song[]): string[] {
  const live = new Set(queue.map((s) => s.id))
  return ids.filter((id) => live.has(id))
}
