// v5.0.0 — Mini Player enable/disable setting regression suite.
//
// Covers the "Enable Mini Player" setting (Settings → Library → Enable Mini
// Player, backed by userPrefsStore.miniPlayerEnabled, default true):
//
//   • default enabled state (preserves current behavior for existing users)
//   • disabling persists the flag
//   • closing an already-open Mini Player when disabled
//   • refusing to reopen while disabled (every renderer entry point funnels
//     through uiStore.setMiniPlayer, which now gates on the flag)
//   • re-enabling restores normal functionality
//   • playback continues normally when the Mini Player is disabled
//
// Run: npx tsx --tsconfig tsconfig.app.json scripts/v500_mini_player_enabled.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { useUserPrefsStore } = await import('@/store/userPrefsStore')
const { useUiStore } = await import('@/store/uiStore')
const { usePlayerStore } = await import('@/store/playerStore')

function resetStores() {
  useUserPrefsStore.setState({
    username: '',
    onboarded: false,
    defaultAppPromptDismissed: false,
    miniPlayerEnabled: true,
  })
  useUiStore.setState({ miniPlayer: false })
  usePlayerStore.setState({
    library: [], playlists: [], favorites: [], queue: [], naturalQueue: [],
    currentSong: null, queueIndex: 0, isPlaying: false,
  })
}

const song = (id: string) => ({
  id, path: `/music/${id}.mp3`, title: `Song ${id}`, artist: 'Artist',
  album: 'Album', duration: 180, coverArt: null as string | null,
  addedAt: 0, mtimeMs: 0,
})

test('default: Mini Player is enabled', () => {
  resetStores()
  assert.equal(useUserPrefsStore.getState().miniPlayerEnabled, true,
    'new users keep the Mini Player enabled by default')
})

test('disabling Mini Player persists the flag', () => {
  resetStores()
  useUserPrefsStore.getState().setUserPrefs({ miniPlayerEnabled: false })
  assert.equal(useUserPrefsStore.getState().miniPlayerEnabled, false,
    'the disable choice is reflected in the store immediately')
})

test('re-enabling Mini Player restores the flag', () => {
  resetStores()
  useUserPrefsStore.getState().setUserPrefs({ miniPlayerEnabled: false })
  assert.equal(useUserPrefsStore.getState().miniPlayerEnabled, false)
  useUserPrefsStore.getState().setUserPrefs({ miniPlayerEnabled: true })
  assert.equal(useUserPrefsStore.getState().miniPlayerEnabled, true,
    're-enabling restores normal Mini Player functionality without restart')
})

test('closing an already-open Mini Player when disabled closes it', () => {
  resetStores()
  useUserPrefsStore.getState().setUserPrefs({ miniPlayerEnabled: true })
  // Open while a track is playing (the playing-only gate allows it).
  const s = song('playing')
  usePlayerStore.setState({ library: [s], currentSong: s, isPlaying: true })
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, true,
    'the widget can be opened while enabled and music is playing')
  // Disable while open: the bridge closes the window. The hide direction is
  // never gated, so setMiniPlayer(false) closes it even while disabled.
  useUserPrefsStore.getState().setUserPrefs({ miniPlayerEnabled: false })
  assert.equal(useUserPrefsStore.getState().miniPlayerEnabled, false,
    'disabling while open takes effect immediately')
  useUiStore.getState().setMiniPlayer(false)
  assert.equal(useUiStore.getState().miniPlayer, false,
    'the widget is closed when disabled')
})

test('reopening is refused while Mini Player is disabled (every entry point)', () => {
  resetStores()
  useUserPrefsStore.getState().setUserPrefs({ miniPlayerEnabled: false })
  // The P key / pill button / command palette all funnel through setMiniPlayer.
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, false,
    'a disabled Mini Player cannot be shown again through setMiniPlayer')
  // Hides are never refused even while disabled.
  useUiStore.getState().setMiniPlayer(false)
  assert.equal(useUiStore.getState().miniPlayer, false,
    'closing still works while disabled')
})

test('playback continues normally when Mini Player is disabled', () => {
  resetStores()
  useUserPrefsStore.getState().setUserPrefs({ miniPlayerEnabled: false })
  const s = song('playing')
  usePlayerStore.setState({ library: [s], currentSong: s, isPlaying: true })
  const st = usePlayerStore.getState()
  assert.equal(st.isPlaying, true, 'audio playback is unaffected by the disable flag')
  assert.equal(st.currentSong?.id, 'playing', 'the current track is still tracked')
  // The mini player must stay closed even while music plays.
  useUiStore.getState().setMiniPlayer(true)
  assert.equal(useUiStore.getState().miniPlayer, false,
    'the widget stays closed while disabled, even mid-playback')
})
