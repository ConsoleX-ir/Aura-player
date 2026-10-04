// ── Aura PlaybackController ─────────────────────────────────────────────────
// The app's audio engine: a plain-TypeScript singleton that owns the audio
// element, the Web Audio graph, track-switching, volume/crossfade envelopes,
// and listening-session accounting. React never touches audio directly —
// components talk to the store, the controller subscribes to the store.
// (v1.x did all of this inside a React hook, which coupled engine lifecycle
// to the component tree and made every refactor riskier.)
//
// Audio graph (built once at startup):
//   <audio> → source → EQ[10 bands, reserved] → FX chain → gain → analyser → destination
//
//   • EQ bands: 10 peaking BiquadFilters at 0 dB — acoustically transparent,
//     zero measurable cost — reserved NOW so Wave 3's EQ UI can plug into
//     real filter nodes instead of bolting them onto a running graph later.
//   • FX chain (Aura 3.0 Wave 3): lowshelf → highshelf → compressor →
//     [dry + wet(convolver)] sum → mid/side stereo widener. Every parameter
//     has a neutral value (0 dB / ratio 1 / wet 0 / width 1) so Bypass is the
//     neutral graph — same zero-cost philosophy as the EQ, no branches.
//     The reverb IR is a generated synthetic impulse (no assets, no deps).
//   • gain: user volume × mute × crossfade envelope (single element — the
//     v1.x gain-envelope crossfade is preserved exactly).
//   • analyser: the existing visualizer/Aura-Pulse data source — sits AFTER
//     the FX chain, so visuals honestly reflect what the user hears.
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
import { desktop } from '@/services/desktop'
import { ensureStatsSchemaMeta } from '@/lib/scrobbleStore'
import { sanitizeGains } from '@/lib/eq'
import { sanitizeFx, BASS_SHELF_HZ, TREBLE_SHELF_HZ, compressionParams } from '@/lib/audioFx'
import { clampPreampDb, clampBalance, limiterEngagedParams, limiterNeutralParams } from '@/lib/audioStudio'
import { toast } from '@/store/toastStore'

// ── Module state (singleton — the app has exactly one audio engine) ─────────
let audio: HTMLAudioElement | null = null
let ctx: AudioContext | null = null
let gainNode: GainNode | null = null
let analyserNode: AnalyserNode | null = null
let initialized = false

// ── Audio Studio 3.2 nodes — filled at init, param-updated in place ─────
// Graph order (spec §5.4), all inside the ONE authoritative pipeline:
//   source → preamp → EQ[10] → bass → treble → comp → dry/wet reverb →
//   M/S widener → balance → limiter → master gain(volume) → analyser → out
let preampNode: GainNode | null = null
let balanceNode: StereoPannerNode | null = null
let limiterNode: DynamicsCompressorNode | null = null
// The bypass/enable gates live as VALUES, never as graph branches: when the
// EQ is disabled or the whole studio is bypassed, the nodes simply glide to
// their transparent neutral params (and back when re-enabled). This keeps
// the "no rebuilds, no reconnections" lifecycle rule intact.
let eqEnabledState = true
let bypassState = false

// Reserved EQ slots — filled at init, adjusted by Wave 3's EQ UI.
export const EQ_BAND_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
const eqBands: BiquadFilterNode[] = []

// Aura 3.0 FX nodes — filled at init, driven by applyAudioFx().
let fxBass: BiquadFilterNode | null = null
let fxTreble: BiquadFilterNode | null = null
let fxComp: DynamicsCompressorNode | null = null
let fxWet: GainNode | null = null
let fxDry: GainNode | null = null
let fxSideLevel: GainNode | null = null   // the stereo-width control
let fxConvolver: ConvolverNode | null = null
let fxIrGenerated = false

// Live analyser handle for the VisualizerPanel / future Aura Pulse ring.
// (Same export shape useAudio exposed in v1.x, so existing consumers keep
// working unchanged.)
export const audioAnalyserRef: { current: AnalyserNode | null } = { current: null }

// Generation token for track loads — see doPlay().
let loadGeneration = 0
// The song the engine believes is loaded (store-side id, for change detection).
let currentSongId: string | null = null

