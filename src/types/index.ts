// ── Aura 4 domain types ─────────────────────────────────────────────────────
// One normalized Track model for local files AND online tracks (mirrors the
// Rust `domain::Track` 1:1 — see src-tauri/src/domain.rs). Remote tracks
// never carry their stream URL as identity; sources resolve at play time
// through the provider layer (desktop.playback.resolveSource).

export interface Track {
  /** Local: "l:<path-hash>". Remote: "p:<provider>:<provider track id>". */
  id: string
  kind: 'local' | 'remote'
  title: string
  artist: string
  album: string
  /** Seconds. 0 when unknown (live radio). */
  durationSecs: number
  // ── local-only ──
  path?: string
  sizeBytes?: number
  mtimeMs?: number
  missing?: boolean
  // ── remote-only ──
  provider?: string
  providerTrackId?: string
  // ── shared ──
  year?: number | null
  genre?: string | null
  trackNumber?: number | null
  /** aura-media://art/<file> for cached covers, or an https URL. */
  artworkUrl?: string | null
  addedAt: number
  updatedAt: number
}

export interface Playlist {
  id: string
  name: string
  songIds: string[]
  createdAt: number
}

export type RepeatMode = 'none' | 'one' | 'all'

// Views. The three music SOURCES are library / localmusic / explore; the
// Library destination hosts the curated-collection tabs (All Music,
// Favorites, Playlists, Recently Added).
export type AppView =
  | 'library'
  | 'localmusic'
  | 'explore'
  | 'playlist'
  | 'nowplaying'
  | 'settings'
  | 'properties'
  | 'rewind'
  | 'smart'
  | 'artist'
  | 'album'
  | 'history'
  | 'studio'

/** Tabs inside the Library destination (Aura 4 §20 navigation model). */
export type LibraryTab = 'all' | 'favorites' | 'playlists' | 'recent'

export interface RewindMonthData {
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
  hourHistogram: number[]
  weekdayHistogram: number[]
  dayTotals: number[]
  longestStreak: number
  mostActiveDay: { day: number; ms: number } | null
  topSongCover: string | null
}

export interface SongListenStats {
  plays: number
  completed: number
  skipped: number
  totalPlayedMs: number
  lastPlayedAt: number | null
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
// lookup (Deezer + iTunes + MusicBrainz merged).
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

// One row of the batch existence check behind Library Health.
export interface PathCheck {
  path: string
  exists: boolean
  sizeBytes: number
  mtimeMs: number
}

// ── Aura 3.0 domain entities (user-owned annotations) ───────────────────────
// User notes and artwork overrides live in their own SQLite tables now; the
// shapes below are what the catalog store exposes.

export interface TrackNote {
  text: string
  updatedAt: number
}

export interface ArtworkOverride {
  url: string
  addedAt: number
}

export interface UserPrefs {
  /** Display name for greeting surfaces; '' = not set (never sent anywhere). */
  username: string
  /** First-launch setup flow has been completed (or deliberately skipped). */
  onboarded: boolean
  /** "Set Aura as default player" card dismissed — never nag again. */
  defaultAppPromptDismissed: boolean
}
