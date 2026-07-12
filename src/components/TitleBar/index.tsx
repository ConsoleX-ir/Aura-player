import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI?.isMaximized().then(setIsMaximized)
    // This subscription already existed on the preload/main side but nothing
    // in the renderer ever listened — the maximize button always showed the
    // same icon regardless of actual window state.
    const listener = (v: boolean) => setIsMaximized(v)
    window.electronAPI?.onMaximized(listener)
  }, [])

  return (
    <div className="titlebar-drag h-9 flex items-center justify-between px-4 shrink-0 border-b border-[var(--color-border)] bg-black/20 backdrop-blur-xl perf-blur">
      <div className="titlebar-no-drag flex items-center gap-2">
        {/* ConsoleX × Aura brand mark */}
        <div className="w-5 h-5 rounded-md bg-[var(--color-glass-strong)] border border-[var(--color-border-mid)] flex items-center justify-center">
          <div className="flex items-end gap-[1.5px] h-3">
            {[2, 3, 4, 3, 2].map((h, i) => (
              <div key={i} className="w-[2px] rounded-full bg-white/70" style={{ height: `${h * 3}px` }} />
            ))}
          </div>
        </div>
        <span className="text-[11px] font-semibold tracking-[0.15em] text-white/40 uppercase">Aura</span>
      </div>
      {/* Colored, always-visible (not just on hover) so each control is easy
          to pick out at a glance — amber/green/red mirrors the universal
          minimize/maximize/close convention. */}
      <div className="titlebar-no-drag flex items-center gap-1.5">
        <button onClick={() => window.electronAPI?.minimize()} title="Minimize"
          className="w-6 h-6 rounded-full flex items-center justify-center transition-all"
          style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.3)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.15)' }}
        >
          <Minus size={10} strokeWidth={2.5} />
        </button>
        <button onClick={() => window.electronAPI?.maximize()} title={isMaximized ? 'Restore' : 'Maximize'}
          className="w-6 h-6 rounded-full flex items-center justify-center transition-all"
          style={{ background: 'rgba(34,197,94,0.15)', color: '#22C55E' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(34,197,94,0.3)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(34,197,94,0.15)' }}
        >
          {isMaximized ? <Copy size={8} strokeWidth={2.5} /> : <Square size={8} strokeWidth={2.5} />}
        </button>
        <button onClick={() => window.electronAPI?.close()} title="Close"
          className="w-6 h-6 rounded-full flex items-center justify-center transition-all"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#EF4444' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.4)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)' }}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