// ── Consecutive playback-error guard (Phase 1) ─────────────────────────────
// The error handler auto-skips past bad files, but only this many times in a
// row — after that it stops trying, so a fully broken selection can't turn
// into an endless skip storm. Reset by any successful play/timeupdate.
const MAX_CONSECUTIVE_ERRORS = 5
let consecutiveAudioErrors = 0

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
  // is a no-op until the Audio Studio drives them.
  const preamp = ctx.createGain()
  preamp.gain.value = 1 // 0 dB — transparent
  preampNode = preamp
  let node: AudioNode = ctx.createMediaElementSource(audio)
  node.connect(preamp)
  node = preamp
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

  // ── FX chain (Aura 3.0 Wave 3) — neutral until driven ─────────────────
  const bass = ctx.createBiquadFilter()
  bass.type = 'lowshelf'
  bass.frequency.value = BASS_SHELF_HZ
  bass.gain.value = 0
  const treble = ctx.createBiquadFilter()
  treble.type = 'highshelf'
  treble.frequency.value = TREBLE_SHELF_HZ
  treble.gain.value = 0
  const comp = ctx.createDynamicsCompressor()
  const cp = compressionParams(0)
  comp.threshold.value = cp.threshold
  comp.ratio.value = cp.ratio
  comp.knee.value = cp.knee
  comp.attack.value = cp.attack
  comp.release.value = cp.release
  node.connect(bass); bass.connect(treble); treble.connect(comp)
  fxBass = bass; fxTreble = treble; fxComp = comp

  // Reverb: dry path always runs; wet path rides a generated IR.
  const dry = ctx.createGain(); dry.gain.value = 1
  const wet = ctx.createGain(); wet.gain.value = 0
  comp.connect(dry)
  const convolver = ctx.createConvolver()
  convolver.buffer = null // generated lazily on first use
  comp.connect(convolver); convolver.connect(wet)
  fxDry = dry; fxWet = wet; fxConvolver = convolver

  // Mid/side stereo widener (see applyAudioFx for the math). At width=1 the
  // M/S round-trip reproduces the original L/R exactly (0.5(L+R) ± 0.5(L−R)).
  const splitter = ctx.createChannelSplitter(2)
  const merger = ctx.createChannelMerger(2)
  const midG = ctx.createGain(); midG.gain.value = 0.5
  const sidePos = ctx.createGain(); sidePos.gain.value = 0.5
  const sideNeg = ctx.createGain(); sideNeg.gain.value = -0.5
  const sideLevel = ctx.createGain(); sideLevel.gain.value = 1
  const sideInvert = ctx.createGain(); sideInvert.gain.value = -1
  dry.connect(splitter); wet.connect(splitter)
  splitter.connect(midG, 0); splitter.connect(midG, 1)          // mid = (L+R)/2
  splitter.connect(sidePos, 0); splitter.connect(sideNeg, 1)    // side = (L−R)/2
  sidePos.connect(sideLevel); sideNeg.connect(sideLevel)
  midG.connect(merger, 0, 0); midG.connect(merger, 0, 1)
  sideLevel.connect(merger, 0, 0)                // outL = mid + w·side
  sideLevel.connect(sideInvert); sideInvert.connect(merger, 0, 1) // outR = mid − w·side
  fxSideLevel = sideLevel

  // Balance (v3.2.0) — a plain StereoPanner at pan 0 is bit-transparent.
  const balance = ctx.createStereoPanner()
  balance.pan.value = 0
  balanceNode = balance
  merger.connect(balance)

  // Limiter (v3.2.0) — the protection stage after everything that can add
  // gain (preamp/EQ boosts). At threshold 0 dB + ratio 1 it is transparent;
  // engaged params come from limiterEngagedParams().
  const limiter = ctx.createDynamicsCompressor()
  const lp = limiterNeutralParams()
  limiter.threshold.value = lp.threshold
  limiter.knee.value = lp.knee
  limiter.ratio.value = lp.ratio
  limiter.attack.value = lp.attack
  limiter.release.value = lp.release
  limiterNode = limiter
  balance.connect(limiter)

  limiter.connect(gainNode)
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
    // Reset the error guard ONLY on real audible progress (currentTime > 0).
    // A load reset ALSO fires timeupdate — with currentTime back at 0 — so
    // an unconditional reset here would re-arm the guard on every failed
    // load and the skip-storm cap below could never trip (observed directly
    // with event tracing: emptied → timeupdate(0) → play → error per cycle).
    if (audio.currentTime > 0) consecutiveAudioErrors = 0
  })

  audio.addEventListener('loadedmetadata', () => {
    if (audio && isFinite(audio.duration)) usePlayerStore.getState().setDuration(audio.duration)
  })

  audio.addEventListener('play', () => { lastTickAt = performance.now() })
  audio.addEventListener('pause', () => { accumulateListenTime(); lastTickAt = 0 })

  // ── Playback errors (Phase 1 — Library 2.0) ──────────────────────────────
  // A missing/corrupt/unsupported file used to die silently: isPlaying went
  // false and the user got nothing. Now: a toast names the song, and a
  // GUARDED auto-advance keeps a queue alive across isolated bad files.
  // Guards, in order:
  //   • MEDIA_ERR_ABORTED is benign (a superseded load from rapid switching)
  //     and must never toast or advance;
