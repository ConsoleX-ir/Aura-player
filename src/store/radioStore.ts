import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { idbStorage } from '@/lib/idbStorage'
import { createJSONStorage } from 'zustand/middleware'

// ── Radio favorites (Phase 5) ───────────────────────────────────────────────
// Stations are live streams, not library songs — they can't ride the library
// favorites list (which resolves songIds against imported files). They get
// their own small persisted store instead: a full snapshot of each favorited
// station so the Radio tab renders favorites even offline / after restarts.
//
// Persistence posture (Wave 0 rules): rides the same idbStorage backend and
// debounced writes as playerStore, so the coordinated shutdown flush covers
// it. Shape is additive — version stays 0, unknown/missing fields degrade
// gracefully because each snapshot IS the data.

export interface RadioStation {
  id: string
  providerId: string
  title: string
  artist: string           // country
  subtitle?: string
  durationSec: null
  artworkUrl: string | null
  streamUrl: string | null
  permalink: string | null
  popularity: number
  isStreamable: boolean
  countrycode?: string | null
  tags?: string[]
  votes?: number
  language?: string | null
}

interface RadioState {
  favorites: RadioStation[]
  toggleFavorite: (station: RadioStation) => void
  removeFavorite: (stationId: string) => void
  isFavorite: (stationId: string) => boolean
}

export const useRadioStore = create<RadioState>()(
  persist(
    (set, get) => ({
      favorites: [],
      toggleFavorite: (station) => set((s) => (
        s.favorites.some((f) => f.id === station.id)
          ? { favorites: s.favorites.filter((f) => f.id !== station.id) }
          : { favorites: [...s.favorites, station] }
      )),
      removeFavorite: (stationId) => set((s) => ({
        favorites: s.favorites.filter((f) => f.id !== stationId),
      })),
      isFavorite: (stationId) => get().favorites.some((f) => f.id === stationId),
    }),
    {
      name: 'aura-radio',
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ favorites: s.favorites }),
    },
  ),
)
