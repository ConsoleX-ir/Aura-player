import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  House, Music2, Heart, ListMusic, Plus, FolderOpen, FileAudio, Loader2,
  Settings as SettingsIcon, History, Clock, Globe, Sparkles, PanelLeftClose,
  PanelLeftOpen, SlidersHorizontal, HardDrive, ChevronRight,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { LiquidTabs } from '@/components/Explore/LiquidTabs'
import { useState } from 'react'
import { PlaylistModal } from '../Modals/PlaylistModal'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { EmptyState } from '@/components/States/EmptyState'
import type { AppView } from '@/types'

// ── Sidebar 4.0 (Core Experience redesign) ──────────────────────────────────
// A re-designed information architecture for BOTH states — not a shrink-to-fit
// of the old list.
//
//   Expanded — a grouped hierarchy that mirrors how the app is actually used:
//     DISCOVER           Home · Explore
//     YOUR MUSIC         Library · Local Music · Favorites · Playlists (+)
//     LISTENING & TOOLS  History · Audio Studio · Smart Playlists · Rewind
//     Application        Settings (pinned bottom, past the now-playing chip)
//   Selection keeps the app's signature travelling gel pill (LiquidTabs) —
//   one per group, so the pill physically travels between siblings and tucks
//   away when the active view belongs to another group.
//
//   Collapsed — a deliberate 56px icon rail with its own composition: brand
//   mark, the import action, the same groups as compact icon stacks separated
//   by hairlines, a Playlists DROPDOWN (so playlist management survives
//   without text), the now-playing artwork chip, and Settings at the base.
//   Every icon carries a tooltip; the gel pill still marks the active view.
//
//   Everything else is preserved from 3.2: persisted collapse state, reduced-
//   motion-aware CollapseLabel choreography, the import progress sliver,
//   PlaylistModal, and the Performance-Mode stillness guarantees.

type View = AppView

// ── Group definitions (expanded labels + collapsed tooltips in one place) ──
const DISCOVER = [
  { id: 'home' as const, label: 'Home', title: 'Your landing space — the Aura Orb', icon: House },
  { id: 'explore' as const, label: 'Explore', title: 'Stream free music from Audius', icon: Globe },
]
const YOUR_MUSIC = [
  { id: 'library' as const, label: 'Library', title: 'Your whole collection', icon: Music2 },
  { id: 'local' as const, label: 'Local Music', title: 'Files stored on this device', icon: HardDrive },
  { id: 'favorites' as const, label: 'Favorites', title: 'The songs you loved', icon: Heart },
]
const TOOLS = [
  { id: 'history' as const, label: 'Listening History', title: 'Every session recorded on this device', icon: Clock },
  { id: 'studio' as const, label: 'Audio Studio', title: 'The live audio workspace — EQ, effects, master stages', icon: SlidersHorizontal },
  { id: 'smart' as const, label: 'Smart Playlists', title: 'Engine-built lists from your listening history — made on-device', icon: Sparkles },
  { id: 'rewind' as const, label: 'Aura Rewind', title: 'Your month, told by your own listening', icon: History },
]