//   • the auto-advance stops after MAX_CONSECUTIVE_ERRORS failures — a
//     library of broken files can never become an infinite skip storm.
//     The counter resets ONLY in the timeupdate handler (real audible
//     progress): the 'play' event fires on play() INVOCATION even when the
//     media then fails to decode, so resetting there would let every
//     error-advance re-arm itself and defeat the guard entirely (found by
//     the Phase 2 functional suite — the storm ran unbounded).
  audio.addEventListener('error', () => {
    const err = audio?.error
    if (!err || err.code === MediaError.MEDIA_ERR_ABORTED) {
      if (err) console.warn('Audio load aborted (superseded) — ignoring')
      return
    }
    console.error('Audio error — code:', err.code, '| src:', audio?.src)
    const store = usePlayerStore.getState()
    const failed = store.currentSong
    store.setIsPlaying(false)
    if (failed) {
      toast({
        kind: 'playback-error',
        title: `Can't play "${failed.title}"`,
        subtitle: 'The file may be missing, corrupt, or in an unsupported format',
      })
    }
    if (consecutiveAudioErrors >= MAX_CONSECUTIVE_ERRORS || store.queue.length <= 1) return
    consecutiveAudioErrors++
    store.nextSong() // manual-skip semantics — always lands on a playable candidate
  })

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

  // (The old minimal error handler was replaced by the guarded handler
  // above — toast + loop-safe auto-advance. Only one 'error' listener.)

  // Best-effort flush of the in-flight session when the window closes.
  window.addEventListener('beforeunload', () => {
    const { currentSong } = usePlayerStore.getState()
    flushListenSession(currentSong, false)
  })

  // ── Store subscription (the engine's only input channel) ────────────────
  usePlayerStore.subscribe((state, prev) => {
    if (!audio || !ctx) return

    // ── Track removed from the library / library cleared while playing ──
    // removeFromLibrary + clearLibrary null currentSong; without this
    // branch the "song changed" and "play/pause" handlers below both skip
    // (they both require a non-null currentSong) and the AUDIO KEPT
    // PLAYING under an empty UI — a state desync found by the Wave 0
    // persistence/stability audit. Flush the dying session first (the
    // guard inside still matches currentSongId), then silence the element.
    if (!state.currentSong && prev.currentSong) {
      flushListenSession(prev.currentSong, false)
      currentSongId = null
      playedMs = 0
      lastTickAt = 0
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      return
    }

    // ── Track changed ────────────────────────────────────────────────────
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

      // Aura 4 — source resolution goes through the desktop boundary: the
      // opaque aura-media:// protocol serves local files (no raw paths in
      // the renderer), and remote tracks get a FRESH provider stream URL at
      // play time (stream endpoints rotate — never persisted).
      // CORS mode per stream. The analyser chain needs crossOrigin=
      // 'anonymous' (aura-media sends ACAO; Audius sends ACAO:* — verified),
      // but most RADIO streams send none: loading them with crossOrigin set
      // fails outright, so it's dropped for those (the analyser reads
      // silence — playback keeps working).
      const gen = ++loadGeneration
      const doPlay = async () => {
        try {
          const source = await desktop.playback.resolveSource(state.currentSong!.id)
          // Superseded while resolving? Drop the load — a newer song is
          // already in flight.
          if (gen !== loadGeneration) return
          audio!.crossOrigin = source.streamCors ? 'anonymous' : null
          audio!.src = source.url
          audio!.load()
          audio!.currentTime = 0
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

    // ── EQ gains changed (Audio Studio sliders / presets) ────────────────
    if (state.eqGains !== prev.eqGains) {
      applyEqGains(state.eqGains)
    }

    // ── Audio FX changed (Aura 3.0 — Settings effects card) ─────────────
    if (state.audioFx !== prev.audioFx) {
      applyAudioFx(state.audioFx)
    }

    // ── Audio Studio 3.2 stages (preamp / balance / limiter / gates) ────
    if (state.preampDb !== prev.preampDb) applyPreamp(state.preampDb)
    if (state.balance !== prev.balance) applyBalance(state.balance)
    if (state.limiterEnabled !== prev.limiterEnabled) applyLimiter(state.limiterEnabled)
    if (state.eqEnabled !== prev.eqEnabled) {
      eqEnabledState = state.eqEnabled
      applyEqEnabled()
    }
    if (state.studioBypass !== prev.studioBypass) {
      bypassState = state.studioBypass
      applyStudioState(state)
    }
  })

  // Restore whatever EQ shape the user had when they last closed Aura.
  // (New fields in persisted state are simply absent — sanitizeGains turns
  // that into a flat curve, which is the zero-cost bypass.)
  // v3.2.0 — the whole Studio state restores through one gate that honors
  // eqEnabled + studioBypass, so a persisted bypassed state boots bypassed.
  applyStudioState(usePlayerStore.getState())

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
  // Gate: while the EQ is disabled or the studio is bypassed the bands stay
  // transparent — the new curve is kept in the store and lands the moment
  // the gate reopens (applyEqEnabled / applyStudioState).
  if (!eqEnabledState || bypassState) return
  const safe = sanitizeGains(gains)
  for (let i = 0; i < eqBands.length; i++) {
    eqBands[i].gain.setTargetAtTime(safe[i], ctx?.currentTime ?? 0, 0.03)
  }
}

/** Live EQ gains as the engine currently holds them (tests / debug tooling). */
export function getEqGains(): number[] {
  return eqBands.map((b) => b.gain.value)
}

// ── Audio FX (Aura 3.0 Wave 3) ──────────────────────────────────────────────
// Drives the reserved FX chain from one sanitized state object. The reverb
// IR is generated lazily on the first non-zero wet mix — a 1.6 s stereo
// decaying-noise impulse built once and cached, no assets, no dependencies.
// Every parameter writes through setTargetAtTime so live tweaks glide
// instead of clicking.
const IR_SECONDS = 1.6
function ensureReverbIr(): void {
  if (fxIrGenerated || !ctx || !fxConvolver) return
  const rate = ctx.sampleRate
  const len = Math.floor(rate * IR_SECONDS)
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    let lp = 0
    for (let i = 0; i < len; i++) {
      // Decaying diffuse noise with a one-pole lowpass — darkens the tail,
      // which reads as a hall rather than a hiss. Deterministic decay, no
      // randomness in the envelope itself.
      const t = i / len
      const decay = Math.pow(1 - t, 2.4)
      const n = (Math.random() * 2 - 1) * decay
      lp += 0.35 * (n - lp)
      data[i] = lp
    }
    // A few early reflections give the tail a spatial skeleton without an IR asset.
    for (const [ms, amp] of [[11, 0.5], [23, 0.38], [37, 0.27], [53, 0.19]] as const) {
      const idx = Math.floor((ms / 1000) * rate)
      if (idx < len) data[idx] += amp * (ch === 0 ? 1 : -0.8)
    }
  }
  fxConvolver.buffer = buf
  fxIrGenerated = true
}

