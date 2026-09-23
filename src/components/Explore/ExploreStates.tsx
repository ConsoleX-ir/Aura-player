import { Globe, Loader2, Radio, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/States/EmptyState'
import { LibraryBig, Heart } from 'lucide-react'

// ── Explore shared states (v2.16.1) ─────────────────────────────────────────
// The ONE vocabulary for every Explore surface's non-content states — the
// page, the radio tab, and the drill-downs all render through these, so a
// timeout in Trending and a timeout in station search look, behave, and
// retry identically. Error copy is keyed by the typed ProviderError kinds
// (services/providers/types.ts) — never a generic "Network Error" when the
// actual problem is a timeout or a rate limit.

export type SectionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; kind: string; message: string }
  | { status: 'empty' }
  | { status: 'done' }

export function toPayload(e: unknown): { kind: string; message: string } {
  // ProviderError carries the typed kind; plain Errors (or the internal
  // 'cancelled' rejection from the dedupe layer when a caller's own signal
  // was already aborted) normalize to network. Callers check their own
  // signal BEFORE surfacing, so cancellations never render as errors.
  const kind = (e as { kind?: string })?.kind
  return {
    kind: typeof kind === 'string' && kind ? kind : 'network',
    message: e instanceof Error ? e.message : 'Request failed',
  }
}

export function toErrorState(e: unknown): SectionState {
  const p = toPayload(e)
  return { status: 'error', kind: p.kind, message: p.message }
}

/** A titled, hairline-ruled content section — the Explore rhythm unit. */
export function Section({ title, icon, hint, children }: { title: string; icon?: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2
          className="text-[11px] font-semibold uppercase"
          style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
        >
          {title}
        </h2>
        {hint && (
          <span className="text-[10px] normal-case truncate" style={{ color: 'var(--text-faint)', opacity: 0.8 }} title={hint}>
            {hint}
          </span>
        )}
        <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
      </div>
      {children}
    </section>
  )
}

/** Skeleton rows shaped exactly like TrackList rows — no layout jump on load. */
export function TrackListSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl animate-pulse" style={{ background: 'var(--glass-1)' }}>
          <div className="w-9 h-9 rounded-lg" style={{ background: 'var(--glass-2)' }} />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 rounded w-1/3" style={{ background: 'var(--glass-2)' }} />
            <div className="h-2.5 rounded w-1/4" style={{ background: 'var(--glass-2)' }} />
          </div>
          <div className="h-2.5 w-8 rounded" style={{ background: 'var(--glass-2)' }} />
        </div>
      ))}
    </div>
  )
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 py-8 justify-center" role="status">
      <Loader2 size={15} className="animate-spin" style={{ color: 'var(--accent)' }} />
      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
    </div>
  )
}

export function EmptyBlock({ note }: { note: string }) {
  return (
    <p className="text-xs py-6 text-center" style={{ color: 'var(--text-faint)' }}>
      {note}
    </p>
  )
}

const ERROR_COPY: Record<string, { title: string; hint: string }> = {
  offline: { title: "You're offline", hint: 'Connect to the internet and try again.' },
  timeout: { title: 'The provider took too long', hint: 'The source may be slow right now — retrying usually helps.' },
  network: { title: 'Connection problem', hint: 'The network request could not complete.' },
  http: { title: 'The provider had a problem', hint: 'The service answered with an error status.' },
  rate_limited: { title: 'Slow down a little', hint: 'The provider asked us to wait a moment — retry shortly.' },
  malformed: { title: 'The provider answered oddly', hint: 'The response was not in the expected shape.' },
  unavailable: { title: 'Provider unavailable', hint: 'This online source is not reachable right now.' },
}

/**
 * Typed, retryable error block. `onRetry` re-issues THE FAILED REQUEST —
 * the v2.16.1 fix; probing connectivity alone used to leave the section
 * stuck in error when the probe succeeded but the provider hiccupped.
 */
export function ErrorBlock({ kind, message, onRetry }: { kind: string; message: string; onRetry: () => void }) {
  const c = ERROR_COPY[kind] ?? { title: 'Something went wrong', hint: message }
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
      role="alert"
      data-error-kind={kind}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{c.title}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{c.hint}</p>
      </div>
      <button
        onClick={onRetry}
        data-testid="explore-retry"
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium active:scale-95 transition-all shrink-0"
        style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
      >
        <Radio size={11} />
        Retry
      </button>
    </div>
  )
}

/** Offline landing: honest, actionable, and never breaks the page layout. */
export function OfflineState({ onRecheck, onLibrary, onFavorites }: {
  onRecheck: () => void
  onLibrary: () => void
  onFavorites: () => void
}) {
  return (
    <div className="pt-10">
      <EmptyState
        icon={<WifiOff size={22} />}
        title="You're offline"
        hint="Explore needs an internet connection. Your library keeps working — it's 100% local."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={onRecheck}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium active:scale-95 transition-all"
              style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
            >
              <Globe size={14} />
              Try again
            </button>
            <button
              onClick={onLibrary}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium active:scale-95 transition-all"
              style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
            >
              <LibraryBig size={14} />
              Your Library
            </button>
            <button
              onClick={onFavorites}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium active:scale-95 transition-all"
              style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
            >
              <Heart size={14} />
              Favorites
            </button>
          </div>
        }
      />
    </div>
  )
}

/** The live connection chip — green/red dot, spinner while probing, click re-checks. */
export function OnlineChip({ online, probing, recheck }: { online: boolean; probing: boolean; recheck: () => void }) {
  const color = online ? 'var(--success)' : 'var(--danger)'
  const veil = online ? 'var(--success-veil)' : 'var(--danger-veil)'
  return (
    <button
      onClick={() => { if (!online) recheck() }}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase transition-all"
      style={{ background: veil, color, border: `1px solid ${color}44`, letterSpacing: '0.08em' }}
      title={online ? 'Connected' : 'Offline — click to re-check'}
      aria-label={online ? 'Online' : 'Offline — click to re-check'}
    >
      {probing
        ? <Loader2 size={10} className="animate-spin" />
        : <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
      {online ? 'Online' : 'Offline'}
    </button>
  )
}

/** A slim honest banner: content on screen is from this session's cache.
 * Carries the local Library/Favorites shortcuts so offline browsing still
 * leads somewhere useful (offline contract: cached content + local paths). */
export function CachedBanner({ note, onLibrary, onFavorites, className }: {
  note: string
  onLibrary?: () => void
  onFavorites?: () => void
  className?: string
}) {
  return (
    <div
      className={cn('flex items-center gap-2 px-3 py-2 rounded-xl mb-3 flex-wrap', className)}
      style={{ background: 'var(--glass-1)', border: '1px dashed var(--border-strong)' }}
      role="note"
      data-cached-banner=""
    >
      <WifiOff size={11} style={{ color: 'var(--warning)' }} className="shrink-0" />
      <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{note}</span>
      <div className="flex-1" />
      {onLibrary && (
        <button
          onClick={onLibrary}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium active:scale-95 transition-all"
          style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
        >
          <LibraryBig size={11} />
          Your Library
        </button>
      )}
      {onFavorites && (
        <button
          onClick={onFavorites}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium active:scale-95 transition-all"
          style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
        >
          <Heart size={11} />
          Favorites
        </button>
      )}
    </div>
  )
}
