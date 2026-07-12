import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ListPlus, Music2, Search, X, Check } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { formatTime } from '@/lib/utils'
import type { Playlist, Song } from '@/types'

interface AddSongsModalProps {
  open: boolean
  playlist: Playlist | null
  onClose: () => void
}

// Lets the user multi-select songs from the whole library and add them to a
// playlist in one go. Complements the existing per-song "Add to {playlist}"
// action in SongRow's dropdown, which only ever adds one song at a time.
export function AddSongsModal({ open, playlist, onClose }: AddSongsModalProps) {
  const library = usePlayerStore((s) => s.library)
  const addToPlaylist = usePlayerStore((s) => s.addToPlaylist)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setSearch('')
    setSelected(new Set())
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [open, playlist?.id])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const existingIds = useMemo(() => new Set(playlist?.songIds ?? []), [playlist])

  const results = useMemo(() => {
    let src = library
    if (search.trim()) {
      const q = search.toLowerCase()
      src = src.filter((s) =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.album.toLowerCase().includes(q)
      )
    }
    return src
  }, [library, search])

  const toggle = (songId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(songId)) next.delete(songId)
      else next.add(songId)
      return next
    })
  }

  const handleAdd = () => {
    if (!playlist || selected.size === 0) return
    // addToPlaylist already guards against duplicates internally, but skipping
    // songs already in the playlist here keeps the "N selected" count honest.
    for (const songId of selected) {
      if (!existingIds.has(songId)) addToPlaylist(playlist.id, songId)
    }
    onClose()
  }

  if (!playlist) return null

  return (
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
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-3xl border border-[var(--color-border-mid)] bg-[var(--color-base-2)] shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 pb-4 border-b border-[var(--color-border)] shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-11 h-11 rounded-xl bg-[var(--color-glass-mid)] flex items-center justify-center shrink-0"
                    style={{ boxShadow: '0 0 20px var(--color-dynamic-3)' }}
                  >
                    <ListPlus size={18} style={{ color: 'var(--color-dynamic-1)' }} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white/90 truncate" style={{ fontFamily: 'var(--font-display)' }}>
                      Add Songs
                    </h2>
                    <p className="text-xs text-white/35 mt-0.5 truncate">to "{playlist.name}"</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 transition shrink-0">
                  <X size={16} className="text-white/35" />
                </button>
              </div>

              {/* Search */}
              <div className="px-6 pt-4 pb-3 shrink-0">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
                  <input
                    ref={searchRef}
                    type="text"
                    placeholder="Search your library..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)] text-sm text-white/80 placeholder:text-white/20 outline-none focus:border-[var(--color-dynamic-1)] transition-all"
                  />
                </div>
              </div>

              {/* Song list */}
              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
                {results.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 gap-2">
                    <Music2 size={22} className="text-white/10" />
                    <p className="text-xs text-white/25">
                      {library.length === 0 ? 'Your library is empty' : `No results for "${search}"`}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {results.map((song) => (
                      <SongPickRow
                        key={song.id}
                        song={song}
                        alreadyInPlaylist={existingIds.has(song.id)}
                        selected={selected.has(song.id)}
                        onToggle={() => toggle(song.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 p-6 pt-4 border-t border-[var(--color-border)] shrink-0">
                <p className="text-xs text-white/30 tabular-nums">
                  {selected.size} {selected.size === 1 ? 'song' : 'songs'} selected
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] text-white/60 hover:text-white transition"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={selected.size === 0}
                    onClick={handleAdd}
                    className="px-5 py-2 rounded-xl text-white disabled:opacity-40 transition"
                    style={{ background: 'var(--color-dynamic-1)' }}
                  >
                    Add {selected.size > 0 ? selected.size : ''}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function SongPickRow({
  song,
  alreadyInPlaylist,
  selected,
  onToggle,
}: {
  song: Song
  alreadyInPlaylist: boolean
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      disabled={alreadyInPlaylist}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors duration-100 ${
        alreadyInPlaylist ? 'opacity-30 cursor-not-allowed' : 'hover:bg-white/[0.03]'
      }`}
    >
      {/* Checkbox */}
      <div
        className="w-4.5 h-4.5 rounded-md border flex items-center justify-center shrink-0 transition-all"
        style={{
          borderColor: selected ? 'var(--color-dynamic-1)' : 'var(--color-border-mid)',
          background: selected ? 'var(--color-dynamic-1)' : 'transparent',
          width: '18px',
          height: '18px',
        }}
      >
        {selected && <Check size={12} className="text-black/80" strokeWidth={3} />}
      </div>

      {/* Cover art */}
      <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden">
        {song.coverArt ? (
          <img src={song.coverArt} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full bg-[var(--color-glass-mid)] flex items-center justify-center">
            <Music2 size={12} className="text-white/20" />
          </div>
        )}
      </div>

      {/* Title / artist */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/80 truncate">{song.title}</p>
        <p className="text-xs text-white/30 truncate">{song.artist}</p>
      </div>

      {alreadyInPlaylist ? (
        <span className="text-[10px] text-white/20 shrink-0">Added</span>
      ) : (
        <span className="text-xs text-white/20 tabular-nums shrink-0">{formatTime(song.duration)}</span>
      )}
    </button>
  )
}
