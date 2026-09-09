import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'

// ── OS-level media integration ──────────────────────────────────────────────
// Wires up THREE Windows integrations, all fed by the same player state —
// no duplicate playback logic, no new surfaces invented:
//
//  1. Hardware/global media keys (Play/Pause/Next/Previous) — registered in
//     the main process (globalShortcut); work even when Aura isn't focused.
//  2. Windows taskbar thumbnail controls — the small Previous/Play-Pause/
//     Next buttons shown when hovering Aura's icon in the taskbar (main
//     process setThumbarButtons; icon swap needs the isPlaying push below).
//  3. Windows System Media Transport Controls — v2.1.0. The native media
//     flyout (volume overlay, Win+K, lock screen) with track title, artist,
//     album artwork and live playback state, driven through the standard
//     navigator.mediaSession API. The main process enables Chromium's
//     MediaSessionService feature (see main.cjs) so the OS actually sees the
//     session. Handlers call the SAME store actions as every in-app control;
//     with no song loaded the session is explicitly cleared so Windows stops
//     advertising a stale track.
//
// 1 and 2 funnel through the same 'media:command' channel from main.
// The thumbar's Play/Pause icon needs the current isPlaying state to show
// the right glyph, which main has no way to know on its own — this hook
// pushes it up whenever it changes.
export function useMediaKeys() {
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentSong = usePlayerStore((s) => s.currentSong)

  useEffect(() => {
    if (!window.electronAPI?.onMediaCommand) return

    return window.electronAPI.onMediaCommand((command) => {
      if (command === 'toggle') usePlayerStore.getState().togglePlay()
      else if (command === 'next') usePlayerStore.getState().nextSong()
      else if (command === 'previous') usePlayerStore.getState().prevSong()
    })
  }, [])

  // Push the thumbar icon state to main (existing v1.x integration).
  useEffect(() => {
    window.electronAPI?.syncPlaybackState?.(isPlaying)
  }, [isPlaying])

  // ── SMTC: action handlers — registered once, read state at call time ──
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    // Guarded on currentSong so a stray OS 'play' can never flip isPlaying
    // with nothing loaded (the audio engine's subscription only acts when a
    // song is loaded, but the UI flag would still move).
    const withSong = (fn: (s: ReturnType<typeof usePlayerStore.getState>) => void) => () => {
      const s = usePlayerStore.getState()
      if (s.currentSong) fn(s)
    }
    try {
      ms.setActionHandler('play', withSong((s) => s.setIsPlaying(true)))
      ms.setActionHandler('pause', withSong((s) => s.setIsPlaying(false)))
      ms.setActionHandler('previoustrack', withSong((s) => s.prevSong()))
      ms.setActionHandler('nexttrack', withSong((s) => s.nextSong()))
    } catch {
      // Some handlers can throw on platforms that don't support them —
      // SMTC is a progressive enhancement, never a requirement.
    }
    return () => {
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
      } catch { /* unmount is best-effort too */ }
    }
  }, [])

  // ── SMTC: track metadata (title/artist/album/artwork) ─────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!currentSong) {
      navigator.mediaSession.metadata = null
      return
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title,
        artist: currentSong.artist,
        album: currentSong.album || undefined,
        artwork: currentSong.coverArt
          ? [{ src: currentSong.coverArt, sizes: '512x512' }]
          : [],
      })
    } catch { /* metadata is optional everywhere */ }
  }, [currentSong])

  // ── SMTC: playback state (drives the flyout's play/pause glyph) ───────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying])
}
