// ── Aura PlaybackController ─────────────────────────────────────────────────
// The app's audio engine: a plain-TypeScript singleton that owns the audio
// element, the Web Audio graph, track-switching, volume/crossfade envelopes,
// and listening-session accounting. React never touches audio directly —
// components talk to the store, the controller subscribes to the store.
// (v1.x did all of this inside a React hook, which coupled engine lifecycle
// to the component tree and made every refactor riskier.)
//
// Audio graph (built once at startup):
//   <audio> → source → EQ[10 bands, reserved] → gain → analyser → destination
//
//   • EQ bands: 10 peaking BiquadFilters at 0 dB — acoustically transparent,
//     zero measurable cost — reserved NOW so Wave 3's EQ UI can plug into
//     real filter nodes instead of bolting them onto a running graph later.
//   • gain: user volume × mute × crossfade envelope (single element — the
//     v1.x gain-envelope crossfade is preserved exactly).
//   • analyser: the existing visualizer/Aura-Pulse data source.
//
// Reliability fixes over v1.x (AURA_V2_ROADMAP audit #1/#3):
//   • Generation tokens on track loads: a superseded play() promise (rapid
//     song switching) can no longer flip isPlaying off while the NEW track
//     is loading — stale rejections are identified by generation and ignored.
//   • Natural track end routes through store.trackEnded(), which STOPS at
//     the end of the queue with repeat=none instead of silently restarting
//     the last song while the UI claimed it was still playing.
//
// Listening history: every track session (start → replace/end) is flushed
// to the local scrobble store (IndexedDB, 100% offline). Fire-and-forget —
// stats can never break playback.

import { usePlayerStore } from '@/store/playerStore'
import { safeAppendScrobble } from '@/lib/scrobbleStore'
import { ensureStatsSchemaMeta } from '@/lib/scrobbleStore'
import { sanitizeGains } from '@/lib/eq'

// ── Module state (singleton — the app has exactly one audio engine) ─────────
let audio: HTMLAudioElement | null = null
let ctx: AudioContext | null = null
let gainNode: GainNode | null = null
let analyserNode: AnalyserNode | null = null
let initialized = false

// Reserved EQ slots — filled at init, adjusted by Wave 3's EQ UI.
export const EQ_BAND_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
const eqBands: BiquadFilterNode[] = []

// Live analyser handle for the VisualizerPanel / future Aura Pulse ring.
// (Same export shape useAudio exposed in v1.x, so existing consumers keep
// working unchanged.)
export const audioAnalyserRef: { current: AnalyserNode | null } = { current: null }

// Generation token for track loads — see doPlay().
let loadGeneration = 0
// The song the engine believes is loaded (store-side id, for change detection).
let currentSongId: string | null = null

// ── Listening session accounting ────────────────────────────────────────────
let sessionStart = 0          // ms epoch when the current session began
let playedMs = 0              // accumulated audible ms in this session
let lastTickAt = 0            // performance.now() of the last accumulation point (0 = not playing)

function accumulateListenTime() {
  // Only meaningful while actually playing — lastTickAt is zeroed on pause.
  if (!lastTickAt) return
  const now = performance.now()
  playedMs += now - lastTickAt
  lastTickAt = now
}

/**
 * Flush the listening session for `song` (which must still be the engine's
 * current song) to the local stats store, then start a fresh session.
 * completed=true marks a natural end-of-track; otherwise completion is
 * derived from the listened ratio. Skips degenerate sub-200ms sessions
 * (rapid double-clicks) to keep the data clean.
 */
function flushListenSession(song: { id: string; title: string; artist: string; album: string } | null, completed: boolean) {
  if (!song || song.id !== currentSongId) return
  accumulateListenTime()
  const { duration } = usePlayerStore.getState()
  if (playedMs >= 200) {
    const playedSec = playedMs / 1000
    safeAppendScrobble({
      songId: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      startedAt: sessionStart,
      playedMs: Math.round(playedMs),
      durationSec: Math.round(duration || 0),
      completed: completed || (!!duration && playedSec >= duration * 0.9),
      skipped: !completed && !!duration && playedSec < duration * 0.5,
    })
  }
  playedMs = 0
  sessionStart = Date.now()
  lastTickAt = audio && !audio.paused ? performance.now() : 0
}

