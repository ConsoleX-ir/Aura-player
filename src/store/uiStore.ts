import { create } from 'zustand'
import type { AppView } from '@/types'
import { usePlayerStore } from '@/store/playerStore'

// Ephemeral UI state that outlives any single component but doesn't belong
// in playerStore (not playback data) and shouldn't be persisted.
interface UiState {
  helpOpen: boolean
  setHelpOpen: (v: boolean) => void

  // Command palette (Wave 4): opened with Ctrl+K from anywhere — navigation,
  // playback actions, playlist jumps, settings and queue ops in one spot.
  // Ephemeral by design.
  commandOpen: boolean
  setCommandOpen: (v: boolean) => void
  toggleCommand: () => void

  // Mini-player (v2.1.2): now the DESKTOP mini player — an independent,
  // freely draggable frameless BrowserWindow (see electron/main.cjs). This
  // flag mirrors the widget's real visibility: the P key / command palette /
  // pill button flip it through here, and main process events (minimize
  // auto-show, restore auto-hide, widget's own close button) sync it back
  // via onMiniVisibility in useMiniPlayerBridge. In non-Electron contexts
  // (plain browser, tests) toggling is a harmless local no-op.
  miniPlayer: boolean
  setMiniPlayer: (v: boolean) => void

  // Player-bar flyout panels (lyrics/visualizer/queue). Lifted from PlayerBar
  // local state in Wave 4 so keyboard shortcuts and the command palette can
  // open them too. panelAnchorX is the horizontal px the open panel centers
  // on — measured from the clicked icon; shortcut/palette opens keep the
  // last anchor (or default to centered-ish pill position).
  openPanel: 'lyrics' | 'visualizer' | 'queue' | null
  panelAnchorX: number
  setOpenPanel: (p: UiState['openPanel'], anchorX?: number) => void
  togglePanel: (p: Exclude<UiState['openPanel'], null>, anchorX?: number) => void

  // Properties page (Wave 3 UX upgrade — replaces the old modal): which song
  // it renders, whether it opens straight on the "Find Info Online" section,
  // and the view to restore on close. Ephemeral by design: the page is a
  // navigation destination, not app state — nothing to persist.
  propertiesSongId: string | null
  propertiesInitialFind: boolean
  propertiesReturnView: AppView
  openProperties: (songId: string, opts?: { initialFind?: boolean }) => void
  closeProperties: () => void

  // ── Library search text (Phase 2 — Search & Navigation 2.0) ──────────
  // Lives here instead of Library-local useState so OTHER surfaces can drive
  // it: the command palette's "Search library for …" row pre-fills it and
  // jumps to the Library. Still ephemeral (uiStore is not persisted) — a
  // search is a moment, not a preference.
  librarySearch: string
  setLibrarySearch: (q: string) => void
}

export const useUiStore = create<UiState>()((set, get) => ({
  helpOpen: false,
  setHelpOpen: (v) => set({ helpOpen: v }),

  commandOpen: false,
  setCommandOpen: (v) => set({ commandOpen: v }),
  toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),

  miniPlayer: false,
  setMiniPlayer: (v) => {
    set({ miniPlayer: v })
    // Show/hide the real desktop window. Main broadcasts the authoritative
    // visibility back on every actual change (see useMiniPlayerBridge), so a
    // missed IPC or a double-toggle self-corrects instead of desyncing.
    try { window.electronAPI?.setMiniVisible?.(v) } catch { /* non-Electron */ }
  },

  openPanel: null,
  panelAnchorX: 0,
  setOpenPanel: (p, anchorX) => set((s) => ({ openPanel: p, panelAnchorX: anchorX ?? s.panelAnchorX })),
  togglePanel: (p, anchorX) => set((s) => ({
    openPanel: s.openPanel === p ? null : p,
    panelAnchorX: anchorX ?? s.panelAnchorX,
  })),

  propertiesSongId: null,
  propertiesInitialFind: false,
  propertiesReturnView: 'library',
  openProperties: (songId, opts) => {
    set({
      propertiesSongId: songId,
      propertiesInitialFind: !!opts?.initialFind,
      propertiesReturnView: usePlayerStore.getState().activeView === 'properties'
        ? get().propertiesReturnView // already on the page — keep the original return target
        : usePlayerStore.getState().activeView,
    })
    usePlayerStore.getState().setActiveView('properties')
  },
  closeProperties: () => {
    const back = get().propertiesReturnView
    set({ propertiesSongId: null, propertiesInitialFind: false })
    // Guard against landing on a dead view if the song's source view no
    // longer makes sense — favorites/playlist are always valid AppViews.
    usePlayerStore.getState().setActiveView(back === 'properties' ? 'library' : back)
  },

  librarySearch: '',
  setLibrarySearch: (q) => set({ librarySearch: q }),
}))