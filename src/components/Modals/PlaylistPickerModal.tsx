import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ListMusic, Search, X } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { toast } from '@/store/toastStore'

interface PlaylistPickerModalProps {
  open: boolean
  /** Song being added — used for the subtitle and the add action. */
  songTitle: string
  songId: string
  onClose: () => void
}

// ── Playlist picker (v2.1.2) ─────────────────────────────────────────────────
// The song `...` menu used to inline EVERY playlist as a dropdown item, so a
// 100-playlist library produced a menu taller than the screen. This modal is
// the scalable replacement: a searchable, scrollable list that stays the same
// size no matter how many playlists exist — and every playlist remains
// reachable (search filters, nothing is capped).
//
// Keyboard: arrows move the selection, Enter adds the selection, Escape
// closes — mirroring the command palette's interaction language.
export function PlaylistPickerModal({ open, songTitle, songId, onClose }: PlaylistPickerModalProps) {
  const playlists = usePlayerStore((s) => s.playlists)
  const addToPlaylist = usePlayerStore((s) => s.addToPlaylist)

  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Case-insensitive substring match over playlist names — same forgiving
  // rule the Library search uses. Stable order (creation order) so arrow-key
  // navigation doesn't shuffle under the cursor while typing.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return playlists
    return playlists.filter((p) => p.name.toLowerCase().includes(q))
  }, [playlists, query])

  // Reset per open: fresh query, selection on the first row, input focused.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlight(0)
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  // Keep the highlighted row in view during arrow navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-highlighted="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight((h) => Math.min(h + 1, filtered.length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((h) => Math.max(h - 1, 0))
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const pl = filtered[highlight]
        if (pl) pick(pl.id, pl.name)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, filtered, highlight, onClose])

  const pick = (playlistId: string, playlistName: string) => {
    addToPlaylist(playlistId, songId)
    toast({
      kind: 'added-to-playlist',
      title: 'Added to Playlist',
      subtitle: `${songTitle} → ${playlistName}`,
    })
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
          >
            <div
              data-picker-modal
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-3xl border border-[var(--color-border-mid)] bg-[var(--color-base-2)] shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 pb-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-11 h-11 rounded-xl bg-[var(--color-glass-mid)] flex items-center justify-center shrink-0"
                    style={{ boxShadow: '0 0 20px var(--color-dynamic-3)' }}
                  >
                    <ListMusic size={18} style={{ color: 'var(--color-dynamic-1)' }} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-ink" style={{ fontFamily: 'var(--font-display)' }}>
                      Add to Playlist
                    </h2>
                    <p className="text-xs text-ink-ter mt-0.5 truncate">{songTitle}</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-ink/5 transition shrink-0" aria-label="Close">
                  <X size={16} className="text-ink-ter" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 pt-4 pb-2">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setHighlight(0) }}
                    placeholder="Search playlists..."
                    maxLength={80}
                    className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] pl-8 pr-3 py-2.5 text-sm text-ink placeholder:text-ink-faint outline-none transition focus:border-[var(--color-dynamic-1)]"
                  />
                </div>
              </div>

              {/* List — bounded height, scrolls; scales to any playlist count */}
              <div ref={listRef} className="px-3 pb-3 max-h-64 overflow-y-auto">
                {filtered.length === 0 ? (
                  playlists.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-ink-sub">No playlists yet</p>
                      <p className="text-xs text-ink-faint mt-1">Create one from the sidebar, then try again.</p>
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-ink-sub">No matches for "{query.trim()}"</p>
                      <p className="text-xs text-ink-faint mt-1">Try a shorter search.</p>
                    </div>
                  )
                ) : (
                  filtered.map((pl, i) => {
                    const count = pl.songIds.length
                    return (
                      <button
                        key={pl.id}
                        data-highlighted={i === highlight}
                        onClick={() => pick(pl.id, pl.name)}
                        onMouseEnter={() => setHighlight(i)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors playlist-picker-row"
                      >
                        <span className="w-8 h-8 rounded-lg bg-[var(--color-glass-mid)] flex items-center justify-center shrink-0">
                          <ListMusic size={13} className="text-ink-sub" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-ink truncate">{pl.name}</span>
                          <span className="block text-[11px] text-ink-faint tabular-nums">
                            {count} {count === 1 ? 'song' : 'songs'}
                          </span>
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
