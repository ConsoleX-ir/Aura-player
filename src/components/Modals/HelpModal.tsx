import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Keyboard } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

// ── Keyboard Shortcuts — the in-app cheat sheet ─────────────────────────────
// Opened from the keyboard icon in the TitleBar or with "?" anywhere.
// Esc and clicking the backdrop both close it. Global "?" handling lives here
// rather than in useMediaShortcuts so the guide opens even when nothing is
// playing (those shortcuts only activate once a song is loaded).

interface ShortcutRow {
  label: string
  /** Individual keycaps to render, e.g. ['Ctrl', '← / →']. */
  keys?: string[]
  /** Short right-side note for rows driven by something other than keycaps. */
  hint?: string
}

const SECTIONS: { title: string; rows: ShortcutRow[] }[] = [
  {
    title: 'Playback',
    rows: [
      { label: 'Play / Pause',                    keys: ['Space'] },
      { label: 'Next / Previous song',            keys: ['→', '←'] },
      { label: 'Seek backward / forward 5s',      keys: ['Ctrl', '← / →'] },
      { label: 'Volume up / down by 5%',          keys: ['↑', '↓'] },
      { label: 'Mute / Unmute',                   keys: ['M'] },
    ],
  },
  {
    title: 'Toggles',
    rows: [
      { label: 'Add current song to Favorites',   keys: ['L'] },
      { label: 'Shuffle on / off',                keys: ['S'] },
      { label: 'Repeat: Off → All → One',         keys: ['R'] },
      { label: 'Open Lyrics & Visualizer panels', hint: 'play bar toggles' },
    ],
  },
  {
    title: 'General',
    rows: [
      { label: 'Toggle this shortcuts guide',       keys: ['?'] },
      { label: 'Close panels & dialogs',          keys: ['Esc'] },
      { label: 'Play / pause, next & previous from hardware media keys', hint: 'system-wide' },
      { label: 'Scroll over the volume control · click the seek bar to jump', hint: 'mouse' },
    ],
  },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-md border border-[var(--color-border-mid)] bg-[var(--color-glass-mid)] text-[10.5px] font-semibold text-white/65 shadow-[0_1.5px_0_rgba(0,0,0,0.45)]"
      style={{ fontFamily: 'inherit' }}
    >
      {children}
    </kbd>
  )
}

export function HelpModal() {
  const open = useUiStore((s) => s.helpOpen)
  const setOpen = useUiStore((s) => s.setHelpOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (!open) {
        // "?" or plain "/" opens. Skip when typing so text inputs keep their slash.
        if (!typing && (e.key === '?' || (e.code === 'Slash' && !e.ctrlKey && !e.altKey && !e.metaKey))) {
          e.preventDefault()
          setOpen(true)
        }
        return
      }
      // Close with Escape or ?
      if (e.key === 'Escape' || e.key === '?' || (e.code === 'Slash' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault()
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[210] bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />

          <motion.div
            className="fixed inset-0 z-[220] flex items-center justify-center p-6 pointer-events-none"
            initial={{ opacity: 0, scale: 0.96, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 18 }}
            transition={{ type: 'spring', stiffness: 350, damping: 28 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto w-full max-w-lg max-h-[86vh] overflow-y-auto rounded-3xl border border-[var(--color-border-mid)] bg-[var(--color-base-2)] shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-6 pb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ background: 'color-mix(in srgb, var(--color-dynamic-1) 14%, transparent)' }}
                  >
                    <Keyboard size={18} style={{ color: 'var(--color-dynamic-1)' }} />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white/90" style={{ fontFamily: 'var(--font-display)' }}>
                      Keyboard Shortcuts
                    </h2>
                    <p className="text-xs text-white/35 mt-0.5">Drive Aura without leaving home row</p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="p-2 rounded-lg hover:bg-white/5 transition shrink-0" aria-label="Close shortcuts guide">
                  <X size={16} className="text-white/35" />
                </button>
              </div>

              {/* Sections */}
              <div className="px-6 pb-6 space-y-5">
                {SECTIONS.map((section) => (
                  <section key={section.title}>
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/25 mb-2">
                      {section.title}
                    </h3>
                    <div className="rounded-2xl border border-[var(--color-border)] overflow-hidden divide-y divide-[var(--color-border)] bg-[var(--color-glass)]">
                      {section.rows.map((row) => (
                        <div key={row.label} className="flex items-center gap-4 px-4 py-2.5">
                          <p className="flex-1 text-[12.5px] text-white/60 leading-snug">{row.label}</p>
                          {(row.keys?.length ?? 0) > 0 && (
                            <div className="flex items-center gap-1 shrink-0">
                              {row.keys!.map((k) => <Kbd key={k}>{k}</Kbd>)}
                            </div>
                          )}
                          {(row.keys?.length ?? 0) === 0 && (
                            <span className="text-[11px] text-white/25 shrink-0">{row.hint}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}

                {/* Footer hint */}
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)]">
                  <p className="text-[11px] text-white/35 leading-relaxed">
                    Press <Kbd>?</Kbd> to toggle this guide. Shortcut hints also appear in button tooltips across the app.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
