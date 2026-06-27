import { Minus, Square, X } from 'lucide-react'

export function TitleBar() {
  return (
    <div className="titlebar-drag h-9 flex items-center justify-between px-4 shrink-0 border-b border-[var(--color-border)] bg-black/20 backdrop-blur-xl">
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
      <div className="titlebar-no-drag flex items-center gap-0.5">
        <button onClick={() => window.electronAPI?.minimize()}
          className="w-6 h-6 rounded flex items-center justify-center text-white/20 hover:bg-white/5 hover:text-white/50 transition-all">
          <Minus size={10} />
        </button>
        <button onClick={() => window.electronAPI?.maximize()}
          className="w-6 h-6 rounded flex items-center justify-center text-white/20 hover:bg-white/5 hover:text-white/50 transition-all">
          <Square size={8} />
        </button>
        <button onClick={() => window.electronAPI?.close()}
          className="w-6 h-6 rounded flex items-center justify-center text-white/20 hover:bg-red-500/20 hover:text-red-400 transition-all">
          <X size={10} />
        </button>
      </div>
    </div>
  )
}