export function Sidebar() {
  // Narrow selectors — Sidebar is mounted almost the entire time the app is
  // open, so it must never re-render on the ~4-10Hz playback progress tick.
  const playlists = usePlayerStore((s) => s.playlists)
  const activeView = usePlayerStore((s) => s.activeView)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const setSelectedPlaylistId = usePlayerStore((s) => s.setSelectedPlaylistId)
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId)
  const favoritesCount = usePlayerStore((s) => s.favorites.length)
  const libraryCount = usePlayerStore((s) => s.library.length)
  const collapsed = usePlayerStore((s) => s.sidebarCollapsed)
  const toggleCollapsed = usePlayerStore((s) => s.toggleSidebarCollapsed)
  const reduceMotion = useReducedMotion()
  const { importFolder, importFiles, importing, progress } = useLibraryImport()

  const [showPlaylistModal, setShowPlaylistModal] = useState(false)

  const yourMusicItems = YOUR_MUSIC.map((item) => ({
    ...item,
    count: item.id === 'library' ? libraryCount : item.id === 'favorites' ? favoritesCount : undefined,
  }))

  const groupValue = (ids: readonly string[]): string =>
    ids.includes(activeView) ? activeView : ''

  return (
    /* ── Floating navigation card (v2.1.0 identity, collapsible since 3.0) ──
       The sidebar is a deliberate floating card: inset from the window on
       three sides, rounded, shadowed, glassed — the ambient background flows
       AROUND it. Collapsed, it becomes a slim icon rail (56px). */
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
      {/* ── Header — brand identity + collapse control ────────────────────
          The brand mark doubles as a Home button (a rail needs a face, and
          the landing page is one click away from it in either state). */}
      <div className={collapsed
        ? 'flex flex-col items-center gap-1.5 pt-3 px-2'
        : 'flex items-center justify-between pl-4 pr-2.5 pt-3 pb-1'}>
        <button
          onClick={() => setActiveView('home')}
          className="flex items-center gap-2.5 rounded-xl outline-none"
          aria-label="Aura — go to Home"
          title={collapsed ? 'Aura — go to Home' : undefined}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{
              background: 'var(--accent-dim)',
              border: '1px solid var(--accent-border)',
              boxShadow: '0 0 16px var(--accent-whisper)',
            }}
          >
            <div className="flex items-end gap-[2px] h-3.5">
              {[2, 3, 4, 3, 2].map((h, i) => (
                <div key={i} className="w-[2px] rounded-full" style={{ height: h * 3.5, background: 'var(--accent)', opacity: 0.9 }} />
              ))}
            </div>
          </div>
          {!collapsed && (
            <CollapseLabel reduceMotion={!!reduceMotion}>
              <span
                className="text-[12px] font-semibold uppercase whitespace-nowrap"
                style={{ color: 'var(--text-primary)', letterSpacing: '0.22em' }}
              >
                Aura
              </span>
            </CollapseLabel>
          )}
        </button>
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="w-[26px] h-[26px] rounded-lg icon-hover flex items-center justify-center shrink-0"
          style={{ color: 'var(--text-faint)' }}
        >
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={collapsed ? 'open' : 'close'}
              initial={{ opacity: 0, rotate: reduceMotion ? 0 : collapsed ? -45 : 45, scale: 0.7 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: reduceMotion ? 0 : 0.14, ease: [0.4, 0, 0.2, 1] }}
              className="flex"
            >
              {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>

      {/* Import — the sidebar's single primary action, wearing the accent. */}
      <div className={collapsed ? 'px-2 pt-2.5 pb-1' : 'px-3.5 pt-2 pb-2'}>
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

      {/* ── Scrollable middle — groups + playlists ─────────────────────────
          Bounded by flex-1 min-h-0 so short windows scroll the middle while
          the brand, import, now-playing chip and Settings stay anchored. */}
      <div className={collapsed ? 'flex-1 min-h-0 overflow-y-auto px-1.5 pt-2 pb-2 space-y-1.5' : 'flex-1 min-h-0 overflow-y-auto px-2.5 pt-2 pb-2'}>

        {/* DISCOVER */}
        {!collapsed && <SectionLabel>Discover</SectionLabel>}
        <LiquidTabs<string>
          variant="row"
          hideLabels={collapsed}
          items={DISCOVER.map(({ id, label, title, icon: Icon }) => ({
            id, label,
            title: collapsed ? label : title,
            icon: <Icon size={15} style={activeView === id ? { color: 'var(--accent)' } : undefined} />,
          }))}
          value={groupValue(DISCOVER.map((d) => d.id))}
          onChange={(id) => setActiveView(id as View)}
          ariaLabel="Discover navigation"
        />

        <RailDivider collapsed={collapsed} />

        {/* YOUR MUSIC */}
        {!collapsed && <SectionLabel>Your Music</SectionLabel>}
        <LiquidTabs<string>
          variant="row"
          hideLabels={collapsed}
          items={yourMusicItems.map(({ id, label, title, icon: Icon, count }) => ({
            id, label,
            title: collapsed ? label : title,
            icon: <Icon size={15} style={activeView === id ? { color: 'var(--accent)' } : undefined} />,
            trailing: !collapsed && count !== undefined && count > 0 ? (
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>{count}</span>
            ) : undefined,
          }))}
          value={groupValue(YOUR_MUSIC.map((d) => d.id))}
          onChange={(id) => setActiveView(id as View)}
          ariaLabel="Your music navigation"
        />

        {/* Playlists — expanded: a real list with its own + action.
            Collapsed: a dropdown keeps playlist management reachable from
            the rail (a text list has no icons-only form by itself). */}
        {collapsed ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                className="w-full flex items-center justify-center py-2 rounded-lg transition-all"
                style={{
                  color: activeView === 'playlist' ? 'var(--accent)' : 'var(--text-faint)',
                  background: activeView === 'playlist' ? 'var(--glass-2)' : 'transparent',
                  transitionDuration: 'var(--dur-fast)',
                }}
                title="Playlists"
                aria-label={`Playlists — ${playlists.length} available`}
              >
                <ListMusic size={15} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="z-[200] min-w-52 p-1 rounded-xl text-sm max-h-72 overflow-y-auto"
                style={{
                  zIndex: 'var(--z-dropdown)',
                  background: 'var(--surface-chrome)',
                  border: '1px solid var(--border-strong)',
                  backdropFilter: 'blur(var(--blur-glass))',
                  boxShadow: 'var(--shadow-overlay)',
                }}
                sideOffset={6} align="start">
                <DropdownMenu.Item
                  onClick={() => setShowPlaylistModal(true)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
                >
                  <Plus size={13} />
                  New Playlist…
                </DropdownMenu.Item>
                {playlists.length > 0 && (
                  <DropdownMenu.Separator className="my-1" style={{ height: 1, background: 'var(--border-default)' }} />
                )}
                {playlists.map((pl) => (
                  <DropdownMenu.Item
                    key={pl.id}
                    onClick={() => { setActiveView('playlist'); setSelectedPlaylistId(pl.id) }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
                    style={activeView === 'playlist' && selectedPlaylistId === pl.id ? { color: 'var(--accent)' } : undefined}
                  >
                    <ListMusic size={12} style={{ opacity: 0.7 }} />
                    <span className="flex-1 truncate">{pl.name}</span>
                    <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>{pl.songIds.length}</span>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <div className="pl-1 pr-0.5 mt-1.5">
            <div className="flex items-center justify-between pl-2.5 pr-1.5 mb-0.5">
              <span
                className="text-[10px] font-medium uppercase"
                style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
              >
                Playlists
              </span>
              <button
                onClick={() => setShowPlaylistModal(true)}
                aria-label="New playlist"
                title="New playlist"
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
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-[13px] transition-all"
                    style={{
                      transitionDuration: 'var(--dur-fast)',
                      color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      background: active ? 'var(--glass-2)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--glass-1)' }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    <ListMusic size={12} style={active ? { color: 'var(--accent)' } : undefined} />
                    <span className="flex-1 text-left truncate">{pl.name}</span>
                    <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{pl.songIds.length}</span>
                    <ChevronRight size={10} style={{ opacity: 0.3 }} />
                  </motion.button>
                )
              })}
            </AnimatePresence>
          </div>
        )}

        <RailDivider collapsed={collapsed} />

        {/* LISTENING & TOOLS */}
        {!collapsed && <SectionLabel>Listening &amp; Tools</SectionLabel>}
        <LiquidTabs<string>
          variant="row"
          hideLabels={collapsed}
          items={TOOLS.map(({ id, label, title, icon: Icon }) => ({
            id, label,
            title: collapsed ? label : title,
            icon: <Icon size={15} style={activeView === id ? { color: 'var(--accent)' } : undefined} />,
          }))}
          value={groupValue(TOOLS.map((d) => d.id))}
          onChange={(id) => setActiveView(id as View)}
          ariaLabel="Listening and tools navigation"
        />
      </div>

      {/* Now playing chip — artwork-only in the rail */}
      <SidebarNowPlaying collapsed={collapsed} />

      {/* Settings — a different kind of destination, pinned below the
          scrollable middle and the now-playing chip. */}
      <div className={collapsed ? 'p-1.5 pt-1.5' : 'p-2.5 pt-1.5'}>
        {!collapsed && <div className="mx-1 mb-2 h-px" style={{ background: 'var(--border-subtle)' }} />}
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
          <SettingsIcon size={15} className="transition-colors" style={activeView === 'settings' ? { color: 'var(--accent)' } : undefined} />
          {!collapsed && <CollapseLabel reduceMotion={!!reduceMotion}><span>Settings</span></CollapseLabel>}
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

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Uppercase micro-label above a nav group (expanded only). */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 pb-1 pt-1.5 text-[9.5px] font-semibold uppercase select-none"
      style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
    >
      {children}
    </div>
  )
}

