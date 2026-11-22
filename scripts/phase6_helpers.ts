// Phase 6 — Shared synthetic song generator for stress tests.
// Deterministic, no filesystem, no Tauri. Pure data for store/algorithm stress.

import type { Song } from '@/types'

let seq = 0
export function mkSong(over: Partial<Song> = {}): Song {
  seq++
  return {
    id: `s${seq}`,
    path: `/music/track_${seq}.mp3`,
    title: `Track ${seq}`,
    artist: `Artist ${(seq % 50) + 1}`,
    album: `Album ${(seq % 20) + 1}`,
    genre: ['Pop', 'Rock', 'Jazz', 'Classical', 'Electronic'][seq % 5],
    duration: 180 + (seq % 300),
    year: 2000 + (seq % 25),
    trackNumber: (seq % 20) + 1,
    coverArt: null,
    mtimeMs: Date.now() - seq * 1000,
    addedAt: Date.now() - seq * 1000,
    ...over,
  }
}

export function makeLibrary(size: number): Song[] {
  return Array.from({ length: size }, (_, i) => mkSong({ id: `lib-${i}`, path: `/music/lib_${i}.mp3` }))
}

export function benchSync(name: string, fn: () => void, iterations = 10): { median: number; min: number; max: number } {
  for (let i = 0; i < 3; i++) fn()
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return { median: times[Math.floor(times.length / 2)], min: times[0], max: times[times.length - 1] }
}
