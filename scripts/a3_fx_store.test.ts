// Aura 3.0 — Wave 3 unit tests: Audio FX store integration (playerStore).
// Runs under tsx (resolves the @/ path aliases the real store imports).
// Run: npx tsx scripts/a3_fx_store.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { usePlayerStore } from '../src/store/playerStore'
import { NEUTRAL_FX } from '../src/lib/audioFx'

test('fx store: audioFx starts neutral', () => {
  assert.deepEqual(usePlayerStore.getState().audioFx, NEUTRAL_FX)
})

test('fx store: setAudioFx merges, sanitizes and clamps', () => {
  usePlayerStore.getState().setAudioFx({ bassGain: 5 })
  assert.equal(usePlayerStore.getState().audioFx.bassGain, 5)
  usePlayerStore.getState().setAudioFx({ bassGain: 500 as number })
  assert.equal(usePlayerStore.getState().audioFx.bassGain, 12)
  usePlayerStore.getState().setAudioFx({ stereoWidth: 1.4 })
  assert.equal(usePlayerStore.getState().audioFx.stereoWidth, 1.4)
  assert.equal(usePlayerStore.getState().audioFx.bassGain, 12) // patch, not replace
  usePlayerStore.getState().setAudioFx({ ...NEUTRAL_FX })
  assert.deepEqual(usePlayerStore.getState().audioFx, NEUTRAL_FX)
})

test('fx store: user preset save/overwrite/delete round-trip', () => {
  const s = usePlayerStore.getState()
  s.setAudioFx({ reverbMix: 0.3, stereoWidth: 1.4 })
  s.saveFxPreset('  Hall  ')
  const saved = usePlayerStore.getState().fxUserPresets.find((p) => p.name === 'Hall')
  assert.ok(saved)
  assert.equal(saved!.state.reverbMix, 0.3)
  // Overwrite on same (trimmed) name — no duplicates.
  s.setAudioFx({ reverbMix: 0.5 })
  s.saveFxPreset('Hall')
  const all = usePlayerStore.getState().fxUserPresets.filter((p) => p.name === 'Hall')
  assert.equal(all.length, 1)
  assert.equal(all[0].state.reverbMix, 0.5)
  // Empty/whitespace names are ignored.
  s.saveFxPreset('   ')
  assert.equal(usePlayerStore.getState().fxUserPresets.length, 1)
  s.deleteFxPreset('Hall')
  assert.equal(usePlayerStore.getState().fxUserPresets.length, 0)
  usePlayerStore.getState().setAudioFx({ ...NEUTRAL_FX })
})
