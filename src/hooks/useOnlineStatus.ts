import { useCallback, useEffect, useRef, useState } from 'react'
import { desktop } from '@/services/desktop'

// ── useOnlineStatus (Phase 3) ────────────────────────────────────────────────
// Honest online awareness for provider-backed surfaces. Three signals, worst
// of wins for "online" (a lie in either direction is bad UI):
//   1. navigator.onLine — instant, optimistic (true ≠ actually online)
//   2. browser online/offline events — instant, same caveat
//   3. a real probe through the main process (HEAD api.audius.co, 4s cap) —
//      the truth, but slow; runs on mount, on offline events, and on demand.
// While a probe is in flight `probing` is true and the UI should not flip
// its state yet; the probe RESULT settles `online`.

export interface OnlineStatus {
  online: boolean
  probing: boolean
  /** Re-run the real probe (after a failed request, before retrying). */
  recheck: () => void
}

export function useOnlineStatus(): OnlineStatus {
  const [browserOnline, setBrowserOnline] = useState(
    () => typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [probedOnline, setProbedOnline] = useState<boolean | null>(null)
  const [probing, setProbing] = useState(false)
  const inFlight = useRef<AbortController | null>(null)

  const probe = useCallback(() => {
    if (!desktop.isDesktop()) return
    setProbing(true)
    desktop.providers.probeOnline()
      .then((v) => {
        // A diagnostic object { ok, kind, detail?, latencyMs } — not a bare
        // boolean, so an "offline" UI state is always explainable.
        setProbedOnline(!!v?.ok)
      })
      .catch(() => setProbedOnline(false))
      .finally(() => setProbing(false))
  }, [])

  useEffect(() => {
    const goOnline = () => { setBrowserOnline(true); setProbedOnline(null); probe() }
    const goOffline = () => { setBrowserOnline(false); setProbedOnline(null); probe() }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    // Initial truth probe — navigator.onLine alone is too optimistic.
    probe()
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
      inFlight.current?.abort()
    }
  }, [probe])

  const online = browserOnline && (probedOnline !== false)

  return { online, probing, recheck: probe }
}
