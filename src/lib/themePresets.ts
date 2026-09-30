// Single source of truth for Aura's built-in theme identities (Theme System
// 3.0). Each preset's PRIMARY accent is one hex — the actual d1/d2/d3/glow
// CSS-var values are derived from it by colorToVars() in useDynamicTheme.ts,
// the same formula a Custom accent color goes through. The REST of the
// identity (ink tints, ambient cloud, secondary accent) lives in
// styles/themes.css keyed by the same id — this list is the accent + label
// side of that registry, so adding a theme is one line here + one block
// there. IDs are load-bearing: they are the persisted `theme` value, so old
// ids must never be renamed (a saved 'forest' must keep resolving).
export interface ThemePreset {
  id: string
  label: string
  color: string
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'default',  label: 'ConsoleX',    color: '#B0B8C8' }, // the original cloud gray
  { id: 'ocean',    label: 'Ocean Deep',  color: '#3D93C9' }, // deep blue
  { id: 'amethyst', label: 'Amethyst',    color: '#9B7FE0' }, // soft violet
  { id: 'cyan',     label: 'Cyan Frost',  color: '#3FB8C9' }, // frosted teal
  { id: 'forest',   label: 'Emerald',     color: '#4A9E6E' }, // muted forest green
  { id: 'crimson',  label: 'Crimson',     color: '#D9636B' }, // muted rose red
  { id: 'sunset',   label: 'Amber',       color: '#E0894F' }, // warm amber/coral
  { id: 'mono',     label: 'Mono',        color: '#D4D4D8' }, // pure grayscale
]

export const DEFAULT_THEME_ID = 'default'

export type ThemePresetId = string
