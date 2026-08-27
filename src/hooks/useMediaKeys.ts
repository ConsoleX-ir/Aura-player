import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'

// Wires up two OS-level integrations, both handled in the main process:
//  1. Hardware/global media keys (Play/Pause/Next/Previous) — work even
//     when Aura isn't the focused window.
//  2. Windows taskbar thumbnail controls — the small Previous/Play-Pause/
//     Next buttons shown when hovering Aura's icon in the taskbar.
// Both funnel through the same 'media:command' channel from main. The
// taskbar's Play/Pause icon needs to know the current isPlaying state to
// show the right icon, which main has no way to know on its own — this
// hook pushes it up whenever it changes.
export function useMediaKeys() {
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const nextSong = usePlayerStore((s) => s.nextSong)
  const prevSong = usePlayerStore((s) => s.prevSong)

  useEffect(() => {
    if (!window.electronAPI?.onMediaCommand) return

    return window.electronAPI.onMediaCommand((command) => {
      if (command === 'toggle') togglePlay()
      else if (command === 'next') nextSong()
      else if (command === 'previous') prevSong()
    })
  }, [togglePlay, nextSong, prevSong])

  useEffect(() => {
    window.electronAPI?.syncPlaybackState?.(isPlaying)
  }, [isPlaying])
}
