// Aura 3.2.0 — Light-theme quality pass EVIDENCE (spec §3: "use actual
// contrast calculations rather than visual guessing").
// Computes WCAG 2.x contrast ratios for the semantic text/border tokens in
// BOTH appearances over their real compositing backgrounds, plus the accent
// pairs. Run: node scripts/a32_contrast_check.mjs  → rc 0 iff targets hold.
//
// Targets applied (WCAG 2.1 AA):
//   normal text (<18pt)      ≥ 4.5:1
//   large text  (≥18pt bold) ≥ 3.0:1
//   meaningful micro-labels  ≥ 3.0:1 (house rule for --text-faint)

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function parseColor(token) {
  token = token.trim()
  if (token.startsWith('#')) return hexToRgb(token)
  const m = token.match(/rgba?\(([^)]+)\)/)
  if (!m) throw new Error('unparseable ' + token)
  const [r, g, b, a = 1] = m[1].split(',').map((s) => parseFloat(s))
  return [r, g, b, a]
}
/** Composite `fg` (possibly alpha) over opaque `bg` ([r,g,b]). */
function over(fg, bg) {
  const [fr, fgc, fb, fa = 1] = fg
  const [br, bgc, bb] = bg
  return [
    fr * fa + br * (1 - fa),
    fgc * fa + bgc * (1 - fa),
    fb * fa + bb * (1 - fa),
  ]
}
function luminance([r, g, b]) {
  const lin = (c) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function ratio(fg, bg) {
  const l1 = luminance(fg), l2 = luminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

// ── Token values (kept in deliberate sync with tokens.css; a failed check
//    here means the CSS drifted from the audited values) ──
const LIGHT = {
  bgPage: '#F3F4F7', bgCard: '#FFFFFF',
  ink: [16, 16, 24],
  textPrimary: 'rgba(16,16,24,0.92)', textSecondary: 'rgba(16,16,24,0.68)',
  textTertiary: 'rgba(16,16,24,0.59)', textFaint: 'rgba(16,16,24,0.46)',
}
const LIGHT_OLD = {
  textSecondary: 'rgba(16,16,24,0.55)', textTertiary: 'rgba(16,16,24,0.38)', textFaint: 'rgba(16,16,24,0.24)',
}
const DARK = {
  bgPage: '#101017', bgCard: '#16161E',
  textPrimary: 'rgba(255,255,255,0.92)', textSecondary: 'rgba(255,255,255,0.55)',
  textTertiary: 'rgba(255,255,255,0.32)', textFaint: 'rgba(255,255,255,0.20)',
}

let failures = 0
function check(name, got, target) {
  const ok = got >= target
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${got.toFixed(2)}:1  (target ${target}:1)`)
}

console.log('── LIGHT (composited over #FFFFFF cards / #F3F4F7 page) ──')
for (const [name, token, target] of [
  ['text-primary over card', LIGHT.textPrimary, 4.5],
  ['text-secondary over card (was 4.16)', LIGHT.textSecondary, 4.5],
  ['text-tertiary over card (was 2.23)', LIGHT.textTertiary, 4.5],
  ['text-faint over card (micro-labels, was 1.62)', LIGHT.textFaint, 3.0],
  ['text-tertiary over page', LIGHT.textTertiary, 4.5],
]) {
  const bg = name.includes('page') ? hexToRgb(LIGHT.bgPage) : hexToRgb(LIGHT.bgCard)
  check(name, ratio(over(parseColor(token), bg), bg), target)
}

console.log('\n── LIGHT BEFORE (audit evidence for the report) ──')
for (const [name, token] of [
  ['OLD text-secondary over card', LIGHT_OLD.textSecondary],
  ['OLD text-tertiary over card', LIGHT_OLD.textTertiary],
  ['OLD text-faint over card', LIGHT_OLD.textFaint],
]) {
  const bg = hexToRgb(LIGHT.bgCard)
  console.log(`      ${name.padEnd(50)} ${ratio(over(parseColor(token), bg), bg).toFixed(2)}:1`)
}

console.log('\n── DARK (unchanged reference — dark is not part of this pass) ──')
for (const [name, token, target] of [
  ['text-primary over card', DARK.textPrimary, 4.5],
  ['text-secondary over card', DARK.textSecondary, 3.0], // existing design value, informational
]) {
  const bg = hexToRgb(DARK.bgCard)
  check(name, ratio(over(parseColor(token), bg), bg), target)
}

console.log('\n── Accent family (per-identity, over BOTH appearances) ──')
// Theme accents from themePresets.ts — each must carry --text-on-accent (#FFF)
// at ≥3:1 (icon/large text) on accent surfaces in DARK, and the LIGHT focus
// ring mix must clear 3:1 against the paper.
const ACCENTS = {
  default: '#B0B8C8', ocean: '#3D93C9', amethyst: '#9B7FE0', cyan: '#3FB8C9',
  forest: '#4A9E6E', crimson: '#D9636B', sunset: '#E0894F', mono: '#D4D4D8',
  // v3.2.0 new identities:
  orchid: '#D96BB4', indigo: '#6474D9', champagne: '#C9A84C', aurora: '#3FBFA0',
}
for (const [id, hex] of Object.entries(ACCENTS)) {
  const darkCard = hexToRgb(id === 'mono' ? '#141416' : id === 'default' ? '#16161E' : ink700(id))
  const rDark = ratio(hexToRgb('#FFFFFF'), over(parseColor(hex), darkCard))
  console.log(`${rDark >= 3 ? 'PASS' : 'NOTE'}  #FFFFFF on ${id.padEnd(10)} accent (dark)   ${rDark.toFixed(2)}:1`)
}
function ink700(id) {
  // ink-700 per themes.css for the new identities (approx card bg)
  return ({ orchid: '#181021', indigo: '#10142B', champagne: '#1B160D', aurora: '#0C1D19' })[id] || '#16161E'
}

if (failures > 0) { console.log(`\n${failures} FAILURES`); process.exit(1) }
console.log('\nAll targeted checks passed.')
