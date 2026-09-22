import { useState, useMemo, useDeferredValue } from 'react'
import { motion } from 'framer-motion'
import { Search, LayoutGrid, List, FolderOpen, Loader2, X, Heart, ListX, ArrowUpDown, ArrowUp, ArrowDown, Check, AudioLines, Sparkles } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { useListenAggregates } from '@/hooks/useListenAggregates'
import { VirtualSongList } from '@/components/Library/VirtualSongList'
import { AlbumCard } from '@/components/Library/AlbumCard'
import { EmptyState, SongListSkeleton } from '@/components/States/EmptyState'
import { useStoreHydration } from '@/hooks/useStoreHydration'
import { sortSongs, SORT_KEYS, defaultDirFor } from '@/lib/sort'
import { searchLibrary } from '@/lib/search'

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
  // Wave 0 persistence: sort key/direction and view mode live in the
  // persisted store (they used to be session-local useState, resetting on
  // every launch — flagged by the Wave 0 persistence audit). Search stays
  // local on purpose: it's a moment, not a preference.
  const viewMode = usePlayerStore((s) => s.libraryViewMode)
  const setViewMode = usePlayerStore((s) => s.setLibraryViewMode)
  const sortKey = usePlayerStore((s) => s.librarySortKey)
  const setSortKey = usePlayerStore((s) => s.setLibrarySortKey)
  const sortDir = usePlayerStore((s) => s.librarySortDir)
  const setSortDir = usePlayerStore((s) => s.setLibrarySortDir)
  // Phase 2: search text lives in uiStore (ephemeral) so the command palette
  // can pre-fill it and jump here — one shared search state, one shared
  // search engine (lib/search).
  const search = useUiStore((s) => s.librarySearch)
  const setSearch = useUiStore((s) => s.setLibrarySearch)
  const hydrated = useStoreHydration()
  // Phase 1 — Library 2.0: whole-history listening aggregates power the
  // Recently Played / Most Played / Most Skipped sorts. Empty map (fresh
  // install, history still loading) = stable ties, by design.
  const listen = useListenAggregates()

  // Genre filter (Phase 1). Session-local like search — a browsing moment,
  // not a preference. `null` = no filter. Derived from the full library so
  // the picker always offers every genre you actually have.
  const [genreFilter, setGenreFilter] = useState<string | null>(null)
  const genres = useMemo(() => {
    const set = new Set<string>()
    for (const s of library) {
      if (s.genre && s.genre.trim()) set.add(s.genre.trim())
    }
    return Array.from(set).sort(new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }).compare)
  }, [library])

  // The input itself stays bound to `search` so typing is always instant —
  // only the expensive part (filtering the whole library + regrouping into
  // albums, non-trivial at a few thousand songs) uses the deferred value,
  // which React computes without blocking the next keystroke.
  const deferredSearch = useDeferredValue(search)

  const searchResult = useMemo(() => {
    let src = activeView === 'favorites' ? library.filter((s) => favorites.includes(s.id)) : library
    // Filter order: genre → search → sort. Each stage shrinks the set the
    // next one walks, and the sort only ever runs on what's visible.
    if (genreFilter) src = src.filter((s) => (s.genre ?? '').trim() === genreFilter)
    // Phase 2: one shared search entry point — exact operators/substring
    // first, fuzzy close-matches only when exact finds nothing.
    return searchLibrary(src, deferredSearch)
  }, [library, activeView, favorites, genreFilter, deferredSearch])

  const songs = useMemo(() =>
    // Sort last, on the filtered set only. sortSongs copies once — the
    // unsorted filtered array is still reused by the album grouping below
    // (grid order follows the same sort, so both views agree).
    sortSongs(searchResult.matches, sortKey, sortDir, listen)
  , [searchResult.matches, sortKey, sortDir, listen])

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

          {/* Genre filter (Phase 1) + Sort + segmented view toggle */}
          <div className="flex items-center gap-2">
            {genres.length > 0 && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-xl text-xs font-medium transition-all"
                    style={{
                      background: genreFilter ? 'var(--accent-dim)' : 'var(--glass-1)',
                      border: `1px solid ${genreFilter ? 'var(--accent-border)' : 'var(--border-default)'}`,
                      color: genreFilter ? 'var(--accent)' : 'var(--text-secondary)',
                      transitionDuration: 'var(--dur-fast)',
                    }}
                    title="Filter by genre"
                    aria-label="Filter by genre"
                  >
                    <AudioLines size={12} />
                    <span className="hidden sm:inline max-w-28 truncate">
                      {genreFilter ?? 'Genre'}
                    </span>
                    {genreFilter && (
                      <span
                        role="button"
                        aria-label="Clear genre filter"
                        onClick={(e) => { e.stopPropagation(); setGenreFilter(null) }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="p-0.5 rounded-md hover:bg-black/20 transition-colors"
                      >
                        <X size={10} />
                      </span>
                    )}
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="z-[200] min-w-44 p-1 rounded-xl text-sm max-h-72 overflow-y-auto"
                    style={{
                      zIndex: 'var(--z-dropdown)',
                      background: 'var(--surface-chrome)',
                      border: '1px solid var(--border-strong)',
                      backdropFilter: 'blur(var(--blur-glass))',
                      boxShadow: 'var(--shadow-overlay)',
                    }}
                    sideOffset={6} align="end">
                    <DropdownMenu.Item
                      onClick={() => setGenreFilter(null)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] outline-none"
                      style={!genreFilter ? { color: 'var(--accent)' } : undefined}
                    >
                      <span className="w-3.5 shrink-0">{!genreFilter && <Check size={12} />}</span>
                      All genres
                    </DropdownMenu.Item>
                    {genres.map((g) => (
                      <DropdownMenu.Item
                        key={g}
                        onClick={() => setGenreFilter(g)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] outline-none"
                        style={genreFilter === g ? { color: 'var(--accent)' } : undefined}
                      >
                        <span className="w-3.5 shrink-0">{genreFilter === g && <Check size={12} />}</span>
                        <span className="truncate">{g}</span>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}

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
                        // Sensible default direction per key (time/count-ish
                        // keys read naturally most/newest-first) — flipping
                        // is one click away in the direction row below.
                        if (key !== sortKey) setSortDir(defaultDirFor(key))
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] outline-none"
                      // Active key keeps its accent inline on purpose (persistent
                      // state, not hover) — CSS owns hover/highlight for the rest.
                      style={sortKey === key ? { color: 'var(--accent)' } : undefined}
                    >
                      <span className="w-3.5 shrink-0">
                        {sortKey === key && <Check size={12} />}
                      </span>
                      {label}
                    </DropdownMenu.Item>
                  ))}
                  <DropdownMenu.Item
                    onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] outline-none"
                    style={{ borderTop: '1px solid var(--border-subtle)', borderRadius: 0, marginTop: 4, paddingTop: 8 }}
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
          <input type="text" placeholder="Search, or try artist: album: genre: year:…"
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

        {/* Phase 2 — fuzzy fallback notice: when exact matching found nothing
            and these are close matches, SAY so (honest result presentation). */}
        {searchResult.fuzzy && songs.length > 0 && (
          <div className="flex items-center gap-2 mt-2 px-1" data-fuzzy-hint>
            <Sparkles size={11} style={{ color: 'var(--accent)' }} />
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              No exact matches — showing {songs.length} close {songs.length === 1 ? 'match' : 'matches'} for “{search}”
            </span>
          </div>
        )}
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

        {/* No results — covers both a failed search and an over-narrow
            genre filter (the two ways this list can legitimately empty out). */}
        {hydrated && library.length > 0 && songs.length === 0 && (!!search || !!genreFilter) && (
          <div className="overflow-y-auto pb-6">
            <EmptyState
              compact
              icon={<ListX size={22} />}
              title={search ? `No results for "${search}"` : `No ${genreFilter} songs`}
              hint={search
                ? (genreFilter ? `Nothing matches in the ${genreFilter} genre — clear the search or the genre filter`
                   : 'Check the spelling, or clear the search to browse everything')
                : `Try another genre, or clear the filter to browse everything`}
              action={
                <button
                  onClick={() => { setSearch(''); setGenreFilter(null) }}
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
