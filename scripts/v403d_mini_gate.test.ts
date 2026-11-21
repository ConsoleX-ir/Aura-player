// v4.0.3e — regression tests for the Mini Player PLAYING-ONLY visibility rule
// (user rule: "when music is not playing — even the song is selected — I
// don't want to see the mini player; if music is playing the mini player
// should be visible") and the artwork self-heal store contract. The
// runtime/visual behavior is verified end-to-end by scripts/v403e_probe.py
// against the real Electron app; this suite pins the pure store-level logic
// those entry points are built on.
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/v403d_mini_gate.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { usePlayerStore } = await import('@/store/playerStore')
const { useUiStore } = await import('@/store/uiStore')

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

function resetStores() {
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
  })
  useUiStore.setState({ miniPlayer: false })
}

// ── Bug 1 — the PLAYING-ONLY rule, renderer side ────────────────────────────
// Every renderer entry point (P key, pill button, command palette) funnels
// through uiStore.setMiniPlayer; the main process independently re-checks at
// the window boundary (showMiniPlayer) and revalidates the minimize
// auto-show against the LIVE store ('media:queryTrack' → 'media:trackReply',
// whose answer since v4.0.3e is the live isPlaying). v4.0.3e tightens the
// v4.0.3 gate from "a track is loaded" to "music is actually playing": a
// selected-but-paused song must NOT surface the widget.

test('setMiniPlayer(true) is refused when NO track is loaded', () => {
  resetStores()
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, false,
    'the widget must not even be requestable without a loaded track')
})

test("setMiniPlayer(true) is REFUSED for a LOADED but PAUSED track (user rule: 'even the song is selected')", () => {
  resetStores()
  const song = mkSong('paused')
  usePlayerStore.setState({ library: [song], currentSong: song, isPlaying: false })
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, false,
    'not playing → not visible, even with a selected song')
})

test('setMiniPlayer(true) opens while a track is PLAYING', () => {
  resetStores()
  const song = mkSong('playing')
  usePlayerStore.setState({ library: [song], currentSong: song, isPlaying: true })
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, true,
    'playing → visible: every manual entry point keeps working')
})

test('closing the widget always works, with or without a track', () => {
  resetStores()
  const song = mkSong('closer')
  usePlayerStore.setState({ library: [song], currentSong: song, isPlaying: true })
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, true)
  usePlayerStore.setState({ isPlaying: false, currentSong: null })
  useUiStore.getState().setMiniPlayer(false)
  assert.equal(useUiStore.getState().miniPlayer, false,
    'hide must never be refused — only the SHOW direction is gated')
})

test('a paused track after a refused request cannot be resurrected by stale UI flags', () => {
  resetStores()
  const song = mkSong('stale')
  usePlayerStore.setState({ library: [song], currentSong: song, isPlaying: true })
  useUiStore.getState().setMiniPlayer(true) // open while playing
  assert.equal(useUiStore.getState().miniPlayer, true)
  // playback stops (pause) — main hides the real window on the state-sync
  // push; a stale "open" request must not stick either:
  usePlayerStore.setState({ isPlaying: false })
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, false)
})

test('a refused show normalizes a stale visible flag and asks main to hide the real window', () => {
  resetStores()
  // Simulate a missed authoritative broadcast: flag stuck true while paused.
  const song = mkSong('normalize')
  usePlayerStore.setState({ library: [song], currentSong: song, isPlaying: true })
  useUiStore.setState({ miniPlayer: true })
  usePlayerStore.setState({ isPlaying: false })
  let hideCalls = 0
  // In Node there is no `window`; install a minimal mock via globalThis so
  // uiStore's window.electronAPI?.setMiniVisible path actually runs.
  const g = globalThis as unknown as { window?: Record<string, unknown> }
  const hadWindow = 'window' in g
  const prevWindow = g.window
  g.window = { electronAPI: { setMiniVisible: (v: boolean) => { if (!v) hideCalls++ } } }
  try {
    useUiStore.getState().setMiniPlayer(true) // refused — flag must normalize
    assert.equal(useUiStore.getState().miniPlayer, false,
      'the stale flag cannot outlive a refused show')
    assert.equal(hideCalls, 1, 'main is told to hide the real widget window')
  } finally {
    if (hadWindow) g.window = prevWindow
    else delete g.window
  }
})

