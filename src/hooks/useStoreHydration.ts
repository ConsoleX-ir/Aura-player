import { useEffect, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useCatalogStore } from '@/store/catalogStore'
import { useNotesStore } from '@/store/notesStore'
import { useUserPrefsStore } from '@/store/userPrefsStore'
import { markHydrationComplete, cacheBootPrefs } from '@/lib/desktopPrefsStorage'
import { desktop } from '@/services/desktop'

/* ── Boot sequence ───────────────────────────────────────────────────────────
   Aura 4's durable state lives in SQLite (Rust-owned); the renderer stores
   are mirrors. Boot order matters:

   1. desktop.library.snapshot() — ONE round trip carrying the catalog,
      library membership, playlists, favorites, folders, notes, artwork
      overrides AND every persisted preference row.
   2. cacheBootPrefs(prefs) — the persist middleware's storage adapter reads
      from this cache; hydrating the stores afterwards sees real values.
   3. The persisted zustand stores rehydrate (player/notes/user-prefs).
   4. markHydrationComplete() opens the pre-hydration write gate.
   5. The persisted queue (id references) rebuilds against the catalog —
      deleted tracks drop out honestly.

   The gate returns true only after EVERYTHING above, so no view can observe
   a hydrated library with default-valued preferences (or vice versa). */

const PERSISTED_STORES = [
  usePlayerStore,
  useNotesStore,
  useUserPrefsStore,
] as const

function allHydrated(): boolean {
  return PERSISTED_STORES.every((s) => s.persist.hasHydrated())
}

export function useStoreHydration(): boolean {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    let unsubs: (() => void)[] = []

    const boot = async () => {
      try {
        if (desktop.isDesktop()) {
          const snap = await desktop.library.snapshot()
          if (cancelled) return
          cacheBootPrefs(snap.prefs)
          useCatalogStore.getState().hydrateFromSnapshot(snap)
        }
      } catch (err) {
        console.error('Boot snapshot failed — starting with an empty catalog:', err)
      }

      // Wait for every persisted store to finish rehydrating (the storage
      // adapter serves from the boot cache, so this resolves immediately).
      if (allHydrated()) {
        finish()
        return
      }
      unsubs = PERSISTED_STORES.map((s) =>
        s.persist.onFinishHydration(() => {
          if (allHydrated()) finish()
        }),
      )
    }

    const finish = () => {
      if (cancelled) return
      markHydrationComplete()
      // Queue rebuild happens last: preferences are in, the catalog is
      // mirrored, so id references resolve against real tracks.
      usePlayerStore.getState().consumePendingQueueRestore((id) =>
        useCatalogStore.getState().tracks[id],
      )
      setHydrated(true)
    }

    void boot()
    return () => {
      cancelled = true
      unsubs.forEach((u) => u())
    }
  }, [])

  return hydrated
}
