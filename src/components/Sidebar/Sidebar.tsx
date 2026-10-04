import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { Library as LibraryIcon, FolderOpen, FileAudio, Loader2, Settings as SettingsIcon, History, Clock, Globe, Sparkles, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Disc3 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useCatalogStore } from '@/store/catalogStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { LiquidTabs } from '@/components/Explore/LiquidTabs'

// ── Sidebar 3.2 (Aura 3.2.0 — collapse polish + motion language) ────────────
// v3.0 gave the sidebar a REAL collapse; 3.2 makes it feel designed:
//   • The collapse control is a proper 26px chip (hover veil, press scale,
//     animated icon crossfade) instead of a floating 13px glyph.
//   • Destination rows (Explore/Smart/History/Rewind) now share the SAME
//     travelling gel pill as Library/Favorites — one selection language,
//     with the indicator physically animating between items.
//   • Labels fade/slide out on collapse and back in on expand (Animate-
//     Presence, opacity/transform only) so the width change, icon recenter
//     and label fade read as ONE coordinated movement instead of a snap.
//   • Icon colors transition via CSS (see [data-liquid-tabs] svg rule in
//     index.css); hover/focus feedback rides the existing utilities.
//   • All of it honors prefers-reduced-motion (per-animation here + the
//     global <MotionConfig reducedMotion="user"> in App) and Performance
//     Mode inherits the same stillness through liquid.ts's guards.
// Selection consistency fix (spec §10) preserved: one indicator, no stacks.

export function Sidebar() {
  // Narrow selectors — Sidebar is mounted almost the entire time the app is
  // open, so the previous full `usePlayerStore()` subscribe meant it
  // re-rendered on every store mutation, including the progress tick that
  // fires ~4-10 times a second during playback, despite never displaying
  // progress at all.
  const activeView = usePlayerStore((s) => s.activeView)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const libraryCount = useCatalogStore((s) => s.libraryIds.length)
  const collapsed = usePlayerStore((s) => s.sidebarCollapsed)
  const toggleCollapsed = usePlayerStore((s) => s.toggleSidebarCollapsed)
  const reduceMotion = useReducedMotion()
  const { importFolder, importFiles, importing, progress } = useLibraryImport()

  // Aura 4 navigation (§20): the three music SOURCES lead; the curated
  // collections (All Music / Favorites / Playlists / Recently Added) live
  // INSIDE the Library destination as tabs — no competing sidebar entries.
  const nav = [
    { id: 'library'    as const, label: 'Library',     icon: LibraryIcon, count: libraryCount },
    { id: 'localmusic' as const, label: 'Local Music', icon: FolderOpen,  count: null },
    { id: 'explore'    as const, label: 'Explore',     icon: Globe,       count: null },
  ]

  // Destination rows — one consistent visual language (icon + label; selected
  // = gel pill + accent icon). Rendered through LiquidTabs so the selection
  // indicator TRAVELS between items (v3.2.0 motion spec §2.2); a value
  // outside this group (e.g. playlist/settings) tucks the pill away.
  const destinations = [
    { id: 'nowplaying' as const, label: 'Now Playing', title: 'The immersive full-screen player', icon: Disc3 },
    { id: 'studio' as const, label: 'Audio Studio', title: 'The live audio workspace — EQ, effects, master stages', icon: SlidersHorizontal },
    { id: 'smart' as const, label: 'Smart Playlists', title: 'Engine-built lists from your listening history — made on-device', icon: Sparkles },
    { id: 'history' as const, label: 'Listening History', title: 'Every session recorded on this device', icon: Clock },
    { id: 'rewind' as const, label: 'Aura Rewind', title: 'Your month, told by your own listening', icon: History },
  ]
  const destinationView = destinations.some((d) => d.id === activeView) ? (activeView as 'studio' | 'nowplaying' | 'smart' | 'history' | 'rewind') : ('' as 'studio')

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
      {/* Collapse toggle — v3.2.0: a designed 26px chip in a fixed-height
          header row (right-aligned expanded, centered in the rail), with a
          crossfading icon so the control itself participates in the motion
          instead of snapping between two glyphs. */}
      <div className={collapsed ? 'flex justify-center pt-2 px-2' : 'flex justify-end pt-2 px-2.5'}>
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="w-[26px] h-[26px] rounded-lg icon-hover flex items-center justify-center"
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
            trailing: !collapsed && count !== null && count > 0 ? (
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>{count}</span>
            ) : undefined,
          }))}
          value={nav.some((n) => n.id === activeView) ? activeView : ''}
          onChange={(id) => setActiveView(id as 'library' | 'localmusic' | 'explore')}
          ariaLabel="Music sources"
        />
      </nav>

      {/* (Playlists moved INTO the Library destination — Aura 4 §20 keeps
          the core sources/collections model uncluttered. The flex-1 spacer
          below keeps the bottom group anchored like the old list did.) */}
      <div className="flex-1 min-h-0" />

      {/* Now playing chip — artwork-only in the rail */}
      <SidebarNowPlaying collapsed={collapsed} />

      {/* Destinations — v3.2.0: the travelling gel pill (LiquidTabs row),
          icons-only when collapsed; the pill re-parks via the ResizeObserver.
          Same selection language as Library/Favorites above. */}
      <div className={collapsed ? 'px-1.5 pt-3' : 'px-2.5 pt-3'}>
        <LiquidTabs<string>
          variant="row"
          hideLabels={collapsed}
          items={destinations.map(({ id, label, title, icon: Icon }) => ({
            id,
            label,
            title: collapsed ? label : title,
            icon: <Icon size={15} className="transition-colors" style={activeView === id ? { color: 'var(--accent)' } : undefined} />,
          }))}
          value={destinationView}
          onChange={(id) => setActiveView(id as 'studio' | 'nowplaying' | 'smart' | 'history' | 'rewind')}
          ariaLabel="Destinations"
        />
      </div>

      {/* Settings — separated from the nav groups since it's a different kind
          of view. Inside the floating card the divider is an inset hairline.
          The label rides the shared CollapseLabel motion (fade/slide with the
          collapse, no mount pop). */}
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
          <SettingsIcon size={15} className="transition-colors" style={activeView === 'settings' ? { color: 'var(--accent)' } : undefined} />
          {!collapsed && <CollapseLabel reduceMotion={!!reduceMotion}><span>Settings</span></CollapseLabel>}
        </button>
      </div>
    </motion.aside>
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

// CollapseLabel — the coordinated fade for sidebar text that appears/
// disappears with the collapse state (v3.2.0 motion language). Exit runs
// during the first ~120ms of the 200ms width collapse (opacity + small
// slide — compositor-only); enter is delayed ~80ms so the label arrives
// as the card is still settling into its expanded width. Reduced motion
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
          {currentSong.artworkUrl
            ? <img src={currentSong.artworkUrl} alt="" className="w-9 h-9 rounded-lg object-cover" />
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
