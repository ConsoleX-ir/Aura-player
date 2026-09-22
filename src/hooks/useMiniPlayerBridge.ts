import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'

// ── Mini player bridge (v2.1.2) ──────────────────────────────────────────────
// The desktop mini player is a separate BrowserWindow with its own JS context
// — it cannot see this renderer's Zustand stores. This bridge (mounted once,
// in App) is the ONE data path between them:
//
//   push   — tiny serializable snapshots of the playback state on a 250ms
//            cadence (matches the ~4Hz audio 'timeupdate' tick that drives
//            every player surface) plus an immediate push whenever the widget
//            becomes visible, so it never paints a stale frame.
//   sync   — main-process visibility events (minimize auto-show, restore
//            auto-hide, the widget's own close button) land here and update
//            uiStore directly, WITHOUT going through setMiniPlayer — that
//            would send the IPC straight back and echo-loop.
//
// Playback decisions are NEVER made here: transport actions travel
// mini → main process → 'media:command' → useMediaKeys, the same funnel the
// hardware media keys and taskbar thumbar buttons already use.
export function useMiniPlayerBridge() {
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.pushMiniState || !api?.onMiniVisibility) return

    // Phase 15 perf: identical snapshots are NOT pushed. While PAUSED the
    // payload is constant — the old heartbeat still shipped it (and forced
    // the widget window to re-render) 4×/s forever. With the dedupe, a
    // paused widget costs ZERO pushes and zero renders; while playing the
    // progress field changes every tick so the stream is unchanged.
    let lastPushed = ''

    // Authoritative visibility from main → uiStore (direct setState: no echo).
    const offVisibility = api.onMiniVisibility((visible: boolean) => {
      // Show transition forces the next push out even if the snapshot is
      // unchanged — the widget may be freshly created (first show) or have
      // missed updates while hidden, and the contract is "never paints a
      // stale frame on show". Hide just stops the pushes (see dedupe below).
      if (visible) lastPushed = ''
      useUiStore.setState({ miniPlayer: !!visible })
    })

    const snapshot = () => {
      const s = usePlayerStore.getState()
      return {
        hasSong: !!s.currentSong,
        title: s.currentSong?.title ?? 'Nothing playing',
        artist: s.currentSong?.artist ?? 'Aura mini-player',
        coverArt: s.currentSong?.coverArt ?? null,
        isPlaying: s.isPlaying,
        progress: s.duration > 0 ? s.progress : 0,
        appearance: s.appearance,
      }
    }

    // 250ms heartbeat while visible. Progress arrives at ~4Hz from the audio
    // element itself, so this adds at most one redundant frame per second —
    // and buys immunity against any dropped update in either direction.
    // (Dedupe rationale: see the lastPushed note above.)
    const pushIfChanged = () => {
      if (!useUiStore.getState().miniPlayer) return
      const snap = snapshot()
      const key = JSON.stringify(snap)
      if (key === lastPushed) return
      lastPushed = key
      api.pushMiniState!(snap)
    }
    // Fresh state the moment the widget shows up (covers slow IPC start-up,
    // too — the periodic push below then keeps it rolling).
    pushIfChanged()
    const offUi = useUiStore.subscribe(pushIfChanged)

    const interval = setInterval(pushIfChanged, 250)

    return () => {
      offVisibility()
      offUi()
      clearInterval(interval)
    }
  }, [])
}
