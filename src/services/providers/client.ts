import {
  ProviderError,
  type ProviderErrorPayload,
} from './types'
import type { ProviderErrorLike } from '@/types'
import { invoke } from '@tauri-apps/api/core'
import { isTauriDesktop } from '@/services/tauriLibrary'

// ── providerCall — the renderer's single door to online providers ───────────
// Wraps the net:providerRequest IPC channel (Electron) or net_provider_request
// Tauri command with:
//   • a requestId that can be cancelled through net:providerCancel
//   • a client-side watchdog timeout
//   • typed ProviderError rejections built from the main process's payload
//
// In non-Electron/Tauri contexts (plain browser, tests without the mock) this
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
  if (!isTauriDesktop()) {
    throw new ProviderError({ kind: 'unavailable', message: 'Online providers need the Aura desktop app' })
  }

  const requestId = `p${Date.now().toString(36)}${(++seq).toString(36)}`
  const timeoutMs = opts.timeoutMs ?? 20_000

  const controller = new AbortController()
  const onAbort = () => {
    try { void invoke('net_provider_cancel', { requestId }) } catch { /* request already settled */ }
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
    const result = await invoke<unknown>(
      'net_provider_request', { requestId, providerId, op, params })
    if (isProviderErrorPayload(result)) {
      throw new ProviderError(normalizePayload(result as ProviderErrorPayload))
    }
    return result as T
  } catch (err) {
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
  for (const id of pending) {
    try {
      void invoke('net_provider_cancel', { requestId: id })
    } catch { /* already settled */ }
  }
  pending.clear()
}
