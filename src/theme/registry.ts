// ═══════════════════════════════════════════════════════════════════════════
// AURA THEME ENGINE — registry (single source of truth)
// ═══════════════════════════════════════════════════════════════════════════
// THE source of truth for every selectable theme. The old split registry
// (accent hexes in lib/themePresets.ts + ink blocks in themes.css) is unified:
// the accent/cloud/secondary side lives HERE in typed form, the CSS side is
// keyed by the same ids, and a unit test (scripts/a33_theme_engine.test.ts)
// proves the two sides never drift apart.
//
// IDs ARE LOAD-BEARING: they are the persisted `theme` value. Legacy ids from
// Theme System 3.0 (ocean, crimson, …) are never re-used for a different
// visual family and never renamed; they resolve through LEGACY_MIGRATION so
// every existing installation lands on the closest new identity (see the map
// below for the exact, documented mapping). `custom` keeps its historical
// meaning: the user-picked accent over the neutral base identity.
// ═══════════════════════════════════════════════════════════════════════════

import type { AuraTheme, NamedThemeId, ThemeAppearance, ThemeId } from './types'

// ── The ten named themes ────────────────────────────────────────────────────
// Record over NamedThemeId: a missing or misspelled entry is a COMPILE error,
// which is the compile-time completeness contract promised in types.ts.
export const THEMES: Record<NamedThemeId, AuraTheme> = {
  aurora: {
    id: 'aurora',
    label: 'Aurora',
    description: 'Northern lights — boreal green, turquoise and violet over deep atmospheric ink.',
    appearance: 'dark',
    accent: { primary: '#35D0A5', secondary: '#67DCD0', cloud: '#9AD9C8' },
    swatch: 'linear-gradient(135deg, #0B1A18 0%, #35D0A5 55%, #67DCD0 78%, #8B7FD0 100%)',
  },
  ember: {
    id: 'ember',
    label: 'Ember',
    description: 'Warm editorial paper — copper, burnt orange and burgundy on cream surfaces.',
    appearance: 'light',
    accent: { primary: '#C4703B', secondary: '#9C4A52', cloud: '#C79E76' },
    swatch: 'linear-gradient(135deg, #F6F1E7 0%, #C4703B 55%, #9C4A52 82%, #5C2E35 100%)',
  },
  abyss: {
    id: 'abyss',
    label: 'Abyss',
    description: 'Ocean depths — navy and teal with light falling through layered water.',
    appearance: 'dark',
    accent: { primary: '#31BFCB', secondary: '#63D8E8', cloud: '#7FB6D9' },
    swatch: 'linear-gradient(135deg, #050912 0%, #0B1830 40%, #31BFCB 78%, #63D8E8 100%)',
  },
  vector: {
    id: 'vector',
    label: 'Vector',
    description: 'Technical precision — graphite and silver, a cobalt accent, blueprint structure.',
    appearance: 'light',
    accent: { primary: '#2B5BD7', secondary: '#4E5A6B', cloud: '#9AA6B5' },
    swatch: 'linear-gradient(135deg, #FAFBFC 0%, #B9C2CE 38%, #2B5BD7 62%, #14171D 100%)',
  },
  nebula: {
    id: 'nebula',
    label: 'Nebula',
    description: 'Cosmic clouds — violet, magenta, coral and gold scattered across deep space.',
    appearance: 'dark',
    accent: { primary: '#A866DC', secondary: '#EF8E70', cloud: '#C0A8D9' },
    swatch: 'linear-gradient(135deg, #0C0A14 0%, #A866DC 52%, #EF8E70 78%, #E4B95B 100%)',
  },

  // ── Expansion wave (v3.3) — same contract, same pipeline ──────────────
  verdant: {
    id: 'verdant',
    label: 'Verdant',
    description: 'Deep forest — emerald and moss under a dense green canopy, with warm-gold light.',
    appearance: 'dark',
    accent: { primary: '#3FBE7E', secondary: '#C9A45C', cloud: '#9CC5A5' },
    swatch: 'linear-gradient(135deg, #071108 0%, #163620 38%, #3FBE7E 68%, #C9A45C 100%)',
  },
  obsidian: {
    id: 'obsidian',
    label: 'Obsidian',
    description: 'Dark glass stone — graphite and charcoal with polished silver metallic depth.',
    appearance: 'dark',
    accent: { primary: '#C6CDD9', secondary: '#98A2B3', cloud: '#AEB6C2' },
    swatch: 'linear-gradient(135deg, #0A0B0D 0%, #1B1F24 34%, #8E99A8 66%, #C6CDD9 100%)',
  },
  solstice: {
    id: 'solstice',
    label: 'Solstice',
    description: 'Golden hour — amber sunlight and coral horizons over warm luminous paper.',
    appearance: 'light',
    accent: { primary: '#D98E2B', secondary: '#D96349', cloud: '#F2CD88' },
    swatch: 'linear-gradient(135deg, #FAF1DD 0%, #F2CD88 40%, #D98E2B 68%, #D96349 100%)',
  },
  cryo: {
    id: 'cryo',
    label: 'Cryo',
    description: 'Glacier light — ice white, pale cyan and silver with deep glacial blue.',
    appearance: 'light',
    accent: { primary: '#4AAAD1', secondary: '#2C5E96', cloud: '#B5D9EA' },
    swatch: 'linear-gradient(135deg, #EEF4F8 0%, #B5D9EA 40%, #4AAAD1 70%, #2C5E96 100%)',
  },
  sakura: {
    id: 'sakura',
    label: 'Sakura',
    description: 'Blossom season — petal pink and blush on paper white, anchored by plum charcoal.',
    appearance: 'light',
    accent: { primary: '#D97A96', secondary: '#8E4A5F', cloud: '#EFC6D2' },
    swatch: 'linear-gradient(135deg, #FAF5F4 0%, #EFC6D2 40%, #D97A96 70%, #8E4A5F 100%)',
  },
}

