// v4.0.3b — regression tests for the three re-opened bugs (pure-logic parts).
// The runtime/visual contracts are verified by scripts/v403b_probe.py against
// the real Electron app; this suite pins the logic the probe can't import.
import assert from 'node:assert/strict'
import { REPEAT_LABEL } from '../src/lib/utils.ts'

let passed = 0
function t(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`) }
  catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1 }
}

// ── Bug A: repeat labels — tooltip/aria names must be human and mode-exact ──
t('REPEAT_LABEL covers all three modes with distinct human labels', () => {
  assert.deepEqual(Object.keys(REPEAT_LABEL).sort(), ['all', 'none', 'one'])
  assert.equal(new Set(Object.values(REPEAT_LABEL)).size, 3, 'labels must be pairwise distinct')
})

t('repeat label for none is "Off" (not the raw enum)', () => {
  assert.equal(REPEAT_LABEL.none, 'Off')
})

t('repeat labels for all/one read as mode names', () => {
  assert.equal(REPEAT_LABEL.all, 'All')
  assert.equal(REPEAT_LABEL.one, 'One')
})

console.log(`\n${passed} v403b label checks passed`)
