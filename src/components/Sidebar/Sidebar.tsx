import { useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  House, Music2, Heart, ListMusic, Plus, FolderOpen, FileAudio, Loader2,
  Settings as SettingsIcon, History, Clock, Globe, Sparkles, PanelLeftClose,
  PanelLeftOpen, SlidersHorizontal, HardDrive,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { PlaylistModal } from '../Modals/PlaylistModal'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { EmptyState } from '@/components/States/EmptyState'
import type { AppView } from '@/types'

// ── Sidebar 4.0.1 (Sidebar & Playback Bar redesign) ─────────────────────────
// The floating rounded glass card is GONE — replaced by a real desktop
// application rail. The composition itself changed, not just its paint:
//
//   • STRUCTURE — a full-height docked column (it spans the app frame's
//     content rows AND the player-bar row — see App.tsx), separated from
//     the content by one vertical hairline. No margins, no radius, no
//     shadow, no blur: a stable, familiar navigation column with a subtle
//     raised surface the ambient background can tint through.
//   • HEADER — a compact 48px brand bar (Aura mark + wordmark, doubles as
//     Home) with the collapse control docked at its right.
//   • NAVIGATION — three labeled groups of plain full-width rows (icon +
//     label + optional count): DISCOVER, YOUR MUSIC, LISTENING & TOOLS.
//     One consistent 36px row grid, 18px icons, distinct active state
//     (accent-tinted surface + accent icon + 3px left indicator bar),
//     quiet hover veil, visible keyboard focus. No per-item pill chrome.
//   • PLAYLISTS — their own region below the fixed groups with an
//     independent scroll container, so long lists never push the utilities
//     or force the whole rail to scroll.
//   • UTILITIES — pinned at the base, below a hairline: the now-playing
//     chip (when something is loaded), Add Music (the import dropdown) and
//     Settings, all on the same row grid.
//
//   COLLAPSED — a deliberate 64px icon rail: brand mark, import, the same
//   groups as icon stacks separated by hairlines, a Playlists dropdown
//   (playlist management survives without text), the now-playing artwork,
//   and Settings at the base. Every icon has a tooltip; active rows keep
//   the accent surface + edge indicator.
//
// Preserved contracts: persisted collapse state, PlaylistModal, the import
// progress sliver, favorites/library counts, Performance-Mode stillness
// (no blur used at all now), reduced-motion-aware transitions, and
// keyboard navigation (Tab + arrow-key roving across all nav rows).
// Collapse/expand animates ONLY the rail's width — nothing remounts and
// playback is untouched.

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
  // Narrow selectors — the sidebar is mounted almost the entire time the app
  // is open, so it must never re-render on the ~4-10Hz playback progress tick.
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
  const asideRef = useRef<HTMLElement>(null)

  // Keyboard roving — Up/Down move focus across every nav row (both states),
  // wrapping at the ends. Selection stays on Enter/Space (native buttons).
  const onNavKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const root = asideRef.current
    if (!root) return
    const rows = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-nav-row]'))
    const at = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (at === -1) return
    e.preventDefault()
    const next = e.key === 'ArrowDown' ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length
    rows[next]?.focus()
  }

  return (
    <motion.aside
      ref={asideRef}
      data-sidebar
      data-collapsed={collapsed ? 'true' : 'false'}
      initial={false}
      animate={{ width: collapsed ? 64 : 'var(--spacing-sidebar)' }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      onKeyDown={onNavKeyDown}
      className={`h-full flex flex-col overflow-hidden shrink-0 ${collapsed ? 'aura-nav-rail' : ''}`}
      style={{
        // A docked rail, not a floating card: flat column, one right
        // hairline, and a quiet raised surface the ambient background can
        // tint through. Every value is token-driven — light mode and every
        // theme identity remap this automatically.
        background: 'color-mix(in srgb, var(--surface-raised) 64%, transparent)',
        borderRight: '1px solid var(--border-subtle)',
      }}
    >
      <SidebarHeader collapsed={collapsed} onToggle={toggleCollapsed} />

      {collapsed ? (
        <RailBody
          activeView={activeView}
          setActiveView={setActiveView}
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          onSelectPlaylist={(id) => { setActiveView('playlist'); setSelectedPlaylistId(id) }}
          onNewPlaylist={() => setShowPlaylistModal(true)}
        />
      ) : (
        <ExpandedBody
          activeView={activeView}
          setActiveView={setActiveView}
          playlists={playlists}
          selectedPlaylistId={selectedPlaylistId}
          onSelectPlaylist={(id) => { setActiveView('playlist'); setSelectedPlaylistId(id) }}
          onNewPlaylist={() => setShowPlaylistModal(true)}
          libraryCount={libraryCount}
          favoritesCount={favoritesCount}
        />
      )}

      {/* Bottom utilities — pinned past the scrollable regions. */}
      <div className="shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <SidebarNowPlaying collapsed={collapsed} />
        <div className={collapsed ? 'flex flex-col items-center gap-1 py-1.5' : 'p-2 pt-1.5 space-y-0.5'}>
          <ImportControl
            collapsed={collapsed}
            importing={importing}
            progress={progress}
            importFolder={importFolder}
            importFiles={importFiles}
          />
          {collapsed ? (
            <RailNavButton
              icon={SettingsIcon}
              label="Settings"
              active={activeView === 'settings'}
              onClick={() => setActiveView('settings')}
            />
          ) : (
            <NavRow
              icon={SettingsIcon}
              label="Settings"
              title="Themes, audio, storage and app behavior"
              active={activeView === 'settings'}
              onClick={() => setActiveView('settings')}
            />
          )}
        </div>
      </div>

      <PlaylistModal
        open={showPlaylistModal}
        mode="create"
        onClose={() => setShowPlaylistModal(false)}
      />
    </motion.aside>
  )
}

