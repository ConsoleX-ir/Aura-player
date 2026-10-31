// v4.0.3b — human labels for the three repeat modes. The repeat control's
// tooltip/aria used to expose the raw enum values ("Repeat: none"), which
// both read badly and desynced the accessible name from the visible state.
// Kept next to formatTime so every surface (play bar, Now Playing) shares
// ONE label source.
import type { RepeatMode } from '../types'

export const REPEAT_LABEL: Record<RepeatMode, string> = {
  none: 'Off',
  all: 'All',
  one: 'One',
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Human-readable file size for the Properties dialog — "3.5 MB" style.
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || isNaN(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

// Deterministic, non-cryptographic string hash — used to derive a stable
// song ID from its file path, so the same file always resolves to the same
// ID across imports/syncs without needing a lookup table.
export function hashStr(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(' ')
}

/** Human runtime for stats/hero rows ("3.5 hours", "42 minutes"). */
export function formatRuntime(totalSec: number): string {
  const hours = totalSec / 3600
  if (hours >= 1) {
    const h = hours >= 100 ? Math.round(hours) : Math.round(hours * 10) / 10
    return `${h} ${h === 1 ? 'hour' : 'hours'}`
  }
  const m = Math.max(1, Math.round(totalSec / 60))
  return `${m} minutes`
}
