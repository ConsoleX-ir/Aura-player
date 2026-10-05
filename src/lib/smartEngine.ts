// ── Aura Smart Music Engine (Phase 7) ───────────────────────────────────────
// A local-first, purely algorithmic ranking engine. NO AI, NO network, NO
// embeddings — every signal comes from the user's own library and IndexedDB
// listening history, and every score is decomposable into human-readable
// reasons ("same artist as your seed", "you finish 9 of 10 plays", …) so a
// recommendation can always be understood and debugged.
//
// Determinism contract: for the same (seed, day, library, history) input the
// output is IDENTICAL. Seeded jitter (FNV-1a → mulberry32) breaks score ties
// reproducibly per seed+day instead of Math.random() — refresh produces the
// same list, tomorrow produces a different (still explainable) one.
//
// Signals (weights are declared constants — tuning happens in ONE place):
//   similarity  seed artist .30 · seed genre .25 · seed album .10 ·
//               year proximity .10 · duration proximity .05
//   familiarity favorites .20 · play-count (log) .20 · completion rate .15
//   aversion    skip rate (≥2 plays) −.25 · recently-played decay −.12
//   context     hour-of-day affinity (last 60d of scrobbles) .08
//   exploration unplayed-novelty .18 · an exploration quota guarantees the
//               list keeps discovering even when familiarity dominates
//
// Cold start is honest: no history → favorites first ("cold-favorites");
// no favorites either → recently added ("cold-library"); empty library →
// empty result with a note. The engine never fabricates affinity it cannot
// measure.

import type { Song } from '@/types'

// ── Public types ─────────────────────────────────────────────────────────────

export interface EngineListen {
  plays: number
  completed: number
  skipped: number
  lastPlayedAt: number | null
}

export interface EngineScrobbleLite {
  songId: string
  startedAt: number
}

export interface SmartConfig {
  /** Max picks per artist in one list — forces artist diversity. */
  artistCap: number
  /** 0..1 — share of the list reserved for never-played tracks. */
  explorationShare: number
  /** Candidates examined before diversity filtering. */
  poolSize: number
  /** Desired list length. */
  targetCount: number
  /** Hour-affinity weight scale 0..1 (0 disables context signal). */
  contextWeight: number
}

export const DEFAULT_SMART_CONFIG: SmartConfig = {
  artistCap: 3,
  explorationShare: 0.2,
  poolSize: 400,
  targetCount: 25,
  contextWeight: 1,
}

export interface SmartPick {
  song: Song
  /** Final score (already includes jitter) — higher is better. */
  score: number
  /** Human-readable reasons, most significant first. */
  reasons: string[]
}

export type SmartMode =
  | 'radio'          // seeded by a song — similarity drives the list
  | 'taste'          // no seed, but real history — familiarity drives it
  | 'cold-favorites' // no usable history — favorites lead
  | 'cold-library'   // no history, no favorites — recently added lead

export interface SmartResult {
  mode: SmartMode
  picks: SmartPick[]
  /** Honest notes about degraded/limited operation (cold start, small pool…). */
  notes: string[]
}

export interface SmartContext {
  /** Seed song (e.g. the track "Start Radio" was clicked on). */
  seed: Song | null
  library: Song[]
  favorites: string[]
  listens: Map<string, EngineListen>
  /** Scrobbles from roughly the last 60 days — hour-of-day affinity. */
  recentScrobbles: EngineScrobbleLite[]
  now: number
  /** Song ids to keep out of the result (already queued, etc.). */
  excludeIds?: string[]
  config?: Partial<SmartConfig>
  /** Overrides the default determinism key (seedId|day). Phase 8 smart
   *  playlists pass `listId|day|nonce` so Regenerate produces a fresh —
   *  still reproducible — ordering. */
  jitterKey?: string
}

// ── Weights (the single tuning table) ────────────────────────────────────────

const W = {
  sameArtist: 0.30,
  sameGenre: 0.25,
  sameAlbum: 0.10,
  yearProximity: 0.10,
  durationProximity: 0.05,
  favorite: 0.20,
  playCount: 0.20,
  completion: 0.15,
  skip: -0.25,
  recentDecay: -0.12,
  hourAffinity: 0.08,
  novelty: 0.18,
} as const

