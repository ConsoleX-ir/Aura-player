import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  FolderOpen, FileAudio, Music2, HardDrive, History, Clock3, Play,
  Loader2, Disc3, ChevronRight,
} from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useUserPrefsStore } from '@/store/userPrefsStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { getRecentScrobbles, SCROBBLE_APPENDED_EVENT, type Scrobble } from '@/lib/scrobbleStore'
import { AuraOrb } from '@/components/Home/AuraOrb'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { EmptyState } from '@/components/States/EmptyState'
import type { Song } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════
// HOME — the landing experience (Core Experience redesign)
// ═══════════════════════════════════════════════════════════════════════════
// Two deliberate regions:
//   Region A — Hero: the Aura Orb with the welcome message woven into its
//   calm center. The Orb is ambient generative art (see AuraOrb.tsx); the
//   text rides a quiet zone of the composition and stays legible while the
//   animation breathes.
//   Region B — Supporting content: normal document flow beneath the hero —
//   quick actions, Continue Listening (real scrobble history) and Recently
//   Added (real library timestamps). Everything here is plain DOM: it scrolls
//   naturally, is independent of the Orb's layout, and shows honest empty
//   states on a fresh install. No fabricated data anywhere.
// ═══════════════════════════════════════════════════════════════════════════

const CONTINUE_COUNT = 8
const RECENT_ADDED_COUNT = 6

/** "2h ago"-style relative stamps — local, honest, tiny. */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

