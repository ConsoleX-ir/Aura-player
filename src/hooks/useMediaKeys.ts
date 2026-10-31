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
      // v3.2.0 — the mini player's mute button rides the same funnel.
      else if (command === 'mute') usePlayerStore.getState().toggleMute()
    })
  }, [])

  // ── Mini player seek + volume (v3.2.0) ─────────────────────────────
  // The widget never touches the audio element; its asks arrive here and
  // are executed against the SAME store actions every other surface uses —
  // one authoritative playback pipeline, no parallel control paths.
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onMediaSeek || !api?.onMediaVolume) return
    const offSeek = api.onMediaSeek((fraction) => {
      if (typeof fraction === 'number' && isFinite(fraction)) {
        usePlayerStore.getState().seekTo(Math.min(1, Math.max(0, fraction)))
      }
    })
    const offVolume = api.onMediaVolume((volume) => {
      if (typeof volume === 'number' && isFinite(volume)) {
        usePlayerStore.getState().setVolume(Math.min(1, Math.max(0, volume)))
      }
    })
    return () => { offSeek(); offVolume() }
  }, [])

  // Push the thumbar icon state to main (existing v1.x integration).
  // v4.0.3e — the same push feeds the mini player's playing-only visibility
  // rule: main shows the widget only while isPlaying is true and hides a
  // visible widget the moment playback stops (a selected-but-paused song is
  // NOT enough to keep it up). Subscribing to currentSong too keeps main's
  // picture honest across every transition — play/pause AND load/unload
  // (queue cleared, playing song removed, restore of the persisted playhead
  // on boot, which changes currentSong while isPlaying stays false).
  useEffect(() => {
    window.electronAPI?.syncPlaybackState?.(isPlaying, !!currentSong)
  }, [isPlaying, currentSong])

  // v4.0.3d — answer main's pre-show revalidation. The minimize auto-show
  // used to trust main's MIRROR of the last player:state-sync push; a stale
  // or delayed push could then surface the widget over an app whose music
  // was not playing (runtime-verified). Main now asks before showing, and
  // this handler — registered once, reading the store at call time like
  // every other media funnel — replies with the LIVE truth. v4.0.3e — the
  // truth the rule needs is "is music ACTUALLY playing right now" (the
  // user's playing-only rule), not merely "is a track loaded": a selected
  // but paused song must never surface the widget.
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onQueryTrackState || !api?.replyTrackState) return
    return api.onQueryTrackState(() => {
      api.replyTrackState(!!usePlayerStore.getState().isPlaying)
    })
  }, [])

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
