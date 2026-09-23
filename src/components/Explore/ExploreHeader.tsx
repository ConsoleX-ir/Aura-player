import { ArrowLeft, Globe, Search, X } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { OnlineChip } from './ExploreStates'

// ── ExploreHeader (v2.16.1) ──────────────────────────────────────────────────
// Back button (goes to wherever the user came from — playerStore.goBack),
// identity row with the honest "Online" chip, and the debounced search box.
// The header is sticky and veils its backdrop with the page's base color so
// long lists scroll UNDER it cleanly (no blur cost — Performance Mode safe).

interface ExploreHeaderProps {
  online: boolean
  probing: boolean
  recheck: () => void
  query: string
  onQueryChange: (q: string) => void
}

export function ExploreHeader({ online, probing, recheck, query, onQueryChange }: ExploreHeaderProps) {
  const goBack = usePlayerStore((s) => s.goBack)
  return (
    <div
      className="sticky top-0 z-10 px-7 pt-3 pb-4"
      style={{ background: 'linear-gradient(to bottom, var(--surface-base) 60%, transparent)' }}
    >
      <button
        onClick={goBack}
        className="flex items-center gap-1.5 mb-3 transition-colors active:scale-95"
        style={{ color: 'var(--text-tertiary)', transitionDuration: 'var(--dur-fast)' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
        title="Go back"
        aria-label="Go back to the previous page"
      >
        <ArrowLeft size={14} />
        <span className="text-xs font-medium">Back</span>
      </button>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1
            className="text-2xl font-semibold tracking-tight flex items-center gap-2.5"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
          >
            Explore
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase align-middle"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)', letterSpacing: '0.08em' }}
            >
              <Globe size={9} />
              Online
            </span>
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
            Stream free music from Audius — keyless, nothing to configure. Your library stays local.
          </p>
        </div>
        <OnlineChip online={online} probing={probing} recheck={recheck} />
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
        <input
          type="text"
          placeholder={online ? 'Search Audius — tracks and artists…' : 'Go online to search Audius'}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          disabled={!online}
          className="w-full pl-9 pr-9 py-2 rounded-xl text-sm outline-none transition-all disabled:opacity-50"
          style={{
            background: 'var(--glass-1)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            transitionDuration: 'var(--dur-fast)',
          }}
          aria-label="Search Audius"
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            title="Clear search" aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors"
            style={{ color: 'var(--text-faint)' }}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
