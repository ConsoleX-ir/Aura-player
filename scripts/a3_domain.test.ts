// Aura 3.0 — Wave 2 unit tests: the three domain stores + effective-artwork
// resolution semantics. Pure-module level (no Electron): the stores are
// exercised through their public actions; persistence shape is asserted via
// partialize-observable state only (IndexedDB round-trips are covered by the
// runtime suites, which boot the real app).
// Run: node --experimental-strip-types scripts/a3_domain.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useNotesStore, getNoteTexts } from '../src/store/notesStore.ts'
import { useArtworkStore, effectiveCover } from '../src/store/artworkStore.ts'
import { useUserPrefsStore, DEFAULT_USER_PREFS } from '../src/store/userPrefsStore.ts'

// ── notes ───────────────────────────────────────────────────────────────────
test('notes: set creates, re-set updates, empty text removes', () => {
  const s = useNotesStore.getState()
  s.setNote('song-1', 'first take')
  assert.equal(useNotesStore.getState().notes['song-1'].text, 'first take')
  const t1 = useNotesStore.getState().notes['song-1'].updatedAt
  s.setNote('song-1', 'second take')
  const t2 = useNotesStore.getState().notes['song-1'].updatedAt
  assert.equal(useNotesStore.getState().notes['song-1'].text, 'second take')
  assert.ok(t2 >= t1)
  s.setNote('song-1', '   ') // whitespace-only = removal intent
  assert.ok(!('song-1' in useNotesStore.getState().notes))
})

test('notes: setNote is idempotent for missing keys, removeNote on absent key is a no-op', () => {
  const before = useNotesStore.getState().notes
  useNotesStore.getState().removeNote('never-existed')
  assert.equal(useNotesStore.getState().notes, before)
})

test('notes: getNoteTexts returns lowercase texts keyed by song', () => {
  useNotesStore.getState().setNote('song-x', 'Chill Evening Vibe')
  const texts = getNoteTexts(useNotesStore.getState().notes)
  const hit = texts.find((t) => t.songId === 'song-x')
  assert.ok(hit && hit.text === 'chill evening vibe')
  useNotesStore.getState().removeNote('song-x')
})

// ── artwork overrides ───────────────────────────────────────────────────────
test('artwork: setOverride wins over song cover; removeOverride falls back', () => {
  useArtworkStore.getState().setOverride('song-a', 'aura://covers/abc.png')
  const ov = useArtworkStore.getState().overrides
  assert.equal(ov['song-a'].url, 'aura://covers/abc.png')
  assert.ok(typeof ov['song-a'].addedAt === 'number')
  const song = { id: 'song-a', coverArt: 'aura://covers/original.png' }
  assert.equal(effectiveCover(ov, song), 'aura://covers/abc.png')
  useArtworkStore.getState().removeOverride('song-a')
  assert.equal(effectiveCover(useArtworkStore.getState().overrides, song), 'aura://covers/original.png')
})

test('artwork: effectiveCover handles null cover and unknown song', () => {
  const ov = useArtworkStore.getState().overrides
  assert.equal(effectiveCover(ov, { id: 'ghost', coverArt: null }), null)
  assert.equal(effectiveCover({}, { id: 'x', coverArt: 'data:image/png;base64,AAA' }), 'data:image/png;base64,AAA')
})

// ── user prefs ──────────────────────────────────────────────────────────────
test('prefs: defaults are unset/onboarding-incomplete', () => {
  assert.deepEqual(DEFAULT_USER_PREFS, { username: '', onboarded: false, defaultAppPromptDismissed: false })
})

test('prefs: completeOnboarding trims the username and marks done once', () => {
  useUserPrefsStore.getState().completeOnboarding('  Vega  ')
  const s = useUserPrefsStore.getState()
  assert.equal(s.username, 'Vega')
  assert.equal(s.onboarded, true)
  // Editable in Settings afterwards (§13) — direct patch path.
  s.setUserPrefs({ username: 'Nova' })
  assert.equal(useUserPrefsStore.getState().username, 'Nova')
  // Reset for runtime suites that assert the first-launch state.
  useUserPrefsStore.getState().setUserPrefs({ ...DEFAULT_USER_PREFS })
  assert.equal(useUserPrefsStore.getState().onboarded, false)
})

test('prefs: dismissal flag persists decisions, not opinions', () => {
  useUserPrefsStore.getState().setUserPrefs({ defaultAppPromptDismissed: true })
  assert.equal(useUserPrefsStore.getState().defaultAppPromptDismissed, true)
  useUserPrefsStore.getState().setUserPrefs({ defaultAppPromptDismissed: false })
})

// ── Wave 10 — Search 3.0: notes scope ───────────────────────────────────────
import { searchLibrary, matchSong } from '../src/lib/search.ts'
import type { Song } from '../src/types/index.ts'

const mkSong = (id: string, title: string): Song => ({
  id, path: `/m/${id}.mp3`, title, artist: 'A', album: 'L', duration: 100, coverArt: null,
})

test('search 3.0: free text finds tracks by note content', () => {
  const songs = [mkSong('s1', 'Aurora'), mkSong('s2', 'Ember')]
  const notes = { s2: { text: 'Chill evening vibe for the balcony' } }
  const r = searchLibrary(songs, 'balcony', 40, notes)
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].id, 's2')
})

test('search 3.0: note: operator is an explicit constraint', () => {
  const songs = [mkSong('s1', 'Aurora'), mkSong('s2', 'Ember')]
  const notes = { s1: { text: 'gym energy' } }
  assert.equal(searchLibrary(songs, 'note:gym', 40, notes).matches[0].id, 's1')
  assert.equal(searchLibrary(songs, 'note:balcony', 40, notes).matches.length, 0)
})

test('search 3.0: matchSong free text hits note even with other tokens', () => {
  const s = mkSong('s1', 'Aurora')
  assert.equal(matchSong(s, [{ field: null, text: 'roadtrip', year: null }], 'perfect roadtrip song'), true)
  assert.equal(matchSong(s, [{ field: 'note', text: 'roadtrip', year: null }], 'perfect roadtrip song'), true)
  assert.equal(matchSong(s, [{ field: 'note', text: 'roadtrip', year: null }], undefined), false)
})
