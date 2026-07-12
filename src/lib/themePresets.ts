// Single source of truth for Aura's built-in theme presets. Each preset is
// just an id/label/hex — the actual d1/d2/d3/glow CSS-var values are derived
// from that one hex by colorToVars() in useDynamicTheme.ts, the same way a
// Custom accent color already was. Adding a new preset is exactly one line
// here; nothing else needs to change.
export interface ThemePreset {
  id: string
  label: string
  color: string
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'default',  label: 'ConsoleX',  color: '#B0B8C8' }, // the original cloud gray
  { id: 'forest',   label: 'Forest',    color: '#4A9E6E' }, // muted forest green
  { id: 'ocean',    label: 'Ocean',     color: '#3D93C9' }, // deep ocean blue
  { id: 'sunset',   label: 'Sunset',    color: '#E0894F' }, // warm amber/coral
  { id: 'amethyst', label: 'Amethyst',  color: '#9B7FE0' }, // soft violet
  { id: 'crimson',  label: 'Crimson',   color: '#D9636B' }, // muted rose red
]

export const DEFAULT_THEME_ID = 'default'

export type ThemePresetId = string
