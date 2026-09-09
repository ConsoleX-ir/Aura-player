import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronLeft, Info, Sparkles, FolderOpen, Loader2, Play, Pause, Heart,
  Music2, Clock3, CheckCircle2, SkipForward, History,
} from 'lucide-react'
import type { Song, SongListenStats, SongFileStats } from '@/types'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'
import { getSongStats } from '@/lib/scrobbleStore'
import { formatTime, formatBytes, cn } from '@/lib/utils'
import { FindInfoPanel } from '@/components/Properties/FindInfoPanel'
import { ArtworkPlaceholder, UnknownValue } from '@/components/States/ArtworkPlaceholder'

// ── Song Properties — a full page, Windows-Media-Player style (Wave 3) ──────
// The v1.x properties dialog did its job, but it floated over the app as a
// cramped modal. Aura 2 turns "Properties" into a real destination: the big
// album art leads, metadata sits in wide grouped cards the way WMP's classic
// properties page always did, and — the Aura-native addition — the song's
// complete local listening history (from the append-only scrobble store) is
// right there next to the file facts.
//
// Two sections, switched by tabs (same texts/behavior as the old modal):
//   Properties       — media info, file facts, your listening
//   Find Info Online — the keyless metadata lookup (FindInfoPanel)
// Escape (or Back) returns to the view the user came from.

type Tab = 'info' | 'find'

