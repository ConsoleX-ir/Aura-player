import { useState } from 'react'
import { Trash2, Music2, ListMusic, Heart, Info, SlidersHorizontal, RefreshCw, Check, Palette, TreePine, Waves, Sunset, Gem, Flame } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { ConfirmModal } from '@/components/Modals/ConfirmModal'
import { useLibrarySync } from '@/hooks/useLibrarySync'
import { THEME_PRESETS } from '@/lib/themePresets'

// UI-only concern, kept out of the shared themePresets.ts registry so that
// file (also used by useDynamicTheme.ts, which has no business importing an
// icon library) stays free of any UI dependency.
const THEME_ICONS: Record<string, typeof Palette> = {
  default:  Palette,
  forest:   TreePine,
  ocean:    Waves,
  sunset:   Sunset,
  amethyst: Gem,
  crimson:  Flame,
}

export function Settings() {
  // Narrow selectors — Settings has nothing to do with playback progress,
  // but was previously re-rendering on every tick while left open.
  const theme = usePlayerStore((s) => s.theme)
  const setTheme = usePlayerStore((s) => s.setTheme)
  const customAccentColor = usePlayerStore((s) => s.customAccentColor)
  const setCustomAccentColor = usePlayerStore((s) => s.setCustomAccentColor)
  const performanceMode = usePlayerStore((s) => s.performanceMode)
  const setPerformanceMode = usePlayerStore((s) => s.setPerformanceMode)
  const crossfade = usePlayerStore((s) => s.crossfade)
  const setCrossfade = usePlayerStore((s) => s.setCrossfade)
  const libraryCount = usePlayerStore((s) => s.library.length)
  const playlistsCount = usePlayerStore((s) => s.playlists.length)
  const favoritesCount = usePlayerStore((s) => s.favorites.length)
  const clearLibrary = usePlayerStore((s) => s.clearLibrary)

  const { syncAll, syncing, progress, lastResult, folderCount } = useLibrarySync()

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
            label="Theme"
            description="Pick a built-in palette, or go Custom for any accent color you like."
          >
            <div className="flex items-center gap-2 flex-wrap justify-end max-w-[360px]">
              {THEME_PRESETS.map((p) => (
                <ThemeButton
                  key={p.id}
                  color={p.color}
                  label={p.label}
                  icon={THEME_ICONS[p.id] ?? Palette}
                  active={theme === p.id}
                  onClick={() => setTheme(p.id)}
                />
              ))}
              <ThemeButton
                color={customAccentColor}
                label="Custom"
                icon={SlidersHorizontal}
                active={theme === 'custom'}
                onClick={() => setTheme('custom')}
              />
              {theme === 'custom' && (
                <input
                  type="color"
                  value={customAccentColor}
                  onChange={(e) => setCustomAccentColor(e.target.value)}
                  className="w-8 h-8 rounded-lg border border-[var(--color-border)] cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
                />
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
            <StatCard icon={Music2} value={libraryCount} label="Songs" />
            <StatCard icon={ListMusic} value={playlistsCount} label="Playlists" />
            <StatCard icon={Heart} value={favoritesCount} label="Favorites" />
          </div>

          <SettingRow
            label="Sync Library"
            description={
              folderCount === 0
                ? 'Import a folder first — sync re-scans folders you\'ve already added for new, removed, or changed songs.'
                : `Re-scans your ${folderCount} imported ${folderCount === 1 ? 'folder' : 'folders'} for new, removed, or changed songs.`
            }
          >
            <div className="flex items-center gap-2">
              {lastResult && !syncing && (
                <span className="text-xs text-white/30 flex items-center gap-1">
                  <Check size={12} className="text-emerald-400" />
                  +{lastResult.added} · −{lastResult.removed} · ~{lastResult.updated}
                </span>
              )}
              <button
                onClick={syncAll}
                disabled={syncing || folderCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)] text-white/60 text-sm hover:text-white/90 hover:bg-[var(--color-glass-mid)] active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                {syncing ? (progress.total ? `${progress.done}/${progress.total}` : 'Scanning...') : 'Sync Now'}
              </button>
            </div>
          </SettingRow>

          <SettingRow
            label="Clear Library"
            description="Removes every song, playlist, and favorite from Aura. Files on your device are never touched."
          >
            <button
              onClick={() => setConfirmClear(true)}
              disabled={libraryCount === 0}
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

function ThemeButton({ color, label, icon: Icon, active, onClick }: {
  color: string; label: string; icon: typeof Palette; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all duration-150 hover:scale-[1.03] active:scale-95"
      style={
        active
          ? { background: `${color}22`, borderColor: `${color}66`, color: '#fff' }
          : { background: 'var(--color-glass)', borderColor: 'var(--color-border)', color: 'rgba(255,255,255,0.5)' }
      }
    >
      <Icon size={13} style={{ color: active ? color : undefined }} />
      {label}
      {active && (
        <Check size={11} strokeWidth={3} style={{ color }} className="ml-0.5" />
      )}
    </button>
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