export function applyAudioFx(input: unknown): void {
  // Bypass gate — same convention as applyEqGains: keep the state, stay
  // transparent. Un-bypassing re-applies everything from the store.
  if (bypassState) return
  const fx = sanitizeFx(input)
  if (fxBass) fxBass.gain.setTargetAtTime(fx.bassGain, ctx?.currentTime ?? 0, 0.04)
  if (fxTreble) fxTreble.gain.setTargetAtTime(fx.trebleGain, ctx?.currentTime ?? 0, 0.04)
  if (fxComp) {
    const cp = compressionParams(fx.compression)
    fxComp.threshold.setTargetAtTime(cp.threshold, ctx?.currentTime ?? 0, 0.04)
    fxComp.ratio.setTargetAtTime(cp.ratio, ctx?.currentTime ?? 0, 0.04)
  }
  if (fxDry && fxWet) {
    // Crossfade dry/wet so the perceived loudness stays roughly constant.
    const wetG = fx.reverbMix > 0 ? Math.min(0.9, fx.reverbMix * 0.9) : 0
    const dryG = fx.reverbMix > 0 ? 1 - fx.reverbMix * 0.35 : 1
    fxDry.gain.setTargetAtTime(dryG, ctx?.currentTime ?? 0, 0.05)
    fxWet.gain.setTargetAtTime(wetG, ctx?.currentTime ?? 0, 0.05)
  }
  if (fx.reverbMix > 0) ensureReverbIr()
  if (fxSideLevel) fxSideLevel.gain.setTargetAtTime(fx.stereoWidth, ctx?.currentTime ?? 0, 0.04)
}