/** Tracks played within this window are "recently heard" → decayed. */
const RECENT_MS = 3 * 60 * 60 * 1000
/** Skip rate only counts once there are enough plays to be meaningful. */
const MIN_PLAYS_FOR_SKIP = 2
/** Hour buckets: 6 buckets of 4h (night/morning/midday/…). */
const HOUR_BUCKETS = 6

// ── Deterministic primitives ─────────────────────────────────────────────────

/** FNV-1a 32-bit — fast, stable across sessions. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 — tiny, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hourBucket = (ts: number): number => {
  const h = new Date(ts).getHours()
  return Math.floor(h / (24 / HOUR_BUCKETS)) % HOUR_BUCKETS
}

const norm = (s: string | null | undefined): string =>
  (s ?? '').trim().toLowerCase()

// ── Scoring ──────────────────────────────────────────────────────────────────

interface Scored {
  song: Song
  score: number
  reasons: string[]
}

/**
 * Scores one candidate. Pure. `seedParts` carries the precomputed seed
 * attributes; `hourHist` is the user's global hour-bucket histogram for the
 * recent window (may be null when there is no history).
 */
function scoreCandidate(
  song: Song,
  listen: EngineListen | undefined,
  isFavorite: boolean,
  seed: Song | null,
  hourHist: number[] | null,
  now: number,
  cfg: SmartConfig,
): Scored {
  const score = { song, score: 0, reasons: [] as string[] }
  let s = 0

  // ── Similarity to the seed (radio mode only) ──
  if (seed && song.id !== seed.id) {
    if (norm(song.artist) && norm(song.artist) === norm(seed.artist)) {
      s += W.sameArtist
      score.reasons.unshift('Same artist as the seed')
    }
    const g1 = norm(song.genre)
    const g2 = norm(seed.genre)
    if (g1 && g2 && g1 === g2) {
      s += W.sameGenre
      score.reasons.unshift(`Same genre (${song.genre})`)
    }
    if (norm(song.album) && norm(song.album) === norm(seed.album)) {
      s += W.sameAlbum
      score.reasons.push('Same album as the seed')
    }
    if (song.year && seed.year) {
      const d = Math.abs(song.year - seed.year)
      if (d <= 15) {
        const part = W.yearProximity * (1 - d / 15)
        s += part
        if (d <= 3) score.reasons.push(`Same era (${song.year})`)
      }
    }
    if (song.duration > 0 && seed.duration > 0) {
      const d = Math.abs(song.duration - seed.duration) / Math.max(song.duration, seed.duration)
      if (d <= 0.35) s += W.durationProximity * (1 - d / 0.35)
    }
  }

  // ── Familiarity (listens) ──
  if (listen && listen.plays > 0) {
    const playPart = W.playCount * Math.min(1, Math.log10(1 + listen.plays) / Math.log10(26)) // 25+ plays ≈ max
    s += playPart
    if (listen.plays >= 5) score.reasons.unshift(`You play this a lot (${listen.plays}×)`)

    const completionRate = listen.completed / listen.plays
    if (completionRate >= 0.5) {
      s += W.completion * completionRate
      if (completionRate >= 0.8) score.reasons.unshift('You usually hear it to the end')
    }

    if (listen.plays >= MIN_PLAYS_FOR_SKIP) {
      const skipRate = listen.skipped / listen.plays
      if (skipRate >= 0.5) {
        s += W.skip * skipRate
        score.reasons.push('You often skip this')
      }
    }

    if (listen.lastPlayedAt != null) {
      const since = now - listen.lastPlayedAt
      if (since < RECENT_MS) {
        const decay = W.recentDecay * (1 - since / RECENT_MS)
        s += decay
        score.reasons.push('Played just recently')
      }
    }
  }

  if (isFavorite) {
    s += W.favorite
    score.reasons.unshift('In your favorites')
  }

  // ── Exploration (novelty) ──
  const unplayed = !listen || listen.plays === 0
  if (unplayed) {
    s += W.novelty * cfg.explorationShare * 5 // 0.18 at the default 0.2 share
    score.reasons.push('New to you — a discovery pick')
  }

  // ── Context: hour-of-day affinity ──
  if (hourHist && cfg.contextWeight > 0) {
    const total = hourHist.reduce((a, b) => a + b, 0)
    if (total >= 10) {
      const bucket = hourBucket(now)
      const share = hourHist[bucket] / total
      const baseline = 1 / HOUR_BUCKETS
      // Only boost when this hour is genuinely over-represented.
      if (share > baseline * 1.25) {
        const part = W.hourAffinity * cfg.contextWeight * Math.min(1, (share - baseline) / (1 - baseline))
        s += part
        // Reasons stay quiet for context — it is the subtlest signal.
      }
    }
  }

  score.score = s
  return score
}

