import { motion, AnimatePresence } from 'framer-motion'
import { Music2, Heart, ListMusic, Plus, FolderOpen, FileAudio, Loader2, ChevronRight, Settings as SettingsIcon, History, Clock, Globe, Sparkles, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { LiquidTabs } from '@/components/Explore/LiquidTabs'
import { useState } from 'react'
import { PlaylistModal } from '../Modals/PlaylistModal'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { EmptyState } from '@/components/States/EmptyState'

// ── Sidebar 3.0 (Aura 3.0 Wave 7) ───────────────────────────────────────────
// The floating navigation card gains a REAL collapse: expanded (icons +
// labels) ⇄ collapsed (icons only), persisted across restarts. The width
// transition is a 200ms ease on the card itself — the main content resizes
// with the same motion, so the layout reads as one deliberate movement.
// Collapsed rows keep their tooltips (title attrs) and center their icons;
// the playlists list folds away (the + button stays); the now-playing chip
// degrades to artwork-only.
//
// Selection consistency fix (spec §10): the Library/Favorites rows no longer
// stack a leading accent bar ON TOP of the gel pill — the travelling pill +
// the accent-colored icon ARE the selected state, matching every other
// destination row's language. No more nested/div-like double indication.

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
  const collapsed = usePlayerStore((s) => s.sidebarCollapsed)
  const toggleCollapsed = usePlayerStore((s) => s.toggleSidebarCollapsed)
  const { importFolder, importFiles, importing, progress } = useLibraryImport()

  const nav = [
    { id: 'library'   as const, label: 'Library',   icon: Music2, count: libraryCount },
    { id: 'favorites' as const, label: 'Favorites',  icon: Heart,  count: favoritesCount },
  ]

  const [showPlaylistModal, setShowPlaylistModal] = useState(false)

  // Destination rows — one consistent visual language (icon + label; selected
  // = glass surface + accent icon; collapsed = centered icon + tooltip).
  const destinations = [
    { id: 'explore' as const, label: 'Explore', icon: Globe, title: 'Stream free music from Audius' },
    { id: 'smart' as const, label: 'Smart Playlists', icon: Sparkles, title: 'Engine-built lists from your listening history — made on-device' },
    { id: 'history' as const, label: 'Listening History', icon: Clock, title: 'Every session recorded on this device' },
    { id: 'rewind' as const, label: 'Aura Rewind', icon: History, title: 'Your month, told by your own listening' },
  ]

  return (
    /* ── Floating navigation card (v2.1.0, collapsible since 3.0) ────────
       The sidebar is a deliberate floating card: inset from the window on
       three sides, rounded, shadowed, glassed — so the ambient background
       flows AROUND it. Collapsed, it becomes a slim icon rail (56px card).
       The width animates; everything inside re-flows with it. */
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 56 : 'calc(var(--spacing-sidebar) - 10px)' }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className="shrink-0 flex flex-col overflow-hidden perf-blur"
      style={{
        margin: '10px 6px 10px 10px',
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--border-strong)',
        background: 'color-mix(in srgb, var(--surface-raised) 76%, transparent)',
        backdropFilter: 'blur(var(--blur-glass)) saturate(1.15)',
        WebkitBackdropFilter: 'blur(var(--blur-glass)) saturate(1.15)',
        boxShadow: 'var(--shadow-3), inset 0 1px 0 var(--border-emphasis)',
      }}
    >
      {/* Collapse toggle — sits above the import action; right-aligned when
          expanded (out of the button's way), centered in the rail. */}
      <div className={collapsed ? 'flex justify-center pt-2.5 px-2' : 'flex justify-end pt-2.5 px-2.5'}>
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1 rounded-lg icon-hover"
          style={{ color: 'var(--text-faint)' }}
        >
          {collapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
      </div>

      {/* Import — the sidebar's single primary action, wearing the accent. */}
      <div className={collapsed ? 'px-2 pb-2' : 'px-3.5 pb-2'}>
        {importing ? (
          <div
            className={collapsed
              ? 'w-full flex items-center justify-center py-2.5 rounded-xl'
              : 'w-full flex flex-col gap-2 py-2.5 px-3 rounded-xl'}
            style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
            role="status"
            aria-label="Importing music"
            title={collapsed ? `Importing ${progress.done}/${progress.total}` : undefined}
          >
            <div className={collapsed ? '' : 'flex items-center justify-center gap-2 text-xs font-medium'} style={{ color: 'var(--accent)' }}>
              <Loader2 size={12} className="animate-spin" />
              {!collapsed && <span className="tabular-nums">{progress.done}/{progress.total}</span>}
            </div>
            {!collapsed && (
              /* Determinate sliver — import is a real, countable process */
              <div className="h-0.5 rounded-pill overflow-hidden" style={{ background: 'var(--glass-2)' }}>
                <div
                  className="h-full rounded-pill transition-[width] duration-300"
                  style={{
                    width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%',
                    background: 'var(--accent)',
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className={collapsed
                  ? 'w-full flex items-center justify-center py-2.5 rounded-xl active:scale-[0.98] transition-all'
                  : 'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium active:scale-[0.98] transition-all'}
                style={{
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent-border)',
                  color: 'var(--accent)',
                  transitionDuration: 'var(--dur-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-dim)' }}
                title={collapsed ? 'Add Music' : undefined}
                aria-label={collapsed ? 'Add Music' : undefined}
              >
                <FolderOpen size={13} />
                {!collapsed && <span>Add Music</span>}
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

      {/* Nav — the gel pill travels between the two rows (v2.16.1 liquid
          system). Icons-only when collapsed; the pill re-parks via the
          ResizeObserver. The old leading accent bar is GONE (one indicator,
          not three). */}
      <nav className={collapsed ? 'px-1.5 space-y-0.5' : 'px-2.5 space-y-0.5'}>
        <LiquidTabs<string>
          variant="row"
          hideLabels={collapsed}
          items={nav.map(({ id, label, icon: Icon, count }) => ({
            id,
            label,
            icon: <Icon size={15} style={activeView === id ? { color: 'var(--accent)' } : undefined} />,
            trailing: !collapsed && count > 0 ? (
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>{count}</span>
            ) : undefined,
          }))}
          value={activeView}
          onChange={(id) => { if (id === 'library' || id === 'favorites') setActiveView(id) }}
          ariaLabel="Library navigation"
        />
      </nav>

      {/* Playlists — fold away entirely in the rail (a text list has no
          icons-only form); the + action stays reachable. */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-2.5 py-3 mt-3 min-h-0">
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
      )}

      {/* Now playing chip — artwork-only in the rail */}
      <SidebarNowPlaying collapsed={collapsed} />

      {/* Destinations — one consistent row language, icons-only when collapsed */}
      <div className={collapsed ? 'px-1.5 pt-3 space-y-0.5' : 'px-2.5 pt-3 space-y-0.5'}>
        {destinations.map((d) => <DestinationRow key={d.id} d={d} collapsed={collapsed} />)}
      </div>

      {/* Settings — separated from the library nav since it's a different kind of view.
          Inside the floating card the divider is an inset hairline, not an edge. */}
      <div className={collapsed ? 'p-1.5 pt-2' : 'p-2.5 pt-2'}>
        <div className="mx-1 mb-2 h-px" style={{ background: 'var(--border-subtle)' }} />
        <button
          onClick={() => setActiveView('settings')}
          className={collapsed
            ? 'w-full flex items-center justify-center py-2 rounded-xl text-sm transition-all'
            : 'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all'}
          style={{
            transitionDuration: 'var(--dur-fast)',
            color: activeView === 'settings' ? 'var(--text-primary)' : 'var(--text-tertiary)',
            background: activeView === 'settings' ? 'var(--glass-2)' : 'transparent',
          }}
          onMouseEnter={(e) => { if (activeView !== 'settings') e.currentTarget.style.background = 'var(--glass-1)' }}
          onMouseLeave={(e) => { if (activeView !== 'settings') e.currentTarget.style.background = 'transparent' }}
          title={collapsed ? 'Settings' : undefined}
          aria-label={collapsed ? 'Settings' : undefined}
        >
          <SettingsIcon size={15} style={activeView === 'settings' ? { color: 'var(--accent)' } : undefined} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>

      <PlaylistModal
        open={showPlaylistModal}
        mode="create"
        onClose={() => setShowPlaylistModal(false)}
      />
    </motion.aside>
  )
}

// One destination row — Explore / Smart / History / Rewind all speak the same
// selected-state language now (glass surface + accent icon), matching the
// Library/Favorites gel pill rather than inventing per-row furniture.
function DestinationRow({ d, collapsed }: {
  d: { id: 'explore' | 'smart' | 'history' | 'rewind'; label: string; icon: typeof Globe; title: string }
  collapsed: boolean
}) {
  const activeView = usePlayerStore((s) => s.activeView)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const active = activeView === d.id
  return (
    <button
      onClick={() => setActiveView(d.id)}
      className={collapsed
        ? 'w-full flex items-center justify-center py-2 rounded-xl text-sm transition-all'
        : 'w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all'}
      style={{
        transitionDuration: 'var(--dur-fast)',
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        background: active ? 'var(--glass-2)' : 'transparent',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-1)' }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
      title={collapsed ? d.label : d.title}
      aria-label={collapsed ? d.label : undefined}
    >
      <d.icon size={15} style={active ? { color: 'var(--accent)' } : undefined} />
      {!collapsed && <span className="flex-1 text-left">{d.label}</span>}
    </button>
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
    >
      <Icon size={13} />
      {label}
    </DropdownMenu.Item>
  )
}

function SidebarNowPlaying({ collapsed }: { collapsed: boolean }) {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  if (!currentSong) return null

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={collapsed ? 'px-2 pt-1' : 'p-2.5 pt-1'}>
      <div className="mx-1 mb-2 h-px" style={{ background: 'var(--border-subtle)' }} />
      <div
        className={collapsed
          ? 'flex items-center justify-center p-1 rounded-xl'
          : 'flex items-center gap-2.5 p-2 rounded-xl'}
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
        title={collapsed ? `${currentSong.title} — ${currentSong.artist}` : undefined}
      >
        <button
          onClick={() => setActiveView('nowplaying')}
          className="relative shrink-0"
          aria-label={collapsed ? `Now playing: ${currentSong.title}` : undefined}
        >
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
        </button>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{currentSong.title}</p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{currentSong.artist}</p>
          </div>
        )}
      </div>
    </motion.div>
  )
}
