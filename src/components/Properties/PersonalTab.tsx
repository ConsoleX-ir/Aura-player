import { useEffect, useRef, useState } from 'react'
import { ImagePlus, RotateCcw, StickyNote, Check } from 'lucide-react'
import type { Song } from '@/types'
import { useArtworkStore } from '@/store/artworkStore'
import { useNotesStore } from '@/store/notesStore'
import { downscaleToCoverDataUrl, isImageFile } from '@/lib/imageTools'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'

// ── PersonalTab — Artwork & Notes (Aura 3.0 Wave 11) ────────────────────────
// The user-owned side of a track, in one place:
//
//   • CUSTOM ARTWORK (spec §15): choose an image → it is downscaled ONCE to
//     a bounded 512px JPEG in the renderer and stored as a local override
//     (artworkStore → its own IndexedDB key). Preview is instant; replace
//     re-runs the same path; Reset removes the override. The original audio
//     file and any provider metadata are NEVER modified — the override is a
//     presentation layer resolved at render time.
//   • TRACK NOTES (spec §17): a free-form note, autosaved (debounced 600ms),
//     removable, and searchable from the Library search (free text + the
//     note: operator — see lib/search).
//
// Both live in their OWN persisted stores, deliberately outside the main
// player snapshot — re-importing or removing files never touches them.

export function PersonalTab({ song }: { song: Song }) {
  const overrideUrl = useArtworkStore((s) => s.overrides[song.id]?.url ?? null)
  const setOverride = useArtworkStore((s) => s.setOverride)
  const removeOverride = useArtworkStore((s) => s.removeOverride)
  const note = useNotesStore((s) => s.notes[song.id])
  const setNote = useNotesStore((s) => s.setNote)

  // Local editor state + debounced autosave — typing stays instant, the
  // store (and IndexedDB) see complete sentences, not every keystroke.
  const [text, setText] = useState(note?.text ?? '')
  const [savedFlash, setSavedFlash] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const lastSavedRef = useRef(note?.text ?? '')

  useEffect(() => {
    // Song switch: re-sync the editor with the stored note.
    setText(note?.text ?? '')
    lastSavedRef.current = note?.text ?? ''
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id])

  useEffect(() => {
    if (text === lastSavedRef.current) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      setNote(song.id, text)
      lastSavedRef.current = text.trim()
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1200)
    }, 600)
    return () => window.clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  // Artwork file input — one hidden input, re-driveable for replace.
  const fileRef = useRef<HTMLInputElement>(null)
  const [artworkBusy, setArtworkBusy] = useState(false)
  const [artworkError, setArtworkError] = useState<string | null>(null)

  const onChooseFile = async (file: File | undefined) => {
    if (!file) return
    if (!isImageFile(file)) {
      setArtworkError('That file is not an image.')
      return
    }
    setArtworkBusy(true)
    setArtworkError(null)
    try {
      const dataUrl = await downscaleToCoverDataUrl(file)
      setOverride(song.id, dataUrl)
    } catch {
      setArtworkError('Could not read that image — try a different file.')
    } finally {
      setArtworkBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Custom artwork ──────────────────────────────────────────── */}
      <section
        className="p-5 rounded-2xl"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
        data-artwork-section
      >
        <div className="flex items-center gap-2 mb-4">
          <ImagePlus size={13} style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Custom Artwork</h3>
          {overrideUrl && (
            <span
              className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              Override active
            </span>
          )}
        </div>

        <div className="flex items-start gap-5">
          {/* Preview: override when present, else the track's own artwork */}
          <div
            className="w-28 h-28 rounded-xl overflow-hidden shrink-0"
            style={{ background: 'var(--glass-2)', border: overrideUrl ? '1.5px solid var(--accent-border)' : '1px solid var(--border-default)', boxShadow: 'var(--shadow-2)' }}
          >
            {(overrideUrl ?? song.coverArt)
              ? <img src={(overrideUrl ?? song.coverArt)!} alt="Track artwork preview" className="w-full h-full object-cover" />
              : <ArtworkPlaceholder seed={song.id} size="lg" />}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
              Pick any image and Aura will use it for this track everywhere — player bar,
              Now Playing, lists and the mini player. Images are resized to a compact
              512&nbsp;px cover and stored locally. Your audio files and their embedded
              metadata are never touched.
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onChooseFile(e.target.files?.[0])}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={artworkBusy}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium active:scale-95 transition-all disabled:opacity-50"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)', transitionDuration: 'var(--dur-fast)' }}
              >
                <ImagePlus size={12} />
                {artworkBusy ? 'Processing…' : overrideUrl ? 'Replace Image…' : 'Choose Image…'}
              </button>
              {overrideUrl && (
                <button
                  onClick={() => removeOverride(song.id)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium active:scale-95 transition-all"
                  style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', transitionDuration: 'var(--dur-fast)' }}
                >
                  <RotateCcw size={12} />
                  Reset to Original
                </button>
              )}
            </div>
            {artworkError && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--danger)' }}>{artworkError}</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Track note ──────────────────────────────────────────────── */}
      <section
        className="p-5 rounded-2xl"
        style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
        data-note-section
      >
        <div className="flex items-center gap-2 mb-3">
          <StickyNote size={13} style={{ color: 'var(--accent)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Track Note</h3>
          {savedFlash && (
            <span className="ml-auto flex items-center gap-1 text-[11px]" style={{ color: 'var(--success)' }}>
              <Check size={11} /> Saved
            </span>
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write anything about this track — a memory, a mood, where to use it. Notes are searchable from the Library search."
          rows={4}
          aria-label="Track note"
          className="w-full rounded-xl px-3.5 py-3 text-sm outline-none resize-y min-h-24"
          style={{
            background: 'var(--surface-inset)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            transitionDuration: 'var(--dur-fast)',
          }}
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Autosaves as you type · stored only on this device
          </p>
          {text && (
            <button
              onClick={() => { setText(''); setNote(song.id, '') }}
              className="text-[11px] transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
            >
              Clear note
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
