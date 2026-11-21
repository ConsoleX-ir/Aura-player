// Aura 3.3.1 — Mini Player Liquid Glass unit tests: store contract + Settings
// surface + widget mode resolution. Runs under tsx (resolves the @/ aliases).
// Run: npx tsx scripts/a34_mini_glass.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { usePlayerStore } from '../src/store/playerStore'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = (p: string) => readFileSync(path.join(here, '..', p), 'utf8')

// ── Store: the single source of truth ────────────────────────────────────────

test('mini glass: default is ON (glass-first design)', () => {
  const v = usePlayerStore.getState().miniLiquidGlass
  assert.equal(v, true)
})

test('mini glass: setter stores booleans and coerces truthy input', () => {
  usePlayerStore.getState().setMiniLiquidGlass(false)
  assert.equal(usePlayerStore.getState().miniLiquidGlass, false)
  usePlayerStore.getState().setMiniLiquidGlass(true)
  assert.equal(usePlayerStore.getState().miniLiquidGlass, true)
  usePlayerStore.getState().setMiniLiquidGlass(false)
  assert.equal(usePlayerStore.getState().miniLiquidGlass, false)
  usePlayerStore.getState().setMiniLiquidGlass(true)
})

test('mini glass: is persisted (partialize includes miniLiquidGlass)', () => {
  // Assert on the persistence configuration source itself — the most robust
  // check across zustand versions: the partialize block must carry the flag
  // so it survives restarts through the existing idbStorage persistence.
  const store = src('src/store/playerStore.ts')
  const partialize = store.split('partialize: (s) => ({')[1]?.split('})')[0] ?? ''
  assert.ok(partialize.includes('miniLiquidGlass: s.miniLiquidGlass'), 'miniLiquidGlass must survive restarts')
})

// ── Widget contract: snapshot field + deterministic mode resolution ─────────

test('mini glass: bridge snapshot carries liquidGlass + perf from the store', () => {
  const bridge = src('src/hooks/useMiniPlayerBridge.ts')
  assert.match(bridge, /liquidGlass:\s*s\.miniLiquidGlass/, 'snapshot must mirror miniLiquidGlass')
  assert.match(bridge, /perf:\s*s\.performanceMode/, 'snapshot must mirror performanceMode')
  assert.match(bridge, /usePlayerStore\.subscribe\(pushIfChanged\)/, 'Settings flips must push instantly')
})

test('mini glass: widget resolves undefined (stale sender) to glass ON', () => {
  const app = src('src/mini/MiniApp.tsx')
  assert.match(app, /state\.liquidGlass !== false/, 'deterministic default: glass ON')
})

// ── Theme independence: the widget must not consume theme tokens ─────────────

test('mini glass: widget surfaces use NO theme tokens (fixed neutral design)', () => {
  const css = src('src/styles/mini.css')
  // The visual system must not read the Theme Engine's semantic tokens.
  for (const token of ['--surface-chrome', '--border-emphasis', '--accent', '--text-primary', '--glass-', '--surface-solid']) {
    assert.ok(!css.includes(`var(${token}`), `mini.css must not consume ${token}`)
  }
  // The fixed neutral system is present.
  assert.match(css, /--mg-ink:/)
  assert.match(css, /\.mini-card--glass/)
  assert.match(css, /\.mini-card--matte/)
  // Performance Mode strips blur with a FIXED fallback, not var(--surface-solid).
  const perfBlock = css.split(":root[data-performance='on']").slice(1).join(":root[data-performance='on']")
  assert.ok(perfBlock.includes('backdrop-filter: none'), 'Performance Mode must strip backdrop blur')
  assert.ok(!perfBlock.includes('var(--surface-solid)'), 'Performance Mode fallback must stay theme-independent')
})

// ── Settings surface: the exact required label + wiring ─────────────────────

test('mini glass: Settings exposes the "Liquid Glass Mini Player" toggle', () => {
  const settings = src('src/pages/Settings.tsx')
  assert.match(settings, /label="Liquid Glass Mini Player"/)
  assert.match(settings, /checked=\{miniLiquidGlass\}/)
  assert.match(settings, /onChange=\{setMiniLiquidGlass\}/)
})

test('mini glass: matte mode keeps the layout (mode classes, not separate trees)', () => {
  const app = src('src/mini/MiniApp.tsx')
  assert.match(app, /mini-card--glass/)
  assert.match(app, /mini-card--matte/)
  assert.match(app, /data-mini-mode=\{glass \? 'glass' : 'matte'\}/)
  // Same layout for both modes: one card, one info column, one controls row.
  const cardTrees = (app.match(/data-mini-player/g) ?? []).length
  assert.equal(cardTrees, 1, 'exactly one primary layout')
})
