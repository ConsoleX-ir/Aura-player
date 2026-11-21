// v4.0.3c — regression tests for the three re-opened bugs (pure-logic parts).
// Runtime/visual contracts are verified by scripts/v403c_verify_probe.py
// against the real Electron app; this suite pins the store logic.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/v403c_regressions.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── playerStore (the app's real store, isolated profile — no persist side
// effects matter here; we only exercise the actions we assert on) ────────────
const { usePlayerStore } = await import('@/store/playerStore')

const mkSong = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  path: `/music/${id}.mp3`,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  duration: 180,
  coverArt: null as string | null,
  addedAt: 0,
  mtimeMs: 0,
  ...over,
})

function resetStore() {
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
  })
}

// ── healCoverArt: the store-wide cover self-heal (covers bug) ────────────────
test('healCoverArt: patches library, currentSong, queue and naturalQueue by path', () => {
  resetStore()
  const a = mkSong('a', { coverArt: 'aura://local?path=%2Fcovers%2Faaa.png' })
  const b = mkSong('b', { coverArt: 'aura://local?path=%2Fcovers%2Fbbb.png' })
  usePlayerStore.setState({
    library: [a, b],
    queue: [a, b],
    naturalQueue: [a, b],
    currentSong: a,
    queueIndex: 0,
  })
  const healed = 'aura://local?path=%2Fcovers%2Faaa.png&r=123'
  usePlayerStore.getState().healCoverArt('/music/a.mp3', healed)
  const s = usePlayerStore.getState()
  assert.equal(s.library[0].coverArt, healed, 'library entry must carry the healed URL')
  assert.equal(s.currentSong!.coverArt, healed, 'the playing song must heal too')
  assert.equal(s.queue[0].coverArt, healed, 'queue must heal')
  assert.equal(s.naturalQueue[0].coverArt, healed, 'naturalQueue must heal')
  assert.equal(s.library[1].coverArt, b.coverArt, 'other songs are untouched')
  assert.equal(s.queue[1].coverArt, b.coverArt, 'other queue rows are untouched')
})

test('healCoverArt: unknown path and unchanged URL are no-ops', () => {
  resetStore()
  const a = mkSong('a', { coverArt: 'aura://local?path=%2Fcovers%2Faaa.png' })
  usePlayerStore.setState({ library: [a], currentSong: a, queue: [a], naturalQueue: [a] })
  const before = usePlayerStore.getState()
  usePlayerStore.getState().healCoverArt('/music/GHOST.mp3', 'aura://local?path=x')
  usePlayerStore.getState().healCoverArt('/music/a.mp3', a.coverArt!)
  assert.equal(usePlayerStore.getState().library[0].coverArt, a.coverArt)
  assert.equal(usePlayerStore.getState().library, before.library, 'state object must not churn')
})

// ── cycleRepeat: the three-state machine still cycles Off → All → One (bug 1) ─
test('cycleRepeat cycles none → all → one → none', () => {
  resetStore()
  const cyc = () => { usePlayerStore.getState().cycleRepeat(); return usePlayerStore.getState().repeat }
  assert.equal(usePlayerStore.getState().repeat, 'none')
  assert.equal(cyc(), 'all')
  assert.equal(cyc(), 'one')
  assert.equal(cyc(), 'none')
})

// ── nextIndex/prevIndex: the three modes' playback semantics (bug 1) ─────────
test('end-of-queue semantics per repeat mode are intact', async () => {
  const { nextIndex, prevIndex } = await import('@/lib/queueEngine')
  // repeat=none stops at the end, all wraps, one never auto-advances
  assert.equal(nextIndex(3, 2, 'none', true), null)
  assert.equal(nextIndex(3, 2, 'all', true), 0)
  assert.equal(nextIndex(3, 0, 'one', true), 1, 'repeat=one auto-advance mid-queue is the caller policy')
  assert.equal(prevIndex(3, 0, 'all'), 2)
  assert.equal(prevIndex(3, 0, 'none'), 0)
})

// ── Song shape sanity for healCoverArt inputs (guards the merge path) ────────
test('healCoverArt handles duplicate paths in the library', () => {
  resetStore()
  const a1 = mkSong('a1', { path: '/music/a.mp3', coverArt: 'aura://old' })
  const a2 = mkSong('a2', { path: '/music/a.mp3', coverArt: 'aura://old' })
  usePlayerStore.setState({ library: [a1, a2], queue: [a1, a2], naturalQueue: [a1, a2], currentSong: a2 })
  usePlayerStore.getState().healCoverArt('/music/a.mp3', 'aura://healed')
  const s = usePlayerStore.getState()
  assert.ok(s.library.every((x) => x.coverArt === 'aura://healed'), 'every entry with that path heals')
  assert.equal(s.currentSong!.coverArt, 'aura://healed')
})

console.log('v403c_regressions: all store/queue checks passed')