// ── Diversity-aware selection ────────────────────────────────────────────────

/**
 * Greedy pick from an already-scored pool: respects the per-artist cap and
 * guarantees the exploration quota. Pure.
 */
function selectDiverse(
  ranked: Scored[],
  cfg: SmartConfig,
): Scored[] {
  const NOVELTY_REASON = 'New to you — a discovery pick'
  const perArtist = new Map<string, number>()
  const picked: Scored[] = []
  const deferred: Scored[] = []
  let novelPicked = 0
  const explorationQuota = Math.ceil(cfg.explorationShare * cfg.targetCount)

  const artistKey = (song: Song) => norm(song.artist) || 'unknown'

  // Pass 1 — greedy, cap-aware. The whole pool is scanned (no early break):
  // candidates that hit the cap are deferred, and the novel ones among them
  // feed the exploration backfill below.
  for (const cand of ranked) {
    if (picked.length >= cfg.targetCount) {
      deferred.push(cand) // still examined — backfill needs the novel tail
      continue
    }
    const isNovel = cand.reasons.includes(NOVELTY_REASON)
    const artist = artistKey(cand.song)
    const count = perArtist.get(artist) ?? 0

    if (count >= cfg.artistCap) {
      deferred.push(cand)
      continue
    }
    picked.push(cand)
    perArtist.set(artist, count + 1)
    if (isNovel) novelPicked++
  }

  // Pass 2 — exploration quota backfill: if familiar hits crowded out
  // discovery, swap the lowest-scored tail picks for the best deferred
  // novel ones (never demoting an already-novel pick).
  if (novelPicked < explorationQuota) {
    const novel = deferred.filter((c) => c.reasons.includes(NOVELTY_REASON))
    for (let i = picked.length - 1; i >= 0 && novelPicked < explorationQuota && novel.length > 0; i--) {
      const cand = novel.shift()!
      const artist = artistKey(cand.song)
      if ((perArtist.get(artist) ?? 0) >= cfg.artistCap) continue
      const replaced = picked[i]
      if (replaced.reasons.includes(NOVELTY_REASON)) continue
      picked[i] = cand
      perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1)
      novelPicked++
    }
  }

  // Pass 3 — shortfall backfill: a hard artist cap on a monoculture pool can
  // leave the list short. Filling the tail (over the cap, in rank order) is
  // the honest best-available — better a slightly repetitive tail than a
  // mysteriously short list.
  if (picked.length < cfg.targetCount && deferred.length > 0) {
    const inPicked = new Set(picked.map((p) => p.song.id))
    for (const cand of deferred) {
      if (picked.length >= cfg.targetCount) break
      if (inPicked.has(cand.song.id)) continue
      picked.push(cand)
      inPicked.add(cand.song.id)
    }
  }

  return picked
}

// ── Cold-start ordering ──────────────────────────────────────────────────────

