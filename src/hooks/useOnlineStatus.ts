import { useCallback, useEffect, useRef, useState } from 'react'

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
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api?.probeOnline) return
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    setProbing(true)
    api.probeOnline()
      .then((ok) => { if (!controller.signal.aborted) setProbedOnline(!!ok) })
      .catch(() => { if (!controller.signal.aborted) setProbedOnline(false) })
      .finally(() => { if (!controller.signal.aborted) setProbing(false) })
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
