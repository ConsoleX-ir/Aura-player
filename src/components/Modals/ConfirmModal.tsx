import { useEffect } from 'react'
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
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl border border-[var(--color-border-mid)] bg-[var(--color-base-2)] shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{
                      background: destructive ? 'rgba(248,113,113,0.12)' : 'var(--color-glass-mid)',
                    }}
                  >
                    <AlertTriangle
                      size={18}
                      className={destructive ? 'text-red-400' : 'text-white/70'}
                    />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white/90" style={{ fontFamily: 'var(--font-display)' }}>
                      {title}
                    </h2>
                    <p className="text-xs text-white/35 mt-0.5 max-w-[280px]">{description}</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 transition shrink-0">
                  <X size={16} className="text-white/35" />
                </button>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 p-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass)] text-white/60 hover:text-white transition"
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-5 py-2 rounded-xl text-white transition"
                  style={{
                    background: destructive ? '#ef4444' : 'var(--color-dynamic-1)',
                  }}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
