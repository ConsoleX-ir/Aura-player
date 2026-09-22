// ── Provider abstraction — renderer side (Phase 3) ──────────────────────────
// The UI never talks to a music service directly. It talks to
// providers via `providerCall` (src/services/providers/client.ts), and every
// provider that exists is declared here with HONEST capabilities. The
// registry (registry.ts) is the list the UI may iterate; the main process
// holds the actual network logic behind an op allowlist (the renderer can
// never fetch an arbitrary URL).
//
// Error model: every failure lands as a ProviderError with one of these
// kinds, so UI surfaces can render the right state instead of a generic
// "something went wrong":
//   offline      — the machine has no usable internet connection
//   timeout      — the provider answered too slowly
//   network      — DNS / connection / cancellation failures
//   http         — the provider answered with a non-OK status
//   rate_limited — the provider asked us to slow down (and we already did)
//   malformed    — the provider answered, but not in the promised shape
//   unavailable  — unknown provider/op asked, or the op has no data source
//   empty        — a successful call that legitimately returned no content

export type ProviderErrorKind =
  | 'offline' | 'timeout' | 'network' | 'http'
  | 'rate_limited' | 'malformed' | 'unavailable' | 'empty'

export interface ProviderErrorPayload {
  kind: ProviderErrorKind
  message: string
  status?: number
}

export class ProviderError extends Error implements ProviderErrorPayload {
  kind: ProviderErrorKind
  status?: number
  constructor(payload: ProviderErrorPayload) {
    super(payload.message)
    this.name = 'ProviderError'
    this.kind = payload.kind
    this.status = payload.status
  }
}

/** What a provider can honestly do — UI builds itself around these. */
export interface ProviderCapabilities {
  /** Text search over its catalog. */
  search: boolean
  /** Artist discovery (search people, not tracks). */
  artistSearch: boolean
  /** Curated/popular content available without a query. */
  trending: boolean
  /** Audio streaming (playable track URLs). */
  stream: boolean
  /** Live radio station browsing by facets (country/language/tag). */
  radioBrowse: boolean
}

export const NO_CAPABILITIES: ProviderCapabilities = {
  search: false,
  artistSearch: false,
  trending: false,
  stream: false,
  radioBrowse: false,
}

export type ProviderKind = 'metadata' | 'streaming' | 'radio'

export interface ProviderInfo {
  id: string
  name: string
  kind: ProviderKind
  description: string
  capabilities: ProviderCapabilities
  /** Keyless = no account, no token, nothing to configure. */
  keyless: boolean
}

/**
 * Every provider search result converges on this shape so provider-agnostic
 * UI (palette, Explore, history) can render anything without branching.
 */
export interface ProviderTrack {
  /** Provider-scoped unique id (NOT the same namespace as library song ids). */
  id: string
  providerId: string
  title: string
  artist: string
  /** Extra display line — album, or radio station country, etc. */
  subtitle?: string
  durationSec: number | null
  /** Remote artwork URL (renderer loads via electronAPI.cacheArtwork when persistence is wanted). */
  artworkUrl: string | null
  /** Streamable: an <audio>-playable URL (redirect-following is fine). */
  streamUrl: string | null
  /** Human-facing page for the track, when the provider has one. */
  permalink: string | null
  /** Popularity signal for ranking (plays / votes / favorites — provider-defined). */
  popularity: number
  isStreamable: boolean
}
