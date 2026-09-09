import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

  // v2.1.0: portal to <body>. The floating sidebar card carries a
  // backdrop-filter, which makes it the CSS containing block for every
  // fixed-position descendant — without the portal, this modal (mounted
  // inside the Sidebar) would be clipped into the card instead of covering
  // the whole window.
  return createPortal(
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
              /* v2.1.0 proportions: a one-field form doesn't need a 448px
                 ribbon — max-w-sm + trimmed padding balances the card. */
              className="
              w-full
              max-w-sm
              rounded-3xl
              border
              border-[var(--color-border-mid)]
              bg-[var(--color-base-2)]
              shadow-2xl
            "
            >
              {/* Header */}

              <div className="flex items-center justify-between p-5 pb-4 border-b border-[var(--color-border)]">
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
                      className="text-lg font-semibold text-ink"
                      style={{
                        fontFamily: 'var(--font-display)',
                      }}
                    >
                      {mode === 'create'
                        ? 'Create Playlist'
                        : 'Rename Playlist'}
                    </h2>

                    <p className="text-xs text-ink-ter mt-0.5">
                      {mode === 'create'
                        ? 'Create a new playlist.'
                        : 'Choose a new playlist name.'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="p-2 rounded-lg hover:bg-ink/5 transition"
                >
                  <X
                    size={16}
                    className="text-ink-ter"
                  />
                </button>
              </div>

              {/* Body */}

              <div className="p-6">
                <label className="block text-xs text-ink-ter mb-2">
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
                  text-ink
                  placeholder:text-ink-faint
                  outline-none
                  transition
                  ${error ? 'border-[var(--danger-border)] focus:border-[var(--danger)]' : 'border-[var(--color-border)] focus:border-[var(--color-dynamic-1)]'}
                `}
                />
                {error ? (
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--danger)' }}>
                    {error}
                  </p>
                ) : (
                  <p className="text-[11px] text-ink-faint mt-1.5 text-right tabular-nums">
                    {name.length}/60
                  </p>
                )}
              </div>

              {/* Footer */}

              <div className="flex justify-end gap-3 px-5 pb-5 pt-1">
                <button
                  onClick={onClose}
                  className="
                  px-4
                  py-2
                  rounded-xl
                  border
                  border-[var(--color-border)]
                  bg-[var(--color-glass)]
                  text-ink-sub
                  hover:text-ink
                  hover-surface
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
                  text-ink
                  disabled:opacity-40
                  transition
                  pressable
                "
                  style={{
                    background:
                      'var(--color-dynamic-1)',
                  }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.filter = 'brightness(1.12)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = '' }}
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
    </AnimatePresence>,
    document.body
  )
}