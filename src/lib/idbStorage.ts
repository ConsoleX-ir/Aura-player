// ── IndexedDB-backed storage for zustand persist ────────────────────────────
// Replaces localStorage persistence (a v1.x performance ceiling): zustand's
// persist middleware serializes the partialized state on EVERY store change,
// and with the library living in persisted state that meant stringifying a
// multi-megabyte JSON blob — including on every ~4-10Hz playback progress
// tick — then hitting localStorage's synchronous, main-thread-blocking write.
//
// This adapter fixes both halves:
//   1. IndexedDB instead of localStorage — async, no main-thread I/O stall,
//      effectively unlimited quota for large libraries.
//   2. Debounced writes — rapid mutations (progress ticks, volume drags)
//      coalesce into one stringify+write per idle window. The partialized
//      object is only serialized at flush time, so skipped ticks cost
//      nothing at all.
//
// One-time migration: on first run the adapter finds no IndexedDB data and
// falls back to reading the legacy localStorage entry ('aura-player'), so
// existing users keep their library transparently. After the first
// successful debounced flush into IndexedDB, the legacy copy is removed.
//
// Zero dependencies — raw IDB, ~120 lines.

const DB_NAME = 'aura-player-db'
const DB_VERSION = 1
const STORE = 'kv'
const FLUSH_DELAY_MS = 800

// Zustand's StateStorage interface (synchronous signatures, async results
// are fine — persist awaits them through createJSONStorage).
export interface IDBStateStorage {
  getItem: (name: string) => Promise<string | null>
  setItem: (name: string, value: string) => Promise<void>
  removeItem: (name: string) => Promise<void>
}

// ── Pre-hydration write gate (Wave 0 hardening) ───────────────────────────
// zustand v5's persist middleware does NOT gate its write-back on
// hydration: any set() that lands before the async IndexedDB read resolves
// makes the middleware serialize the INCOMPLETE (default) state and
// schedule its write. With this adapter's 800ms debounce, that stale
// snapshot would flush AFTER hydration finished — overwriting the
// freshly-loaded library with a half-empty one (the classic startup
// overwrite, one future boot-time set() away). The Wave 0 audit verified
// no current code writes pre-hydration; this gate makes that guarantee
// structural instead of wishful. Pre-gate snapshots are held, then
// DISCARDED when hydration lands — hydration overwrites in-memory state
// anyway, so they are stale by definition. A 3s failsafe opens the gate
// regardless, so a wedged hydration can never wedge persistence with it.
let gateOpen = false
const gatedSnapshots = new Map<string, string>()
let gateFailsafeTimer: ReturnType<typeof setTimeout> | null = null

/** Called once the persist middleware has finished rehydrating (see useStoreHydration). */
export function markHydrationComplete(): void {
  gateOpen = true
  gatedSnapshots.clear()
  if (gateFailsafeTimer !== null) { clearTimeout(gateFailsafeTimer); gateFailsafeTimer = null }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Debounced write pipeline ────────────────────────────────────────────────
// One pending value per key; the LAST write in a burst wins (correct — every
// write is a full state snapshot), and only the final one is serialized.
const pending = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>()
// Resolved after the first successful flush of the persisted state — used to
// time the removal of the legacy localStorage copy exactly once.
let legacyMigrated = false
let legacyMigrationResolve: (() => void) | null = null
const legacyMigrationDone = new Promise<void>((resolve) => { legacyMigrationResolve = resolve })

async function flushKey(name: string): Promise<void> {
  const entry = pending.get(name)
  if (!entry) return
  pending.delete(name)
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry.value, name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  if (!legacyMigrated) {
    legacyMigrated = true
    // Only after IndexedDB provably holds the state do we drop the legacy
    // copy — if the flush had failed, the old data would still be the only
    // copy and deleting it would be data loss.
    try { localStorage.removeItem(name) } catch { /* ignore */ }
    legacyMigrationResolve?.()
    legacyMigrationResolve = null
  }
}

export const idbStorage: IDBStateStorage = {
  async getItem(name) {
    try {
      const db = await openDb()
      const value = await new Promise<string | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly')
        const req = tx.objectStore(STORE).get(name)
        req.onsuccess = () => resolve(req.result as string | undefined)
        req.onerror = () => reject(req.error)
      })
      if (value != null) return value
    } catch (e) {
      console.warn('IndexedDB read failed, falling back to localStorage:', e)
    }
    // Migration path + fallback: whatever this session's writes do, reads
    // degrade gracefully to the old storage so the app never starts empty
    // for a user who had data under v1.x.
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },

  setItem(name, value) {
    // Pre-hydration: hold the snapshot (see gate note above) — it describes
    // default/incomplete state and must never reach the disk snapshot that
    // hydration is about to establish.
    if (!gateOpen) {
      if (gateFailsafeTimer === null) {
        gateFailsafeTimer = setTimeout(() => {
          gateOpen = true
          gatedSnapshots.clear()
        }, 3000)
      }
      gatedSnapshots.set(name, value)
      return Promise.resolve()
    }
    // Coalesce bursts: replace any pending value and restart the timer.
    const existing = pending.get(name)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      flushKey(name).catch((e) => {
        console.warn('IndexedDB state flush failed:', e)
        // Keep the failed value pending? No — drop it; the next change will
        // retry, and reads fall back to the last successful snapshot.
        pending.delete(name)
      })
    }, FLUSH_DELAY_MS)
    pending.set(name, { value, timer })
    return Promise.resolve()
  },

  async removeItem(name) {
    const existing = pending.get(name)
    if (existing) { clearTimeout(existing.timer); pending.delete(name) }
    try {
      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(name)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch (e) {
      console.warn('IndexedDB remove failed:', e)
    }
  },
}

/** Resolves once the first state flush has landed in IndexedDB (testing/migration introspection). */
export function whenLegacyMigrationComplete(): Promise<void> {
  return legacyMigrationDone
}

// ── Unload flushing ─────────────────────────────────────────────────────────
// The debounce trades write latency for durability: a change made <800ms
// before the app goes away would otherwise die in `pending`. Flush every
// pending key the moment the page starts going away (tab/app close, and
// reloads) — same best-effort contract as the engine's beforeunload scrobble
// flush. Fires at most once per pending value; no-op when nothing is pending.

/**
 * Flush every pending key NOW and resolve once they have all landed (or
 * failed). The coordinated-shutdown path (Electron holds the window open
 * until the renderer acks) awaits this — that's what closes the durability
 * gap that made "change a setting, quit within 800ms, lose the setting"
 * possible with the debounce alone. Wave 0, alongside the immediate-write
 * pattern scrobbleStore already used.
 */
export function flushAllPending(): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const name of Array.from(pending.keys())) {
    jobs.push(
      flushKey(name).catch(() => {
        // Same policy as the debounced path: drop the failed value; reads
        // fall back to the last successful snapshot.
        pending.delete(name)
      })
    )
  }
  return Promise.all(jobs).then(() => {})
}

// Best-effort event variants (page going away — no ack channel available).
function flushAllPendingNow(): void {
  void flushAllPending()
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllPendingNow()
  })
  window.addEventListener('pagehide', flushAllPendingNow)
}