// ── Header ──────────────────────────────────────────────────────────────────
// 48px brand bar: the mark doubles as a Home button; the collapse control
// sits at the rail's right edge (expanded) or under the mark (rail mode).
function SidebarHeader({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const reduceMotion = useReducedMotion()
  return (
    <div
      className={collapsed
        ? 'flex flex-col items-center gap-1 pt-2.5 pb-1 shrink-0'
        : 'flex items-center justify-between h-12 pl-3.5 pr-2 shrink-0'}
      style={collapsed ? undefined : { borderBottom: '1px solid var(--border-subtle)' }}
    >
      <button
        onClick={() => setActiveView('home')}
        className="flex items-center gap-2.5 rounded-xl outline-none"
        aria-label="Aura — go to Home"
        title={collapsed ? 'Aura — go to Home' : undefined}
      >
        <BrandMark size={28} />
        {!collapsed && (
          <span
            className="text-[12px] font-semibold uppercase whitespace-nowrap"
            style={{ color: 'var(--text-primary)', letterSpacing: '0.22em' }}
          >
            Aura
          </span>
        )}
      </button>
      <button
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="w-7 h-7 rounded-lg icon-hover flex items-center justify-center shrink-0"
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
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  )
}

// ── Expanded body ───────────────────────────────────────────────────────────
// Fixed labeled groups on top; the Playlists region below them gets the
// remaining height and its own scroll container; nothing else ever scrolls.
function ExpandedBody({
  activeView, setActiveView,
  playlists, selectedPlaylistId, onSelectPlaylist, onNewPlaylist,
  libraryCount, favoritesCount,
}: {
  activeView: View
  setActiveView: (v: View) => void
  playlists: { id: string; name: string; songIds: string[] }[]
  selectedPlaylistId: string | null
  onSelectPlaylist: (id: string) => void
  onNewPlaylist: () => void
  libraryCount: number
  favoritesCount: number
}) {
  return (
    <>
      {/* Fixed groups — shrink-allowing so a very short window scrolls this
          region instead of crushing the playlists/utility areas. */}
      <div className="min-h-0 flex flex-col px-2 pt-1.5 overflow-y-auto" style={{ flex: '0 1 auto' }}>
        <SectionLabel>Discover</SectionLabel>
        {DISCOVER.map((item) => (
          <NavRow
            key={item.id}
            icon={item.icon}
            label={item.label}
            title={item.title}
            active={activeView === item.id}
            onClick={() => setActiveView(item.id)}
          />
        ))}

        <SectionLabel>Your Music</SectionLabel>
        {YOUR_MUSIC.map((item) => (
          <NavRow
            key={item.id}
            icon={item.icon}
            label={item.label}
            title={item.title}
            active={activeView === item.id}
            onClick={() => setActiveView(item.id)}
            count={item.id === 'library' ? libraryCount : item.id === 'favorites' ? favoritesCount : undefined}
          />
        ))}

        <SectionLabel>Listening &amp; Tools</SectionLabel>
        {TOOLS.map((item) => (
          <NavRow
            key={item.id}
            icon={item.icon}
            label={item.label}
            title={item.title}
            active={activeView === item.id}
            onClick={() => setActiveView(item.id)}
          />
        ))}
      </div>

      {/* Playlists — the region that owns scrolling. Long lists scroll
          HERE only; the groups above and the utilities below stay put. */}
      <div className="flex-1 min-h-[72px] flex flex-col px-2 pt-2 pb-1">
        <div className="flex items-center justify-between pl-3 pr-1 pb-1 shrink-0">
          <span
            className="text-[9.5px] font-semibold uppercase select-none"
            style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
          >
            Playlists
          </span>
          <button
            onClick={onNewPlaylist}
            aria-label="New playlist"
            title="New playlist"
            className="w-6 h-6 rounded-md icon-hover flex items-center justify-center"
            style={{ color: 'var(--text-faint)' }}
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-0.5">
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
                <button
                  key={pl.id}
                  data-nav-row
                  data-active={active ? 'true' : 'false'}
                  aria-current={active || undefined}
                  onClick={() => onSelectPlaylist(pl.id)}
                  className="aura-nav-row w-full flex items-center gap-2.5 h-8 pl-3 pr-2 rounded-[10px] text-[13px]"
                  style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                >
                  <span className="aura-nav-glyph" aria-hidden />
                  <ListMusic size={15} className="shrink-0 transition-colors" style={{ color: active ? 'var(--accent)' : 'var(--text-tertiary)' }} />
                  <span className="flex-1 text-left truncate">{pl.name}</span>
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{pl.songIds.length}</span>
                </button>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}

// ── Collapsed body — the 64px icon rail ─────────────────────────────────────
function RailBody({
  activeView, setActiveView,
  playlists, selectedPlaylistId, onSelectPlaylist, onNewPlaylist,
}: {
  activeView: View
  setActiveView: (v: View) => void
  playlists: { id: string; name: string; songIds: string[] }[]
  selectedPlaylistId: string | null
  onSelectPlaylist: (id: string) => void
  onNewPlaylist: () => void
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center px-1.5 pt-2 pb-1 gap-0.5 overflow-y-auto overflow-x-hidden">
      {/* Import stays in the pinned bottom utilities (shared with the
          expanded state) — the rail body is pure navigation. */}
      <RailDivider />

      {DISCOVER.map((item) => (
        <RailNavButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={activeView === item.id}
          onClick={() => setActiveView(item.id)}
        />
      ))}
      <RailDivider />
      {YOUR_MUSIC.map((item) => (
        <RailNavButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={activeView === item.id}
          onClick={() => setActiveView(item.id)}
        />
      ))}

      {/* Playlists survive icon-only as a dropdown. */}
      <RailPlaylistsDropdown
        playlists={playlists}
        activeView={activeView}
        selectedPlaylistId={selectedPlaylistId}
        onSelectPlaylist={onSelectPlaylist}
        onNewPlaylist={onNewPlaylist}
      />
      <RailDivider />
      {TOOLS.map((item) => (
        <RailNavButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={activeView === item.id}
          onClick={() => setActiveView(item.id)}
        />
      ))}
    </div>
  )
}

function RailDivider() {
  return <div aria-hidden className="mx-2 my-1 h-px shrink-0" style={{ background: 'var(--border-subtle)' }} />
}

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Aura brand chip — the equalizer glyph wearing the live accent. */
function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <div
      className="rounded-[9px] flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        background: 'var(--accent-dim)',
        border: '1px solid var(--accent-border)',
        boxShadow: '0 0 14px var(--accent-whisper)',
      }}
    >
      <div className="flex items-end gap-[2px]" style={{ height: size * 0.42 }}>
        {[2, 3, 4, 3, 2].map((h, i) => (
          <div
            key={i}
            className="rounded-full"
            style={{ width: 2, height: h * (size * 0.13), background: 'var(--accent)', opacity: 0.9 }}
          />
        ))}
      </div>
    </div>
  )
}

