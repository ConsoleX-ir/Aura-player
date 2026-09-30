// ── Appearance switching with a graceful cross-fade ─────────────────────────
// One helper so EVERY entry point (Settings toggle, command palette, future
// theme widgets) produces the identical animated dark↔light transition: a
// temporary .theme-anim class lets all colors glide over --dur-ambient, then
// the class is removed so steady-state rendering pays nothing.
// Re-entrancy safe: rapid toggling resets the removal timer instead of
// stacking classes or cutting an in-flight fade short.

import { usePlayerStore } from '@/store/playerStore'

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

// ── Theme System 3.0 (Wave 4) ───────────────────────────────────────────────
// Theme IDENTITY changes (ink tints / ambient cloud / secondary accent) get
// the same graceful cross-fade as appearance switches: one shared .theme-anim
// window, no snap, zero steady-state cost. 'custom' (attribute removal) is
// animated the same way — that IS a visual change of identity.
export function setThemeAnimated(themeId: string): void {
  animateNextChange()
  usePlayerStore.getState().setTheme(themeId)
}
