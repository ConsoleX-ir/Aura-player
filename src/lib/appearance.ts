// ── Appearance switching with a graceful cross-fade ─────────────────────────
// One helper so EVERY entry point (Settings toggle, command palette, future
// theme widgets) produces the identical animated dark↔light transition: a
// temporary .theme-anim class lets all colors glide over --dur-ambient, then
// the class is removed so steady-state rendering pays nothing.
// Re-entrancy safe: rapid toggling resets the removal timer instead of
// stacking classes or cutting an in-flight fade short.

import { usePlayerStore } from '@/store/playerStore'

let removeTimer: number | undefined

export function setAppearanceAnimated(mode: 'dark' | 'light'): void {
  const root = document.documentElement
  root.classList.add('theme-anim')
  usePlayerStore.getState().setAppearance(mode)
  window.clearTimeout(removeTimer)
  removeTimer = window.setTimeout(() => root.classList.remove('theme-anim'), 850)
}
