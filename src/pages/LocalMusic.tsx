import { useMemo, useState, useDeferredValue } from 'react'
import {
  HardDrive, FolderOpen, FileAudio, Loader2, Search, X, ArrowUpDown,
  ArrowUp, ArrowDown, Check, ListX, Music2,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { VirtualSongList } from '@/components/Library/VirtualSongList'
import { EmptyState, SongListSkeleton } from '@/components/States/EmptyState'
import { useStoreHydration } from '@/hooks/useStoreHydration'
import { sortSongs, SORT_KEYS, defaultDirFor, type SortKey } from '@/lib/sort'
import { searchLibrary } from '@/lib/search'
import type { Song } from '@/types'

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL MUSIC — the device-files destination (Core Experience redesign)
// ═══════════════════════════════════════════════════════════════════════════
// A page about the music that physically lives on this machine. It adds NO
// new pipeline: importing runs through the existing LibraryService
// (importFolderViaDialog / importFilesViaDialog — native dialogs, batch
// metadata parsing, folder registration for Folder Sync), the song model is
// the store's own library, and playback/queue/context actions are the same
// SongRow component every other surface uses.
//
// "Local" semantics, straight from the data model: a persisted library entry
// IS a local file (song ids are hashes of filesystem paths; online tracks —
// `source: 'online'`, e.g. Audius — never enter the library). The filter
// below is therefore `source !== 'online'`: today that is the whole library,
// and it stays honest if that ever changes. No second scanner, no parallel
// database, no duplicate persistence.
// ═══════════════════════════════════════════════════════════════════════════

/** Basename of a filesystem folder, Windows- or POSIX-separated. */
function folderLabel(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? folder
}

/** Total collection time in a human voice ("3 hr 24 min"). */
function totalDurationLabel(songs: Song[]): string {
  const totalSec = songs.reduce((acc, s) => acc + (s.duration || 0), 0)
  if (totalSec < 60) return `${Math.round(totalSec)} sec`
  const mins = Math.floor(totalSec / 60)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)} hr ${mins % 60} min`
}

export function LocalMusic() {
  const library = usePlayerStore((s) => s.library)
  const hydrated = useStoreHydration()
  const { importFolder, importFiles, importing, progress } = useLibraryImport()

  // Local Music is about files on disk — the store's library is exactly that
  // (see the semantics note above); the filter is the contract, not the tool.
  const localSongs = useMemo(
    () => library.filter((s) => s.source !== 'online'),
    [library],
  )

  const importedFolders = usePlayerStore((s) => s.importedFolders)
  // Folder-origin filter: which imported folder (if any) the view is scoped
  // to. Derived from the store's own importedFolders — the SAME registration
  // Folder Sync uses. 'all' = every local file regardless of origin.
  const [folderFilter, setFolderFilter] = useState<string | null>(null)

  // Search stays session-local here (its own moment, separate from the
  // Library's shared search state — one search per destination).
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  // Sort — session-local (the Library's persisted sort belongs to the
  // Library; this page keeps its own browsing mood).
  const [sortKey, setSortKey] = useState<SortKey>('added')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const songs = useMemo(() => {
    let src = localSongs
    if (folderFilter) src = src.filter((s) => s.path.startsWith(folderFilter))
    const { matches } = searchLibrary(src, deferredSearch, 40)
    return sortSongs(matches, sortKey, sortDir)
  }, [localSongs, folderFilter, deferredSearch, sortKey, sortDir])

  // Folder chips — only folders that actually hold songs right now.
  const foldersWithSongs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of localSongs) {
      const hit = importedFolders.find((f) => s.path.startsWith(f))
      if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
  }, [localSongs, importedFolders])

  const hasLibrary = library.length > 0
  const importing_ = importing

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 px-7 pt-6 pb-4"
        style={{
          background: 'linear-gradient(to bottom, var(--surface-base) 60%, transparent)',
          backdropFilter: 'none',
        }}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
              >
                <HardDrive size={16} />
              </div>
              <div>
                <h1
                  className="text-2xl font-semibold tracking-tight leading-tight"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
                >
                  Local Music
                </h1>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  Files stored on this device — imported folders and loose tracks.
                </p>
              </div>
            </div>
            {localSongs.length > 0 && (
              <div className="flex items-center gap-2 mt-2 pl-[46px] text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
                <span>{localSongs.length} {localSongs.length === 1 ? 'file' : 'files'}</span>
                <span aria-hidden>·</span>
                <span>{totalDurationLabel(localSongs)}</span>
                {importedFolders.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{importedFolders.length} watched {importedFolders.length === 1 ? 'folder' : 'folders'}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Import — the page's primary actions, through the existing services */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={importFolder}
              disabled={importing_}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium active:scale-[0.98] transition-all disabled:opacity-50"
              style={{
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent-border)',
                color: 'var(--accent)',
                transitionDuration: 'var(--dur-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-dim)' }}
            >
              {importing_ ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
              <span>Add Folder</span>
            </button>
            <button
              onClick={importFiles}
              disabled={importing_}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium active:scale-[0.98] transition-all disabled:opacity-50"
              style={{
                background: 'var(--glass-1)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)',
                transitionDuration: 'var(--dur-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--glass-2)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--glass-1)' }}
            >
              {importing_ ? <Loader2 size={13} className="animate-spin" /> : <FileAudio size={13} />}
              <span>Add Files</span>
            </button>
          </div>
        </div>

        {/* Import progress — determinate, real (from onMetadataProgress) */}
        {importing_ && progress.total > 0 && (
          <div className="mb-3" role="status" aria-label={`Importing ${progress.done} of ${progress.total}`}>
            <div className="flex items-center justify-between mb-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              <span className="flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />
                Reading metadata
              </span>
              <span className="tabular-nums">{progress.done}/{progress.total}</span>
            </div>
            <div className="h-0.5 rounded-pill overflow-hidden" style={{ background: 'var(--glass-2)' }}>
              <div
                className="h-full rounded-pill transition-[width] duration-300"
                style={{
                  width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%',
                  background: 'var(--accent)',
                }}
              />
            </div>
          </div>
        )}

        {/* Folder-origin chips — click to scope the view to one import root */}
        {foldersWithSongs.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <FolderChip
              label="All folders"
              count={localSongs.length}
              active={folderFilter === null}
              onClick={() => setFolderFilter(null)}
            />
            {foldersWithSongs.map(([folder, count]) => (
              <FolderChip
                key={folder}
                label={folderLabel(folder)}
                count={count}
                title={folder}
                active={folderFilter === folder}
                onClick={() => setFolderFilter(folderFilter === folder ? null : folder)}
              />
            ))}
          </div>
        )}

        {/* Search + sort toolbar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 group-search">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input
              type="text"
              placeholder="Search this device's music, or try artist: album: genre: year:…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-library-search
              className="w-full pl-9 pr-9 py-2 rounded-xl text-sm outline-none transition-all"
              style={{
                background: 'var(--glass-1)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                transitionDuration: 'var(--dur-fast)',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-border)'; e.currentTarget.style.background = 'var(--glass-2)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'var(--glass-1)' }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                title="Clear search"
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors"
                style={{ color: 'var(--text-faint)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent' }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="flex items-center gap-1.5 pl-2.5 pr-2 py-2 rounded-xl text-xs font-medium transition-all shrink-0"
                style={{
                  background: 'var(--glass-1)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  transitionDuration: 'var(--dur-fast)',
                }}
                title="Sort files"
                aria-label="Sort files"
              >
                <ArrowUpDown size={12} />
                <span className="hidden sm:inline">{SORT_KEYS.find((k) => k.key === sortKey)?.label}</span>
                {sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-[200] min-w-44 p-1 rounded-xl text-sm"
                style={{
                  zIndex: 'var(--z-dropdown)',
                  background: 'var(--surface-chrome)',
                  border: '1px solid var(--border-strong)',
                  backdropFilter: 'blur(var(--blur-glass))',
                  boxShadow: 'var(--shadow-overlay)',
                }}
                sideOffset={6} align="end">
                {SORT_KEYS.map(({ key, label }) => (
                  <DropdownMenu.Item
                    key={key}
                    onClick={() => {
                      setSortKey(key)
                      if (key !== sortKey) setSortDir(defaultDirFor(key))
                    }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] outline-none"
                    style={sortKey === key ? { color: 'var(--accent)' } : undefined}
                  >
                    <span className="w-3.5 shrink-0">{sortKey === key && <Check size={12} />}</span>
                    {label}
                  </DropdownMenu.Item>
                ))}
                <DropdownMenu.Item
                  onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] outline-none"
                  style={{ borderTop: '1px solid var(--border-subtle)', borderRadius: 0, marginTop: 4, paddingTop: 8 }}
                >
                  <span className="w-3.5 shrink-0">{sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</span>
                  {sortDir === 'asc' ? 'Ascending' : 'Descending'}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col">
        {!hydrated && localSongs.length === 0 && <SongListSkeleton />}

        {hydrated && library.length === 0 && (
          <div className="overflow-y-auto pb-6">
            <EmptyState
              icon={<HardDrive size={24} />}
              title="No music on this device yet"
              hint="Point Aura at a folder of music files — it will index the metadata and keep the folder in sync."
              action={
                <button
                  onClick={importFolder}
                  disabled={importing_}
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
                  {importing_ ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                  <span>Import Music Folder</span>
                </button>
              }
            />
          </div>
        )}

        {hydrated && hasLibrary && localSongs.length === 0 && (
          <div className="overflow-y-auto pb-6">
            <EmptyState
              compact
              icon={<Music2 size={20} />}
              title="No local files"
              hint="Every entry in your library is a remote stream — import files to see them here."
            />
          </div>
        )}

        {songs.length === 0 && localSongs.length > 0 && (!!search || !!folderFilter) && (
          <div className="overflow-y-auto pb-6">
            <EmptyState
              compact
              icon={<ListX size={20} />}
              title={search ? `No results for "${search}"` : 'Nothing in this folder'}
              hint={search
                ? (folderFilter ? 'Nothing matches inside this folder — clear the search or switch back to All folders'
                   : 'Check the spelling, or clear the search to browse every file')
                : 'Pick another folder, or go back to All folders'}
              action={
                <button
                  onClick={() => { setSearch(''); setFolderFilter(null) }}
                  className="text-xs underline underline-offset-2 transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                >
                  Clear filters
                </button>
              }
            />
          </div>
        )}

        {songs.length > 0 && (
          <VirtualSongList
            songs={songs}
            queue={songs}
            className="h-full overflow-y-auto px-7 pb-4"
            header={
              <div
                className="flex items-center gap-3 px-3 pb-1 mb-1 text-[10px] font-semibold uppercase"
                style={{
                  color: 'var(--text-faint)',
                  letterSpacing: 'var(--tracking-caps)',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <span className="w-7">#</span>
                <span className="w-9 shrink-0"></span>
                <span className="flex-1">Title</span>
                <span className="w-36 hidden md:block">Album</span>
                <span className="w-9 text-right shrink-0">Time</span>
                <span className="w-14 shrink-0"></span>
              </div>
            }
          />
        )}
      </div>
    </div>
  )
}

function FolderChip({ label, count, active, onClick, title }: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      aria-pressed={active}
      className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-pill text-[11px] font-medium transition-all"
      style={{
        background: active ? 'var(--accent-dim)' : 'var(--glass-1)',
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border-default)'}`,
        color: active ? 'var(--accent)' : 'var(--text-tertiary)',
        transitionDuration: 'var(--dur-fast)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-2)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'var(--accent-dim)' : 'var(--glass-1)' }}
    >
      <FolderOpen size={10} />
      <span className="max-w-44 truncate">{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}
