import { useState, useMemo, useDeferredValue } from 'react'
import { motion } from 'framer-motion'
import { Search, LayoutGrid, List, FolderOpen, Loader2, X, Heart, ListX, ArrowUpDown, ArrowUp, ArrowDown, Check } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { VirtualSongList } from '@/components/Library/VirtualSongList'
import { AlbumCard } from '@/components/Library/AlbumCard'
import { EmptyState, SongListSkeleton } from '@/components/States/EmptyState'
import { useStoreHydration } from '@/hooks/useStoreHydration'
import { sortSongs, SORT_KEYS, type SortKey, type SortDir } from '@/lib/sort'

type ViewMode = 'list' | 'grid'

// Above this many albums, skip the framer-motion entrance animation on grid
// cards entirely (see AlbumCard's animateIn prop) — same threshold VirtualSongList
// uses for switching into windowed rendering, kept consistent here since
// they're addressing the same class of problem (many concurrent expensive
// operations at mount).
const ANIMATE_GRID_THRESHOLD = 60

export function Library() {
  // Narrow selectors — avoids re-rendering the whole library view (and its
  // useMemo recomputation of songs/albums) on unrelated store mutations
  // like the playback progress tick.
  const library = usePlayerStore((s) => s.library)
  const activeView = usePlayerStore((s) => s.activeView)
  const favorites = usePlayerStore((s) => s.favorites)
  const { importFolder, importing } = useLibraryImport()
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  // v2.1.0: Library sorting. Default 'added'/asc keeps the historical
  // insertion-order look (oldest imports first); direction flips to newest
  // first with one click. Session-local by design — the library's shape is
  // remembered, the lens you're viewing it through resets with the app.
  const [sortKey, setSortKey] = useState<SortKey>('added')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const hydrated = useStoreHydration()

  // The input itself stays bound to `search` so typing is always instant —
  // only the expensive part (filtering the whole library + regrouping into
  // albums, non-trivial at a few thousand songs) uses the deferred value,
  // which React computes without blocking the next keystroke.
  const deferredSearch = useDeferredValue(search)

  const songs = useMemo(() => {
    let src = activeView === 'favorites' ? library.filter((s) => favorites.includes(s.id)) : library
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase()
      src = src.filter((s) =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.album.toLowerCase().includes(q)
      )
    }
    // Sort last, on the filtered set only. sortSongs copies once — the
    // unsorted filtered array is still reused by the album grouping below
    // (grid order follows the same sort, so both views agree).
    return sortSongs(src, sortKey, sortDir)
  }, [library, activeView, favorites, deferredSearch, sortKey, sortDir])

  const albums = useMemo(() => {
    if (viewMode !== 'grid') return []
    const map = new Map<string, { songs: typeof library; coverArt: string | null; artist: string }>()
    for (const song of songs) {
      const key = `${song.album}|||${song.artist}`
      if (!map.has(key)) map.set(key, { songs: [], coverArt: song.coverArt, artist: song.artist })
      map.get(key)!.songs.push(song)
    }
    return Array.from(map.entries()).map(([key, val]) => ({ album: key.split('|||')[0], ...val }))
  }, [songs, viewMode])

  const isFavorites = activeView === 'favorites'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-7 pt-6 pb-4"
        style={{
          background: 'linear-gradient(to bottom, var(--surface-base) 60%, transparent)',
          backdropFilter: 'none',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              {isFavorites ? 'Favorites' : 'Library'}
            </h1>
            <p className="text-xs mt-1 tabular-nums" style={{ color: 'var(--text-faint)' }}>
              {songs.length} {songs.length === 1 ? 'song' : 'songs'}
            </p>
          </div>

          {/* Sort (v2.1.0) + segmented view toggle */}
          <div className="flex items-center gap-2">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: 'var(--glass-1)',
                    border: '1px solid var(--border-default)',
                    color: 'var(--text-secondary)',
                    transitionDuration: 'var(--dur-fast)',
                  }}
                  title="Sort songs"
                  aria-label="Sort songs"
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
                        // Sensible default direction per key: name-ish fields
                        // read naturally A→Z; time-ish fields newest-first.
                        setSortDir(key === 'added' || key === 'duration' ? 'desc' : 'asc')
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] outline-none"
                      style={{ color: sortKey === key ? 'var(--accent)' : 'var(--text-secondary)' }}
                    >
                      <span className="w-3.5 shrink-0">
                        {sortKey === key && <Check size={12} />}
                      </span>
                      {label}
                    </DropdownMenu.Item>
                  ))}
                  <DropdownMenu.Item
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] outline-none"
                    style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', borderRadius: 0, marginTop: 4, paddingTop: 8 }}
                  >
                    <span className="w-3.5 shrink-0">
                      {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    </span>
                    {sortDir === 'asc' ? 'Ascending' : 'Descending'}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>

            {/* Segmented view toggle */}
            <div
              className="flex items-center rounded-xl p-1 gap-0.5"
              style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
              role="group" aria-label="View mode"
            >
              <ViewToggleButton active={viewMode === 'list'} onClick={() => setViewMode('list')} label="List view">
                <List size={14} />
              </ViewToggleButton>
              <ViewToggleButton active={viewMode === 'grid'} onClick={() => setViewMode('grid')} label="Grid view">
                <LayoutGrid size={14} />
              </ViewToggleButton>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative group-search">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input type="text" placeholder="Search songs, artists, albums..."
            value={search} onChange={(e) => setSearch(e.target.value)}
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
            <button onClick={() => setSearch('')} title="Clear search" aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md transition-colors"
              style={{ color: 'var(--text-faint)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent' }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Content — flex-1 min-h-0 gives this a bounded height without scrolling itself;
          each branch below owns its own scroll container so VirtualSongList's internal
          scroll tracking has exactly one unambiguous container to measure. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Cold-boot rehydration — brief skeleton in the library's own rhythm
            (the app-level boot screen covers the very first paint). */}
        {!hydrated && library.length === 0 && <SongListSkeleton />}

        {/* Empty state — the app's front door */}
        {hydrated && library.length === 0 && (
          <div className="overflow-y-auto pb-6">
            <EmptyState
              icon={
                <div className="flex items-end gap-1 h-8">
                  {[3, 5, 8, 5, 3].map((h, i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 rounded-full"
                      style={{ background: 'var(--cloud-soft)' }}
                      animate={{ height: [`${h * 4}px`, `${h * 6}px`, `${h * 4}px`] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              }
              title="Your library is empty"
              hint="Import a folder, or drag and drop files here"
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

        {/* Favorites empty state — distinct from "no search results" below,
            since showing 'No results for ""' when you just have zero
            favorites (not a failed search) would be a confusing message. */}
        {hydrated && library.length > 0 && isFavorites && songs.length === 0 && !search && (
          <div className="overflow-y-auto pb-6">
            <EmptyState
              compact
              icon={<Heart size={22} />}
              title="No favorites yet"
              hint="Tap the heart on any song to add it here"
            />
          </div>
        )}

        {/* No search results */}
        {hydrated && library.length > 0 && songs.length === 0 && !!search && (
          <div className="overflow-y-auto pb-6">
            <EmptyState
              compact
              icon={<ListX size={22} />}
              title={`No results for "${search}"`}
              hint="Check the spelling, or clear the search to browse everything"
              action={
                <button
                  onClick={() => setSearch('')}
                  className="text-xs underline underline-offset-2 transition-colors"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                >
                  Clear search
                </button>
              }
            />
          </div>
        )}

        {/* List view */}
        {viewMode === 'list' && songs.length > 0 && (
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

        {/* Grid view */}
        {viewMode === 'grid' && albums.length > 0 && (
          <div className="h-full overflow-y-auto px-7 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 pt-1">
              {albums.map((album, i) => (
                <AlbumCard key={`${album.album}-${album.artist}`}
                  album={album.album} artist={album.artist}
                  songs={album.songs} coverArt={album.coverArt} index={i}
                  animateIn={albums.length <= ANIMATE_GRID_THRESHOLD} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ViewToggleButton({ active, onClick, label, children }: {
  active: boolean; onClick: () => void; label: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="p-1.5 rounded-lg transition-all"
      style={{
        transitionDuration: 'var(--dur-fast)',
        color: active ? 'var(--text-primary)' : 'var(--text-faint)',
        background: active ? 'var(--glass-3)' : 'transparent',
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-2)' } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent' } }}
    >
      {children}
    </button>
  )
}
