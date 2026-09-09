import { motion, AnimatePresence } from 'framer-motion'
import { Music2, Heart, ListMusic, Plus, FolderOpen, FileAudio, Loader2, ChevronRight, Settings as SettingsIcon, History } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { PlaylistModal } from '../Modals/PlaylistModal'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { EmptyState } from '@/components/States/EmptyState'

export function Sidebar() {
  // Narrow selectors — Sidebar is mounted almost the entire time the app is
  // open, so the previous full `usePlayerStore()` subscribe meant it
  // re-rendered on every store mutation, including the progress tick that
  // fires ~4-10 times a second during playback, despite never displaying
  // progress at all.
  const playlists = usePlayerStore((s) => s.playlists)
  const activeView = usePlayerStore((s) => s.activeView)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const setSelectedPlaylistId = usePlayerStore((s) => s.setSelectedPlaylistId)
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId)
  const favoritesCount = usePlayerStore((s) => s.favorites.length)
  const libraryCount = usePlayerStore((s) => s.library.length)
  const { importFolder, importFiles, importing, progress } = useLibraryImport()

  const nav = [
    { id: 'library'   as const, label: 'Library',   icon: Music2, count: libraryCount },
    { id: 'favorites' as const, label: 'Favorites',  icon: Heart,  count: favoritesCount },
  ]

  const [showPlaylistModal, setShowPlaylistModal] = useState(false)

  return (
    /* ── Floating navigation card (v2.1.0) ───────────────────────────────
       The sidebar used to sit flush against the window edge, separated from
       the content by nothing but a hairline. It's now a deliberate floating
       card: inset from the window on three sides, rounded, shadowed, glassed
       — so the ambient background flows AROUND it and the main content reads
       as its own surface. The card is 10px narrower than --spacing-sidebar so
       the total footprint (card + left inset) stays exactly 256px and no
       other layout math changes. Not a modal: it's still the primary nav,
       just wearing its own elevation. */
    <aside
      className="shrink-0 flex flex-col overflow-hidden perf-blur"
      style={{
        width: 'calc(var(--spacing-sidebar) - 10px)',
        margin: '10px 6px 10px 10px',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-strong)',
        background: 'color-mix(in srgb, var(--surface-raised) 76%, transparent)',
        backdropFilter: 'blur(var(--blur-glass)) saturate(1.15)',
        WebkitBackdropFilter: 'blur(var(--blur-glass)) saturate(1.15)',
        boxShadow: 'var(--shadow-3), inset 0 1px 0 var(--border-emphasis)',
      }}
    >
      {/* Import — the sidebar's single primary action, wearing the accent.
          Padding widened to px-3.5 so content breathes inside the rounded card. */}
      <div className="px-3.5 pt-4 pb-2">
        {importing ? (
          <div
            className="w-full flex flex-col gap-2 py-2.5 px-3 rounded-xl"
            style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
            role="status"
            aria-label="Importing music"
          >
            <div className="flex items-center justify-center gap-2 text-xs font-medium" style={{ color: 'var(--accent)' }}>
              <Loader2 size={12} className="animate-spin" />
              <span className="tabular-nums">{progress.done}/{progress.total}</span>
            </div>
            {/* Determinate sliver — import is a real, countable process */}
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
        ) : (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium active:scale-[0.98] transition-all"
                style={{
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent-border)',
                  color: 'var(--accent)',
                  transitionDuration: 'var(--dur-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-dim)' }}
              >
                <FolderOpen size={13} />
                <span>Add Music</span>
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-[200] min-w-52 p-1 rounded-xl text-sm"
                style={{
                  zIndex: 'var(--z-dropdown)',
                  background: 'var(--surface-chrome)',
                  border: '1px solid var(--border-strong)',
                  backdropFilter: 'blur(var(--blur-glass))',
                  boxShadow: 'var(--shadow-overlay)',
                }}
                sideOffset={6} align="start">
                <SidebarMenuItem icon={FolderOpen} label="Add Folder..." onClick={importFolder} />
                <SidebarMenuItem icon={FileAudio} label="Add Files..." onClick={importFiles} />
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>

      {/* Nav */}
      <nav className="px-2.5 space-y-0.5">
        {nav.map(({ id, label, icon: Icon, count }) => (
          <button key={id} onClick={() => setActiveView(id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm relative overflow-hidden transition-all'
            )}
            style={{
              transitionDuration: 'var(--dur-fast)',
              color: activeView === id ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: activeView === id ? 'var(--glass-2)' : 'transparent',
            }}
            onMouseEnter={(e) => { if (activeView !== id) e.currentTarget.style.background = 'var(--glass-1)' }}
            onMouseLeave={(e) => { if (activeView !== id) e.currentTarget.style.background = 'transparent' }}
          >
            {activeView === id && (
              <motion.div layoutId="nav-indicator"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full"
                style={{ background: 'var(--accent)' }}
                transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
            )}
            <Icon size={15} style={activeView === id ? { color: 'var(--accent)' } : undefined} />
            <span className="flex-1 text-left">{label}</span>
            {count > 0 && (
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>{count}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Playlists */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 mt-3">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
            Playlists
          </span>
          <button onClick={() => setShowPlaylistModal(true)} aria-label="New playlist"
            className="w-5 h-5 rounded flex items-center justify-center transition-all"
            style={{ color: 'var(--text-faint)', transitionDuration: 'var(--dur-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent' }}
          >
            <Plus size={12} />
          </button>
        </div>

        <AnimatePresence>
          {playlists.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState
                compact
                icon={<ListMusic size={18} />}
                title="No playlists yet"
                hint="Hit + to group your music"
              />
            </motion.div>
          )}
          {playlists.map((pl) => {
            const active = activeView === 'playlist' && selectedPlaylistId === pl.id
            return (
              <motion.button key={pl.id}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                onClick={() => { setActiveView('playlist'); setSelectedPlaylistId(pl.id) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all"
                style={{
                  transitionDuration: 'var(--dur-fast)',
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  background: active ? 'var(--glass-2)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-1)' }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <ListMusic size={13} style={active ? { color: 'var(--accent)' } : undefined} />
                <span className="flex-1 text-left truncate">{pl.name}</span>
                <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>{pl.songIds.length}</span>
                <ChevronRight size={11} style={{ opacity: 0.3 }} />
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Now playing mini */}
      <SidebarNowPlaying />

      {/* Rewind — the monthly story, a different *kind* of destination */}
      <div className="px-2.5 pt-3">
        <button
          onClick={() => setActiveView('rewind')}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all group/rewind"
          style={{
            transitionDuration: 'var(--dur-fast)',
            color: activeView === 'rewind' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            background: activeView === 'rewind' ? 'var(--glass-2)' : 'transparent',
          }}
          onMouseEnter={(e) => { if (activeView !== 'rewind') e.currentTarget.style.background = 'var(--glass-1)' }}
          onMouseLeave={(e) => { if (activeView !== 'rewind') e.currentTarget.style.background = 'transparent' }}
          title="Your month, told by your own listening"
        >
          <History size={15} style={activeView === 'rewind' ? { color: 'var(--accent)' } : undefined} />
          <span className="flex-1 text-left">Aura Rewind</span>
        </button>
      </div>

      {/* Settings — separated from the library nav since it's a different kind of view.
          Inside the floating card the divider is an inset hairline, not an edge. */}
      <div className="p-2.5 pt-2">
        <div className="mx-1 mb-2 h-px" style={{ background: 'var(--border-subtle)' }} />
        <button
          onClick={() => setActiveView('settings')}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all"
          style={{
            transitionDuration: 'var(--dur-fast)',
            color: activeView === 'settings' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            background: activeView === 'settings' ? 'var(--glass-2)' : 'transparent',
          }}
          onMouseEnter={(e) => { if (activeView !== 'settings') e.currentTarget.style.background = 'var(--glass-1)' }}
          onMouseLeave={(e) => { if (activeView !== 'settings') e.currentTarget.style.background = 'transparent' }}
        >
          <SettingsIcon size={15} style={activeView === 'settings' ? { color: 'var(--accent)' } : undefined} />
          <span>Settings</span>
        </button>
      </div>

      <PlaylistModal
        open={showPlaylistModal}
        mode="create"
        onClose={() => setShowPlaylistModal(false)}
      />
    </aside>
  )
}

// Shared menu-item styling for the import dropdown.
function SidebarMenuItem({ icon: Icon, label, onClick }: {
  icon: typeof FolderOpen; label: string; onClick: () => void
}) {
  return (
    <DropdownMenu.Item
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
      style={{ color: 'var(--text-secondary)' }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'transparent' }}
    >
      <Icon size={13} />
      {label}
    </DropdownMenu.Item>
  )
}

function SidebarNowPlaying() {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  if (!currentSong) return null

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="p-2.5 pt-1">
      <div className="mx-1 mb-2 h-px" style={{ background: 'var(--border-subtle)' }} />
      <div
        className="flex items-center gap-2.5 p-2 rounded-xl"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
      >
        <div className="relative shrink-0">
          {currentSong.coverArt
            ? <img src={currentSong.coverArt} alt="" className="w-9 h-9 rounded-lg object-cover" />
            : <div className="w-9 h-9 rounded-lg overflow-hidden">
                <ArtworkPlaceholder seed={currentSong.id} size="sm" />
              </div>
          }
          {isPlaying && (
            <div
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full flex items-center justify-center"
              style={{ background: 'var(--accent)', border: '2px solid var(--surface-card)' }}
              aria-hidden
            >
              {!performanceMode && (
                <motion.div className="w-1 h-1 rounded-full"
                  style={{ background: 'var(--text-on-accent)' }}
                  animate={{ scale: [0.6, 1, 0.6] }} transition={{ duration: 1, repeat: Infinity }} />
              )}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{currentSong.title}</p>
          <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{currentSong.artist}</p>
        </div>
      </div>
    </motion.div>
  )
}
