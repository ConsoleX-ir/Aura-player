import {
  ProviderError,
  type ProviderErrorPayload,
} from './types'
import type { ProviderErrorLike } from '@/types'

// ── providerCall — the renderer's single door to online providers ───────────
// Wraps the net:providerRequest IPC channel with:
//   • a requestId that can be cancelled through net:providerCancel
//   • a client-side watchdog timeout (the main process has its own per-fetch
//     timeout; this one also covers a wedged IPC round-trip)
//   • typed ProviderError rejections built from the main process's payload
//
// In non-Electron contexts (plain browser, tests without the mock) this
// rejects with an 'unavailable' ProviderError — callers render their
// unavailable state instead of crashing.

let seq = 0
const pending = new Set<string>()

/** Runtime guard: an IPC payload is a provider failure iff kind+message are strings. */
function isProviderErrorPayload(v: unknown): v is ProviderErrorLike {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as ProviderErrorLike).kind === 'string' &&
    typeof (v as ProviderErrorLike).message === 'string'
  )
}

function normalizePayload(v: ProviderErrorLike): ProviderErrorPayload {
  return {
    kind: (v.kind && KINDS.has(v.kind) ? v.kind : 'network') as ProviderErrorPayload['kind'],
    message: v.message || 'Provider request failed',
    ...(v.status !== undefined ? { status: v.status } : {}),
  }
}

const KINDS = new Set<string>([
  'offline', 'timeout', 'network', 'http', 'rate_limited', 'malformed', 'unavailable', 'empty',
])

export interface ProviderCallOptions {
  /** Client-side watchdog, distinct from the per-fetch timeout in main. */
  timeoutMs?: number
  /** Abort externally (component unmount, new query superseding this one). */
  signal?: AbortSignal
}

export async function providerCall<T>(
  providerId: string,
  op: string,
  params: Record<string, unknown> = {},
  opts: ProviderCallOptions = {},
): Promise<T> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.providerRequest || !api?.providerCancel) {
    throw new ProviderError({ kind: 'unavailable', message: 'Online providers need the Aura desktop app' })
  }

  const requestId = `p${Date.now().toString(36)}${(++seq).toString(36)}`
  const timeoutMs = opts.timeoutMs ?? 20_000

  const controller = new AbortController()
  const onAbort = () => {
    try { api.providerCancel!(requestId) } catch { /* request already settled */ }
  }
  if (opts.signal) {
    if (opts.signal.aborted) throw new ProviderError({ kind: 'network', message: 'cancelled' })
    opts.signal.addEventListener('abort', onAbort, { once: true })
  }

  const watchdog = setTimeout(() => {
    onAbort()
    controller.abort()
  }, timeoutMs)
  const cleanup = () => {
    clearTimeout(watchdog)
    pending.delete(requestId)
    opts.signal?.removeEventListener('abort', onAbort)
  }
  pending.add(requestId)

  try {
    const result = await api.providerRequest(requestId, providerId, op, params)
    if (isProviderErrorPayload(result)) {
      throw new ProviderError(normalizePayload(result as ProviderErrorPayload))
    }
    return result as T
  } catch (err) {
    // The invoke itself can reject for IPC-level reasons (handler throw,
    // serializer issues) — normalize anything that isn't already typed.
    if (err instanceof ProviderError) throw err
    if (controller.signal.aborted) {
      throw new ProviderError({ kind: 'timeout', message: `No response within ${timeoutMs / 1000}s` })
    }
    if (isProviderErrorPayload(err)) {
      throw new ProviderError(normalizePayload(err as ProviderErrorPayload))
    }
    throw new ProviderError({
      kind: 'network',
      message: err instanceof Error ? err.message : 'Provider request failed',
    })
  } finally {
    cleanup()
  }
}

/** Best-effort cancel of everything still in flight (e.g. going offline). */
export function cancelAllProviderCalls(): void {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api?.providerCancel) return
  for (const id of pending) {
    try { api.providerCancel(id) } catch { /* already settled */ }
  }
  pending.clear()
}
