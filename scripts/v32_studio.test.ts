// Aura 3.2.0 — Audio Studio unit tests: pure data modules + store integration.
// Runs under tsx (resolves the @/ aliases the real store imports).
// Run: npx tsx scripts/v32_studio.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  clampPreampDb, clampBalance, limiterEngagedParams, limiterNeutralParams,
  sanitizeEqUserPresets,
} from '../src/lib/audioStudio'
import { EQ_PRESETS, sanitizeGains, isFlat } from '../src/lib/eq'
import { onAccentInk } from '../src/hooks/useDynamicTheme'
import { THEME_PRESETS } from '../src/lib/themePresets'
import { usePlayerStore } from '../src/store/playerStore'
import { NEUTRAL_FX } from '../src/lib/audioFx'

// ── Pure data: ranges & sanitizers ──────────────────────────────────────────

test('studio: preamp clamps to ±12 dB', () => {
  assert.equal(clampPreampDb(6), 6)
  assert.equal(clampPreampDb(500), 12)
  assert.equal(clampPreampDb(-500), -12)
  assert.equal(clampPreampDb(NaN), NaN) // guard: non-finite passes through for caller to handle
})

test('studio: balance clamps to −1…+1', () => {
  assert.equal(clampBalance(0.4), 0.4)
  assert.equal(clampBalance(4), 1)
  assert.equal(clampBalance(-4), -1)
})

test('studio: limiter engaged vs neutral params', () => {
  const engaged = limiterEngagedParams()
  assert.ok(engaged.ratio > 1, 'engaged ratio must compress')
  assert.ok(engaged.threshold < 0, 'engaged threshold must act below full scale')
  const neutral = limiterNeutralParams()
  assert.equal(neutral.ratio, 1, 'neutral limiter is transparent')
  assert.equal(neutral.threshold, 0)
})

test('studio: sanitizeEqUserPresets drops corrupt rows', () => {
  assert.deepEqual(sanitizeEqUserPresets('garbage'), [])
  assert.deepEqual(sanitizeEqUserPresets(null), [])
  const safe = sanitizeEqUserPresets([
    { id: 'a', name: 'Curve A', gains: [1, 2, 3, 4, 5, 6, 7, 8, 9, 99], createdAt: 1 },
    { name: 'no-id row', gains: 'bad', createdAt: 2 },
    null,
    { id: '', name: '   ', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], createdAt: 3 },
  ])
  assert.equal(safe.length, 2)
  assert.equal(safe[0].id, 'a')
  assert.equal(safe[0].gains[9], 12, 'out-of-range band clamped to +12')
  assert.ok(safe[1].id.length > 0, 'missing id is synthesized')
})

test('studio: EQ presets include Pop and Acoustic, all 10 bands in range', () => {
  const ids = EQ_PRESETS.map((p) => p.id)
  assert.ok(ids.includes('pop'))
  assert.ok(ids.includes('acoustic'))
  for (const p of EQ_PRESETS) {
    assert.equal(p.gains.length, 10, `${p.id} has 10 bands`)
    for (const g of p.gains) assert.ok(g >= -12 && g <= 12, `${p.id} band in range`)
  }
  assert.ok(isFlat(sanitizeGains(undefined)))
})

// ── Adaptive on-accent ink (light-pass §3) ──────────────────────────────────

test('studio: onAccentInk picks readable ink per accent luminance', () => {
  assert.equal(onAccentInk('#B0B8C8'), '#101017', 'ConsoleX cloud gray needs ink')
  assert.equal(onAccentInk('#D4D4D8'), '#101017', 'Mono needs ink')
  assert.equal(onAccentInk('#3FB8C9'), '#101017', 'Cyan Frost needs ink')
  assert.equal(onAccentInk('#3D93C9'), '#FFFFFF', 'Ocean Deep keeps white')
  assert.equal(onAccentInk('#D9636B'), '#FFFFFF', 'Crimson keeps white')
  assert.equal(onAccentInk('#6474D9'), '#FFFFFF', 'Indigo keeps white')
  assert.equal(onAccentInk('nonsense'), '#FFFFFF', 'garbage falls back to white')
})

// ── New themes are first-class registry entries ─────────────────────────────

test('studio: v3.2.0 theme ids registered without touching the originals', () => {
  const ids = THEME_PRESETS.map((t) => t.id)
  for (const old of ['default', 'ocean', 'amethyst', 'cyan', 'forest', 'crimson', 'sunset', 'mono']) {
    assert.ok(ids.includes(old), `${old} still registered`)
  }
  for (const neu of ['orchid', 'indigo', 'champagne', 'aurora']) {
    assert.ok(ids.includes(neu), `${neu} registered`)
  }
  assert.equal(THEME_PRESETS.length, 12)
})

// ── Store integration ───────────────────────────────────────────────────────

