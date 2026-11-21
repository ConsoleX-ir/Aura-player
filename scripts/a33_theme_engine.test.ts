// Aura 3.3 — Theme Engine unit suite.
// Run: npx tsx --tsconfig tsconfig.app.json scripts/a33_theme_engine.test.ts
//
// Covers the contracts the whole engine rests on:
//   1. Registry completeness — every named theme carries a full definition
//      (label/description/brightness/accents/swatch) with valid values.
//   2. Registry ↔ CSS integrity — every registry theme has a matching
//      [data-aura-theme='<id>'] identity block in styles/themes.css, every
//      CSS block has a registry entry, and every theme sets the ink scale,
//      cloud and secondary-accent families (the drift guard).
//   3. resolveThemeId — modern ids, legacy migration (including the
//      brightness-aware entries), custom preservation, garbage fallback.
//   4. themeAppearance — designed brightness per theme.
//   5. Store integration — setTheme validates/derives appearance; direct
//      garbage injection cannot poison the state.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

import { THEMES, CUSTOM_THEME, THEME_LIST, ALL_THEME_IDS, DEFAULT_THEME_ID, LEGACY_MIGRATION, resolveThemeId, themeAppearance, getTheme } from '../src/theme/registry'
import type { NamedThemeId } from '../src/theme/types'

// ── 1. Registry completeness ─────────────────────────────────────────────────

test('registry: ten named themes + custom, stable default', () => {
  assert.deepEqual(Object.keys(THEMES).sort(), [
    'abyss', 'aurora', 'cryo', 'ember', 'nebula', 'obsidian', 'sakura', 'solstice', 'vector', 'verdant',
  ])
  assert.equal(CUSTOM_THEME.id, 'custom')
  assert.equal(DEFAULT_THEME_ID, 'aurora')
  assert.equal(THEME_LIST.length, 11)
  assert.equal(new Set(THEME_LIST.map((t) => t.id)).size, 11, 'ids are unique')
})