/** Uppercase micro-label above a nav group (expanded only). */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pl-3 pr-2 pb-1 pt-2 text-[9.5px] font-semibold uppercase select-none"
      style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
    >
      {children}
    </div>
  )
}

/** Expanded nav row — one consistent 36px grid: indicator · 18px icon ·
    label · optional count. States come from .aura-nav-row CSS (hover,
    active surface) plus the accent icon + left glyph for active. */
function NavRow({ icon: Icon, label, title, active, count, onClick }: {
  icon: typeof House
  label: string
  title?: string
  active: boolean
  count?: number
  onClick: () => void
}) {
  return (
    <button
      data-nav-row
      data-active={active ? 'true' : 'false'}
      aria-current={active || undefined}
      onClick={onClick}
      title={title}
      className="aura-nav-row w-full flex items-center gap-3 h-9 pl-3 pr-2.5 rounded-[10px] text-[13px] font-medium outline-none"
      style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
    >
      <span className="aura-nav-glyph" aria-hidden />
      <Icon size={18} className="shrink-0 transition-colors" style={{ color: active ? 'var(--accent)' : 'var(--text-tertiary)' }} />
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>{count}</span>
      )}
    </button>
  )
}

/** Collapsed rail button — 40px target, 20px icon, tooltip, same active
    treatment (accent surface + edge indicator) as the expanded rows. */
