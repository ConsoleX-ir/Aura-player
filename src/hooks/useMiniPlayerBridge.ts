import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'
import { effectiveCover, useArtworkStore } from '@/store/artworkStore'

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

    // v3.2.0 fix (found by the Xvfb smoke probe): the FIRST push after a show
    // can race the widget window's boot — a snapshot sent while the mini
    // renderer is still loading is dropped, and with the dedupe above every
    // later identical push (a paused app's snapshot never changes) would be
    // suppressed too, leaving the widget on its initial "Nothing playing"
    // frame forever. After each show we therefore force-push through the
    // dedupe for a bounded 2.5s grace window (~10 heartbeats) so the widget
    // ALWAYS catches at least one full snapshot; steady-state cost is
    // unchanged (zero pushes while paused after grace expires).
    let forceUntil = 0

    // Authoritative visibility from main → uiStore (direct setState: no echo).
    const offVisibility = api.onMiniVisibility((visible: boolean) => {
      // Show transition forces the next push out even if the snapshot is
      // unchanged — the widget may be freshly created (first show) or have
      // missed updates while hidden, and the contract is "never paints a
      // stale frame on show". Hide just stops the pushes (see dedupe below).
      if (visible) {
        lastPushed = ''
        forceUntil = Date.now() + 2500
      }
      useUiStore.setState({ miniPlayer: !!visible })
    })

    const snapshot = () => {
      const s = usePlayerStore.getState()
      const overrides = useArtworkStore.getState().overrides
      // Aura 3.0 — the widget inherits the full theme: the identity id (for
      // data-aura-theme), the RESOLVED accent vars (the dynamic pipeline's
      // output — theme color or artwork ambient, so the widget's accent
      // lighting always matches what the main window shows), and an honest
      // next-up preview. Computed-style reads are ~µs at this cadence.
      const cs = getComputedStyle(document.documentElement)
      const v = (name: string) => cs.getPropertyValue(name).trim()
      // Next-up honesty: repeat-one repeats; shuffle order is not knowable
      // until the skip happens; end-of-queue has no next.
      let nextTitle: string | null = null
      if (s.repeat === 'one') nextTitle = s.currentSong?.title ?? null
      else if (!s.shuffle && s.queue.length && s.queueIndex + 1 < s.queue.length)
        nextTitle = s.queue[s.queueIndex + 1]?.title ?? null
      return {
        hasSong: !!s.currentSong,
        title: s.currentSong?.title ?? 'Nothing playing',
        artist: s.currentSong?.artist ?? 'Aura mini-player',
        coverArt: s.currentSong ? effectiveCover(overrides, s.currentSong) : null,
        isPlaying: s.isPlaying,
        progress: s.duration > 0 ? s.progress : 0,
        // v3.2.0 — the widget renders its own seek bar + elapsed/remaining,
        // and mirrors volume/mute so both surfaces agree.
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
          // v3.2.0 — adaptive on-accent ink (light pass §3), so the widget's
          // accent surfaces keep AA contrast under every theme.
          onAccent: v('--text-on-accent'),
        },
        nextTitle,
      }
    }

    // 250ms heartbeat while visible. Progress arrives at ~4Hz from the audio
    // element itself, so this adds at most one redundant frame per second —
    // and buys immunity against any dropped update in either direction.
    // (Dedupe rationale: see the lastPushed note above; the grace window is
    // the boot-race fix two blocks up.)
    const pushIfChanged = () => {
      if (!useUiStore.getState().miniPlayer) return
      const snap = snapshot()
      const key = JSON.stringify(snap)
      if (key === lastPushed && Date.now() >= forceUntil) return
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
