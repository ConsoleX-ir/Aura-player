import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ListMusic, X } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import type { Playlist } from '@/types'

interface PlaylistModalProps {
  open: boolean
  mode: 'create' | 'rename'
  playlist?: Playlist
  onClose: () => void
}

export function PlaylistModal({
  open,
  mode,
  playlist,
  onClose,
}: PlaylistModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createPlaylist = usePlayerStore((s) => s.createPlaylist)
  const renamePlaylist = usePlayerStore((s) => s.renamePlaylist)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const setSelectedPlaylistId = usePlayerStore(
    (s) => s.setSelectedPlaylistId
  )

  useEffect(() => {
    if (!open) return

    setName(mode === 'rename' ? playlist?.name ?? '' : '')
    setError(null)

    setTimeout(() => {
      inputRef.current?.focus()

      if (mode === 'rename') {
        inputRef.current?.select()
      }
    }, 50)
  }, [open, mode, playlist])

useEffect(() => {
  if (!open) return

  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()

    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  window.addEventListener('keydown', handler)

  return () => window.removeEventListener('keydown', handler)
}, [open, name, mode, playlist, onClose])

  const handleSubmit = () => {
    const value = name.trim()

    if (!value) return

    if (mode === 'create') {
      const id = createPlaylist(value)

      if (!id) {
        setError(`A playlist named "${value}" already exists.`)
        return
      }

      setSelectedPlaylistId(id)
      setActiveView('playlist')
    } else {
      if (!playlist) return

      const ok = renamePlaylist(playlist.id, value)

      if (!ok) {
        setError(`A playlist named "${value}" already exists.`)
        return
      }
    }

    setName('')
    setError(null)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}

          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal */}

          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{
              type: 'spring',
              stiffness: 350,
              damping: 28,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="
              w-full
              max-w-md
              rounded-3xl
              border
              border-[var(--color-border-mid)]
              bg-[var(--color-base-2)]
              shadow-2xl
            "
            >
              {/* Header */}

              <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-xl bg-[var(--color-glass-mid)] flex items-center justify-center"
                    style={{ boxShadow: '0 0 20px var(--color-dynamic-3)' }}
                  >
                    <ListMusic
                      size={18}
                      style={{ color: 'var(--color-dynamic-1)' }}
                    />
                  </div>

                  <div>
                    <h2
                      className="text-lg font-semibold text-white/90"
                      style={{
                        fontFamily: 'var(--font-display)',
                      }}
                    >
                      {mode === 'create'
                        ? 'Create Playlist'
                        : 'Rename Playlist'}
                    </h2>

                    <p className="text-xs text-white/35 mt-0.5">
                      {mode === 'create'
                        ? 'Create a new playlist.'
                        : 'Choose a new playlist name.'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-white/5 transition"
                >
                  <X
                    size={16}
                    className="text-white/35"
                  />
                </button>
              </div>

              {/* Body */}

              <div className="p-6">
                <label className="block text-xs text-white/35 mb-2">
                  Playlist Name
                </label>

                <input
                  ref={inputRef}
                  value={name}
                  maxLength={60}
                  onChange={(e) => {
                    setName(e.target.value)
                    setError(null)
                  }}
                  placeholder="My Playlist..."
                  className={`
                  w-full
                  rounded-xl
                  border
                  bg-[var(--color-glass)]
                  px-4
                  py-3
                  text-white/90
                  placeholder:text-white/25
                  outline-none
                  transition
                  ${error ? 'border-red-500/50 focus:border-red-500/70' : 'border-[var(--color-border)] focus:border-[var(--color-dynamic-1)]'}
                `}
                />
                {error ? (
                  <p className="text-[11px] text-red-400 mt-1.5">
                    {error}
                  </p>
                ) : (
                  <p className="text-[11px] text-white/20 mt-1.5 text-right tabular-nums">
                    {name.length}/60
                  </p>
                )}
              </div>

              {/* Footer */}

              <div className="flex justify-end gap-3 px-6 pb-6">
                <button
                  onClick={onClose}
                  className="
                  px-4
                  py-2
                  rounded-xl
                  border
                  border-[var(--color-border)]
                  bg-[var(--color-glass)]
                  text-white/60
                  hover:text-white
                  transition
                "
                >
                  Cancel
                </button>

                <button
                  disabled={!name.trim()}
                  onClick={handleSubmit}
                  className="
                  px-5
                  py-2
                  rounded-xl
                  text-white
                  disabled:opacity-40
                  transition
                "
                  style={{
                    background:
                      'var(--color-dynamic-1)',
                  }}
                >
                  {mode === 'create'
                    ? 'Create'
                    : 'Save'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}