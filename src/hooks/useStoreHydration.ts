import { useEffect, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useNotesStore } from '@/store/notesStore'
import { useArtworkStore } from '@/store/artworkStore'
import { useUserPrefsStore } from '@/store/userPrefsStore'
import { markHydrationComplete } from '@/lib/idbStorage'

/* ── Store hydration gate ────────────────────────────────────────────────────
   Since Wave 1 the persisted store lives in IndexedDB (async) instead of
   localStorage (sync). That means on cold boot there IS a window — a few
   milliseconds on SSD, but real — where the store still holds its defaults
   (library = []) before rehydration lands. Rendering the Library during that
   window flashes the "Your library is empty" state for a frame.

   This hook reports when zustand's persist middleware has finished reading
   storage; App.tsx holds the shell on a branded boot screen until it
   returns true. After the first hydration everything is in-memory and this
   is free.

   Aura 3.0 (Wave 1): the app now has FOUR persisted stores — the main
   player store plus the notes / artwork / user-prefs domain stores. The
   gate waits for ALL of them (cheap — same shared IndexedDB) so a view
   can never observe a hydrated library but default-valued notes/prefs. */
const PERSISTED_STORES = [
  usePlayerStore,
  useNotesStore,
  useArtworkStore,
  useUserPrefsStore,
] as const

function allHydrated(): boolean {
  return PERSISTED_STORES.every((s) => s.persist.hasHydrated())
}

export function useStoreHydration(): boolean {
  const [hydrated, setHydrated] = useState(allHydrated)

  useEffect(() => {
    if (allHydrated()) {
      setHydrated(true)
      // Opens the idbStorage pre-hydration write gate (Wave 0): from this
      // point on, store writes describe complete, hydrated state and are
      // safe to persist.
      markHydrationComplete()
      return
    }
    const unsubs = PERSISTED_STORES.map((s) =>
      s.persist.onFinishHydration(() => {
        if (allHydrated()) {
          setHydrated(true)
          markHydrationComplete()
        }
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [])

  return hydrated
}
