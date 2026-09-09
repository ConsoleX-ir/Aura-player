import { useEffect } from 'react'
// Compatibility re-export: VisualizerPanel (and Wave 3's Aura Pulse ring)
// read the live analyser through this path. The engine itself lives in
// playbackController.ts — this hook is only the React mount point.
import { initPlayback, audioAnalyserRef } from '@/lib/playbackController'

export { audioAnalyserRef }

// Mounts the app-wide audio engine exactly once. The controller is a
// module-level singleton with no teardown — it intentionally outlives every
// component, so React's mount/unmount cycle (including StrictMode's dev
// double-mount) can't create or destroy the audio graph anymore.
export function useAudio() {
  useEffect(() => {
    initPlayback()
  }, [])
}
