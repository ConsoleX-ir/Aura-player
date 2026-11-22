import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'
import { useUserPrefsStore } from '@/store/userPrefsStore'
import { effectiveCover, useArtworkStore } from '@/store/artworkStore'
import { isTauriDesktop, tauriMiniPushState, onMiniVisibility, tauriMiniSetVisible } from '@/services/tauriLibrary'

// ── Mini player bridge (v2.1.2) ────────────────────────────────────────────────
// The desktop mini player is a separate window. Under Tauri it is a second
// webview window declared in tauri.conf.json. This bridge (mounted once, in App)
// is the ONE data path between the main renderer and the mini window:
//
//   push   — tiny serializable snapshots of the playback state on a 250ms
//            cadence plus an immediate push whenever the widget becomes visible.
//   sync   — main-process visibility events land here and update uiStore
//            directly, WITHOUT going through setMiniPlayer — that would
//            echo-loop.
//
// Playback decisions are NEVER made here: transport actions travel
// mini → main process → 'media:command' → useMediaKeys, the same funnel the
// hardware media keys and taskbar thumbar buttons already use.
//
// When `miniPlayerEnabled` is false (user settings), the bridge never pushes
// state, never shows the window, and closes it if it happens to be open.
//
// Performance notes (Phase 5):
//   • The store subscription is narrowed to playback-relevant fields
//     (currentSong, isPlaying, volume, muted, duration, theme, appearance,
//     miniLiquidGlass, performanceMode). Progress ticks (~4–10 Hz) are NOT
//     subscribed — they are handled by the 250 ms interval, which is already
//     debounced by the lastPushed / forceUntil guard.
//   • uiStore subscription only fires on miniPlayer visibility changes.
//   • getComputedStyle is only invoked inside snapshot(), which runs only
//     when something actually changed — not on every store mutation.
export function useMiniPlayerBridge() {
  const miniPlayerEnabled = useUserPrefsStore((s) => s.miniPlayerEnabled)

  useEffect(() => {
    if (!isTauriDesktop()) return
    if (!miniPlayerEnabled) {
      // Disabled: make sure the mini window is hidden and stays that way.
      void tauriMiniSetVisible(false).catch(() => { /* window may not exist yet */ })
      return
    }

    let lastPushed = ''
    let forceUntil = 0

    const offVisibility = onMiniVisibility((visible: boolean) => {
      if (visible) {
        lastPushed = ''
        forceUntil = Date.now() + 2500
      }
      useUiStore.setState({ miniPlayer: !!visible })
    })

    const snapshot = (): any => {
      const s = usePlayerStore.getState()
      const overrides = useArtworkStore.getState().overrides
      const cs = getComputedStyle(document.documentElement)
      const v = (name: string) => cs.getPropertyValue(name).trim()
      let nextTitle: string | null = null
      if (s.repeat === 'one') nextTitle = s.currentSong?.title ?? null
      else if (!s.shuffle && s.queue.length && s.queueIndex + 1 < s.queue.length)
        nextTitle = s.queue[s.queueIndex + 1]?.title ?? null
      return {
        hasSong: !!s.currentSong,
        title: s.currentSong?.title ?? 'Nothing playing',
        artist: s.currentSong?.artist ?? 'Aura mini-player',
        coverArt: s.currentSong ? effectiveCover(overrides, s.currentSong) : null,
        songPath: s.currentSong?.path ?? null,
        isPlaying: s.isPlaying,
        progress: s.duration > 0 ? s.progress : 0,
        durationSec: s.duration > 0 ? s.duration : 0,
        volume: s.volume,
        muted: s.muted,
        appearance: s.appearance,
        theme: s.theme,
        liquidGlass: s.miniLiquidGlass,
        perf: s.performanceMode,
        accent: {
          d1: v('--color-dynamic-1'),
          d2: v('--color-dynamic-2'),
          d3: v('--color-dynamic-3'),
          glow: v('--color-dynamic-glow'),
          onAccent: v('--text-on-accent'),
        },
        nextTitle,
      }
    }

    const pushIfChanged = () => {
      if (!useUiStore.getState().miniPlayer) return
      const snap = snapshot()
      const key = JSON.stringify(snap)
      if (key === lastPushed && Date.now() >= forceUntil) return
      lastPushed = key
      void tauriMiniPushState(snap)
    }
    pushIfChanged()
    // Narrow subscription: only push on playback-relevant state changes.
    // Progress ticks (~4–10 Hz) are handled by the 250 ms interval below,
    // not by a per-tick store subscription.
    const offPlayer = usePlayerStore.subscribe((state, prev) => {
      const playbackChanged =
        state.currentSong !== prev.currentSong ||
        state.isPlaying !== prev.isPlaying ||
        state.volume !== prev.volume ||
        state.muted !== prev.muted ||
        state.duration !== prev.duration ||
        state.theme !== prev.theme ||
        state.appearance !== prev.appearance ||
        state.miniLiquidGlass !== prev.miniLiquidGlass ||
        state.performanceMode !== prev.performanceMode
      if (playbackChanged) pushIfChanged()
    })
    const offUi = useUiStore.subscribe((state, prev) => {
      if (state.miniPlayer !== prev.miniPlayer) pushIfChanged()
    })

    const interval = setInterval(pushIfChanged, 250)

    return () => {
      offVisibility()
      offUi()
      offPlayer()
      clearInterval(interval)
    }
  }, [miniPlayerEnabled])

  // When the user toggles the setting off, close the mini window immediately.
  useEffect(() => {
    if (!miniPlayerEnabled) {
      void tauriMiniSetVisible(false).catch(() => { /* window may not exist */ })
    }
  }, [miniPlayerEnabled])
}
