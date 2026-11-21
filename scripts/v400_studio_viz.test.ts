// Aura 4.0.0 — Audio Studio visualization math: unit tests.
// Pure data/math modules only (no Web Audio, no DOM) — runs under tsx with
// the app tsconfig because eqResponse mirrors the controller's imports.
// Run: npx tsx --tsconfig tsconfig.app.json scripts/v400_studio_viz.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  chainResponseDb, EQ_BAND_FREQS_HZ, BASS_SHELF_FREQ_HZ, TREBLE_SHELF_FREQ_HZ,
  type ChainResponseInput,
} from '../src/lib/eqResponse'
import { sanitizeGains } from '../src/lib/eq'

const FLAT: ChainResponseInput = {
  eqGains: new Array(10).fill(0),
  eqEnabled: true,
  bypass: false,
  preampDb: 0,
  bassGain: 0,
  trebleGain: 0,
  sampleRate: 48000,
}

const PROBE = new Float32Array([
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000, // band centers
  20, 60, 5000,                                          // extra points
])

test('viz: flat chain is 0 dB at every frequency', () => {
  const out = chainResponseDb(PROBE, FLAT)
  for (const db of out) assert.ok(Math.abs(db) < 0.05, `expected ~0 dB, got ${db}`)
})

test('viz: +6 dB peaking at 31 Hz reads ≈+6 dB there and ≈0 dB at 1 kHz', () => {
  const gains = new Array(10).fill(0)
  gains[0] = 6
  const out = chainResponseDb(PROBE, { ...FLAT, eqGains: sanitizeGains(gains) })
  assert.ok(Math.abs(out[0] - 6) < 0.15, `31 Hz should be ≈+6 dB, got ${out[0].toFixed(2)}`)
  assert.ok(Math.abs(out[5]) < 0.3, `1 kHz should be ≈0 dB, got ${out[5].toFixed(2)}`)
})

test('viz: −12 dB peaking at 16 kHz mirrors the boost case', () => {
  const gains = new Array(10).fill(0)
  gains[9] = -12
  const out = chainResponseDb(PROBE, { ...FLAT, eqGains: sanitizeGains(gains) })
  assert.ok(Math.abs(out[9] + 12) < 0.15, `16 kHz should be ≈−12 dB, got ${out[9].toFixed(2)}`)
})

test('viz: preamp adds its dB across the whole curve', () => {
  const out = chainResponseDb(PROBE, { ...FLAT, preampDb: 3 })
  for (const db of out) assert.ok(Math.abs(db - 3) < 0.01, `expected +3 dB, got ${db}`)
})

test('viz: bass shelf boosts lows, leaves 5 kHz nearly untouched', () => {
  const out = chainResponseDb(PROBE, { ...FLAT, bassGain: 8 })
  assert.ok(out[10] > 4, `20 Hz should ride the shelf (≈+8), got ${out[10].toFixed(2)}`)
  assert.ok(Math.abs(out[12]) < 0.4, `5 kHz should be ≈0 dB, got ${out[12].toFixed(2)}`)
  void BASS_SHELF_FREQ_HZ
})

test('viz: treble shelf boosts highs symmetrically', () => {
  const out = chainResponseDb(PROBE, { ...FLAT, trebleGain: 6 })
  // At the shelf corner the gain is exactly half in dB (≈ +3.00 here).
  assert.ok(Math.abs(out[12] - 3) < 0.15, `5 kHz corner should be ≈+3 dB, got ${out[12].toFixed(2)}`)
  assert.ok(out[10] < 1, `20 Hz untouched, got ${out[10].toFixed(2)}`)
  void TREBLE_SHELF_FREQ_HZ
})

test('viz: EQ disabled gates the bands to 0 dB (curve kept, not applied)', () => {
  const gains = new Array(10).fill(6)
  const out = chainResponseDb(PROBE, { ...FLAT, eqGains: sanitizeGains(gains), eqEnabled: false })
  for (const db of out) assert.ok(Math.abs(db) < 0.05, `disabled EQ must be flat, got ${db}`)
})

test('viz: studio bypass flattens everything (preamp included)', () => {
  const gains = new Array(10).fill(6)
  const out = chainResponseDb(PROBE, {
    ...FLAT, eqGains: sanitizeGains(gains), preampDb: 5, bassGain: 4, trebleGain: 4, bypass: true,
  })
  for (const db of out) assert.ok(Math.abs(db) < 0.05, `bypass must be flat, got ${db}`)
})

test('viz: stages stack multiplicatively (band + preamp add in dB)', () => {
  const gains = new Array(10).fill(0)
  gains[0] = 4
  const single = chainResponseDb(PROBE, { ...FLAT, eqGains: sanitizeGains(gains) })
  const stacked = chainResponseDb(PROBE, { ...FLAT, eqGains: sanitizeGains(gains), preampDb: 2 })
  for (let i = 0; i < PROBE.length; i++) {
    assert.ok(Math.abs(stacked[i] - (single[i] + 2)) < 0.02, `stack mismatch at ${i}`)
  }
  void EQ_BAND_FREQS_HZ
})

test('viz: sample rate changes nothing in the audible band (44.1k vs 48k)', () => {
  const gains = new Array(10).fill(0)
  gains[3] = 5
  const a = chainResponseDb(PROBE, { ...FLAT, eqGains: sanitizeGains(gains), sampleRate: 44100 })
  const b = chainResponseDb(PROBE, { ...FLAT, eqGains: sanitizeGains(gains), sampleRate: 48000 })
  for (let i = 0; i < 10; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.05, `rate shift at ${PROBE[i]} Hz`)
})
