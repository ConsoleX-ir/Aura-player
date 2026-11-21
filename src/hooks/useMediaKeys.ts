import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { onMediaCommand, onMediaSeek, onMediaVolume } from '@/services/tauriLibrary'

// ── OS-level media integration ──────────────────────────────────────────────
// Wires up Windows integrations, all fed by the same player state —
// no duplicate playback logic, no new surfaces invented:
//
//  1. Hardware/global media keys (Play/Pause/Next/Previous)
//  2. Windows taskbar thumbnail controls
//  3. Windows System Media Transport Controls (navigator.mediaSession)
//
// Under Tauri, commands arrive via events emitted from the Rust side.
// SMTC (navigator.mediaSession) works identically under both.
export function useMediaKeys() {
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentSong = usePlayerStore((s) => s.currentSong)

  // ── Command channel (media keys, thumbar, mini transport) ────────────────
  useEffect(() => {
    const off = onMediaCommand((command) => {
      if (command === 'toggle') usePlayerStore.getState().togglePlay()
      else if (command === 'next') usePlayerStore.getState().nextSong()
      else if (command === 'previous') usePlayerStore.getState().prevSong()
      else if (command === 'mute') usePlayerStore.getState().toggleMute()
    })
    return off
  }, [])

  // ── Mini player seek + volume ──────────────────────────────────────────
  useEffect(() => {
    const offSeek = onMediaSeek((fraction) => {
      if (typeof fraction === 'number' && isFinite(fraction)) {
        usePlayerStore.getState().seekTo(Math.min(1, Math.max(0, fraction)))
      }
    })
    const offVolume = onMediaVolume((volume) => {
      if (typeof volume === 'number' && isFinite(volume)) {
        usePlayerStore.getState().setVolume(Math.min(1, Math.max(0, volume)))
      }
    })
    return () => { offSeek(); offVolume() }
  }, [])

  // ── SMTC: action handlers ──
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const withSong = (fn: (s: ReturnType<typeof usePlayerStore.getState>) => void) => () => {
      const s = usePlayerStore.getState()
      if (s.currentSong) fn(s)
    }
    try {
      ms.setActionHandler('play', withSong((s) => s.setIsPlaying(true)))
      ms.setActionHandler('pause', withSong((s) => s.setIsPlaying(false)))
      ms.setActionHandler('previoustrack', withSong((s) => s.prevSong()))
      ms.setActionHandler('nexttrack', withSong((s) => s.nextSong()))
    } catch { /* progressive enhancement */ }
    return () => {
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
      } catch { /* best-effort */ }
    }
  }, [])

  // ── SMTC: track metadata ──
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

  // ── SMTC: playback state ──
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }, [isPlaying])
}
