// ── Appearance switching with a graceful cross-fade ─────────────────────────
// One helper so EVERY entry point (Settings, command palette) produces the
// identical animated transition: a temporary .theme-anim class lets all colors
// glide over --dur-ambient, then the class is removed so steady-state
// rendering pays nothing. Re-entrancy safe: rapid toggling resets the removal
// timer instead of stacking classes or cutting an in-flight fade short.

import { usePlayerStore } from '@/store/playerStore'
import { THEMES, getTheme } from '@/theme/registry'
import type { ThemeAppearance, ThemeId } from '@/theme/types'

let removeTimer: number | undefined

function animateNextChange(): void {
  const root = document.documentElement
  root.classList.add('theme-anim')
  window.clearTimeout(removeTimer)
  removeTimer = window.setTimeout(() => root.classList.remove('theme-anim'), 850)
}

export function setAppearanceAnimated(mode: 'dark' | 'light'): void {
  animateNextChange()
  usePlayerStore.getState().setAppearance(mode)
}

// ── Theme Engine (v3.3) ──────────────────────────────────────────────────────
// Theme changes get the same graceful cross-fade as appearance switches: one
// shared .theme-anim window, no snap, zero steady-state cost. 'custom' (no
// identity attribute) is animated the same way — that IS a visual change.

export function setThemeAnimated(themeId: ThemeId | string): void {
  animateNextChange()
  usePlayerStore.getState().setTheme(themeId)
}

// ── Opposite-brightness jump (command palette) ───────────────────────────────
// The Dark/Light toggle is retired as a primary control, but "jump to the
// other brightness" remains useful from the palette. Session memory of the
// last theme seen per appearance (defaults: the two designed light themes) so
// the jump lands where the user last was instead of a hard-coded pick.
const lastThemeByAppearance: Record<ThemeAppearance, ThemeId> = { dark: 'aurora', light: 'ember' }

export function noteThemeAppearance(id: ThemeId, appearance: ThemeAppearance): void {
  if (id !== 'custom') lastThemeByAppearance[appearance] = id
}

/** Candidate theme for a palette jump to the other brightness. */
export function oppositeThemeCandidate(currentAppearance: ThemeAppearance): ThemeId {
  const other: ThemeAppearance = currentAppearance === 'dark' ? 'light' : 'dark'
  return lastThemeByAppearance[other]
}

/** Human label for the palette's jump command. */
export function oppositeThemeLabel(currentAppearance: ThemeAppearance): string {
  return getTheme(oppositeThemeCandidate(currentAppearance)).label
}

// Re-export so palette/Settings imports stay one-module deep.
export { THEMES }
