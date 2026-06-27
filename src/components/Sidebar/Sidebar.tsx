import { motion, AnimatePresence } from 'framer-motion'
import { Music2, Heart, ListMusic, Plus, FolderOpen, Loader2, ChevronRight } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const { playlists, activeView, setActiveView, setSelectedPlaylistId,
    selectedPlaylistId, favorites, library, createPlaylist } = usePlayerStore()
  const { importFolder, importing, progress } = useLibraryImport()

  const nav = [
    { id: 'library'   as const, label: 'Library',   icon: Music2, count: library.length },
    { id: 'favorites' as const, label: 'Favorites',  icon: Heart,  count: favorites.length },
  ]

  const handleNewPlaylist = () => {
    const name = prompt('Playlist name:')
    if (name?.trim()) createPlaylist(name.trim())
  }

  return (
    <aside
      className="shrink-0 flex flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-base-3)]"
      style={{ width: 'var(--spacing-sidebar)' }}
    >
      {/* Import */}
      <div className="p-4 pb-3">
        <button
          onClick={importFolder} disabled={importing}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[var(--color-glass-mid)] border border-[var(--color-border-mid)] text-white/70 text-sm font-medium hover:bg-[var(--color-glass-strong)] hover:text-white/90 hover:border-[var(--color-border-mid)] active:scale-[0.98] transition-all duration-150 disabled:opacity-40"
        >
          {importing
            ? <><Loader2 size={13} className="animate-spin" /><span>{progress.done}/{progress.total}</span></>
            : <><FolderOpen size={13} /><span>Add Music</span></>
          }
        </button>
      </div>

      {/* Nav */}
      <nav className="px-3 space-y-0.5">
        {nav.map(({ id, label, icon: Icon, count }) => (
          <button key={id} onClick={() => setActiveView(id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all duration-150 relative overflow-hidden',
              activeView === id
                ? 'text-white/90 bg-[var(--color-glass-mid)]'
                : 'text-white/40 hover:bg-[var(--color-glass)] hover:text-white/70'
            )}>
            {activeView === id && (
              <motion.div layoutId="nav-indicator"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
                style={{ background: 'var(--color-dynamic-1)' }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
            )}
            <Icon size={15} />
            <span className="flex-1 text-left">{label}</span>
            {count > 0 && <span className="text-xs text-white/20 tabular-nums">{count}</span>}
          </button>
        ))}
      </nav>

      {/* Playlists */}
      <div className="flex-1 overflow-y-auto px-3 py-3 mt-3">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/20">Playlists</span>
          <button onClick={handleNewPlaylist}
            className="w-5 h-5 rounded flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/5 transition-all">
            <Plus size={12} />
          </button>
        </div>

        <AnimatePresence>
          {playlists.length === 0 && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="px-2 py-4 text-xs text-white/20 text-center">
              No playlists yet
            </motion.p>
          )}
          {playlists.map((pl) => (
            <motion.button key={pl.id}
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
              onClick={() => { setActiveView('playlist'); setSelectedPlaylistId(pl.id) }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all',
                activeView === 'playlist' && selectedPlaylistId === pl.id
                  ? 'bg-[var(--color-glass-mid)] text-white/80'
                  : 'text-white/40 hover:bg-[var(--color-glass)] hover:text-white/70'
              )}>
              <ListMusic size={13} />
              <span className="flex-1 text-left truncate">{pl.name}</span>
              <span className="text-xs text-white/20">{pl.songIds.length}</span>
              <ChevronRight size={11} className="opacity-30" />
            </motion.button>
          ))}
        </AnimatePresence>
      </div>

      {/* Now playing mini */}
      <SidebarNowPlaying />
    </aside>
  )
}

function SidebarNowPlaying() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  if (!currentSong) return null

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="p-3 border-t border-[var(--color-border)]">
      <div className="flex items-center gap-2.5">
        <div className="relative shrink-0">
          {currentSong.coverArt
            ? <img src={currentSong.coverArt} alt="" className="w-9 h-9 rounded-lg object-cover" />
            : <div className="w-9 h-9 rounded-lg bg-[var(--color-glass-mid)] flex items-center justify-center">
                <Music2 size={13} className="text-white/30" />
              </div>
          }
          {isPlaying && (
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[var(--color-base-3)] flex items-center justify-center"
              style={{ background: 'var(--color-dynamic-1)' }}>
              <motion.div className="w-1 h-1 rounded-full bg-white/80"
                animate={{ scale: [0.6, 1, 0.6] }} transition={{ duration: 1, repeat: Infinity }} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/80 truncate">{currentSong.title}</p>
          <p className="text-[11px] text-white/30 truncate">{currentSong.artist}</p>
        </div>
      </div>
    </motion.div>
  )
}