export function Home() {
  const library = usePlayerStore((s) => s.library)
  const playlists = usePlayerStore((s) => s.playlists)
  const importedFolders = usePlayerStore((s) => s.importedFolders)
  const playSong = usePlayerStore((s) => s.playSong)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const username = useUserPrefsStore((s) => s.username)
  const { importFolder, importFiles, importing, progress } = useLibraryImport()

  // ── Real listening history (Region B feed) ─────────────────────────────
  // The most recent sessions, read fresh from the append-only scrobble store
  // and refreshed (debounced) whenever the playback engine appends one.
  // Until the first read resolves, `recent` stays null → the section renders
  // a light skeleton instead of pretending to know.
  const [recent, setRecent] = useState<Scrobble[] | null>(null)
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const load = () => {
      getRecentScrobbles(40)
        .then((rows) => { if (alive) setRecent(rows) })
        .catch(() => { if (alive) setRecent([]) })
    }
    load()
    const onAppended = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 800)
    }
    window.addEventListener(SCROBBLE_APPENDED_EVENT, onAppended)
    return () => {
      alive = false
      window.clearTimeout(timer)
      window.removeEventListener(SCROBBLE_APPENDED_EVENT, onAppended)
    }
  }, [])

  // De-duplicate the session feed by song (a track played 4 times in a row is
  // ONE card) and resolve each id against the live library. Sessions whose
  // song has since been removed stay visible (the scrobble carries its own
  // title/artist — real history) but are honest about being unplayable.
  const continueItems = useMemo(() => {
    if (!recent) return null
    const bySong = new Map<string, Scrobble>()
    for (const row of recent) {
      if (!bySong.has(row.songId)) bySong.set(row.songId, row)
    }
    return Array.from(bySong.values()).slice(0, CONTINUE_COUNT)
  }, [recent])

  const songById = useMemo(() => {
    const map = new Map<string, Song>()
    for (const s of library) map.set(s.id, s)
    return map
  }, [library])

  // Recently Added — the library's own addedAt timestamps (v2.1.0+), with the
  // same mtime fallback lib/sort uses for older imports.
  const recentlyAdded = useMemo(() => {
    return [...library]
      .sort((a, b) => (b.addedAt ?? b.mtimeMs ?? 0) - (a.addedAt ?? a.mtimeMs ?? 0))
      .slice(0, RECENT_ADDED_COUNT)
  }, [library])

  const hour = new Date().getHours()
  const daypart = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const greeting = username ? `${daypart}, ${username}` : daypart

  const continueQueue = useMemo(() => {
    if (!continueItems) return []
    return continueItems
      .map((c) => songById.get(c.songId))
      .filter((s): s is Song => !!s)
  }, [continueItems, songById])

  const hasLibrary = library.length > 0
  const hasHistory = !!continueItems && continueItems.length > 0

  return (
    <div className="h-full overflow-y-auto">
      {/* ══ Region A — Hero ══════════════════════════════════════════════ */}
      <section
        className="relative flex items-center justify-center"
        style={{ height: 'min(56vh, 540px)', minHeight: 380 }}
      >
        {/* The Orb — fills the hero, paints behind the greeting, never
            intercepts input (pointer-events: none inside the component). */}
        <AuraOrb className="absolute inset-0" />

        {/* Welcome composition — sits in the Orb's calm center. A whisper of
            the base surface behind the text (not a card) keeps the type
            legible against the moving filaments in every theme. */}
        <div className="relative z-10 flex flex-col items-center text-center px-8 select-text">
          <p
            className="text-[11px] font-semibold uppercase"
            style={{
              color: 'var(--accent)',
              letterSpacing: 'var(--tracking-caps)',
              textShadow: '0 1px 12px var(--surface-base)',
            }}
          >
            {greeting}
          </p>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="mt-2 text-4xl font-semibold tracking-tight"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--text-primary)',
              textShadow: '0 2px 24px var(--surface-base)',
            }}
          >
            Welcome back
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="mt-2.5 text-sm"
            style={{
              color: 'var(--text-secondary)',
              textShadow: '0 1px 12px var(--surface-base)',
            }}
          >
            Your music, your space.
          </motion.p>

          {/* Real collection snapshot — every number here is live state. */}
          {(hasLibrary || playlists.length > 0 || importedFolders.length > 0) && (
            <div
              className="mt-4 flex items-center gap-2 text-[11px] tabular-nums"
              style={{ color: 'var(--text-tertiary)', textShadow: '0 1px 10px var(--surface-base)' }}
            >
              {hasLibrary && (
                <span>{library.length} {library.length === 1 ? 'song' : 'songs'}</span>
              )}
              {hasLibrary && playlists.length > 0 && <span aria-hidden>·</span>}
              {playlists.length > 0 && (
                <span>{playlists.length} {playlists.length === 1 ? 'playlist' : 'playlists'}</span>
              )}
              {(hasLibrary || playlists.length > 0) && importedFolders.length > 0 && <span aria-hidden>·</span>}
              {importedFolders.length > 0 && (
                <span>{importedFolders.length} watched {importedFolders.length === 1 ? 'folder' : 'folders'}</span>
              )}
            </div>
          )}
        </div>

        {/* Import progress — a quiet floating chip, only while scanning */}
        {importing && progress.total > 0 && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3.5 py-2 rounded-pill text-xs"
            style={{
              background: 'var(--surface-chrome)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--shadow-2)',
              color: 'var(--text-secondary)',
            }}
            role="status"
            aria-label={`Importing ${progress.done} of ${progress.total}`}
          >
            <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)' }} />
            <span className="tabular-nums">Importing {progress.done}/{progress.total}</span>
          </div>
        )}
      </section>

      {/* ══ Region B — Supporting content (normal flow) ═════════════════ */}
      <div className="max-w-[1100px] w-full mx-auto px-7 pb-10">
        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1 pb-6">
          <HomeAction
            onClick={importFolder}
            icon={<FolderOpen size={13} />}
            label="Add Folder"
            busy={importing && progress.total > 0}
            accent
          />
          <HomeAction
            onClick={importFiles}
            icon={<FileAudio size={13} />}
            label="Add Files"
            busy={importing && progress.total > 0}
          />
          <HomeAction
            onClick={() => setActiveView('library')}
            icon={<Music2 size={13} />}
            label="Open Library"
          />
          <HomeAction
            onClick={() => setActiveView('local')}
            icon={<HardDrive size={13} />}
            label="Local Music"
          />
        </div>

        {/* Fresh install — one honest, useful empty state instead of
            pretending there's something to resume. */}
        {!hasLibrary && (
          <div className="py-2 pb-8">
            <EmptyState
              icon={<Disc3 size={26} />}
              title="Your library is empty"
              hint="Import a folder of music, add individual files, or just drag and drop them anywhere in Aura."
              action={
                <button
                  onClick={importFolder}
                  disabled={importing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium active:scale-95 transition-all disabled:opacity-40"
                  style={{
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-border)',
                    color: 'var(--accent)',
                    transitionDuration: 'var(--dur-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-dim)' }}
                >
                  {importing ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                  <span>Import Music Folder</span>
                </button>
              }
            />
          </div>
        )}

        {hasLibrary && (
          <>
            {/* ── Continue Listening ─────────────────────────────────── */}
            <HomeSection
              title="Continue Listening"
              icon={<History size={12} />}
              actionLabel={hasHistory ? 'History' : undefined}
              onAction={() => setActiveView('history')}
            >
              {continueItems === null ? (
                <div className="flex gap-3 overflow-hidden" aria-label="Loading recent history">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="shrink-0 w-56 h-[64px] rounded-2xl skeleton" style={{ opacity: 0.5 }} />
                  ))}
                </div>
              ) : hasHistory ? (
                <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                  {continueItems.map((item, i) => {
                    const song = songById.get(item.songId)
                    return (
                      <ContinueCard
                        key={item.songId}
                        scrobble={item}
                        song={song}
                        index={i}
                        onPlay={song
                          ? () => playSong(song, continueQueue)
                          : undefined}
                      />
                    )
                  })}
                </div>
              ) : (
                <CompactEmpty
                  icon={<Clock3 size={16} />}
                  title="No listening history yet"
                  hint="Play anything from your library and it will find you here."
                />
              )}
            </HomeSection>

            {/* ── Recently Added ──────────────────────────────────────── */}
            <HomeSection title="Recently Added" icon={<Music2 size={12} />}>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {recentlyAdded.map((song, i) => (
                  <RecentCard
                    key={song.id}
                    song={song}
                    index={i}
                    onPlay={() => playSong(song, recentlyAdded)}
                  />
                ))}
              </div>
            </HomeSection>
          </>
        )}
      </div>
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function HomeAction({ onClick, icon, label, busy, accent }: {
  onClick: () => void
  icon: React.ReactNode
  label: string
  busy?: boolean
  accent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="pressable flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-all disabled:opacity-50"
      style={{
        background: accent ? 'var(--accent-dim)' : 'var(--glass-1)',
        border: `1px solid ${accent ? 'var(--accent-border)' : 'var(--border-default)'}`,
        color: accent ? 'var(--accent)' : 'var(--text-secondary)',
        transitionDuration: 'var(--dur-fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = accent
          ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
          : 'var(--glass-2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = accent ? 'var(--accent-dim)' : 'var(--glass-1)'
      }}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

function HomeSection({ title, icon, actionLabel, onAction, children }: {
  title: string
  icon?: React.ReactNode
  actionLabel?: string
  onAction?: () => void
  children: React.ReactNode
}) {
  return (
    <section className="mb-7">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ color: 'var(--accent)' }}>{icon}</span>
          <h2
            className="text-[11px] font-semibold uppercase"
            style={{ color: 'var(--text-secondary)', letterSpacing: 'var(--tracking-caps)' }}
          >
            {title}
          </h2>
        </div>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="flex items-center gap-1 text-xs transition-colors"
            style={{ color: 'var(--text-faint)', transitionDuration: 'var(--dur-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)' }}
          >
            {actionLabel}
            <ChevronRight size={11} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function ContinueCard({ scrobble, song, index, onPlay }: {
  scrobble: Scrobble
  song: Song | undefined
  index: number
  onPlay?: () => void
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.15) }}
      onClick={onPlay}
      disabled={!onPlay}
      title={song ? `Play ${scrobble.title}` : 'No longer in your library'}
      className="group shrink-0 w-56 flex items-center gap-3 p-2.5 rounded-2xl text-left transition-all disabled:cursor-default"
      style={{
        background: 'var(--glass-1)',
        border: '1px solid var(--border-default)',
        transitionDuration: 'var(--dur-fast)',
        opacity: song ? 1 : 0.55,
      }}
      onMouseEnter={(e) => { if (song) e.currentTarget.style.background = 'var(--glass-2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--glass-1)' }}
    >
      <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0">
        {song?.coverArt
          ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <ArtworkPlaceholder seed={scrobble.songId} size="sm" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {scrobble.title}
        </p>
        <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
          {song ? scrobble.artist : `${scrobble.artist} — removed from library`}
        </p>
        <p className="text-[10px] mt-0.5 tabular-nums" style={{ color: 'var(--text-faint)' }}>
          {timeAgo(scrobble.startedAt)}
        </p>
      </div>
      {song && (
        <span
          aria-hidden
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
        >
          <Play size={11} fill="currentColor" className="ml-px" />
        </span>
      )}
    </motion.button>
  )
}

