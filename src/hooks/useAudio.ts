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
    const onTimeUpdate = () => {
      const d = audio.duration
      if (d && isFinite(d)) usePlayerStore.getState().setProgress(audio.currentTime / d)
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
        gainRef.current.gain.value = state.volume
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