/** Hairline between rail groups (collapsed) — invisible when expanded, where
    the section labels already carry the separation. */
function RailDivider({ collapsed }: { collapsed: boolean }) {
  if (!collapsed) return null
  return <div aria-hidden className="mx-2.5 my-1 h-px" style={{ background: 'var(--border-subtle)' }} />
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

// CollapseLabel — the coordinated fade for sidebar text that appears/
// disappears with the collapse state (v3.2.0 motion language, kept). Exit runs
// during the first ~120ms of the 200ms width collapse (opacity + small
// slide — compositor-only); enter is delayed ~80ms so the label arrives as
// the card is still settling into its expanded width. Reduced motion
// collapses both to instant placement — the state still changes, just
// without the movement.
function CollapseLabel({ children, reduceMotion }: { children: React.ReactNode; reduceMotion: boolean }) {
  return (
    <AnimatePresence initial={false}>
      <motion.span
        initial={reduceMotion ? false : { opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -6 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.13, ease: [0.4, 0, 0.2, 1], delay: 0.06 }}
        className="flex-1 min-w-0 flex"
      >
        {children}
      </motion.span>
    </AnimatePresence>
  )
}

function SidebarNowPlaying({ collapsed }: { collapsed: boolean }) {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const reduceMotion = useReducedMotion()
  if (!currentSong) return null

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={collapsed ? 'px-2 pt-1' : 'p-2.5 pt-1'}>
      {!collapsed && <div className="mx-1 mb-2 h-px" style={{ background: 'var(--border-subtle)' }} />}
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
          <CollapseLabel reduceMotion={!!reduceMotion}>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{currentSong.title}</p>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{currentSong.artist}</p>
            </div>
          </CollapseLabel>
        )}
      </div>
    </motion.div>
  )
}
