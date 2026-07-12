import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Search, LayoutGrid, List, FolderOpen, Loader2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { VirtualSongList } from '@/components/Library/VirtualSongList'
import { AlbumCard } from '@/components/Library/AlbumCard'

type ViewMode = 'list' | 'grid'

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


  const songs = useMemo(() => {
    let src = activeView === 'favorites' ? library.filter((s) => favorites.includes(s.id)) : library
    if (search.trim()) {
      const q = search.toLowerCase()
      src = src.filter((s) =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.album.toLowerCase().includes(q)
      )
    }
    return src
  }, [library, activeView, favorites, search])

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 px-7 pt-6 pb-4"
        style={{ background: 'linear-gradient(to bottom, var(--color-base) 60%, transparent)', backdropFilter: 'none' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold text-white/90" style={{ fontFamily: 'var(--font-display)' }}>
              {activeView === 'favorites' ? 'Favorites' : 'Library'}
            </h1>
            <p className="text-xs text-white/25 mt-0.5">{songs.length} {songs.length === 1 ? 'song' : 'songs'}</p>
          </div>
          <div className="flex items-center bg-[var(--color-glass)] border border-[var(--color-border)] rounded-xl p-1 gap-0.5">
            <button onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-[var(--color-glass-strong)] text-white/80' : 'text-white/25 hover:text-white/50'}`}>
              <List size={14} />
            </button>
            <button onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-[var(--color-glass-strong)] text-white/80' : 'text-white/25 hover:text-white/50'}`}>
              <LayoutGrid size={14} />
            </button>
          </div>
        </div>

        

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <input type="text" placeholder="Search songs, artists, albums..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-[var(--color-border-mid)] transition-all"
          />
        </div>
      </div>

      {/* Content — flex-1 min-h-0 gives this a bounded height without scrolling itself;
          each branch below owns its own scroll container so VirtualSongList's internal
          scroll tracking has exactly one unambiguous container to measure. */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Empty state */}
        {library.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-60 gap-5 px-7 pb-4 overflow-y-auto">
            <div className="relative">
              <div className="w-20 h-20 rounded-3xl bg-[var(--color-glass-mid)] border border-[var(--color-border)] flex items-center justify-center">
                <div className="flex items-end gap-1 h-8">
                  {[3,5,8,5,3].map((h,i) => (
                    <motion.div key={i} className="w-1.5 rounded-full bg-[var(--color-cloud)]/30"
                      animate={{ height: [`${h*4}px`, `${h*6}px`, `${h*4}px`] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: i*0.15 }} />
                  ))}
                </div>
              </div>
              {/* Outer cloud glow ring */}
              <div className="absolute inset-0 rounded-3xl"
                style={{ boxShadow: '0 0 40px var(--color-cloud-glow)' }} />
            </div>

            <div className="text-center">
              <p className="text-sm font-medium text-white/60">Your library is empty</p>
              <p className="text-xs text-white/25 mt-1">Import a folder with your music files</p>
            </div>

            <button onClick={importFolder} disabled={importing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--color-glass-strong)] border border-[var(--color-border-mid)] text-white/80 text-sm font-medium hover:bg-white/15 hover:text-white/90 active:scale-95 transition-all disabled:opacity-40">
              {importing ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              <span>Import Music Folder</span>
            </button>
          </motion.div>
        )}

        {/* No search results */}
        {library.length > 0 && songs.length === 0 && (
          <div className="flex items-center justify-center h-32 px-7 pb-4 overflow-y-auto">
            <p className="text-sm text-white/25">No results for "{search}"</p>
          </div>
        )}

        {/* List view */}
        {viewMode === 'list' && songs.length > 0 && (
          <VirtualSongList
            songs={songs}
            queue={songs}
            className="h-full overflow-y-auto px-7 pb-4"
            header={
              <div className="flex items-center gap-3 px-3 pb-1 mb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-white/15 border-b border-[var(--color-border)]">
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
                  songs={album.songs} coverArt={album.coverArt} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
