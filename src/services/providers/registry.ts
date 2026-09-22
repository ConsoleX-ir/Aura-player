import type { ProviderInfo } from './types'

// ── Provider registry — the list the UI may iterate ─────────────────────────
// Metadata mirrors what main process registers (electron/providers/*.cjs).
// Keep both in sync — a unit test (scripts/phase3_core.test.ts) requires the
// CJS modules and asserts every registered provider/op is declared here, so
// drift fails CI instead of surfacing as a broken panel.
//
// Capabilities are HONEST declarations, verified against the live APIs
// (2026-09): each capability maps to an op the provider actually exposes.

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'findinfo',
    name: 'Find Info Online',
    kind: 'metadata',
    description: 'Song metadata lookup across Deezer, Apple Music (iTunes), and MusicBrainz — used by the song ⋯ menu.',
    capabilities: { search: true, artistSearch: false, trending: false, stream: false, radioBrowse: false },
    keyless: true,
  },
  {
    id: 'audius',
    name: 'Audius',
    kind: 'streaming',
    description: 'Free, decentralized streaming catalog — search tracks and artists, trending and underground picks, full-track playback. Keyless; queries go through Aura\'s main process only.',
    capabilities: { search: true, artistSearch: true, trending: true, stream: true, radioBrowse: false },
    keyless: true,
  },
  {
    id: 'radiobrowser',
    name: 'Radio Browser',
    kind: 'radio',
    description: 'Community-driven directory of thousands of live radio stations worldwide — browse by country, language, or genre. Keyless; only station lookups leave the app, streams play direct from each station.',
    capabilities: { search: true, artistSearch: false, trending: false, stream: true, radioBrowse: true },
    keyless: true,
  },
]

export function getProviderInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

export function hasCapability(id: string, cap: keyof ProviderInfo['capabilities']): boolean {
  return getProviderInfo(id)?.capabilities[cap] ?? false
}
