// ═══════════════════════════════════════════════════════════════════════════
// AURA THEME ENGINE — type contract (v3.3 "Theme Engine & Design System",
// ten-theme expansion)
// ═══════════════════════════════════════════════════════════════════════════
// A THEME is a complete, designed identity — not an accent-color variant.
// Every named theme owns:
//   • a designed BRIGHTNESS (appearance) — the old global dark/light toggle
//     is retired; brightness is a property of the theme, not a second axis;
//   • its accent family (primary + secondary + idle ambient cloud);
//   • a full CSS identity block in styles/themes.css keyed by the SAME id
//     (ink scale, chrome tint, shadow tint, border temperature, decorative
//     layer). Registry ↔ CSS completeness is enforced by
//     scripts/a33_theme_engine.test.ts, which parses themes.css and fails
//     the build if a registry theme has no matching identity block.
//
// Adding a future theme (see docs/THEME_ENGINE_IMPLEMENTATION.md §6):
//   1. add its id to NamedThemeId,
//   2. add its AuraTheme entry to THEMES in registry.ts (the Record<
//      NamedThemeId, …> type makes a missing entry a compile error),
//   3. add the [data-aura-theme='<id>'] identity block in themes.css,
//   4. add it to the Settings picker (it renders THEME_LIST — automatic).
// ═══════════════════════════════════════════════════════════════════════════

/** The ten named product themes (original five + the five-theme expansion). */
export type NamedThemeId =
  | 'aurora'
  | 'ember'
  | 'abyss'
  | 'vector'
  | 'nebula'
  // ── expansion wave ──
  | 'verdant'
  | 'obsidian'
  | 'solstice'
  | 'cryo'
  | 'sakura'

/**
 * Every selectable theme id. 'custom' is retained for backward compatibility
 * with the user-picked accent feature: it renders the neutral base identity
 * (no data-aura-theme attribute) with the user's accent color.
 */
export type ThemeId = NamedThemeId | 'custom'

/** Designed brightness of a theme. Derived from the theme — never a free axis. */
export type ThemeAppearance = 'dark' | 'light'

export interface AuraAccent {
  /**
   * Primary accent hex. Feeds the --color-dynamic-* pipeline exactly like the
   * old preset hexes did (same colorToVars derivation, so Custom accents,
   * artwork ambient and playlist covers keep working unchanged).
   */
  primary: string
  /**
   * Secondary accent (--accent-2) for 3.0 surfaces (Playbar glass, Explore
   * hero, selected states). Owned by the theme — not derived.
   */
  secondary: string
  /**
   * Idle ambient cloud — the glow color before any artwork takes over
   * (--cloud family in themes.css).
   */
  cloud: string
}

/** Complete definition of one theme — the shape the whole app consumes. */
export interface AuraTheme {
  id: ThemeId
  /** Human label shown in Settings / command palette. */
  label: string
  /** One-line identity description (Settings description text). */
  description: string
  /** Designed brightness. Drives data-theme; never user-selected. */
  appearance: ThemeAppearance
  accent: AuraAccent
  /** CSS background for the Settings picker tile (mini identity preview). */
  swatch: string
}
