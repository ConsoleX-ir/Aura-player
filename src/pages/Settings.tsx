import { useState } from 'react'
import { Trash2, Music2, ListMusic, Heart, Info, SlidersHorizontal, RefreshCw, Check, Palette, TreePine, Waves, Sunset, Gem, Flame, Globe, Mic2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { setAppearanceAnimated } from '@/lib/appearance'
import { ConfirmModal } from '@/components/Modals/ConfirmModal'
import { EqualizerCard } from '@/components/Settings/EqualizerCard'
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
  const appearance = usePlayerStore((s) => s.appearance)
  const watchFolders = usePlayerStore((s) => s.watchFolders)
  const setWatchFolders = usePlayerStore((s) => s.setWatchFolders)
  const importedFolderCount = usePlayerStore((s) => s.importedFolders.length)
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
      <h1
        className="text-2xl font-semibold tracking-tight mb-6"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
      >
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
                  aria-label="Custom accent color"
                  className="w-8 h-8 rounded-lg cursor-pointer bg-transparent appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
                  style={{ border: '1px solid var(--border-default)' }}
                />
              )}
            </div>
          </SettingRow>

          <SettingRow
            label="Light mode"
            description="Switch between Aura's true dark form and the light paper look. Colors glide — nothing snaps."
          >
            <div
              className="flex items-center rounded-xl p-0.5"
              style={{ background: 'var(--glass-1)', border: '1px solid var(--border-subtle)' }}
              role="group"
              aria-label="Theme appearance"
              data-appearance-toggle
            >
              {(['dark', 'light'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setAppearanceAnimated(mode)}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-lg capitalize transition-all"
                  style={{
                    transitionDuration: 'var(--dur-fast)',
                    background: appearance === mode ? 'var(--accent-dim)' : 'transparent',
                    color: appearance === mode ? 'var(--accent)' : 'var(--text-tertiary)',
                    border: appearance === mode ? '1px solid var(--accent-border)' : '1px solid transparent',
                  }}
                >
                  {mode}
                </button>
              ))}
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
                aria-label="Crossfade seconds"
                className="w-28 h-1.5 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--accent) ${crossfade ? (crossfade / 12) * 100 : 0}%, var(--glass-3) ${crossfade ? (crossfade / 12) * 100 : 0}%)`,
                }}
              />
              <span className="text-xs tabular-nums w-8 text-right" style={{ color: 'var(--text-secondary)' }}>
                {crossfade === 0 ? 'Off' : `${crossfade}s`}
              </span>
            </div>
          </SettingRow>

          {/* Wave 3: the reserved EQ bands get their face */}
          <EqualizerCard />
        </Section>

        {/* ── Online Services ─────────────────────────────────────────── */}
        <Section title="Online Services">
          <SettingRow
            label="Find Info Online"
            description="Song lookup (⋯ menu on any song) uses free public search APIs — Deezer, Apple Music, and MusicBrainz. No account or API token needed; only a text query is sent, never your files."
          >
            <KeylessBadge icon={<Globe size={11} />} />
          </SettingRow>
          <SettingRow
            label="Lyrics"
            description="Synced & plain lyrics in the Now Playing view come from LRCLIB (lrclib.net) — a free, open lyrics service. No account or API token needed; only the song's title and artist are sent."
          >
            <KeylessBadge icon={<Mic2 size={11} />} />
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
                <span className="text-xs flex items-center gap-1 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                  <Check size={12} style={{ color: 'var(--success)' }} />
                  +{lastResult.added} · −{lastResult.removed} · ~{lastResult.updated}
                </span>
              )}
              <button
                onClick={syncAll}
                disabled={syncing || folderCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: 'var(--glass-1)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-secondary)',
                  transitionDuration: 'var(--dur-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--glass-2)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                {syncing ? (progress.total ? `${progress.done}/${progress.total}` : 'Scanning...') : 'Sync Now'}
              </button>
            </div>
          </SettingRow>

          <SettingRow
            label="Watch folders for changes"
            description={
              importedFolderCount === 0
                ? 'Watches folders you import — add one with Add Folder... first. New, changed, or removed files then sync automatically.'
                : `Watches your ${importedFolderCount} imported ${importedFolderCount === 1 ? 'folder' : 'folders'} and syncs automatically when files change. Event-driven — no background scanning.`
            }
          >
            <Toggle checked={watchFolders} onChange={setWatchFolders} />
          </SettingRow>

          <SettingRow
            label="Clear Library"
            description="Removes every song, playlist, and favorite from Aura. Files on your device are never touched."
          >
            <button
              onClick={() => setConfirmClear(true)}
              disabled={libraryCount === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: 'var(--danger-veil)',
                border: '1px solid var(--danger-border)',
                color: 'var(--danger)',
                transitionDuration: 'var(--dur-fast)',
              }}
            >
              <Trash2 size={13} />
              Clear Library
            </button>
          </SettingRow>
        </Section>

        {/* ── About ─────────────────────────────────────────────────────── */}
        <Section title="About">
          <div
            className="flex items-start gap-3 p-4 rounded-xl"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
          >
            <Info size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Aura Player</p>
                <span
                  className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold tabular-nums"
                  style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                >
                  v2.1.0
                </span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                by ConsoleX · offline desktop music player · your library & listening history never leave this machine
              </p>
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

function KeylessBadge({ icon }: { icon: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium"
      style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
    >
      {icon}
      No token needed
    </div>
  )
}

function ThemeButton({ color, label, icon: Icon, active, onClick }: {
  color: string; label: string; icon: typeof Palette; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 hover:scale-[1.03] active:scale-95"
      style={
        active
          ? { background: `${color}22`, borderColor: `${color}66`, color: 'var(--text-primary)' }
          : { background: 'var(--glass-1)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }
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
      <div className="flex items-center gap-3 mb-3">
        <h2
          className="text-[11px] font-semibold uppercase whitespace-nowrap"
          style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
        >
          {title}
        </h2>
        <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between gap-4 p-4 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      /* v2.1.0 hover: unchecked toggles lift their track + glow faintly on
         hover so the control reads as interactive; checked state already
         wears the accent, so it gets the press feedback only. */
      className="relative w-11 h-6 rounded-full transition-all shrink-0 pressable"
      style={{
        background: checked ? 'var(--accent)' : 'var(--glass-3)',
        transitionDuration: 'var(--dur-fast)',
      }}
      onMouseEnter={(e) => { if (!checked) e.currentTarget.style.background = 'var(--surface-selected)' }}
      onMouseLeave={(e) => { if (!checked) e.currentTarget.style.background = 'var(--glass-3)' }}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform"
        style={{ background: 'var(--text-on-accent)', transform: checked ? 'translateX(20px)' : 'translateX(0)' }}
      />
    </button>
  )
}

function StatCard({ icon: Icon, value, label }: { icon: typeof Music2; value: number; label: string }) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 p-4 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ background: 'var(--accent-dim)' }}
      >
        <Icon size={14} style={{ color: 'var(--accent)' }} />
      </div>
      <span className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</span>
      <span className="text-[10px] uppercase" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
        {label}
      </span>
    </div>
  )
}
