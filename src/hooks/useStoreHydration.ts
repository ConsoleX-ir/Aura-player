import { useEffect, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'

/* ── Store hydration gate ────────────────────────────────────────────────────
   Since Wave 1 the persisted store lives in IndexedDB (async) instead of
   localStorage (sync). That means on cold boot there IS a window — a few
   milliseconds on SSD, but real — where the store still holds its defaults
   (library = []) before rehydration lands. Rendering the Library during that
   window flashes the "Your library is empty" state for a frame.

   This hook reports when zustand's persist middleware has finished reading
   storage; App.tsx holds the shell on a branded boot screen until it
   returns true. After the first hydration everything is in-memory and this
   is free. */
export function useStoreHydration(): boolean {
  const [hydrated, setHydrated] = useState(() => usePlayerStore.persist.hasHydrated())

  useEffect(() => {
    if (usePlayerStore.persist.hasHydrated()) {
      setHydrated(true)
      return
    }
    const unsub = usePlayerStore.persist.onFinishHydration(() => setHydrated(true))
    return unsub
  }, [])

  return hydrated
}
