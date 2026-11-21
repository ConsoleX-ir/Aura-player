// Aura 3.0 — Wave 3 unit tests: Audio FX data contract (pure module).
// Run: node --experimental-strip-types scripts/a3_fx.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeFx, isFxNeutral, compressionParams, FX_PRESETS, fxPresetById,
  sanitizeUserPresets, NEUTRAL_FX,
} from '../src/lib/audioFx.ts'

test('fx: sanitizeFx passes a valid state through unchanged', () => {
  const fx = { bassGain: 6, trebleGain: 3, compression: 0.4, reverbMix: 0.25, stereoWidth: 1.5 }
  assert.deepEqual(sanitizeFx(fx), fx)
})

test('fx: sanitizeFx clamps out-of-range values into the contract', () => {
  const fx = sanitizeFx({ bassGain: 99, trebleGain: -5, compression: 7, reverbMix: -1, stereoWidth: 42 })
  assert.equal(fx.bassGain, 12)
  assert.equal(fx.trebleGain, 0)
  assert.equal(fx.compression, 1)
  assert.equal(fx.reverbMix, 0)
  assert.equal(fx.stereoWidth, 2)
})

test('fx: sanitizeFx maps garbage to the neutral graph, never a crash', () => {
  assert.deepEqual(sanitizeFx(undefined), NEUTRAL_FX)
  assert.deepEqual(sanitizeFx(null), NEUTRAL_FX)
  assert.deepEqual(sanitizeFx('bass please'), NEUTRAL_FX)
  assert.deepEqual(sanitizeFx({ bassGain: NaN, stereoWidth: 'wide' }), NEUTRAL_FX)
})

test('fx: neutral state satisfies isFxNeutral, every non-default knob breaks it', () => {
  assert.equal(isFxNeutral(NEUTRAL_FX), true)
  for (const key of ['bassGain', 'trebleGain', 'compression', 'reverbMix'] as const) {
    assert.equal(isFxNeutral({ ...NEUTRAL_FX, [key]: 1 }), false, key)
  }
  assert.equal(isFxNeutral({ ...NEUTRAL_FX, stereoWidth: 1.01 }), false)
  assert.equal(isFxNeutral({ ...NEUTRAL_FX, stereoWidth: 1 }), true)
})

test('fx: compression mapping hits both endpoints and stays monotonic', () => {
  const c0 = compressionParams(0)
  assert.equal(c0.ratio, 1)
  assert.equal(c0.threshold, -1)
  const c1 = compressionParams(1)
  assert.equal(c1.ratio, 8)
  assert.equal(c1.threshold, -28)
  let prev = 100
  for (let a = 0; a <= 1.001; a += 0.1) {
    const p = compressionParams(a)
    assert.ok(p.threshold <= prev + 0.001)
    prev = p.threshold
  }
})

test('fx: built-in presets are stable under their own sanitizer; Bypass is neutral', () => {
  for (const p of FX_PRESETS) {
    assert.deepEqual(sanitizeFx(p.state), p.state, p.id)
  }
  assert.equal(isFxNeutral(fxPresetById('off')!.state), true)
})

test('fx: user presets sanitizer keeps valid rows, drops broken shapes', () => {
  const rows = [
    { name: 'Mine', state: { ...NEUTRAL_FX, bassGain: 3 }, createdAt: 123 },
    null,
    { name: 42 },
    { state: NEUTRAL_FX },
    { name: 'Corrupt', state: { bassGain: 'loud' }, createdAt: 1 },
  ]
  const out = sanitizeUserPresets(rows)
  assert.equal(out.length, 2)
  assert.equal(out[0].name, 'Mine')
  assert.equal(out[1].name, 'Corrupt')
  assert.equal(out[1].state.bassGain, 0) // corrupted number → neutral, not crash
  assert.equal(sanitizeUserPresets('nope').length, 0)
})