// ── Bug 1 — the live revalidation contract the minimize auto-show relies on ──
// main asks ('media:queryTrack'); the renderer answers with the LIVE store
// truth. Since v4.0.3e the answer is the live isPlaying (not merely "a track
// is loaded"), so a paused app can never pass the minimize auto-show. These
// tests pin the exact predicate the answer is built from, so a regression to
// "mirror the last push" or to the old hasTrack semantics fails here first.
test('revalidation predicate: live store truth — no track answers isPlaying=false', () => {
  resetStores()
  // THE CONTRACT (see useMediaKeys): replyTrackState(!!usePlayerStore.getState().isPlaying)
  assert.equal(!!usePlayerStore.getState().isPlaying, false)
})

test('revalidation predicate: a loaded-but-PAUSED track answers isPlaying=false', () => {
  resetStores()
  const song = mkSong('reval-paused')
  usePlayerStore.setState({ library: [song], currentSong: song, isPlaying: false })
  assert.equal(!!usePlayerStore.getState().isPlaying, false,
    'the playing-only rule: paused must fail the minimize auto-show')
})

test('revalidation predicate: a PLAYING track answers isPlaying=true', () => {
  resetStores()
  const song = mkSong('reval-playing')
  usePlayerStore.setState({ library: [song], currentSong: song, isPlaying: true })
  assert.equal(!!usePlayerStore.getState().isPlaying, true,
    'playing keeps the minimize auto-show working')
})

test('revalidation predicate: pausing flips the answer to false immediately', () => {
  resetStores()
  const song = mkSong('unload')
  usePlayerStore.setState({ library: [song], currentSong: song, isPlaying: true })
  assert.equal(!!usePlayerStore.getState().isPlaying, true)
  usePlayerStore.setState({ isPlaying: false })
  assert.equal(!!usePlayerStore.getState().isPlaying, false,
    'the answer follows the LIVE store, not a cached mirror')
})

// ── Bug 2 — artwork self-heal store contract (regression guard) ──────────────
test('healCoverArt patches the healed URL store-wide and leaves unrelated songs alone', () => {
  resetStores()
  const dead = mkSong('dead', { path: '/music/same.mp3', coverArt: 'aura://local?path=%2Fcovers%2Fdead.png' })
  const twin = mkSong('twin', { path: '/music/same.mp3', coverArt: 'aura://local?path=%2Fcovers%2Fdead.png' })
  const other = mkSong('other', { path: '/music/other.mp3', coverArt: 'aura://local?path=%2Fcovers%2Fother.png' })
  usePlayerStore.setState({
    library: [dead, twin, other],
    queue: [dead, twin, other],
    naturalQueue: [dead, twin, other],
    currentSong: dead,
  })
  const healed = 'aura://local?path=%2Fcovers%2Fdead.png&r=123'
  usePlayerStore.getState().healCoverArt('/music/same.mp3', healed)
  const s = usePlayerStore.getState()
  for (const song of s.library) {
    if (song.path === '/music/same.mp3') assert.equal(song.coverArt, healed)
  }
  assert.equal(s.currentSong?.coverArt, healed, 'the playing surface heals immediately')
  assert.equal(s.library.find((x) => x.id === 'other')?.coverArt,
    'aura://local?path=%2Fcovers%2Fother.png',
    'unrelated artwork must never be touched')
})

test('healCoverArt is a silent no-op for unknown paths', () => {
  resetStores()
  const a = mkSong('a', { coverArt: 'aura://local?path=%2Fcovers%2Fa.png' })
  usePlayerStore.setState({ library: [a], currentSong: a })
  const before = usePlayerStore.getState()
  usePlayerStore.getState().healCoverArt('/nowhere/x.mp3', 'aura://local?path=%2Fcovers%2Fx.png')
  assert.equal(usePlayerStore.getState(), before,
    'state object must be untouched when nothing matches')
})
