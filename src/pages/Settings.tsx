import { useState } from 'react'
import { Trash2, Music2, ListMusic, Heart, Info, Palette, SlidersHorizontal } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { ConfirmModal } from '@/components/Modals/ConfirmModal'

export function Settings() {
  const {
    theme, setTheme,
    customAccentColor, setCustomAccentColor,
    performanceMode, setPerformanceMode,
    crossfade, setCrossfade,
    library, playlists, favorites,
    clearLibrary,
  } = usePlayerStore()

  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <div className="h-full overflow-y-auto px-7 py-6">
      <h1 className="text-xl font-semibold text-white/90 mb-6" style={{ fontFamily: 'var(--font-display)' }}>
        Settings
      </h1>

      <div className="max-w-2xl space-y-8">

        {/* ── Appearance ────────────────────────────────────────────────── */}
        <Section title="Appearance">
          <SettingRow
            label="Accent Theme"
            description="Default uses the built-in cloud gray. Custom lets you pick any color for the ambient glow."
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-[var(--color-glass)] border border-[var(--color-border)] rounded-xl p-1 gap-0.5">
                <button
                  onClick={() => setTheme('default')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${theme === 'default' ? 'bg-[var(--color-glass-strong)] text-white/90' : 'text-white/40 hover:text-white/70'}`}
                >
                  <Palette size={13} /> Default
                </button>
                <button
                  onClick={() => setTheme('custom')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${theme === 'custom' ? 'bg-[var(--color-glass-strong)] text-white/90' : 'text-white/40 hover:text-white/70'}`}
                >
                  <SlidersHorizontal size={13} /> Custom
                </button>
              </div>

              {theme === 'custom' && (
                <div className="relative">
                  <input
                    type="color"
                    value={customAccentColor}
                    onChange={(e) => setCustomAccentColor(e.target.value)}
                    className="w-8 h-8 rounded-lg border border-[var(--color-border)] cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
                  />
                </div>
              )}
            </div>
          </SettingRow>

          <SettingRow
            label="Performance Mode"
            description="Turns off background blur and decorative animations (spinning ring, glow pulses). Recommended on older or integrated GPUs."
          >
            <Toggle checked={performanceMode} onChange={setPerformanceMode} />
          </SettingRow>
        </Section>

        {/* ── Playback ──────────────────────────────────────────────────── */}
        <Section title="Playback">
          <SettingRow
            label="Crossfade"
            description="Smoothly blend the end of one song into the beginning of the next. Set to 0s to disable."
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={12}
                step={0.5}
                value={crossfade}
                onChange={(e) => setCrossfade(Number(e.target.value))}
                className="w-28 h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--color-dynamic-1) ${crossfade ? (crossfade / 12) * 100 : 0}%, rgba(255,255,255,0.12) ${crossfade ? (crossfade / 12) * 100 : 0}%)`,
                }}
              />
              <span className="text-xs text-white/50 tabular-nums w-8 text-right">
                {crossfade === 0 ? 'Off' : `${crossfade}s`}
              </span>
            </div>
          </SettingRow>
        </Section>

        {/* ── Library ───────────────────────────────────────────────────── */}
        <Section title="Library">
          <div className="grid grid-cols-3 gap-3 mb-5">
            <StatCard icon={Music2} value={library.length} label="Songs" />
            <StatCard icon={ListMusic} value={playlists.length} label="Playlists" />
            <StatCard icon={Heart} value={favorites.length} label="Favorites" />
          </div>

          <SettingRow
            label="Clear Library"
            description="Removes every song, playlist, and favorite from Aura. Files on your device are never touched."
          >
            <button
              onClick={() => setConfirmClear(true)}
              disabled={library.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm hover:bg-red-500/15 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 size={13} />
              Clear Library
            </button>
          </SettingRow>
        </Section>

        {/* ── About ─────────────────────────────────────────────────────── */}
        <Section title="About">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)]">
            <Info size={15} className="text-white/30 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-white/70 font-medium">Aura Player</p>
              <p className="text-xs text-white/30 mt-1">by ConsoleX · offline desktop music player</p>
            </div>
          </div>
        </Section>
      </div>

      <ConfirmModal
        open={confirmClear}
        title="Clear Library"
        description="This removes all songs, playlists, and favorites from Aura. Files on your device are not affected. This can't be undone."
        confirmLabel="Clear Everything"
        onConfirm={clearLibrary}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/25 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)]">
      <div className="min-w-0">
        <p className="text-sm text-white/80 font-medium">{label}</p>
        <p className="text-xs text-white/30 mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative w-11 h-6 rounded-full transition-colors shrink-0"
      style={{ background: checked ? 'var(--color-dynamic-1)' : 'rgba(255,255,255,0.12)' }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}

function StatCard({ icon: Icon, value, label }: { icon: typeof Music2; value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 p-4 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)]">
      <Icon size={16} className="text-white/30" />
      <span className="text-lg font-semibold text-white/85 tabular-nums">{value}</span>
      <span className="text-[10px] text-white/25 uppercase tracking-wider">{label}</span>
    </div>
  )
}