// Focused regression coverage for mini-player visibility state transitions.
// Run with: npx tsx --tsconfig tsconfig.app.json scripts/v403d_mini_visibility.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

const visibilityRequests: boolean[] = []
;(globalThis as Record<string, unknown>).window = {
  electronAPI: { setMiniVisible: (visible: boolean) => visibilityRequests.push(visible) },
}

const { usePlayerStore } = await import('@/store/playerStore')
const { useUiStore } = await import('@/store/uiStore')

function reset() {
  visibilityRequests.length = 0
  usePlayerStore.setState({ currentSong: null, isPlaying: false })
  useUiStore.setState({ miniPlayer: false })
}

const song = {
  id: 'loaded', path: '/music/loaded.mp3', title: 'Loaded', artist: 'Artist',
  album: 'Album', duration: 120, coverArt: 'aura://cover/loaded',
}

test('no track: show is refused without changing the native window', () => {
  reset()
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, false)
  assert.deepEqual(visibilityRequests, [])
})

test('loaded paused track: mini-player show is refused', () => {
  reset()
  usePlayerStore.setState({ currentSong: song, isPlaying: false })
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, false)
  assert.deepEqual(visibilityRequests, [])
})

test('paused track and later unload: stale open requests stay refused', () => {
  reset()
  usePlayerStore.setState({ currentSong: song, isPlaying: false })
  useUiStore.getState().setMiniPlayer(true)
  usePlayerStore.setState({ currentSong: null, isPlaying: false })
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, false)
  assert.deepEqual(visibilityRequests, [])
})