// ── Volume / mute / crossfade envelope ──────────────────────────────────────
// Identical semantics to v1.x: mute is applied on the gain node (slider
// value stays visible, unmute restores bit-perfectly), and the crossfade
// setting shapes a fade-out tail / fade-in head around the user volume.
function applyFadeEnvelope() {
  if (!gainNode || !audio) return
  const { volume, crossfade, muted } = usePlayerStore.getState()
  const d = audio.duration
  const base = muted ? 0 : volume
  if (!crossfade || !d || !isFinite(d)) {
    gainNode.gain.value = base
    return
  }
  const t = audio.currentTime
  const fadeIn = t < crossfade ? t / crossfade : 1
  const fadeOut = (d - t) < crossfade ? Math.max(0, (d - t) / crossfade) : 1
  gainNode.gain.value = base * Math.min(fadeIn, fadeOut)
}

// ── Init ────────────────────────────────────────────────────────────────────
// Idempotent: safe under React StrictMode's double-mount and any future
// re-mount attempts. No teardown — the engine lives as long as the app.
export function initPlayback() {
  if (initialized) return
  initialized = true

  audio = new Audio()
  audio.preload = 'auto'
  // Required so the aura:// handler's CORS headers keep the element
  // decodable by the Web Audio graph (and by extension the analyser).
  audio.crossOrigin = 'anonymous'

  ctx = new AudioContext()
  gainNode = ctx.createGain()
  analyserNode = ctx.createAnalyser()
  analyserNode.fftSize = 2048
  analyserNode.smoothingTimeConstant = 0.8

  // EQ: 10 reserved peaking bands — 0 dB gain is transparent, so this chain
  // is a no-op until Wave 3 gives the bands an API + UI.
  let node: AudioNode = ctx.createMediaElementSource(audio)
  for (const freq of EQ_BAND_FREQS) {
    const band = ctx.createBiquadFilter()
    band.type = 'peaking'
    band.frequency.value = freq
    band.Q.value = 1
    band.gain.value = 0
    node.connect(band)
    node = band
    eqBands.push(band)
  }
  node.connect(gainNode)
  gainNode.connect(analyserNode)
  analyserNode.connect(ctx.destination)

  gainNode.gain.value = usePlayerStore.getState().volume
  audioAnalyserRef.current = analyserNode

  // ── Audio element events ────────────────────────────────────────────────
  audio.addEventListener('timeupdate', () => {
    if (!audio) return
    const d = audio.duration
    if (d && isFinite(d)) usePlayerStore.getState().setProgress(audio.currentTime / d)
    accumulateListenTime()
    applyFadeEnvelope()
  })

  audio.addEventListener('loadedmetadata', () => {
    if (audio && isFinite(audio.duration)) usePlayerStore.getState().setDuration(audio.duration)
  })

  audio.addEventListener('play', () => { lastTickAt = performance.now() })
  audio.addEventListener('pause', () => { accumulateListenTime(); lastTickAt = 0 })

  audio.addEventListener('ended', () => {
    const store = usePlayerStore.getState()
    if (store.repeat === 'one') {
      // Continuous repeat of the same track: restart the element, reset the
      // UI progress (v1.x left the bar pinned at ~100%), and open a fresh
      // listening session — each loop is its own scrobble row.
      flushListenSession(store.currentSong, true)
      if (!audio) return
      audio.currentTime = 0
      audio.play().catch(() => {})
      usePlayerStore.getState().setProgress(0)
    } else {
      // Natural end. Flush THIS session (it completed) before the store
      // advances — the switch handler only flushes sessions that never saw
      // an 'ended' event, so together both paths cover every song change
      // exactly once.
      flushListenSession(store.currentSong, true)
      usePlayerStore.getState().trackEnded()
    }
  })

  audio.addEventListener('error', () => {
    const err = audio?.error
    console.error('Audio error — code:', err?.code, '| src:', audio?.src)
    usePlayerStore.getState().setIsPlaying(false)
  })

  // Best-effort flush of the in-flight session when the window closes.
  window.addEventListener('beforeunload', () => {
    const { currentSong } = usePlayerStore.getState()
    flushListenSession(currentSong, false)
  })

  // ── Store subscription (the engine's only input channel) ────────────────
  usePlayerStore.subscribe((state, prev) => {
    if (!audio || !ctx) return

    // ── Song changed ────────────────────────────────────────────────────
    if (state.currentSong && state.currentSong.id !== currentSongId) {
      // Flush the previous song's session (unless 'ended' already did it —
      // flushListenSession self-guards by song id, so a double flush is
      // structurally impossible: after 'ended' flushed it, playedMs is 0
      // AND the song id no longer matches currentSongId... actually the
      // guard below is what makes the 'ended'→switch path safe).
      const prevSong = prev.currentSong
      if (prevSong && prevSong.id !== state.currentSong.id) {
        flushListenSession(prevSong, false)
      }

      const wasPlaying = state.isPlaying
      currentSongId = state.currentSong.id
      sessionStart = Date.now()
      playedMs = 0
      lastTickAt = 0

      const isElectron = typeof window !== 'undefined' && !!window.electronAPI
      const params = new URLSearchParams({ path: state.currentSong.path })
      audio.src = isElectron ? `aura://local?${params.toString()}` : state.currentSong.path
      audio.load()
      audio.currentTime = 0

      // Generation token: if another song is requested before this play()
      // settles, this promise's rejection is stale and MUST NOT touch the
      // store (v1.x bug: the aborted play of song A flipped isPlaying off
      // while song B was loading).
      const gen = ++loadGeneration
      const doPlay = async () => {
        try {
          if (ctx!.state === 'suspended') await ctx!.resume()
          await audio!.play()
          if (gen === loadGeneration) applyFadeEnvelope()
        } catch (e) {
          if (gen !== loadGeneration) return // superseded — not our state to change
          console.error('Play failed:', e)
          usePlayerStore.getState().setIsPlaying(false)
        }
      }
      if (wasPlaying) doPlay()
    }

    // ── Play/pause toggled (same song) ──────────────────────────────────
    if (state.isPlaying !== prev.isPlaying && state.currentSong?.id === currentSongId) {
      if (state.isPlaying) {
        if (ctx.state === 'suspended') ctx.resume()
        const gen = loadGeneration
        audio.play().catch(() => {
          if (gen === loadGeneration) usePlayerStore.getState().setIsPlaying(false)
        })
      } else {
        audio.pause()
      }
    }

    // ── Volume / mute ───────────────────────────────────────────────────
    if ((state.volume !== prev.volume || state.muted !== prev.muted)) {
      applyFadeEnvelope()
    }

    // ── Seek ────────────────────────────────────────────────────────────
    if (state.seekRequest !== null && state.seekRequest !== prev.seekRequest) {
      const d = audio.duration
      if (d && isFinite(d)) audio.currentTime = state.seekRequest * d
      usePlayerStore.getState().clearSeekRequest()
    }

    // ── EQ gains changed (Settings sliders / presets) ───────────────────
    if (state.eqGains !== prev.eqGains) {
      applyEqGains(state.eqGains)
    }
  })

  // Restore whatever EQ shape the user had when they last closed Aura.
  // (New fields in persisted state are simply absent — sanitizeGains turns
  // that into a flat curve, which is the zero-cost bypass.)
  applyEqGains(usePlayerStore.getState().eqGains ?? [])

  // Stats schema marker — fire-and-forget, purely for future migrations.
  ensureStatsSchemaMeta()

  // Exposed for Wave 3's EQ UI (not used anywhere yet — reserved).
  void eqBands
}

/** Direct analyser access for render loops (VisualizerPanel etc.). */
export function getAnalyser(): AnalyserNode | null {
  return analyserNode
}

// ── EQ (Wave 3) ─────────────────────────────────────────────────────────────
// Applies per-band dB gains to the reserved BiquadFilter chain. Flat (all
// zeros) IS the bypass: a peaking filter at 0 dB is acoustically transparent,
// so no routing/branch is ever needed. Clamped to ±12 dB, sanitized against
// corrupted or foreign persisted state.
export function applyEqGains(gains: number[]): void {
  const safe = sanitizeGains(gains)
  for (let i = 0; i < eqBands.length; i++) {
    eqBands[i].gain.setTargetAtTime(safe[i], ctx?.currentTime ?? 0, 0.03)
  }
}

/** Live EQ gains as the engine currently holds them (tests / debug tooling). */
export function getEqGains(): number[] {
  return eqBands.map((b) => b.gain.value)
}
