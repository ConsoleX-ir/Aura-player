import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { toast } from '@/store/toastStore'

// Watches the Sleep Timer deadline and pauses playback once it's reached.
// Uses a single setTimeout recomputed whenever the deadline changes, rather
// than a polling interval — simpler, no drift, and does nothing at all when
// no timer is set.
export function useSleepTimer() {
  const sleepTimerEndsAt = usePlayerStore((s) => s.sleepTimerEndsAt)
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying)
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer)

  useEffect(() => {
    if (!sleepTimerEndsAt) return

    const msRemaining = sleepTimerEndsAt - Date.now()

    const fire = () => {
      setIsPlaying(false)
      setSleepTimer(null)
      // Music silently stopping is confusing without context ("did it
      // crash?") — say why. The user may be away from the screen, but the
      // card waits for them either way.
      toast({ kind: 'sleep-timer', title: 'Sleep Timer Ended', subtitle: 'Playback paused. Goodnight 🌙' })
    }

    if (msRemaining <= 0) {
      fire()
      return
    }

    const timeout = setTimeout(fire, msRemaining)
    return () => clearTimeout(timeout)
  }, [sleepTimerEndsAt, setIsPlaying, setSleepTimer])
}