/** Live FX parameters as the engine currently holds them (tests / debug tooling). */
export function getAudioFxSnapshot(): {
  bassGain: number; trebleGain: number; compression: { threshold: number; ratio: number }
  reverbMix: { wet: number; dry: number; irReady: boolean }; stereoWidth: number
} | null {
  if (!fxBass || !fxTreble || !fxComp || !fxDry || !fxWet || !fxSideLevel) return null
  return {
    bassGain: fxBass.gain.value,
    trebleGain: fxTreble.gain.value,
    compression: { threshold: fxComp.threshold.value, ratio: fxComp.ratio.value },
    reverbMix: { wet: fxWet.gain.value, dry: fxDry.gain.value, irReady: fxIrGenerated },
    stereoWidth: fxSideLevel.gain.value,
  }
}

// ── Audio Studio 3.2 — preamp / balance / limiter / gates ───────────────────
// All stage changes are PARAM writes on long-lived nodes (setTargetAtTime
// glides, no disconnects, no rebuilds — spec §5.5). The gates (EQ enable,
// studio bypass) are value-driven neutralization: nodes stay connected,
// parameters glide to their transparent points, so enabling/disabling is
// click-free and costs nothing while idle.

/** Preamp: input gain before the EQ chain, −12…+12 dB (0 = transparent). */
export function applyPreamp(db: number): void {
  if (!preampNode || bypassState) return
  const linear = Math.pow(10, clampPreampDb(db) / 20)
  preampNode.gain.setTargetAtTime(linear, ctx?.currentTime ?? 0, 0.03)
}

/** Balance: −1 hard left … +1 hard right (0 = center, transparent). */
export function applyBalance(pan: number): void {
  if (!balanceNode || bypassState) return
  balanceNode.pan.setTargetAtTime(clampBalance(pan), ctx?.currentTime ?? 0, 0.03)
}

/** Limiter: engaged = true protection stage, false = transparent defaults. */
export function applyLimiter(enabled: boolean): void {
  if (!limiterNode) return
  const p = enabled && !bypassState ? limiterEngagedParams() : limiterNeutralParams()
  const t = ctx?.currentTime ?? 0
  limiterNode.threshold.setTargetAtTime(p.threshold, t, 0.04)
  limiterNode.knee.setTargetAtTime(p.knee, t, 0.04)
  limiterNode.ratio.setTargetAtTime(p.ratio, t, 0.04)
  limiterNode.attack.setTargetAtTime(p.attack, t, 0.04)
  limiterNode.release.setTargetAtTime(p.release, t, 0.04)
}

/**
 * EQ enable gate. Disabled = every band glides to 0 dB (the acoustically
 * transparent state) while the user's curve stays intact in the store —
 * re-enabling restores it exactly. Reads the live store gains.
 */