function RailNavButton({ icon: Icon, label, active, onClick }: {
  icon: typeof House
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      data-nav-row
      data-active={active ? 'true' : 'false'}
      aria-current={active || undefined}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="aura-nav-row w-10 h-10 rounded-xl flex items-center justify-center outline-none shrink-0"
      style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
    >
      <span className="aura-nav-glyph" aria-hidden />
      <Icon size={20} style={{ color: active ? 'var(--accent)' : 'currentColor' }} />
    </button>
  )
}

/** Import (Add Music) — expanded: a quiet accent row that opens the
    Folder/Files dropdown; while importing it becomes the progress sliver. */
function ImportControl({ collapsed, importing, progress, importFolder, importFiles }: {
  collapsed: boolean
  importing: boolean
  progress: { done: number; total: number }
  importFolder: () => void
  importFiles: () => void
}) {
  if (collapsed) {
    if (importing) {
      return (
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
          role="status"
          aria-label={`Importing ${progress.done}/${progress.total}`}
          title={`Importing ${progress.done}/${progress.total}`}
        >
          <Loader2 size={18} className="animate-spin" />
        </div>
      )
    }
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 active:scale-[0.97] transition-all"
            style={{ color: 'var(--accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', transitionDuration: 'var(--dur-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-dim)' }}
            title="Add Music"
            aria-label="Add Music"
          >
            <FolderOpen size={20} />
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
            <RailMenuItem icon={FolderOpen} label="Add Folder..." onClick={importFolder} />
            <RailMenuItem icon={FileAudio} label="Add Files..." onClick={importFiles} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    )
  }

  if (importing) {
    return (
      <div
        className="w-full flex flex-col gap-2 py-2 px-3 rounded-[10px]"
        style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)' }}
        role="status"
        aria-label="Importing music"
      >
        <div className="flex items-center justify-center gap-2 text-xs font-medium" style={{ color: 'var(--accent)' }}>
          <Loader2 size={14} className="animate-spin" />
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
    )
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          data-nav-row
          className="aura-nav-row w-full flex items-center gap-3 h-9 pl-3 pr-2.5 rounded-[10px] text-[13px] font-medium"
          style={{ color: 'var(--accent)' }}
          title="Import music into your library"
        >
          <FolderOpen size={18} className="shrink-0" />
          <span className="flex-1 text-left">Add Music</span>
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
          <RailMenuItem icon={FolderOpen} label="Add Folder..." onClick={importFolder} />
          <RailMenuItem icon={FileAudio} label="Add Files..." onClick={importFiles} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Collapsed Playlists dropdown — playlist management survives without
    text: New Playlist… plus every playlist, in one Radix menu. */
