import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X, Keyboard } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const setHelpOpen = useUiStore((s) => s.setHelpOpen)

  useEffect(() => {
    window.electronAPI?.isMaximized().then(setIsMaximized)
    // This subscription already existed on the preload/main side but nothing
    // in the renderer ever listened — the maximize button always showed the
    // same icon regardless of actual window state.
    const listener = (v: boolean) => setIsMaximized(v)
    window.electronAPI?.onMaximized(listener)
  }, [])

  return (
    <div className="titlebar-drag h-9 flex items-center justify-between px-4 shrink-0 perf-blur"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--surface-raised) 55%, transparent)',
        backdropFilter: 'blur(var(--blur-glass))',
      }}
    >
      <div className="titlebar-no-drag flex items-center gap-2">
        {/* Aura brand mark — the equalizer glyph, wearing the live accent */}
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: 'var(--glass-3)', border: '1px solid var(--border-strong)' }}
        >
          <div className="flex items-end gap-[1.5px] h-3">
            {[2, 3, 4, 3, 2].map((h, i) => (
              <div key={i} className="w-[2px] rounded-full" style={{ height: h * 3, background: 'var(--text-primary)', opacity: 0.7 }} />
            ))}
          </div>
        </div>
        <span
          className="text-[11px] font-semibold uppercase"
          style={{ color: 'var(--text-tertiary)', letterSpacing: 'var(--tracking-caps)' }}
        >
          Aura
        </span>
      </div>
      {/* Colored, always-visible (not just on hover) so each control is easy
          to pick out at a glance — amber/green/red mirrors the universal
          minimize/maximize/close convention. Hues come from the token layer
          so they follow the design system (and any future theme remap). */}
      <div className="titlebar-no-drag flex items-center gap-1.5">
        {/* Shortcuts guide — discoverable entry point for everything the
            keyboard can do ("?" opens it too). Kept here, top-right where
            first-time eyes land, rather than buried in Settings. */}
        <TitleBarButton
          onClick={() => setHelpOpen(true)}
          title="Keyboard shortcuts (?)"
          ariaLabel="Keyboard shortcuts"
          color="var(--text-secondary)"
          veil="var(--glass-2)"
          hoverVeil="var(--glass-3)"
          hoverColor="var(--text-primary)"
        >
          <Keyboard size={11} strokeWidth={2.2} />
        </TitleBarButton>
        <TitleBarButton
          onClick={() => window.electronAPI?.minimize()}
          title="Minimize"
          color="var(--warning)"
          veil="var(--warning-veil)"
          hoverVeil="color-mix(in srgb, var(--warning) 30%, transparent)"
          hoverColor="var(--warning)"
        >
          <Minus size={10} strokeWidth={2.5} />
        </TitleBarButton>
        <TitleBarButton
          onClick={() => window.electronAPI?.maximize()}
          title={isMaximized ? 'Restore' : 'Maximize'}
          color="var(--success)"
          veil="var(--success-veil)"
          hoverVeil="color-mix(in srgb, var(--success) 30%, transparent)"
          hoverColor="var(--success)"
        >
          {isMaximized ? <Copy size={8} strokeWidth={2.5} /> : <Square size={8} strokeWidth={2.5} />}
        </TitleBarButton>
        <TitleBarButton
          onClick={() => window.electronAPI?.close()}
          title="Close"
          color="var(--danger)"
          veil="var(--danger-veil)"
          hoverVeil="color-mix(in srgb, var(--danger) 40%, transparent)"
          hoverColor="var(--danger)"
        >
          <X size={10} strokeWidth={2.5} />
        </TitleBarButton>
      </div>
    </div>
  )
}

/* One traffic-light button implementation instead of four copies of the
   same inline onMouseEnter/Leave styling — colors come in as tokens. */
function TitleBarButton({ children, onClick, title, ariaLabel, color, veil, hoverVeil, hoverColor }: {
  children: React.ReactNode
  onClick: () => void
  title: string
  ariaLabel?: string
  color: string
  veil: string
  hoverVeil: string
  hoverColor: string
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="w-6 h-6 rounded-full flex items-center justify-center transition-all"
      style={{
        background: hover ? hoverVeil : veil,
        color: hover ? hoverColor : color,
        transitionDuration: 'var(--dur-instant)',
      }}
    >
      {children}
    </button>
  )
}
