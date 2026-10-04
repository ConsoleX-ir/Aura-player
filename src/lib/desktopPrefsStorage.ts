// SQLite-backed storage for zustand persist (Aura 4 §5/§13).
//
// Aura 3 persisted everything through IndexedDB in the renderer. Aura 4's
// durable layer is the Rust-owned SQLite database, so the playback/preference
// stores persist through the prefs table via the desktop boundary. The
// interface matches zustand's StateStorage, so store definitions don't care
// where the bytes land.
//
// Writes are debounced (400ms — these payloads are small now that the
// library lives in SQLite) and reads resolve from the boot snapshot.

import { desktop } from '@/services/desktop'

const FLUSH_DELAY_MS = 400

export interface PrefsStateStorage {
  getItem: (name: string) => Promise<string | null>
  setItem: (name: string, value: string) => Promise<void>
  removeItem: (name: string) => Promise<void>
}

// Pre-hydration writes are held and discarded (hydration overwrites memory
// anyway) — the same structural gate the IndexedDB adapter had.
let gateOpen = false
const gatedSnapshots = new Map<string, string>()
let gateFailsafeTimer: ReturnType<typeof setTimeout> | null = null

/** Called once the persist middleware finished rehydrating. */
export function markHydrationComplete(): void {
  gateOpen = true
  gatedSnapshots.clear()
  if (gateFailsafeTimer !== null) {
    clearTimeout(gateFailsafeTimer)
    gateFailsafeTimer = null
  }
}

const pendingWrites = new Map<string, string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

// The boot snapshot carries every pref row; `getItem` reads from this cache
// instead of re-querying (prefs only ever change through this renderer).
let bootCache: Map<string, string> | null = null

/** Feed the pref rows from the boot snapshot (called once at startup). */
export function cacheBootPrefs(prefs: [string, string][]): void {
  bootCache = new Map(prefs)
}

function scheduleFlush() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const writes = new Map(pendingWrites)
    pendingWrites.clear()
    if (!desktop.isDesktop()) return
    for (const [key, value] of writes) {
      // JSON string is stored under the store's name; the prefs table is a
      // plain key/value surface so the renderer owns its own shapes.
      desktop.library.prefs
        .set(key, value)
        .catch((err) => console.warn('prefs flush failed:', key, err))
    }
  }, FLUSH_DELAY_MS)
}

export const desktopPrefsStorage: PrefsStateStorage = {
  async getItem(name) {
    return bootCache?.get(name) ?? null
  },

  async setItem(name, value) {
    // Keep the boot cache current so a later getItem (rehydration, dev
    // reload) observes the latest value without a round trip.
    if (bootCache !== null) bootCache.set(name, value)
    if (!gateOpen) {
      gatedSnapshots.set(name, value)
      if (gateFailsafeTimer === null) {
        gateFailsafeTimer = setTimeout(markHydrationComplete, 3000)
      }
      return
    }
    pendingWrites.set(name, value)
    scheduleFlush()
  },

  async removeItem(name) {
    pendingWrites.delete(name)
    if (desktop.isDesktop()) {
      await desktop.library.prefs.delete(name).catch(() => {})
    }
  },
}
