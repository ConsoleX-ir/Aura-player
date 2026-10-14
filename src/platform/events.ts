// Minimal in-process event bus. In Electron, the mini player lived in a second
// window and its messages were relayed through the main process. In the single-
// window Wails build both ends live in one renderer, so the relay is this bus.

type Listener = (payload: never) => void

const listeners = new Map<string, Set<Listener>>()
const last = new Map<string, unknown>()

/** Subscribes to an event; returns an unsubscribe function. */
export function on<T>(name: string, cb: (payload: T) => void, opts?: { replay?: boolean }): () => void {
  let set = listeners.get(name)
  if (!set) listeners.set(name, (set = new Set()))
  set.add(cb as Listener)
  if (opts?.replay && last.has(name)) cb(last.get(name) as T)
  return () => { set!.delete(cb as Listener) }
}

/** Emits to every current subscriber. A throwing listener cannot affect the others. */
export function emit<T>(name: string, payload: T, opts?: { remember?: boolean }): void {
  if (opts?.remember) last.set(name, payload)
  for (const cb of [...(listeners.get(name) ?? [])]) {
    try { (cb as (p: T) => void)(payload) } catch (e) { console.error(`[aura] listener for "${name}" threw`, e) }
  }
}

export function listenerCount(name: string): number {
  return listeners.get(name)?.size ?? 0
}

/** Test helper. */
export function resetEvents(): void {
  listeners.clear()
  last.clear()
}
