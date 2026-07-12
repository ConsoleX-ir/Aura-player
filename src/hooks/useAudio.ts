import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'

export const audioAnalyserRef = { current: null as AnalyserNode | null }

export function useAudio() {
  const audioRef  = useRef<HTMLAudioElement | null>(null)
  const ctxRef    = useRef<AudioContext | null>(null)
  const gainRef   = useRef<GainNode | null>(null)
  const songIdRef = useRef<string | null>(null)

  useEffect(() => {
    // جلوگیری از ساخت دوباره در React StrictMode (dev)
    if (audioRef.current) return

    const audio = new Audio()
    audio.preload = 'auto'
    audio.crossOrigin = 'anonymous'
    audioRef.current = audio

    // Build Web Audio graph
    const ctx      = new AudioContext()
    const gain     = ctx.createGain()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8

    // Source → Gain → Analyser → Output
    // MUST connect source before setting audio.src
    const source = ctx.createMediaElementSource(audio)
    source.connect(gain)
    gain.connect(analyser)
    analyser.connect(ctx.destination)
    gain.gain.value = usePlayerStore.getState().volume

    ctxRef.current = ctx
    gainRef.current = gain
    audioAnalyserRef.current = analyser

    // ── Event listeners ──────────────────────────────────────────────────
    // Crossfade — the Settings slider stored this value but nothing ever
    // read it. Implemented as a gain envelope on the existing single audio
    // element/graph rather than a second overlapping audio element: fades
    // the tail of a song out over the last `crossfade` seconds, and fades a
    // freshly-started song in over its first `crossfade` seconds. Since
    // onEnded already fires right as the fade-out reaches ~0, this produces
    // a smooth fade-to-silence into fade-in-from-silence transition without
    // the added complexity/risk of running two audio elements in parallel.
    // When crossfade is 0 (the default), this is a no-op — gain is just set
    // to the plain volume, identical to the previous behavior.
    const applyFadeEnvelope = () => {
      if (!gainRef.current) return
      const { volume, crossfade } = usePlayerStore.getState()
      const d = audio.duration

      if (!crossfade || !d || !isFinite(d)) {
        gainRef.current.gain.value = volume
        return
      }

      const t = audio.currentTime
      const fadeInFactor  = t < crossfade ? t / crossfade : 1
      const fadeOutFactor = (d - t) < crossfade ? Math.max(0, (d - t) / crossfade) : 1
      gainRef.current.gain.value = volume * Math.min(fadeInFactor, fadeOutFactor)
    }

    const onTimeUpdate = () => {
      const d = audio.duration
      if (d && isFinite(d)) usePlayerStore.getState().setProgress(audio.currentTime / d)
      applyFadeEnvelope()
    }

    const onMetadata = () => {
      if (isFinite(audio.duration)) usePlayerStore.getState().setDuration(audio.duration)
    }

    const onEnded = () => {
      const { repeat, nextSong } = usePlayerStore.getState()
      if (repeat === 'one') {
        audio.currentTime = 0
        audio.play().catch(() => {})
      } else {
        nextSong()
      }
    }

    const onError = () => {
      const err = audio.error
      console.error('Audio error — code:', err?.code, '| src:', audio.src)
      usePlayerStore.getState().setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onMetadata)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    // ── Subscribe to store changes (no hooks-in-effects) ────────────────
    const unsub = usePlayerStore.subscribe((state, prev) => {
      // ── Song changed ────────────────────────────────────────────────
      if (state.currentSong && state.currentSong.id !== songIdRef.current) {
        songIdRef.current = state.currentSong.id

        const isElectron = typeof window !== 'undefined' && !!window.electronAPI

        if (isElectron) {
          // Dev + Prod هر دو از aura://
          const params = new URLSearchParams({ path: state.currentSong.path })
          audio.src = `aura://local?${params.toString()}`
        } else {
          audio.src = state.currentSong.path
        }

        audio.load()
        audio.currentTime = 0

        const doPlay = async () => {
          try {
            if (ctx.state === 'suspended') await ctx.resume()
            await audio.play()
            applyFadeEnvelope()
          } catch (e) {
            console.error('Play failed:', e)
            usePlayerStore.getState().setIsPlaying(false)
          }
        }
        doPlay()
      }

      // ── Play/pause toggled (same song) ──────────────────────────────
      if (state.isPlaying !== prev.isPlaying && state.currentSong?.id === songIdRef.current) {
        if (state.isPlaying) {
          if (ctx.state === 'suspended') ctx.resume()
          audio.play().catch(() => usePlayerStore.getState().setIsPlaying(false))
        } else {
          audio.pause()
        }
      }

      // ── Volume ──────────────────────────────────────────────────────
      if (state.volume !== prev.volume && gainRef.current) {
        applyFadeEnvelope()
      }

      // ── Seek ────────────────────────────────────────────────────────
      if (state.seekRequest !== null && state.seekRequest !== prev.seekRequest) {
        const d = audio.duration
        if (d && isFinite(d)) audio.currentTime = state.seekRequest * d
        usePlayerStore.getState().clearSeekRequest()
      }
    })

    return () => {
      unsub()
      audio.pause()
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onMetadata)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      ctx.close()

      audioAnalyserRef.current = null
      audioRef.current = null
      ctxRef.current = null
      gainRef.current = null
      songIdRef.current = null
    }
  }, [])

  return {}
}