function RecentCard({ song, index, onPlay }: {
  song: Song
  index: number
  onPlay: () => void
}) {
  const added = song.addedAt ?? song.mtimeMs ?? null
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.15) }}
      onClick={onPlay}
      title={`Play ${song.title}`}
      className="group text-left rounded-2xl p-2.5 transition-all"
      style={{
        background: 'var(--glass-1)',
        border: '1px solid var(--border-default)',
        transitionDuration: 'var(--dur-fast)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--glass-1)' }}
    >
      <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-2.5">
        {song.coverArt
          ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <ArtworkPlaceholder seed={song.id} size="md" />
        }
        <span
          aria-hidden
          className="absolute bottom-1.5 right-1.5 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            background: 'var(--accent)',
            color: 'var(--text-on-accent)',
            boxShadow: 'var(--shadow-2)',
          }}
        >
          <Play size={12} fill="currentColor" className="ml-px" />
        </span>
      </div>
      <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{song.title}</p>
      <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{song.artist}</p>
      {added !== null && (
        <p className="text-[10px] mt-0.5 tabular-nums" style={{ color: 'var(--text-faint)' }}>
          {timeAgo(added)}
        </p>
      )}
    </motion.button>
  )
}

function CompactEmpty({ icon, title, hint }: {
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div
      className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl"
      style={{ background: 'var(--glass-1)', border: '1px dashed var(--border-default)' }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: 'var(--glass-2)', color: 'var(--cloud)' }}
      >
        {icon}
      </div>
      <div>
        <p className="text-[13px] font-medium" style={{ color: 'var(--text-secondary)' }}>{title}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{hint}</p>
      </div>
    </div>
  )
}
