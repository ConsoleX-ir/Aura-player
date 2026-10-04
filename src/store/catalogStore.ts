// ── Aura 4 catalog store ────────────────────────────────────────────────────
// The renderer's mirror of the SQLite catalog (Aura 4 §5/§13). SQLite is the
// source of truth — this store exists so React can render it. Every mutation
// here happens BECAUSE the same mutation went to (or came back from) the
// desktop layer; there is no second persistence pipeline.
//
// The mirror updates three ways:
//   1. boot: desktop.library.snapshot() populates everything at once
//   2. explicit user actions: optimistic local change + await desktop call
//   3. Rust events: watcher reconcile pushes SyncResult diffs straight in

import { create } from 'zustand'
import { desktop } from '@/services/desktop'
import type { Track, Playlist } from '@/types'

interface CatalogState {
  // ── the catalog (all known tracks, local + remote) ──
  tracks: Record<string, Track>
  // ── Library membership (the curated collection) ──
  libraryIds: string[]
  favorites: string[]
  playlists: Playlist[]
  musicFolders: string[]
  notes: Record<string, { text: string; updatedAt: number }>
  artworkOverrides: Record<string, { url: string; addedAt: number }>

  hydrated: boolean

  hydrate: () => Promise<void>
  hydrateFromSnapshot: (snap: import('@/services/desktop').CatalogSnapshot) => void

  // ── derived helpers (plain selectors over the mirror) ──
  byId: (id: string) => Track | undefined

  // ── mutations (mirror + DB) ──
  upsertTracks: (tracks: Track[]) => void
  removeTrackIds: (ids: string[]) => void
  addToLibrary: (ids: string[]) => Promise<void>
  removeFromLibrary: (ids: string[]) => Promise<void>
  toggleFavorite: (trackId: string) => Promise<void>
  createPlaylist: (name: string) => Promise<string | null>
  deletePlaylist: (id: string) => Promise<void>
  renamePlaylist: (id: string, name: string) => Promise<boolean>
  addToPlaylist: (playlistId: string, trackId: string) => Promise<void>
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>
  addMusicFolder: (folder: string) => Promise<void>
  removeMusicFolder: (folder: string) => Promise<void>
  setNote: (trackId: string, text: string) => Promise<void>
  setArtworkOverride: (trackId: string, url: string) => Promise<void>
  removeArtworkOverride: (trackId: string) => Promise<void>
  /** Resolve a dropped path set into catalog tracks (drag-and-drop). */
  applySyncResult: (result: import('@/services/desktop').SyncResult) => void
}

