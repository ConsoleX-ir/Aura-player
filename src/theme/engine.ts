// ═══════════════════════════════════════════════════════════════════════════
// AURA THEME ENGINE — DOM application layer
// ═══════════════════════════════════════════════════════════════════════════
// The ONE place that translates a ThemeId into DOM state:
//   • data-aura-theme='<id>'  — selects the CSS identity block (themes.css)
//   • data-theme='dark|light' — selects the brightness foundation (tokens.css)
//
// Application cost is two attribute writes; the visual cross-fade rides the
// existing .theme-anim window (see lib/appearance.ts) and the decorative
// layer's one-shot fade-in (index.css). No React re-renders beyond the store
// subscription, no remounts, no style recalculation storms.
//
// Used by BOTH windows: App.tsx (from the store) and the Mini Player widget
// (from the bridge snapshot), so the two surfaces can never disagree.
// ═══════════════════════════════════════════════════════════════════════════

import { resolveThemeId, themeAppearance } from './registry'
import type { ThemeAppearance, ThemeId } from './types'

export interface ApplyThemeOptions {
  /**
   * Brightness override for the 'custom' theme ONLY. Custom has no designed
   * brightness (it renders the neutral base identity), so the user's current
   * appearance is preserved — this is how pre-migration custom+light users
   * keep their look. Named themes always use their designed brightness and
   * ignore this field.
   */
  customAppearance?: ThemeAppearance
}

/**
 * Apply a theme to a document. Invalid/legacy ids are resolved safely, so a
 * stale or foreign value can never leave the DOM half-themed.
 */
export function applyThemeToDocument(id: ThemeId | string, doc: Document = document, opts?: ApplyThemeOptions): void {
  const theme = resolveThemeId(id)
  const root = doc.documentElement
  if (theme === 'custom') {
    // Custom accent renders the NEUTRAL base identity — no identity block.
    // The resolved accent vars still arrive via the dynamic pipeline.
    root.removeAttribute('data-aura-theme')
  } else {
    root.setAttribute('data-aura-theme', theme)
  }
  const appearance = theme === 'custom' && opts?.customAppearance
    ? opts.customAppearance
    : themeAppearance(theme)
  root.setAttribute('data-theme', appearance)
}
