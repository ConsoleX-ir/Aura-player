import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UserPrefs } from '../types'
import { desktopPrefsStorage } from '../lib/desktopPrefsStorage'

// ── User Preferences domain store (Aura 3.0 Wave 1/2) ───────────────────────
// Small, local-only preferences that are about the USER (not playback):
// the display username from the first-launch flow, onboarding completion,
// and the "set as default player" choice. Persisted as 'aura-prefs'.
//
// Hard rules (spec §13/§14): the username is optional, editable in Settings,
// NEVER treated as an account, and NEVER sent to any external service. The
// default-player prompt is shown at most once — dismissal is permanent.

export const DEFAULT_USER_PREFS: UserPrefs = {
  username: '',
  onboarded: false,
  defaultAppPromptDismissed: false,
}

interface UserPrefsState extends UserPrefs {
  setUserPrefs: (patch: Partial<UserPrefs>) => void
  /** One-shot helper for the onboarding flow: set name + mark done together. */
  completeOnboarding: (username: string) => void
}

export const useUserPrefsStore = create<UserPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULT_USER_PREFS,
      setUserPrefs: (patch) => set(patch),
      completeOnboarding: (username) =>
        set({ username: username.trim(), onboarded: true }),
    }),
    {
      name: 'aura-prefs',
      storage: createJSONStorage(() => desktopPrefsStorage),
      partialize: (s) => ({
        username: s.username,
        onboarded: s.onboarded,
        defaultAppPromptDismissed: s.defaultAppPromptDismissed,
      }),
    },
  ),
)
