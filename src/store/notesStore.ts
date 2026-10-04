import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { TrackNote } from '../types'
import { desktopPrefsStorage } from '../lib/desktopPrefsStorage'

// ── Track Notes domain store (Aura 3.0 Wave 1/2) ────────────────────────────
// User-authored notes attached to library tracks. Persisted as its OWN
// IndexedDB key ('aura-notes') through the shared debounced idbStorage —
// deliberately NOT part of the main player snapshot, so:
//   • the library payload stays lean (notes are usually sparse),
//   • re-importing/removing files never touches note history (keyed by the
//     stable song id, which is a hash of the file path — re-adding the same
//     file restores its notes),
//   • the concept can evolve (richer formatting, pinned notes) independently.
// Search integration reads getNoteTexts() — see Wave 10/Search 3.0.

interface NotesState {
  notes: Record<string, TrackNote>
  /** Create or update the note for a track. Empty text removes the note. */
  setNote: (songId: string, text: string) => void
  removeNote: (songId: string) => void
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      notes: {},
      setNote: (songId, text) =>
        set((s) => {
          const trimmed = text.trim()
          if (!trimmed) {
            if (!(songId in s.notes)) return s
            const { [songId]: _drop, ...rest } = s.notes
            return { notes: rest }
          }
          return { notes: { ...s.notes, [songId]: { text: trimmed, updatedAt: Date.now() } } }
        }),
      removeNote: (songId) =>
        set((s) => {
          if (!(songId in s.notes)) return s
          const { [songId]: _drop, ...rest } = s.notes
          return { notes: rest }
        }),
    }),
    {
      name: 'aura-notes',
      storage: createJSONStorage(() => desktopPrefsStorage),
      partialize: (s) => ({ notes: s.notes }),
    },
  ),
)

/** All note texts, lowercase — consumed by search indexing without copying per keystroke. */
export function getNoteTexts(notes: Record<string, TrackNote>): { songId: string; text: string }[] {
  return Object.entries(notes).map(([songId, n]) => ({ songId, text: n.text.toLowerCase() }))
}