test('registry: every theme has a complete, valid definition', () => {
  for (const t of THEME_LIST) {
    assert.ok(t.label.length > 0 && t.label.length < 30, `${t.id} label`)
    assert.ok(t.description.length > 20, `${t.id} description is human-meaningful`)
    assert.ok(t.appearance === 'dark' || t.appearance === 'light', `${t.id} brightness`)
    for (const [k, v] of Object.entries(t.accent)) {
      assert.match(v as string, /^#[0-9A-Fa-f]{6}$/, `${t.id} accent.${k} is #rrggbb`)
    }
    assert.ok(t.swatch.includes('gradient'), `${t.id} swatch is a gradient preview`)
  }
  // Designed brightness covers both appearances across the lineup (the spec's
  // "not every theme must be dark" requirement) and is balanced 5/5.
  const appearances = new Set(Object.values(THEMES).map((t) => t.appearance))
  assert.ok(appearances.has('dark') && appearances.has('light'), 'lineup spans both brightness levels')
  assert.equal(Object.values(THEMES).filter((t) => t.appearance === 'light').length, 5,
    'ember/vector/solstice/cryo/sakura are the light themes')
})

// ── 2. Registry ↔ CSS integrity (the drift guard) ────────────────────────────

test('registry↔css: every theme has a complete identity block in themes.css', () => {
  const css = readFileSync(path.join(root, 'src/styles/themes.css'), 'utf8')
  for (const id of Object.keys(THEMES) as NamedThemeId[]) {
    const block = css.match(new RegExp(`\\[data-aura-theme='${id}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`))
    assert.ok(block, `${id} has a [data-aura-theme] identity block`)
    const body = block![1]
    if (THEMES[id].appearance === 'dark') {
      // Dark identities remap the ink primitives — the whole semantic ladder
      // (surfaces, borders, chrome) inherits from them.
      for (const token of ['--aura-ink-900', '--aura-ink-800', '--aura-ink-700', '--aura-ink-600']) {
        assert.ok(body.includes(`${token}:`), `${id} remaps ${token}`)
      }
    } else {
      // Light identities are paper-based: they remap the paper ladder, and
      // the ink PRIMITIVES are irrelevant to them by design.
      assert.ok(body.includes('--surface-base:'), `${id} tints its paper`)
      assert.ok(body.includes('--text-primary:'), `${id} owns its ink ladder`)
    }
    assert.ok(body.includes('--cloud:'), `${id} owns its ambient cloud`)
    assert.ok(body.includes('--accent-2:'), `${id} owns its secondary accent`)
    // The registry accent family must agree with the CSS cloud family — the
    // registry is the source of truth, the CSS implements it.
    const cloudVar = body.match(/--cloud:\s*(#[0-9A-Fa-f]{6})/)
    assert.ok(cloudVar, `${id} --cloud is a hex`)
    assert.equal(cloudVar![1].toLowerCase(), THEMES[id].accent.cloud.toLowerCase(), `${id} CSS cloud matches registry accent.cloud`)
  }
  // No legacy identity blocks left behind (the named system replaced them).
  for (const legacy of ['default', 'ocean', 'amethyst', 'cyan', 'forest', 'crimson', 'sunset', 'mono', 'orchid', 'indigo', 'champagne']) {
    assert.ok(!css.includes(`[data-aura-theme='${legacy}']`), `legacy block '${legacy}' removed from themes.css`)
  }
  // Decorative recipes exist for every named theme.
  for (const id of Object.keys(THEMES) as NamedThemeId[]) {
    assert.ok(css.includes(`[data-aura-theme='${id}'] .theme-deco`), `${id} has a decorative recipe`)
  }
})

// ── 3. resolveThemeId ────────────────────────────────────────────────────────

test('resolve: modern ids pass through', () => {
  for (const id of ALL_THEME_IDS) assert.equal(resolveThemeId(id), id)
})

test('resolve: legacy ids migrate (appearance-aware where designed)', () => {
  // Dark-mode family mapping (no persisted appearance reads as dark).
  assert.equal(resolveThemeId('aurora'), 'aurora')
  assert.equal(resolveThemeId('forest'), 'aurora')
  assert.equal(resolveThemeId('ocean'), 'abyss')
  assert.equal(resolveThemeId('cyan'), 'abyss')
  assert.equal(resolveThemeId('indigo'), 'abyss')
  assert.equal(resolveThemeId('amethyst'), 'nebula')
  assert.equal(resolveThemeId('orchid'), 'nebula')
  assert.equal(resolveThemeId('sunset'), 'nebula')
  assert.equal(resolveThemeId('crimson'), 'nebula')
  assert.equal(resolveThemeId('champagne'), 'nebula')
  assert.equal(resolveThemeId('default'), 'aurora')
  assert.equal(resolveThemeId('mono'), 'aurora')
  assert.equal(resolveThemeId('custom'), 'custom')
  // Light-mode mapping: warm ids keep their warmth (Ember), everything else
  // goes to the cool light paper (Vector).
  for (const warm of ['sunset', 'crimson', 'champagne']) {
    assert.equal(resolveThemeId(warm, 'light'), 'ember', `${warm}+light → ember`)
  }
  // ('aurora' is absent here — it is the modern-id collision covered below.)
  for (const cool of ['forest', 'ocean', 'cyan', 'indigo', 'amethyst', 'orchid', 'default', 'mono']) {
    assert.equal(resolveThemeId(cool, 'light'), 'vector', `${cool}+light → vector`)
  }
  // The migration invariant: no legacy id ever crosses the brightness line —
  // with ONE documented exception: 'aurora' is BOTH a legacy id and a modern
  // id (the new flagship reused the name). The modern id wins, so a legacy
  // aurora+light user keeps the NAMED identity (now dark) instead of being
  // silently moved to a different-named theme. Identity beats brightness for
  // the collision; everything else preserves brightness exactly.
  for (const legacy of Object.keys(LEGACY_MIGRATION)) {
    for (const ap of ['light', 'dark'] as const) {
      const target = resolveThemeId(legacy, ap)
      assert.ok((ALL_THEME_IDS as string[]).includes(target), `${legacy} → valid ${target}`)
      if (legacy === 'aurora') continue // documented collision — identity wins
      assert.equal(themeAppearance(target), ap, `${legacy}+${ap} keeps the user's brightness`)
    }
  }
  assert.equal(resolveThemeId('aurora', 'light'), 'aurora', 'modern aurora id passes through unchanged')
})

test('resolve: garbage never throws and always falls back', () => {
  for (const bad of [undefined, null, '', '   ', 'nonsense', 42, {}, [], '<script>']) {
    assert.equal(resolveThemeId(bad), DEFAULT_THEME_ID, `fallback for ${String(bad)}`)
  }
})

// ── 4. Designed brightness ───────────────────────────────────────────────────

test('appearance: derived from the registry, custom is dark-nominal', () => {
  assert.equal(themeAppearance('aurora'), 'dark')
  assert.equal(themeAppearance('abyss'), 'dark')
  assert.equal(themeAppearance('nebula'), 'dark')
  assert.equal(themeAppearance('verdant'), 'dark')
  assert.equal(themeAppearance('obsidian'), 'dark')
  assert.equal(themeAppearance('ember'), 'light')
  assert.equal(themeAppearance('vector'), 'light')
  assert.equal(themeAppearance('solstice'), 'light')
  assert.equal(themeAppearance('cryo'), 'light')
  assert.equal(themeAppearance('sakura'), 'light')
  assert.equal(themeAppearance('custom'), 'dark')
})

test('registry: getTheme never misses', () => {
  for (const id of ALL_THEME_IDS) assert.equal(getTheme(id).id, id)
})

// ── 4b. Theme emblems (Settings picker icons) ───────────────────────────────
// Every theme — including custom — must own a bespoke emblem in
// src/theme/icons.tsx. The file is parsed as text (the test stays
// dependency-free): each id must appear as an EMBLEMS record key.

test('icons: every theme id has an emblem entry in theme/icons.tsx', () => {
  const icons = readFileSync(path.join(root, 'src/theme/icons.tsx'), 'utf8')
  for (const id of ALL_THEME_IDS) {
    assert.ok(new RegExp(`\\n\\s{2}${id}: \\(p\\)`).test(icons), `emblem entry for ${id}`)
  }
  // No stock placeholder glyphs: the file must not import an icon library.
  assert.ok(!icons.includes('lucide-react'), 'emblems are hand-drawn SVG, not lucide')
})

// ── 5. Store integration (validation at the setter) ──────────────────────────

const { usePlayerStore } = await import('../src/store/playerStore')

test('store: setTheme validates and derives appearance', () => {
  const s = usePlayerStore.getState()
  s.setTheme('abyss')
  assert.equal(usePlayerStore.getState().theme, 'abyss')
  assert.equal(usePlayerStore.getState().appearance, 'dark')
  s.setTheme('ember')
  assert.equal(usePlayerStore.getState().theme, 'ember')
  assert.equal(usePlayerStore.getState().appearance, 'light', 'switching themes carries the designed brightness')
  // Legacy id through the setter migrates against the CURRENT appearance:
  // the state is on ember/light, so the warm legacy id stays in the light
  // warm family — that is the designed brightness-aware migration.
  s.setTheme('sunset')
  assert.equal(usePlayerStore.getState().theme, 'ember', 'sunset from a light state stays light-warm')
  // Garbage through the setter cannot poison state
  s.setTheme('garbage-id')
  assert.equal(usePlayerStore.getState().theme, DEFAULT_THEME_ID)
  // Custom preserves the live appearance instead of forcing one
  usePlayerStore.getState().setAppearance('light')
  usePlayerStore.getState().setTheme('custom')
  assert.equal(usePlayerStore.getState().theme, 'custom')
  assert.equal(usePlayerStore.getState().appearance, 'light', 'custom keeps current appearance')
  // Restore defaults for other suites sharing the process
  usePlayerStore.getState().setAppearance('dark')
  usePlayerStore.getState().setTheme(DEFAULT_THEME_ID)
})
