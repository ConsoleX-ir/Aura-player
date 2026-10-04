import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useCatalogStore, effectiveCover } from '@/store/catalogStore'
import { desktop } from '@/services/desktop'

// ── OS-level media integration ──────────────────────────────────────────────
// Wires up THREE Windows integrations, all fed by the same player state —
// no duplicate playback logic, no new surfaces invented:
//
//  1. Hardware/global media keys (Play/Pause/Next/Previous) — registered in
//     Rust (global shortcut plugin); work even when Aura isn't focused.
//  2. System Media Transport Controls (Windows SMTC / MPRIS on Linux where
//     the webview exposes it): the native media flyout driven through the
//     standard navigator.mediaSession API. Handlers call the SAME store
//     actions as every in-app control; with no song loaded the session is
//     explicitly cleared so the OS stops advertising a stale track.
//  3. Mini player transport — v3.2. The widget's asks (seek/volume/mute)
//     arrives on the same narrow channels (media://seek, media://volume).
//
// 1 and 3 funnel through the same media://command channel from Rust.
export function useMediaKeys() {
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const currentSong = usePlayerStore((s) => s.currentSong)

  useEffect(() => {
    if (!desktop.isDesktop()) return
    const off = desktop.events.onMediaCommand((command) => {
      if (command === 'toggle') usePlayerStore.getState().togglePlay()
      else if (command === 'next') usePlayerStore.getState().nextSong()
      else if (command === 'previous') usePlayerStore.getState().prevSong()
      // v3.2.0 — the mini player's mute button rides the same funnel.
      else if (command === 'mute') usePlayerStore.getState().toggleMute()
    })
    return () => { off.then((u) => u()).catch(() => {}) }
  }, [])

  // ── Mini player seek + volume (v3.2.0) ─────────────────────────────
  // The widget never touches the audio element; its asks arrive here and
  // are executed against the SAME store actions every other surface uses —
  // one authoritative playback pipeline, no parallel control paths.
  useEffect(() => {
    if (!desktop.isDesktop()) return
    const offSeek = desktop.events.onMediaSeek((fraction) => {
      if (typeof fraction === 'number' && isFinite(fraction)) {
        usePlayerStore.getState().seekTo(Math.min(1, Math.max(0, fraction)))
      }
    })
    const offVolume = desktop.events.onMediaVolume((volume) => {
      if (typeof volume === 'number' && isFinite(volume)) {
        usePlayerStore.getState().setVolume(Math.min(1, Math.max(0, volume)))
      }
    })
    return () => {
      offSeek.then((u) => u()).catch(() => {})
      offVolume.then((u) => u()).catch(() => {})
    }
  }, [])

  // (Aura 3's thumbar state push has no Tauri equivalent — the taskbar
  // thumbnail controls were a Windows-only Electron API. Documented as a
  // platform limitation; SMTC/mediaSession below still works everywhere.)

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
        artwork: effectiveCover(useCatalogStore.getState().artworkOverrides, currentSong)
          ? [{ src: effectiveCover(useCatalogStore.getState().artworkOverrides, currentSong) as string, sizes: '512x512' }]
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
