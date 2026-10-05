import { useCallback, useEffect, useMemo, useState } from 'react'
import { Play, RefreshCw, Sparkles, Compass, Heart, Loader2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { EmptyState } from '@/components/States/EmptyState'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { assembleSmartContext } from '@/lib/smartRadioActions'
import { buildSmartRadio, type SmartResult, type SmartContext } from '@/lib/smartEngine'
import { formatTime, cn } from '@/lib/utils'
import { toast } from '@/store/toastStore'
import type { Song } from '@/types'

// ── Smart Playlists (Phase 8) ───────────────────────────────────────────────
// Three built-in, engine-driven lists. They are NOT stored playlists — they
// are honest, deterministic VIEWS over the local library + listening
// history, regenerated daily (or on demand via Regenerate). Every row shows
// WHY it was picked, because a recommendation the user cannot inspect is a
// recommendation they cannot trust.
//
//   Made for You     — taste mix: plays, completions, favorites, context
//   Discovery        — exploration-heavy: at least 60% never-played tracks
//   Favorites Radio  — seeded by a deterministic favorite of the day

type ListId = 'made' | 'discovery' | 'favorites'

interface ListDef {
  id: ListId
  title: string
  icon: React.ReactNode
  description: string
  build: (ctx: SmartContext, nonce: number, favoriteSeed: Song | null) => SmartResult
}

const LIST_DEFS: ListDef[] = [
  {
    id: 'made',
    title: 'Made for You',
    icon: <Sparkles size={12} />,
    description: 'Your plays, completions, favorites and listening hours — ranked on-device.',
    build: (ctx) => buildSmartRadio(ctx),
  },
  {
    id: 'discovery',
    title: 'Discovery',
    icon: <Compass size={12} />,
    description: 'At least 60% unheard tracks — the engine keeps digging for what you have not met yet.',
    build: (ctx) => buildSmartRadio({ ...ctx, config: { explorationShare: 0.6, artistCap: 2 } }),
  },
  {
    id: 'favorites',
    title: 'Favorites Radio',
    icon: <Heart size={12} />,
    description: 'A radio around a favorite of the day — similarity plus everything you taught it.',
    build: (ctx, nonce, favSeed) => buildSmartRadio({ ...ctx, seed: favSeed, jitterKey: `favorites|${favSeed?.id ?? 'none'}|${new Date(ctx.now).toISOString().slice(0, 10)}|${nonce}` }),
  },
]

export function SmartPlaylists() {
  const library = usePlayerStore((s) => s.library)
  const currentSongId = usePlayerStore((s) => s.currentSong?.id)
  const [ctx, setCtx] = useState<SmartContext | null>(null)
  const [gathering, setGathering] = useState(true)
  const [nonces, setNonces] = useState<Record<string, number>>({ made: 0, discovery: 0, favorites: 0 })
  const { online } = useOnlineStatus()

  const gather = useCallback(() => {
    setGathering(true)
    assembleSmartContext(null)
      .then((c) => setCtx(c))
      .catch(() => setCtx(null))
      .finally(() => setGathering(false))
  }, [])

  useEffect(() => { gather() }, [gather])

  // Deterministic favorite of the day (favorites are ordered by when they
  // were hearted — the jitter key rotates among them daily).
  const favoriteSeed = useMemo<Song | null>(() => {
    if (!ctx || ctx.favorites.length === 0) return null
    const day = new Date(ctx.now).toISOString().slice(0, 10)
    let h = 0
    for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0
    const id = ctx.favorites[h % ctx.favorites.length]
    return ctx.library.find((s) => s.id === id) ?? null
  }, [ctx])

  const results = useMemo(() => {
    if (!ctx) return null
    const map: Partial<Record<ListId, SmartResult>> = {}
    for (const def of LIST_DEFS) {
      map[def.id] = def.build({ ...ctx, jitterKey: `${def.id}|${new Date(ctx.now).toISOString().slice(0, 10)}|${nonces[def.id] ?? 0}` }, nonces[def.id] ?? 0, favoriteSeed)
    }
    return map
  }, [ctx, nonces, favoriteSeed])

  const playList = (def: ListDef, result: SmartResult) => {
    if (result.picks.length === 0) return
    const s = usePlayerStore.getState()
    const songs = result.picks.map((p) => p.song)
    s.playSong(songs[0], songs)
    toast({
      kind: 'smart-radio',
      title: def.title,
      subtitle: `${songs.length} tracks · ${result.notes[0] ?? 'generated on-device from your library'}`,
    })
  }

  const regenerate = (id: ListId) => {
    setNonces((n) => ({ ...n, [id]: (n[id] ?? 0) + 1 }))
  }

  const hasLibrary = library.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-7 pt-6 pb-4"
        style={{ background: 'linear-gradient(to bottom, var(--surface-base) 60%, transparent)' }}
      >
        <h1
          className="text-2xl font-semibold tracking-tight flex items-center gap-2.5"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
        >
          Smart Playlists
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase align-middle"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)', letterSpacing: '0.08em' }}
          >
            <Sparkles size={9} />
            On-device
          </span>
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          Generated locally from your library and listening history — refreshes daily, never leaves your machine.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-6">
        {!hasLibrary ? (
          <div className="pt-10">
            <EmptyState
              icon={<Sparkles size={22} />}
              title="Nothing to learn from yet"
              hint="Import some music and play it — the engine builds these lists from your listening history."
            />
          </div>
        ) : gathering || !results ? (
          <div className="flex items-center justify-center gap-2.5 py-16" role="status">
            <Loader2 size={15} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Reading your listening history…</span>
          </div>
        ) : (
          LIST_DEFS.map((def) => {
            const result = results[def.id]!
            const picks = result.picks
            return (
              <section key={def.id} className="mb-8">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold tracking-tight flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                      {def.icon}
                      {def.title}
                    </h2>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{def.description}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => playList(def, result)}
                      disabled={picks.length === 0}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium active:scale-95 transition-all disabled:opacity-40"
                      style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
                      title={`Play ${def.title}`}
                    >
                      <Play size={11} fill="currentColor" />
                      Play
                    </button>
                    <button
                      onClick={() => regenerate(def.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium active:scale-95 transition-all"
                      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                      title="Regenerate with a fresh ordering"
                      aria-label={`Regenerate ${def.title}`}
                    >
                      <RefreshCw size={11} />
                    </button>
                  </div>
                </div>

                {/* Honest notes (cold start, small history, empty pool…). */}
                {result.notes.map((n, i) => (
                  <p key={i} className="text-[11px] mb-1" style={{ color: 'var(--warning)', opacity: 0.85 }}>· {n}</p>
                ))}

                {picks.length === 0 ? (
                  <p className="text-xs py-5" style={{ color: 'var(--text-faint)' }}>
                    Nothing to show here right now{!online ? ' — and you are offline (history is always readable; this list just has no candidates).' : '.'}
                  </p>
                ) : (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    {picks.map((pick, i) => {
                      const song = pick.song
                      const isCurrent = currentSongId === song.id
                      return (
                        <div
                          key={song.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`Play ${song.title}`}
                          onKeyDown={(e) => { if (e.key === 'Enter') playList(def, result) }}
                          className={cn('group flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors hover-surface', i > 0 && 'border-t')}
                          style={{ borderTopColor: 'var(--border-subtle)', background: isCurrent ? 'var(--accent-dim)' : undefined }}
                          onClick={() => playList(def, result)}
                        >
                          <span className="text-[10px] tabular-nums w-5 text-right shrink-0" style={{ color: 'var(--text-faint)' }}>{i + 1}</span>
                          <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden" style={{ background: 'var(--glass-2)' }}>
                            {song.coverArt
                              ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                              : <ArtworkPlaceholder seed={song.id} size="sm" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate" style={{ color: isCurrent ? 'var(--accent)' : 'var(--text-primary)', fontWeight: isCurrent ? 500 : 400 }}>
                              {song.title}
                            </p>
                            <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{song.artist}</p>
                            {pick.reasons.length > 0 && (
                              <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-faint)' }} title={pick.reasons.join(' · ')}>
                                {pick.reasons.join(' · ')}
                              </p>
                            )}
                          </div>
                          <span className="text-xs tabular-nums shrink-0" style={{ color: 'var(--text-faint)' }}>
                            {song.duration ? formatTime(song.duration) : '—'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