export function PropertiesPage() {
  const songId = useUiStore((s) => s.propertiesSongId)
  const initialFind = useUiStore((s) => s.propertiesInitialFind)
  const closeProperties = useUiStore((s) => s.closeProperties)

  // Look the song up from the live library — the page renders whatever the
  // library currently holds, so metadata applied on the Find tab shows up
  // instantly without any local mirroring.
  const song: Song | null = usePlayerStore((s) =>
    songId ? s.library.find((x) => x.id === songId) ?? null : null
  )

  const [tab, setTab] = useState<Tab>(initialFind ? 'find' : 'info')
  // A new song (or a new menu entry) must not inherit the previous tab choice.
  useEffect(() => {
    setTab(initialFind ? 'find' : 'info')
  }, [initialFind, songId])

  // Escape leaves the page — same contract as every dialog in Aura.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeProperties() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeProperties])

  // If the song vanished (removed from the library while the page was open,
  // or a stale id after a sync), return to where the user came from.
  useEffect(() => {
    if (songId && !song) closeProperties()
  }, [songId, song, closeProperties])

  if (!songId || !song) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className="h-full overflow-y-auto"
    >
      <div className="px-7 py-6 max-w-4xl mx-auto">
        {/* Top bar — back navigation, WMP-style page header, section tabs */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={closeProperties}
            className="flex items-center gap-1 pl-1.5 pr-3 py-1.5 rounded-full transition-all active:scale-95"
            style={{ color: 'var(--text-tertiary)', background: 'var(--glass-1)', border: '1px solid var(--border-subtle)', transitionDuration: 'var(--dur-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--glass-2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
          >
            <ChevronLeft size={15} />
            <span className="text-xs font-medium">Back</span>
          </button>

          <span
            className="text-[10px] font-semibold uppercase hidden sm:block"
            style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
          >
            Song Properties
          </span>

          <div className="flex gap-1 ml-auto p-1 rounded-full" style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}>
            <TabButton active={tab === 'info'} icon={Info} label="Properties" onClick={() => setTab('info')} />
            <TabButton active={tab === 'find'} icon={Sparkles} label="Find Info Online" onClick={() => setTab('find')} />
          </div>
        </div>

        {/* Hero — WMP's properties page always led with the artwork */}
        <SongHero song={song} />

        {/* Body — both sections stay mounted when switching so search state
            survives tab flips (same contract as the old modal). */}
        <div className={cn(tab !== 'info' && 'hidden')}>
          <InfoTab song={song} />
        </div>
        <div className={cn(tab !== 'find' && 'hidden')}>
          <FindInfoPanel key={song.id} song={song} onApplied={() => setTab('info')} />
        </div>
      </div>
    </motion.div>
  )
}

// ── Hero: artwork + identity + quick actions ────────────────────────────────
function SongHero({ song }: { song: Song }) {
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isActive = usePlayerStore((s) => s.currentSong?.id === song.id)
  const isFav = usePlayerStore((s) => s.favorites.includes(song.id))
  const togglePlay = usePlayerStore((s) => s.togglePlay)
  const playSong = usePlayerStore((s) => s.playSong)
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite)

  return (
    <div className="flex items-center gap-6 mb-6 p-5 rounded-3xl" style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}>
      <div className="w-28 h-28 rounded-2xl overflow-hidden shrink-0" style={{ boxShadow: 'var(--shadow-2)' }}>
        {song.coverArt
          ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" />
          : <ArtworkPlaceholder seed={song.id} size="lg" />
        }
      </div>

      <div className="min-w-0 flex-1">
        <h1
          className="text-2xl font-semibold tracking-tight truncate"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
        >
          {song.title}
        </h1>
        <p className="text-sm mt-1 truncate" style={{ color: 'var(--text-secondary)' }}>
          {isUnknown(song.artist) ? <UnknownValue>{song.artist}</UnknownValue> : song.artist}
          <span className="mx-1.5" style={{ color: 'var(--text-faint)' }}>·</span>
          <span style={{ color: 'var(--text-tertiary)' }}>
            {isUnknown(song.album) ? 'Unknown Album' : song.album}
          </span>
        </p>

        <div className="flex items-center gap-2 mt-4 flex-wrap">
          <button
            onClick={() => (isActive ? togglePlay() : playSong(song, [song]))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium active:scale-95 transition-all"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)', transitionDuration: 'var(--dur-fast)' }}
            title={isActive && isPlaying ? 'Pause' : 'Play'}
          >
            {isActive && isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
            {isActive && isPlaying ? 'Pause' : 'Play'}
          </button>

          <button
            onClick={() => toggleFavorite(song.id)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium active:scale-95 transition-all"
            style={{
              background: isFav ? 'var(--favorite-veil)' : 'var(--glass-2)',
              border: `1px solid ${isFav ? 'color-mix(in srgb, var(--favorite) 35%, transparent)' : 'var(--border-default)'}`,
              color: isFav ? 'var(--favorite)' : 'var(--text-secondary)',
              transitionDuration: 'var(--dur-fast)',
            }}
          >
            <Heart size={13} fill={isFav ? 'currentColor' : 'none'} />
            {isFav ? 'Favorite' : 'Add to Favorites'}
          </button>

          <button
            onClick={() => window.electronAPI?.showItemInFolder(song.path)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium active:scale-95 transition-all"
            style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', transitionDuration: 'var(--dur-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--glass-3)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-2)' }}
          >
            <FolderOpen size={13} />
            Show in Folder
          </button>

          <span
            className="ml-auto px-3 py-1.5 rounded-full text-xs tabular-nums shrink-0"
            style={{ background: 'var(--glass-2)', color: 'var(--text-tertiary)' }}
          >
            {formatTime(song.duration)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Info tab: media info / file facts / local listening stats ───────────────
function InfoTab({ song }: { song: Song }) {
  const playlists = usePlayerStore((s) => s.playlists)
  const favorites = usePlayerStore((s) => s.favorites)

  const isFav = favorites.includes(song.id)
  const inPlaylists = playlists.filter((p) => p.songIds.includes(song.id))

  // Technical stats, fetched only while the page is open
  const [stats, setStats] = useState<SongFileStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setStatsLoading(true)
    window.electronAPI?.getFileStats(song.path)
      .then((s) => { if (!cancelled) setStats(s) })
      .catch(() => { /* stats stay null → the section shows dashes */ })
      .finally(() => { if (!cancelled) setStatsLoading(false) })
    return () => { cancelled = true }
  }, [song.path])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* WMP called it exactly this */}
        <Section title="Media Information">
          <Row label="Title"  value={song.title} />
          <Row label="Artist" value={song.artist} />
          <Row label="Album"  value={song.album} />
          <Row label="Year"   value={song.year ? song.year.toString() : null} />
          <Row label="Genre"  value={song.genre ?? null} />
          <Row label="Track"  value={song.trackNumber ? song.trackNumber.toString() : null} />
          <Row label="Duration" value={formatTime(song.duration)} />
          <Row
            label="Favorite"
            value={isFav ? 'Yes' : 'No'}
            custom={isFav ? <Heart size={11} className="inline" style={{ color: 'var(--favorite)' }} fill="currentColor" /> : undefined}
          />
          <Row
            label="Playlists"
            value={inPlaylists.length ? inPlaylists.map((p) => p.name).join(', ') : null}
          />
        </Section>

        <Section title="File">
          {statsLoading && !stats ? (
            <div className="flex items-center gap-2 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <Loader2 size={12} className="animate-spin" /> Reading file properties…
            </div>
          ) : (
            <>
              <Row
                label="Format"
                value={
                  stats
                    ? [stats.extension.replace('.', '').toUpperCase(), stats.codec, stats.container].filter(Boolean).join(' · ') || null
                    : null
                }
              />
              <Row label="Size"        value={stats ? formatBytes(stats.sizeBytes) : null} />
              <Row label="Bitrate"     value={stats?.bitrateKbps ? `${stats.bitrateKbps} kbps` : null} />
              <Row label="Sample Rate" value={stats?.sampleRateHz ? `${(stats.sampleRateHz / 1000).toFixed(1)} kHz` : null} />
              <Row label="Channels"    value={stats?.channels ? stats.channels === 2 ? 'Stereo' : stats.channels === 1 ? 'Mono' : stats.channels.toString() : null} />
            </>
          )}
          <Row label="Path" value={song.path} mono />
        </Section>
      </div>

      <ListenStatsCard songId={song.id} />
    </div>
  )
}

// ── Your Listening — the Aura-native section the old modal never had ────────
// Everything here comes from the local, append-only scrobble store. No
// network, no account — just what this person actually listened to.
function ListenStatsCard({ songId }: { songId: string }) {
  const [stats, setStats] = useState<SongListenStats | null>(null)

  // Refresh whenever the song changes. A session that starts and ends while
  // this page is open is intentionally not live-tracked here — reopening the
  // page (or switching songs) picks the new numbers up.
  useEffect(() => {
    let cancelled = false
    getSongStats(songId).then((s) => { if (!cancelled) setStats(s) })
    return () => { cancelled = true }
  }, [songId])

  const hasHistory = !!stats && stats.plays > 0

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <h3 className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
          Your Listening
        </h3>
        <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
        <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
          <History size={9} />
          100% local — never leaves this device
        </span>
      </div>

      {!hasHistory ? (
        <div className="p-4 rounded-xl" style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--glass-2)' }}>
              <Music2 size={13} style={{ color: 'var(--text-faint)' }} />
            </div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              No listening history for this song yet — play it and your stats will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile icon={Music2}      value={String(stats!.plays)}                          label="Plays" />
          <StatTile icon={CheckCircle2} value={String(stats!.completed)}                     label="Completed" />
          <StatTile icon={SkipForward} value={String(stats!.skipped)}                        label="Skipped" />
          <StatTile icon={Clock3}      value={formatListenTime(stats!.totalPlayedMs)}        label="Time Listened" />
          <div className="col-span-2 sm:col-span-4 flex items-center gap-2 px-4 py-2.5 rounded-xl" style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}>
            <History size={12} style={{ color: 'var(--text-faint)' }} />
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Last played
            </span>
            <span className="text-xs ml-auto" style={{ color: 'var(--text-secondary)' }}>
              {stats!.lastPlayedAt ? new Date(stats!.lastPlayedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function StatTile({ icon: Icon, value, label }: { icon: typeof Music2; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-3.5 rounded-xl" style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}>
      <Icon size={13} style={{ color: 'var(--accent)' }} />
      <span className="text-base font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</span>
      <span className="text-[9px] uppercase" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>{label}</span>
    </div>
  )
}

// m:ss is wrong for cumulative listening (a 100-play song reads "92:31") —
// this renders human spans: "3h 42m", "12m 8s", "45s".
function formatListenTime(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${totalSec}s`
}

// ── Shared bits ──

function TabButton({ active, icon: Icon, label, onClick }: {
  active: boolean; icon: typeof Info; label: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn('flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all')}
      style={
        active
          ? { background: 'var(--glass-3)', color: 'var(--text-primary)' }
          : { color: 'var(--text-tertiary)' }
      }
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-tertiary)' }}
    >
      <Icon size={12} />
      {label}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase mb-2" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>{title}</h3>
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden" style={{ background: 'var(--surface-raised)' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, mono, custom }: { label: string; value: string | null; mono?: boolean; custom?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-2 border-b border-[var(--color-border)] last:border-b-0">
      <span className="text-xs shrink-0 pt-0.5" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className={cn('text-xs text-right break-all min-w-0', mono && 'font-mono text-[11px]')} style={{ color: 'var(--text-secondary)' }}>
        {value ?? <span style={{ color: 'var(--text-faint)' }}>—</span>}
        {custom}
      </span>
    </div>
  )
}

// "Unknown Artist" / "Unknown Album" (and blank) — mirrors SongRow's rule.
const UNKNOWN_RE = /^(unknown (artist|album)|unknown)$/i
function isUnknown(value: string): boolean {
  return !value.trim() || UNKNOWN_RE.test(value.trim())
}