export const useCatalogStore = create<CatalogState>()((set, get) => ({
  tracks: {},
  libraryIds: [],
  favorites: [],
  playlists: [],
  musicFolders: [],
  notes: {},
  artworkOverrides: {},
  hydrated: false,

  hydrate: async () => {
    if (!desktop.isDesktop()) return
    const snap = await desktop.library.snapshot()
    get().hydrateFromSnapshot(snap)
  },

  hydrateFromSnapshot: (snap) => {
    const tracks: Record<string, Track> = {}
    for (const t of snap.tracks) tracks[t.id] = t
    set({
      tracks,
      libraryIds: snap.libraryIds,
      favorites: snap.favorites,
      playlists: snap.playlists,
      musicFolders: snap.musicFolders,
      notes: Object.fromEntries(snap.notes.map((n) => [n.trackId, { text: n.text, updatedAt: n.updatedAt }])),
      artworkOverrides: Object.fromEntries(
        snap.artworkOverrides.map((o) => [o.trackId, { url: o.url, addedAt: o.addedAt }]),
      ),
      hydrated: true,
    })
  },

  byId: (id) => get().tracks[id],

  upsertTracks: (incoming) =>
    set((s) => {
      const tracks = { ...s.tracks }
      for (const t of incoming) tracks[t.id] = t
      return { tracks }
    }),

  removeTrackIds: (ids) =>
    set((s) => {
      const drop = new Set(ids)
      const tracks = { ...s.tracks }
      for (const id of ids) delete tracks[id]
      return {
        tracks,
        libraryIds: s.libraryIds.filter((id) => !drop.has(id)),
        favorites: s.favorites.filter((id) => !drop.has(id)),
        playlists: s.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => !drop.has(id)) })),
      }
    }),

  addToLibrary: async (ids) => {
    set((s) => ({
      libraryIds: [...s.libraryIds, ...ids.filter((id) => !s.libraryIds.includes(id))],
    }))
    if (desktop.isDesktop()) await desktop.library.addToLibrary(ids)
  },

  removeFromLibrary: async (ids) => {
    // Local paths get tombstoned on the Rust side (the FILE stays on disk).
    set((s) => {
      const drop = new Set(ids)
      return {
        libraryIds: s.libraryIds.filter((id) => !drop.has(id)),
        favorites: s.favorites.filter((id) => !drop.has(id)),
        playlists: s.playlists.map((p) => ({ ...p, songIds: p.songIds.filter((id) => !drop.has(id)) })),
      }
    })
    if (desktop.isDesktop()) await desktop.library.removeFromLibrary(ids)
  },

  toggleFavorite: async (trackId) => {
    const wasFavorite = get().favorites.includes(trackId)
    set((s) => ({
      favorites: wasFavorite
        ? s.favorites.filter((id) => id !== trackId)
        : [trackId, ...s.favorites],
    }))
    if (desktop.isDesktop()) await desktop.library.setFavorite(trackId, !wasFavorite)
  },

  createPlaylist: async (name) => {
    const trimmed = name.trim()
    const duplicate = get().playlists.some(
      (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (duplicate || !trimmed) return null
    const id = await desktop.library.playlists.create(trimmed)
    set((s) => ({
      playlists: [...s.playlists, { id, name: trimmed, songIds: [], createdAt: Date.now() }],
    }))
    return id
  },

  deletePlaylist: async (id) => {
    set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }))
    if (desktop.isDesktop()) await desktop.library.playlists.delete(id)
  },

  renamePlaylist: async (id, name) => {
    const trimmed = name.trim()
    const duplicate = get().playlists.some(
      (p) => p.id !== id && p.name.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (duplicate || !trimmed) return false
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) }))
    if (desktop.isDesktop()) await desktop.library.playlists.rename(id, trimmed)
    return true
  },

  addToPlaylist: async (playlistId, trackId) => {
    set((s) => ({
      playlists: s.playlists.map((p) =>
        p.id === playlistId && !p.songIds.includes(trackId)
          ? { ...p, songIds: [...p.songIds, trackId] }
          : p,
      ),
    }))
    if (desktop.isDesktop()) await desktop.library.playlists.addItem(playlistId, trackId)
  },

  removeFromPlaylist: async (playlistId, trackId) => {
    set((s) => ({
      playlists: s.playlists.map((p) =>
        p.id === playlistId ? { ...p, songIds: p.songIds.filter((id) => id !== trackId) } : p,
      ),
    }))
    if (desktop.isDesktop()) await desktop.library.playlists.removeItem(playlistId, trackId)
  },

  addMusicFolder: async (folder) => {
    set((s) => ({
      musicFolders: s.musicFolders.includes(folder) ? s.musicFolders : [...s.musicFolders, folder],
    }))
    if (desktop.isDesktop()) await desktop.library.addMusicFolder(folder)
    if (desktop.isDesktop()) await desktop.library.watchFolders()
  },

  removeMusicFolder: async (folder) => {
    set((s) => ({ musicFolders: s.musicFolders.filter((f) => f !== folder) }))
    if (desktop.isDesktop()) await desktop.library.removeMusicFolder(folder)
    if (desktop.isDesktop()) await desktop.library.watchFolders()
  },

  setNote: async (trackId, text) => {
    const updatedAt = Date.now()
    set((s) => {
      if (!text.trim()) {
        const { [trackId]: _drop, ...rest } = s.notes
        return { notes: rest }
      }
      return { notes: { ...s.notes, [trackId]: { text, updatedAt } } }
    })
    if (desktop.isDesktop()) await desktop.library.notes.set(trackId, text)
  },

  setArtworkOverride: async (trackId, url) => {
    set((s) => ({
      artworkOverrides: { ...s.artworkOverrides, [trackId]: { url, addedAt: Date.now() } },
    }))
    if (desktop.isDesktop()) await desktop.library.artwork.setOverride(trackId, url)
  },

  removeArtworkOverride: async (trackId) => {
    set((s) => {
      const { [trackId]: _drop, ...rest } = s.artworkOverrides
      return { artworkOverrides: rest }
    })
    if (desktop.isDesktop()) await desktop.library.artwork.removeOverride(trackId)
  },

  applySyncResult: (result) => {
    if (result.upsertedTracks.length > 0) get().upsertTracks(result.upsertedTracks)
    if (result.removedTrackIds.length > 0) get().removeTrackIds(result.removedTrackIds)
    // New tracks from reconcile join the Library (Folder Sync contract:
    // tracked folders mirror disk → Library).
    const known = new Set(get().libraryIds)
    const additions = result.upsertedTracks
      .filter((t) => !known.has(t.id))
      .map((t) => t.id)
    if (additions.length > 0 && !known.size) return
    if (result.added > 0) {
      set((s) => ({
        libraryIds: [...s.libraryIds, ...additions.filter((id) => !s.libraryIds.includes(id))],
      }))
    }
  },
}))

// ── derived selectors used across the UI ────────────────────────────────────

/** Library members in membership order (the curated collection). */
export function selectLibraryTracks(s: CatalogState): Track[] {
  return s.libraryIds.map((id) => s.tracks[id]).filter((t): t is Track => !!t)
}

export function selectLibraryCount(s: CatalogState): number {
  return s.libraryIds.length
}

export function selectFavoritesTracks(s: CatalogState): Track[] {
  return s.favorites.map((id) => s.tracks[id]).filter((t): t is Track => !!t)
}

/** The artwork a surface should render: user override first, else the track's own. */
export function effectiveCover(
  overrides: Record<string, { url: string }>,
  track: Pick<Track, 'id' | 'artworkUrl'>,
): string | null {
  return overrides[track.id]?.url ?? track.artworkUrl ?? null
}
