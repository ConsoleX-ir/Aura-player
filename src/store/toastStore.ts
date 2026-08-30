import { create } from 'zustand'

// ── Toast feedback store ─────────────────────────────────────────────────────
// Lightweight, transient notifications for actions whose result isn't always
// visible at a glance — favoriting via keyboard from the middle of a long
// list, toggling shuffle while the button is scrolled away, sleep timers
// firing in the background, etc. Not persisted, auto-dismissed on a fixed
// per-toast schedule.

export type ToastKind =
  | 'favorite-add'
  | 'favorite-remove'
  | 'shuffle-on'
  | 'shuffle-off'
  | 'repeat-none'
  | 'repeat-all'
  | 'repeat-one'
  | 'mute'
  | 'unmute'
  | 'sleep-timer'
  | 'now-playing'
  | 'metadata-updated'

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  subtitle?: string
}

interface ToastState {
  toasts: ToastItem[]
  push: (toast: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
}

let seq = 0
const MAX_TOASTS = 3
const TOAST_MS = 2200

// Timers intentionally live here in module scope rather than in a component
// effect: a component-level effect recreates EVERY toast's timer whenever the
// list changes, so a busy stream of actions could keep an old card alive
// indefinitely. Per-toast timers give each card its own fixed lifetime.
const timers = new Map<number, number>()

function clearTimer(id: number) {
  const handle = timers.get(id)
  if (handle !== undefined) {
    clearTimeout(handle)
    timers.delete(id)
  }
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq
    set((s) => {
      const next = [...s.toasts.filter((x) => x.kind !== t.kind), { ...t, id }].slice(-MAX_TOASTS)
      // Clear timers for cards that got evicted (same-kind replacement or
      // MAX_TOASTS overflow) so their timeouts can't fire on stale ids.
      const keptIds = new Set(next.map((x) => x.id))
      for (const old of s.toasts) {
        if (!keptIds.has(old.id)) clearTimer(old.id)
      }
      return { toasts: next }
    })
    timers.set(id, window.setTimeout(() => useToastStore.getState().dismiss(id), TOAST_MS))
  },
  dismiss: (id) => {
    clearTimer(id)
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
  },
}))

// Imperative helper for non-React callers (keyboard handlers, timers) so
// they don't need useToastStore() subscriptions just to fire one toast.
export function toast(t: Omit<ToastItem, 'id'>) {
  useToastStore.getState().push(t)
}