test('studio store: master stages default neutral', () => {
  const s = usePlayerStore.getState()
  assert.equal(s.preampDb, 0)
  assert.equal(s.balance, 0)
  assert.equal(s.limiterEnabled, false)
  assert.equal(s.eqEnabled, true)
  assert.equal(s.studioBypass, false)
  assert.deepEqual(s.audioFx, NEUTRAL_FX)
})

test('studio store: preamp/balance setters clamp', () => {
  const s = usePlayerStore.getState()
  s.setPreampDb(50)
  assert.equal(usePlayerStore.getState().preampDb, 12)
  s.setBalance(-9)
  assert.equal(usePlayerStore.getState().balance, -1)
  s.setPreampDb(0); s.setBalance(0)
})

test('studio store: EQ enable gate keeps the curve', () => {
  const s = usePlayerStore.getState()
  s.applyEqPreset('bass')
  const curve = [...usePlayerStore.getState().eqGains]
  assert.ok(!isFlat(curve))
  s.setEqEnabled(false)
  assert.equal(usePlayerStore.getState().eqEnabled, false)
  assert.deepEqual(usePlayerStore.getState().eqGains, curve, 'curve preserved while off')
  s.setEqEnabled(true)
  assert.deepEqual(usePlayerStore.getState().eqGains, curve)
})

test('studio store: custom EQ preset full CRUD round-trip', () => {
  const s = usePlayerStore.getState()
  s.applyEqPreset('vocal')
  s.saveEqPreset('  My Curve  ')
  const saved = usePlayerStore.getState().eqUserPresets.find((p) => p.name === 'My Curve')
  assert.ok(saved, 'preset saved (trimmed)')
  assert.deepEqual(saved.gains, usePlayerStore.getState().eqGains)

  // Apply another shape, then re-apply the user preset by id
  s.applyEqPreset('flat')
  assert.ok(isFlat(usePlayerStore.getState().eqGains))
  usePlayerStore.getState().applyEqUserPreset(saved.id)
  assert.deepEqual(usePlayerStore.getState().eqGains, saved.gains)
  assert.equal(usePlayerStore.getState().eqPreset, 'My Curve')

  // Rename keeps applying target consistent
  usePlayerStore.getState().renameEqPreset(saved.id, 'Renamed Curve')
  assert.ok(usePlayerStore.getState().eqUserPresets.some((p) => p.name === 'Renamed Curve'))
  assert.equal(usePlayerStore.getState().eqPreset, 'Renamed Curve')

  // Duplicate gets a unique name
  usePlayerStore.getState().duplicateEqPreset(saved.id)
  const names = usePlayerStore.getState().eqUserPresets.map((p) => p.name)
  assert.ok(names.includes('Renamed Curve copy'))
  assert.equal(new Set(names).size, names.length, 'no duplicate names')

  // Delete
  const id = usePlayerStore.getState().eqUserPresets.find((p) => p.name === 'Renamed Curve copy')!.id
  usePlayerStore.getState().deleteEqPreset(id)
  assert.ok(!usePlayerStore.getState().eqUserPresets.some((p) => p.name === 'Renamed Curve copy'))

  usePlayerStore.getState().deleteEqPreset(saved.id)
})

test('studio store: FX presets rename + duplicate', () => {
  const s = usePlayerStore.getState()
  s.setAudioFx({ reverbMix: 0.4 })
  s.saveFxPreset('Echo Chamber')
  usePlayerStore.getState().renameFxPreset('Echo Chamber', 'Cave')
  assert.ok(usePlayerStore.getState().fxUserPresets.some((p) => p.name === 'Cave'))
  assert.ok(!usePlayerStore.getState().fxUserPresets.some((p) => p.name === 'Echo Chamber'))
  usePlayerStore.getState().duplicateFxPreset('Cave')
  assert.ok(usePlayerStore.getState().fxUserPresets.some((p) => p.name === 'Cave copy'))
  usePlayerStore.getState().deleteFxPreset('Cave')
  usePlayerStore.getState().deleteFxPreset('Cave copy')
  usePlayerStore.getState().setAudioFx({ ...NEUTRAL_FX })
})

test('studio store: bypass flag + resetStudio restore the neutral graph', () => {
  const s = usePlayerStore.getState()
  s.applyEqPreset('rock')
  s.setAudioFx({ bassGain: 8 })
  s.setPreampDb(6)
  s.setBalance(-0.5)
  s.setLimiterEnabled(true)
  s.setStudioBypass(true)
  assert.equal(usePlayerStore.getState().studioBypass, true)
  s.setStudioBypass(false)

  s.resetStudio()
  const after = usePlayerStore.getState()
  assert.equal(after.preampDb, 0)
  assert.equal(after.balance, 0)
  assert.equal(after.limiterEnabled, false)
  assert.equal(after.eqEnabled, true)
  assert.equal(after.studioBypass, false)
  assert.ok(isFlat(after.eqGains))
  assert.deepEqual(after.audioFx, NEUTRAL_FX)
})