function RailPlaylistsDropdown({ playlists, activeView, selectedPlaylistId, onSelectPlaylist, onNewPlaylist }: {
  playlists: { id: string; name: string; songIds: string[] }[]
  activeView: View
  selectedPlaylistId: string | null
  onSelectPlaylist: (id: string) => void
  onNewPlaylist: () => void
}) {
  const active = activeView === 'playlist'
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          data-nav-row
          data-active={active ? 'true' : 'false'}
          className="aura-nav-row relative w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ color: active ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
          title="Playlists"
          aria-label={`Playlists — ${playlists.length} available`}
        >
          <span className="aura-nav-glyph" aria-hidden />
          <ListMusic size={20} style={{ color: active ? 'var(--accent)' : 'currentColor' }} />
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
            onClick={onNewPlaylist}
            className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
          >
            <Plus size={14} />
            New Playlist…
          </DropdownMenu.Item>
          {playlists.length > 0 && (
            <DropdownMenu.Separator className="my-1" style={{ height: 1, background: 'var(--border-default)' }} />
          )}
          {playlists.map((pl) => (
            <DropdownMenu.Item
              key={pl.id}
              onClick={() => onSelectPlaylist(pl.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              style={activeView === 'playlist' && selectedPlaylistId === pl.id ? { color: 'var(--accent)' } : undefined}
            >
              <ListMusic size={13} style={{ opacity: 0.7 }} />
              <span className="flex-1 truncate">{pl.name}</span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>{pl.songIds.length}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// Shared menu-item styling for the import dropdown.
function RailMenuItem({ icon: Icon, label, onClick }: {
  icon: typeof FolderOpen; label: string; onClick: () => void
}) {
  return (
    <DropdownMenu.Item
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
    >
      <Icon size={15} />
      {label}
    </DropdownMenu.Item>
  )
}

// ── Now-playing chip (bottom utility area) ──────────────────────────────────
// Expanded: artwork + title/artist row. Rail: artwork-only button. Both open
// the Now Playing view; the accent dot pulses while playing (still in
// Performance Mode).
function SidebarNowPlaying({ collapsed }: { collapsed: boolean }) {
  const currentSong = usePlayerStore((s) => s.currentSong)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  if (!currentSong) return null

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={collapsed ? 'pt-1.5 pb-0.5 flex justify-center' : 'px-2 pt-2 pb-1'}>
      <div
        className={collapsed
          ? 'flex items-center justify-center p-0.5 rounded-xl'
          : 'w-full flex items-center gap-2.5 p-1.5 rounded-[10px]'}
        style={{ background: collapsed ? 'transparent' : 'var(--glass-1)', border: collapsed ? undefined : '1px solid var(--border-subtle)' }}
        title={collapsed ? `${currentSong.title} — ${currentSong.artist}` : undefined}
      >
        <button
          onClick={() => setActiveView('nowplaying')}
          className="relative shrink-0"
          aria-label={collapsed ? `Now playing: ${currentSong.title}` : undefined}
        >
          {currentSong.coverArt
            ? <img src={currentSong.coverArt} alt="" className={collapsed ? 'w-10 h-10 rounded-xl object-cover' : 'w-9 h-9 rounded-lg object-cover'} />
            : <div className={collapsed ? 'w-10 h-10 rounded-xl overflow-hidden' : 'w-9 h-9 rounded-lg overflow-hidden'}>
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
