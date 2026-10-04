import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useCatalogStore, effectiveCover } from '@/store/catalogStore'
import { useUiStore } from '@/store/uiStore'
import { desktop } from '@/services/desktop'

// ── Mini player bridge (§14) ────────────────────────────────────────────────
// The desktop mini player is a separate Tauri window with its own JS context
// — it cannot see this renderer's Zustand stores. This bridge (mounted once,
// in App) is the ONE data path between them:
//
//   push   — tiny serializable snapshots of the playback state on a 250ms
//            cadence (matches the ~4Hz audio 'timeupdate' tick) plus an
//            immediate push whenever the widget becomes visible.
//   sync   — Rust-side visibility events (minimize auto-show, restore
//            auto-hide, the widget's own close button) land here and update
//            uiStore directly, WITHOUT going through setMiniPlayer — that
//            would echo-loop.
//
// Playback decisions are NEVER made here: transport actions travel
// mini → Rust → media://command → useMediaKeys, the same funnel the hardware
// media keys use.
export function useMiniPlayerBridge() {
  useEffect(() => {
    if (!desktop.isDesktop()) return

    // Identical snapshots are NOT pushed. While PAUSED the payload is
    // constant — the old heartbeat shipped it 4x/s forever. With the dedupe,
    // a paused widget costs ZERO pushes and zero renders.
    let lastPushed = ''

    // The FIRST push after a show can race the widget window's boot — a
    // snapshot sent while the mini renderer is still loading is dropped, and
    // with the dedupe every later identical push would be suppressed too.
    // After each show we force-push through the dedupe for a bounded 2.5s
    // grace window (~10 heartbeats) so the widget ALWAYS catches at least one
    // full snapshot.
    let forceUntil = 0

    // Authoritative visibility from Rust → uiStore (direct setState: no echo).
    const offVisibility = desktop.events.onMiniVisibility((visible: boolean) => {
      if (visible) {
        lastPushed = ''
        forceUntil = Date.now() + 2500
      }
      useUiStore.setState({ miniPlayer: !!visible })
    })

    const snapshot = () => {
      const s = usePlayerStore.getState()
      const overrides = useCatalogStore.getState().artworkOverrides
      // The widget inherits the full theme: identity id + RESOLVED accent
      // vars (theme color or artwork ambient) + an honest next-up preview.
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
        artworkUrl: s.currentSong ? effectiveCover(overrides, s.currentSong) : null,
        isPlaying: s.isPlaying,
        progress: s.duration > 0 ? s.progress : 0,
        durationSec: s.duration > 0 ? s.duration : 0,
        volume: s.volume,
        muted: s.muted,
        appearance: s.appearance,
        theme: s.theme,
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
      desktop.windows.mini.pushState(snap)
    }
    pushIfChanged()
    const offUi = useUiStore.subscribe(pushIfChanged)
    const interval = setInterval(pushIfChanged, 250)

    return () => {
      offVisibility.then((u) => u()).catch(() => {})
      offUi()
      clearInterval(interval)
    }
  }, [])
}
