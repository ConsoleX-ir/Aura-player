// ── Smart Radio actions (Phase 7) — the bridge between the pure engine and
// the app. Gathers the engine's context from the live stores + IndexedDB,
// plays the result, and reports honestly via toasts.
//
// This module is deliberately tiny: everything smart lives in
// lib/smartEngine.ts (pure, unit-tested); everything Electron lives in the
// stores. Here we only orchestrate.

import { usePlayerStore } from '@/store/playerStore'
import { toast } from '@/store/toastStore'
import { getListenAggregates, getScrobblesInRange } from '@/lib/scrobbleStore'
import { buildSmartRadio, type SmartResult } from '@/lib/smartEngine'
import { CONTINUE_COUNT } from '@/lib/smartQueue'
import type { Song } from '@/types'

/** Scrobble window used for the hour-of-day context signal. */
const CONTEXT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000 // 60 days

export interface StartRadioOptions {
  /** Seed song — null builds a taste mix instead of a radio. */
  seed?: Song | null
  /** Skip playing immediately (used by Phase 8 queue continuation). */
  play?: boolean
}

/**
 * Gathers everything the engine needs from the live stores + IndexedDB.
 * Returns null when the library is empty (callers handle the honest UI).
 * Shared by the radio actions (Phase 7), the queue continuation and the
 * Smart Playlists page (Phase 8) — ONE gather path, no duplicated logic.
 */
export async function assembleSmartContext(seed?: Song | null) {
  const s = usePlayerStore.getState()
  if (s.library.length === 0) return null
  const now = Date.now()
  const [aggregates, scrobbles] = await Promise.all([
    getListenAggregates(),
    getScrobblesInRange(now - CONTEXT_WINDOW_MS, now).catch(() => []),
  ])
  return {
    seed: s.library.some((x) => x.id === seed?.id) ? seed! : null,
    library: s.library,
    favorites: s.favorites,
    listens: aggregates,
    recentScrobbles: scrobbles.map((sc) => ({ songId: sc.songId, startedAt: sc.startedAt })),
    now,
  }
}

/**
 * Builds and (by default) starts a smart list. Returns the raw engine
 * result so callers (Smart Queue UI in Phase 8) can surface reasons.
 */
export async function buildSmartList(options: StartRadioOptions = {}): Promise<SmartResult | null> {
  const s = usePlayerStore.getState()
  const seed = options.seed ?? null

  // Local songs only — online/radio tracks have no history and leave the
  // library untouched by design.
  if (s.library.length === 0) {
    toast({ kind: 'smart-radio', title: 'Smart Radio', subtitle: 'Your library is empty — import some music first.' })
    return null
  }

  if (seed && !s.library.some((x) => x.id === seed.id)) {
    // Seed is an online/radio track or was removed — degrade to taste mix.
    toast({ kind: 'smart-radio', title: 'Smart Radio', subtitle: 'The seed is not a library track — building from your taste instead.' })
  }

  const ctx = await assembleSmartContext(seed)
  if (!ctx) return null
  const result = buildSmartRadio(ctx)

  if (result.picks.length === 0) {
    toast({ kind: 'smart-radio', title: 'Smart Radio', subtitle: result.notes[0] ?? 'Nothing to recommend right now.' })
    return result
  }
  return result
}

/**
 * Phase 8 — queue continuation: build the next batch of recommendations
 * seeded by the current track, excluding everything already queued or
 * explicitly removed by the user. Returns raw payloads for the store's
 * append action (or null when there is nothing worth adding).
 */
export async function buildContinuation(currentSong: Song, excludeIds: string[]): Promise<{ song: Song; reason: string }[] | null> {
  const ctx = await assembleSmartContext(currentSong)
  if (!ctx) return null
  const result = buildSmartRadio({
    ...ctx,
    seed: ctx.seed ?? currentSong,
    excludeIds,
    config: { targetCount: CONTINUE_COUNT },
  })
  if (result.picks.length === 0) return null
  return result.picks.map((p) => ({
    song: p.song,
    reason: p.reasons[0] ?? 'Recommended by the Smart Music Engine',
  }))
}

/** Build + start playing a smart radio (seeded) or taste mix (unseeded). */
export async function startSmartRadio(seed: Song | null): Promise<void> {
  const result = await buildSmartList({ seed, play: true })
  if (!result || result.picks.length === 0) return

  const s = usePlayerStore.getState()
  const songs = result.picks.map((p) => p.song)
  // The seed (when present and playable) always leads the queue.
  const queue = seed && !songs.some((x) => x.id === seed.id) ? [seed, ...songs] : songs
  const head = seed && queue[0]?.id === seed.id ? seed : queue[0]
  s.playSong(head, queue)

  const flavor = result.mode === 'radio'
    ? `Radio around “${seed?.title ?? ''}”`
    : result.mode === 'taste'
      ? 'Made for you'
      : 'Smart mix'
  toast({
    kind: 'smart-radio',
    title: flavor,
    subtitle: `${queue.length} tracks · ${result.notes[0] ?? 'built from your library and listening history'}`,
  })
}
