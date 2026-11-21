export interface Song {
  id: string
  path: string
  title: string
  artist: string
  album: string
  duration: number
  coverArt: string | null
  year?: number | null
  genre?: string | null
  trackNumber?: number | null
  // File modification time at the point this song was last (re-)imported —
  // lets Folder Sync detect changed files with a cheap stat instead of
  // re-parsing every file's metadata on every sync.
  mtimeMs?: number
  // Epoch ms when the song first entered the library (v2.1.0) — powers the
  // "Recently Added" sort. Optional because every song imported before
  // v2.1.0 lacks it; those fall back to mtimeMs at sort time (see lib/sort).
  addedAt?: number
  // Phase 4 — online tracks are NOT library entries: `path` holds a stream
  // URL (passed through untouched by the playback engine — no aura:// wrap),
  // and they are excluded from favorites/playlists/health. Local songs
  // simply omit this field.
  source?: 'local' | 'online'
  // Phase 5 — radio streams usually DON'T send CORS headers; the engine must
  // drop its crossOrigin mode for them or they fail to load entirely (the
  // analyser then reads silence — an honest, invisible trade for playback).
  streamCors?: boolean
}

export interface Playlist {
  id: string
  name: string
  songIds: string[]
  createdAt: number
}

export type RepeatMode = 'none' | 'one' | 'all'
// 'rewind' = Aura Rewind (Wave 4) — the monthly listening-story destination.
// 'studio' = Audio Studio (v3.2.0) — the dedicated audio workspace destination.
// 'home' = the Aura Orb landing page (Core Experience redesign) — startup view.
// 'local' = Local Music — device files, distinct from Library's whole-collection view.
export type AppView = 'home' | 'library' | 'local' | 'playlist' | 'favorites' | 'nowplaying' | 'settings' | 'properties' | 'rewind' | 'explore' | 'smart' | 'artist' | 'album' | 'history' | 'studio'

// ── Folder watching (Wave 4) ─────────────────────────────────────────────
// One change event per watched folder, already debounced in the main
// process — the renderer responds by re-running the Folder Sync
// reconciliation for that folder (or all of them, cheap either way).
export interface FolderWatchChange {
  folder: string
  // Main-process epoch ms when the change was first seen (pre-debounce).
  at: number
}

export interface RewindMonthData {
  // Aggregates over the month window (see lib/rewind.ts for the math).
  monthStart: number
  monthEnd: number
  hasData: boolean
  totalPlayedMs: number
  sessions: number
  completed: number
  skipped: number
  uniqueSongs: number
  uniqueArtists: number
  uniqueAlbums: number
  topSongs: { key: string; title: string; artist: string; album: string; ms: number; plays: number }[]
  topArtists: { key: string; name: string; ms: number; plays: number }[]
  topAlbums: { key: string; name: string; artist: string; ms: number; plays: number }[]
  topGenres: { name: string; plays: number }[]
  hourHistogram: number[]        // 24 buckets, session-start counts
  weekdayHistogram: number[]     // 7 buckets, Mon-first, session-start counts
  // Per-day listening totals, day-of-month → ms (0 when silent).
  dayTotals: number[]
  longestStreak: number          // consecutive days with ≥1 scrobble
  mostActiveDay: { day: number; ms: number } | null
  // Cover art (aura:// or file path) for the #1 song/album/artist's top song,
  // resolved at query time from the live library when still available.
  topSongCover: string | null
  // v4.0.3c — the #1 song's source audio path, so the story's cover can
  // self-heal a dead covers-cache file exactly like the other surfaces.
  topSongPath: string | null
  // The color the Rewind story is told in — derived from the top song's art
  // by the caller (useDynamicTheme pipeline), not stored here.
}

// Aggregated local listening stats for one song — computed on demand from
// the append-only scrobble store (see getSongStats in lib/scrobbleStore).
export interface SongListenStats {
  plays: number          // listening sessions (sub-200ms double-clicks excluded)
  completed: number      // sessions that reached ≥90% of the track
  skipped: number        // sessions abandoned before the halfway point
  totalPlayedMs: number  // cumulative audible listen time
  lastPlayedAt: number | null // ms epoch of the most recent session
}

// Technical file properties, fetched on demand by the Properties dialog.
export interface SongFileStats {
  sizeBytes: number
  extension: string
  bitrateKbps: number | null
  sampleRateHz: number | null
  channels: number | null
  codec: string | null
  container: string | null
}

// One de-duplicated candidate returned by the keyless "Find Info Online"
// lookup (Deezer + iTunes + MusicBrainz merged by the shared metadata client).
// `sources` holds which of the three found this candidate, e.g.
// ['deezer','itunes'].
export interface OnlineMatch {
  title: string | null
  artist: string | null
  album: string | null
  year: number | null
  genre: string | null
  durationSec: number | null
  artworkUrl: string | null
  sources: string[]
  links: string[]
  score: number
}

export type FindMetadataQuery = {
  title: string
  artist: string
  album: string
  duration: number
}

// One row of the batch existence check behind Library Health (Phase 1).
export interface PathCheck {
  path: string
  exists: boolean
  sizeBytes: number
  mtimeMs: number
}

// The failure shape the provider core returns over IPC (Phase 3).
export interface ProviderErrorLike {
  kind: string
  message: string
  status?: number
}

/**
 * One playback-snapshot frame pushed from the main renderer to the mini
 * player widget over IPC (v5: a named contract — the bridge has shipped
 * durationSec/volume/muted/liquidGlass/perf since v3.2 and the old inline
 * literals had drifted from what actually flies over the wire).
 */
export interface MiniPlayerSnapshot {
  hasSong: boolean
  title: string
  artist: string
  coverArt: string | null
  isPlaying: boolean
  progress: number
  appearance: 'dark' | 'light'
  /** Aura 3.0 — theme identity + resolved accent vars (artwork-aware). */
  theme?: string
  accent?: { d1: string; d2: string; d3: string; glow: string; onAccent?: string }
  /** Honest next-up preview (null when shuffle/repeat make it unknowable). */
  nextTitle?: string | null
  /** v3.2.0 — widget-hosted seek bar + volume/mute mirror. */
  durationSec: number
  volume: number
  muted: boolean
  /** v3.2.0 — Liquid Glass visual mode + Performance Mode flags. */
  liquidGlass: boolean
  perf: boolean
}

declare global {
  interface Window {}
}

// ── Aura 3.0 domain entities (Wave 1/2) ────────────────────────────────────
// User-owned annotations that live in their OWN persisted stores (never in
// the main player snapshot — keeps the library payload lean and these
// concepts independent of library re-imports). None of this is provider
// metadata; nothing here is ever sent to an external service.

/** A free-form user note attached to one library track (Wave 11 UI). */
export interface TrackNote {
  text: string
  updatedAt: number // epoch ms — drives "edited" hints and search ranking
}

/** A user-chosen artwork image overriding one track's provider/embedded art. */
export interface ArtworkOverride {
  /** aura:// cache URL (via net:cacheArtwork) or a data: URL. */
  url: string
  addedAt: number
}

/** Local-only preferences captured outside the main player store. */
export interface UserPrefs {
  /** Display name for greeting surfaces; '' = not set (optional, never sent anywhere). */
  username: string
  /** First-launch setup flow has been completed (or deliberately skipped). */
  onboarded: boolean
  /** "Set Aura as default player" card dismissed — never nag again (§14). */
  defaultAppPromptDismissed: boolean
  /** Whether the floating Mini Player window is enabled. Default true. */
  miniPlayerEnabled: boolean
}