function orderColdPicks(
  pool: Song[],
  favorites: Set<string>,
  listens: Map<string, EngineListen>,
  cfg: SmartConfig,
): SmartPick[] {
  // Favorites first, then never-played discoveries, then the rest.
  const fav = pool.filter((s) => favorites.has(s.id))
  const never = pool.filter((s) => !favorites.has(s.id) && (listens.get(s.id)?.plays ?? 0) <= 0)
  const rest = pool.filter((s) => !favorites.has(s.id) && (listens.get(s.id)?.plays ?? 0) > 0)
  const order = [...fav, ...never, ...rest].slice(0, cfg.targetCount)
  return order.map((song) => ({
    song,
    score: favorites.has(song.id) ? W.favorite : 0,
    reasons: favorites.has(song.id)
      ? ['In your favorites']
      : (listens.get(song.id)?.plays ?? 0) <= 0
        ? ['From your library — waiting to be discovered']
        : ['From your library'],
  }))
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Builds a smart, explainable track list. Pure and deterministic given the
 * same inputs (including `now`).
 */
export function buildSmartRadio(ctx: SmartContext): SmartResult {
  const cfg = { ...DEFAULT_SMART_CONFIG, ...ctx.config }
  const notes: string[] = []

  // Unavailable tracks never enter the pool.
  const excluded = new Set(ctx.excludeIds ?? [])
  const pool = ctx.library.filter((s) => !excluded.has(s.id) && s.duration >= 0)

  if (pool.length === 0) {
    return { mode: ctx.seed ? 'radio' : 'taste', picks: [], notes: ['Your library is empty — add some music first.'] }
  }

  // Deterministic per (seed, day) — refresh-safe, debuggable, still varies
  // day to day so the list does not fossilize. An explicit jitterKey (smart
  // playlists, Regenerate) takes precedence.
  const dayKey = new Date(ctx.now).toISOString().slice(0, 10)
  const rng = mulberry32(fnv1a(ctx.jitterKey ?? `${ctx.seed?.id ?? 'taste'}|${dayKey}`))

  // Hour-of-day histogram over the recent scrobble window.
  let hourHist: number[] | null = null
  if (ctx.recentScrobbles.length >= 10) {
    hourHist = new Array(HOUR_BUCKETS).fill(0)
    for (const sc of ctx.recentScrobbles) hourHist[hourBucket(sc.startedAt)]++
  }

  const favorites = new Set(ctx.favorites)
  const seed = ctx.seed && pool.some((p) => p.id === ctx.seed!.id) ? ctx.seed : null
  if (ctx.seed && !seed) notes.push('The seed song is no longer in the library — building from taste instead.')

  const hasHistory = ctx.listens.size > 0 && [...ctx.listens.values()].some((l) => l.plays > 0)

  // ── Cold start paths ──
  if (!seed && !hasHistory) {
    const anyFav = ctx.favorites.some((id) => favorites.has(id) && pool.some((p) => p.id === id))
    if (anyFav) {
      notes.push('Not enough listening history yet — leading with your favorites.')
      return { mode: 'cold-favorites', picks: orderColdPicks(pool, favorites, ctx.listens, cfg), notes }
    }
    notes.push('Not enough listening history yet — leading with recently added tracks.')
    // Recently added lead: addedAt (falls back to mtimeMs) — newest first.
    const byAdded = [...pool].sort((a, b) => (b.addedAt ?? b.mtimeMs ?? 0) - (a.addedAt ?? a.mtimeMs ?? 0))
    return {
      mode: 'cold-library',
      picks: byAdded.slice(0, cfg.targetCount).map((song) => ({
        song,
        score: 0,
        reasons: ['Recently added to your library'],
      })),
      notes,
    }
  }

  // ── Scored path (radio or taste) ──
  const scored: Scored[] = []
  for (const song of pool) {
    if (seed && song.id === seed.id) continue // the seed itself does not rank
    const listen = ctx.listens.get(song.id)
    scored.push(scoreCandidate(song, listen, favorites.has(song.id), seed, hourHist, ctx.now, cfg))
  }

  // Deterministic jitter breaks ties reproducibly (same day+seed → same list).
  const jitterSize = 0.01
  for (const sc of scored) sc.score += rng() * jitterSize

  scored.sort((a, b) => b.score - a.score)
  const ranked = scored.slice(0, cfg.poolSize)

  let picks = selectDiverse(ranked, cfg)

  if (picks.length === 0) {
    // Pool exhausted (e.g. everything excluded) — honest empty.
    return { mode: seed ? 'radio' : 'taste', picks: [], notes }
  }

  // Taste mode (no seed): familiar tracks dominate; re-rank so the head of
  // the list is the strongest mix rather than all-novelty.
  if (!seed) notes.push('Built from your listening history — plays, completions, skips and favorites.')

  return {
    mode: seed ? 'radio' : 'taste',
    picks: picks.map((p) => ({ song: p.song, score: p.score, reasons: p.reasons.slice(0, 4) })),
    notes,
  }
}