/**
 * The retained Custom-accent entry. It has no CSS identity block: selecting it
 * REMOVES the data-aura-theme attribute so the neutral token base renders,
 * exactly like the old 'custom' path. Its brightness is not fixed — the store
 * keeps the user's current appearance when switching to Custom (see
 * playerStore.setTheme), so pre-migration custom+light users keep their look.
 */
export const CUSTOM_THEME: AuraTheme = {
  id: 'custom',
  label: 'Custom',
  description: 'Your own accent color over the neutral ConsoleX base identity.',
  appearance: 'dark', // nominal only — the store preserves the live appearance
  accent: { primary: '#B0B8C8', secondary: '#D7DEEB', cloud: '#B0B8C8' }, // classic defaults
  swatch: 'linear-gradient(135deg, #B0B8C8, #4A4E58)',
}

/** UI order for the Settings picker: the ten named themes (original five,
 * then the expansion wave), then Custom. */
export const THEME_LIST: readonly AuraTheme[] = [
  THEMES.aurora,
  THEMES.ember,
  THEMES.abyss,
  THEMES.vector,
  THEMES.nebula,
  THEMES.verdant,
  THEMES.obsidian,
  THEMES.solstice,
  THEMES.cryo,
  THEMES.sakura,
  CUSTOM_THEME,
]

/** Launch default. 'aurora' is the house identity going forward. */
export const DEFAULT_THEME_ID: ThemeId = 'aurora'

/** Every valid id — used by validation and tests. */
export const ALL_THEME_IDS: readonly ThemeId[] = [...THEME_LIST.map((t) => t.id)]

// ── Legacy migration (Theme System 3.0 → Theme Engine) ──────────────────────
// Old ids are mapped to the closest NEW identity. EVERY entry is a function
// of the persisted appearance, guaranteeing one invariant: a light-mode user
// is never dropped into a dark theme (and vice versa) by migration. Dark-mode
// users split by hue family; light-mode users split warm (Ember) vs cool
// (Vector). This map is DOCUMENTED behavior — see
// docs/THEME_ENGINE_IMPLEMENTATION.md §5.
export type LegacyTarget = (persistedAppearance: ThemeAppearance) => ThemeId

export const LEGACY_MIGRATION: Record<string, LegacyTarget> = {
  // Green/boreal family → Aurora in dark; cool light users → Vector
  aurora: (ap) => (ap === 'light' ? 'vector' : 'aurora'),
  forest: (ap) => (ap === 'light' ? 'vector' : 'aurora'),
  // Blue/aqua family → Abyss in dark; cool light users → Vector
  ocean: (ap) => (ap === 'light' ? 'vector' : 'abyss'),
  cyan: (ap) => (ap === 'light' ? 'vector' : 'abyss'),
  indigo: (ap) => (ap === 'light' ? 'vector' : 'abyss'),
  // Violet/plum family → Nebula in dark; cool light users → Vector
  amethyst: (ap) => (ap === 'light' ? 'vector' : 'nebula'),
  orchid: (ap) => (ap === 'light' ? 'vector' : 'nebula'),
  // Warm family → Ember keeps light warm; dark warm users → Nebula's coral/gold
  sunset: (ap) => (ap === 'light' ? 'ember' : 'nebula'),
  crimson: (ap) => (ap === 'light' ? 'ember' : 'nebula'),
  champagne: (ap) => (ap === 'light' ? 'ember' : 'nebula'),
  // Neutral family → Vector keeps light neutral; dark → Aurora (new flagship)
  default: (ap) => (ap === 'light' ? 'vector' : 'aurora'),
  mono: (ap) => (ap === 'light' ? 'vector' : 'aurora'),
  // 'custom' is not legacy — resolved directly in resolveThemeId.
}

/**
 * Validate ANY stored/foreign theme value and return a safe ThemeId.
 * Order: exact modern id → legacy migration (appearance-aware) → default.
 * Never throws; unknown garbage always falls back to DEFAULT_THEME_ID.
 */
export function resolveThemeId(raw: unknown, persistedAppearance?: ThemeAppearance): ThemeId {
  const id = typeof raw === 'string' ? raw.trim() : ''
  if ((ALL_THEME_IDS as readonly string[]).includes(id)) return id as ThemeId
  const legacy = LEGACY_MIGRATION[id]
  if (legacy) {
    const target = typeof legacy === 'function' ? legacy(persistedAppearance === 'light' ? 'light' : 'dark') : legacy
    return target
  }
  return DEFAULT_THEME_ID
}

/** Designed brightness of a named theme ('dark' for custom — see CUSTOM_THEME). */
export function themeAppearance(id: ThemeId): ThemeAppearance {
  return id === 'custom' ? 'dark' : THEMES[id].appearance
}

/** Theme lookup that cannot miss (resolveThemeId first for foreign input). */
export function getTheme(id: ThemeId): AuraTheme {
  return id === 'custom' ? CUSTOM_THEME : THEMES[id]
}