export function applyEqEnabled(): void {
  const on = eqEnabledState && !bypassState
  const gains = on ? sanitizeGains(usePlayerStore.getState().eqGains ?? []) : new Array(10).fill(0)
  const t = ctx?.currentTime ?? 0
  for (let i = 0; i < eqBands.length; i++) {
    eqBands[i].gain.setTargetAtTime(gains[i], t, 0.03)
  }
}

/**
 * Whole-studio bypass gate. TRUE neutralizes every stage (preamp 0 dB, EQ
 * flat, FX neutral, balance center, limiter transparent); FALSE re-applies
 * the full persisted state. One authoritative gate for the "Reset/Bypass"
 * control in the Audio Studio header — still zero graph branches.
 */
export function applyStudioState(state: {
  eqGains?: number[]
  audioFx?: unknown
  preampDb?: number
  balance?: number
  limiterEnabled?: boolean
}): void {
  const t = ctx?.currentTime ?? 0

  // Preamp
  if (preampNode) {
    const db = bypassState ? 0 : clampPreampDb(state.preampDb ?? 0)
    preampNode.gain.setTargetAtTime(Math.pow(10, db / 20), t, 0.03)
  }

  // EQ bands
  const eqOn = !bypassState && eqEnabledState
  const gains = eqOn ? sanitizeGains(state.eqGains ?? []) : new Array(10).fill(0)
  for (let i = 0; i < eqBands.length; i++) {
    eqBands[i].gain.setTargetAtTime(gains[i], t, 0.03)
  }

  // FX chain
  const fx = bypassState
    ? { bassGain: 0, trebleGain: 0, compression: 0, reverbMix: 0, stereoWidth: 1 }
    : sanitizeFx(state.audioFx)
  if (fxBass) fxBass.gain.setTargetAtTime(fx.bassGain, t, 0.04)
  if (fxTreble) fxTreble.gain.setTargetAtTime(fx.trebleGain, t, 0.04)
  if (fxComp) {
    const cp = compressionParams(fx.compression)
    fxComp.threshold.setTargetAtTime(cp.threshold, t, 0.04)
    fxComp.ratio.setTargetAtTime(cp.ratio, t, 0.04)
  }
  if (fxDry && fxWet) {
    const wetG = fx.reverbMix > 0 ? Math.min(0.9, fx.reverbMix * 0.9) : 0
    const dryG = fx.reverbMix > 0 ? 1 - fx.reverbMix * 0.35 : 1
    fxDry.gain.setTargetAtTime(dryG, t, 0.05)
    fxWet.gain.setTargetAtTime(wetG, t, 0.05)
  }
  if (fx.reverbMix > 0) ensureReverbIr()
  if (fxSideLevel) fxSideLevel.gain.setTargetAtTime(fx.stereoWidth, t, 0.04)

  // Balance
  if (balanceNode) {
    balanceNode.pan.setTargetAtTime(bypassState ? 0 : clampBalance(state.balance ?? 0), t, 0.03)
  }

  // Limiter
  if (limiterNode) {
    const p = !bypassState && state.limiterEnabled ? limiterEngagedParams() : limiterNeutralParams()
    limiterNode.threshold.setTargetAtTime(p.threshold, t, 0.04)
    limiterNode.knee.setTargetAtTime(p.knee, t, 0.04)
    limiterNode.ratio.setTargetAtTime(p.ratio, t, 0.04)
    limiterNode.attack.setTargetAtTime(p.attack, t, 0.04)
    limiterNode.release.setTargetAtTime(p.release, t, 0.04)
  }
}

/** Live Studio stage values as the engine holds them (tests / debug tooling). */
export function getStudioSnapshot(): {
  preampDb: number; balance: number; eqBands: number[]
  limiter: { threshold: number; ratio: number }; bypass: boolean; eqEnabled: boolean
} | null {
  if (!preampNode || !balanceNode || !limiterNode) return null
  return {
    preampDb: 20 * Math.log10(preampNode.gain.value || 1e-6),
    balance: balanceNode.pan.value,
    eqBands: eqBands.map((b) => b.gain.value),
    limiter: { threshold: limiterNode.threshold.value, ratio: limiterNode.ratio.value },
    bypass: bypassState,
    eqEnabled: eqEnabledState,
  }
}
