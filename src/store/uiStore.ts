import { create } from 'zustand'

// Small ephemeral UI state that outlives any single component but doesn't
// belong in playerStore (not playback data) and shouldn't be persisted.
interface UiState {
  helpOpen: boolean
  setHelpOpen: (v: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  helpOpen: false,
  setHelpOpen: (v) => set({ helpOpen: v }),
}))
