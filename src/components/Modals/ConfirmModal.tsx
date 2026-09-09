import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmModalProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red destructive styling vs neutral accent styling. Defaults to true since
   *  this component exists specifically for delete/remove confirmations. */
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
        onClose()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onConfirm, onClose])

  const handleConfirm = () => {
    onConfirm()
    onClose()
  }

  // v2.1.0: portal to <body> — same containing-block reasoning as
  // PlaylistModal (backdrop-filter ancestors would trap the fixed overlay).
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
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              /* v2.1.0 proportions: a confirm dialog is a short question —
                 max-w-sm + tighter padding balances width against its natural
                 height instead of reading as a stretched ribbon. */
              className="w-full max-w-sm rounded-3xl"
              style={{
                background: 'var(--surface-raised)',
                border: '1px solid var(--border-strong)',
                boxShadow: 'var(--shadow-3)',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-5 pb-4" style={{ borderBottom: '1px solid var(--border-default)' }}>
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{
                      background: destructive ? 'var(--danger-veil)' : 'var(--glass-2)',
                    }}
                  >
                    <AlertTriangle
                      size={18}
                      style={{ color: destructive ? 'var(--danger)' : 'var(--text-secondary)' }}
                    />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                      {title}
                    </h2>
                    <p className="text-xs mt-0.5 max-w-[240px]" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="p-2 rounded-lg icon-hover transition shrink-0"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 px-5 pb-5 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl transition-all hover-surface"
                  style={{ border: '1px solid var(--border-default)', background: 'var(--glass-1)', color: 'var(--text-secondary)', transitionDuration: 'var(--dur-fast)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={handleConfirm}
                  /* v2.1.0 hover: the destructive/primary action now responds
                     (brightness + press) instead of sitting flat under the mouse */
                  className="px-5 py-2 rounded-xl pressable transition-all"
                  style={{
                    background: destructive ? 'var(--danger)' : 'var(--accent)',
                    color: 'var(--text-on-accent)',
                    transitionDuration: 'var(--dur-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.12)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = '' }}
                >
                  {confirmLabel}
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
