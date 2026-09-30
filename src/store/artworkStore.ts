import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ArtworkOverride } from '../types'
import { idbStorage } from '../lib/idbStorage.ts'

// ── Custom Artwork domain store (Aura 3.0 Wave 1/2) ─────────────────────────
// Per-track artwork OVERRIDES chosen by the user (Wave 11 UI: track
// properties → artwork → choose image). Persisted separately ('aura-artwork')
// for the same reasons as notes. The override stores a durable URL:
//   • remote candidates are materialized into the main process cover cache
//     first (net:cacheArtwork → aura://…), so the override survives the
//     original host disappearing — same lifetime guarantees as embedded art;
//   • local files are downscaled in the renderer and stored as compact
//     data: URLs (processed at import — never the original megapixel blob).
// Provider metadata is never modified; the override is purely a presentation
// layer resolved at render time via effectiveCover().

interface ArtworkState {
  overrides: Record<string, ArtworkOverride>
  setOverride: (songId: string, url: string) => void
  removeOverride: (songId: string) => void
}

export const useArtworkStore = create<ArtworkState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (songId, url) =>
        set((s) => ({
          overrides: { ...s.overrides, [songId]: { url, addedAt: Date.now() } },
        })),
      removeOverride: (songId) =>
        set((s) => {
          if (!(songId in s.overrides)) return s
          const { [songId]: _drop, ...rest } = s.overrides
          return { overrides: rest }
        }),
    }),
    {
      name: 'aura-artwork',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ overrides: s.overrides }),
    },
  ),
)

/** The artwork a surface should render for a song: user override first, else the song's own. */
export function effectiveCover(
  overrides: Record<string, ArtworkOverride>,
  song: { id: string; coverArt: string | null },
): string | null {
  return overrides[song.id]?.url ?? song.coverArt ?? null
}
