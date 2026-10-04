import { useState } from 'react'
import { motion } from 'framer-motion'
import { FolderOpen, FileAudio, RefreshCw, Loader2, FolderX, HardDrive, Eye, EyeOff } from 'lucide-react'
import { useCatalogStore } from '@/store/catalogStore'
import { usePlayerStore } from '@/store/playerStore'
import { useLibraryImport } from '@/hooks/useLibraryImport'
import { useLibrarySync } from '@/hooks/useLibrarySync'
import { useStoreHydration } from '@/hooks/useStoreHydration'
import { EmptyState } from '@/components/States/EmptyState'
import { syncAllFolders } from '@/services/libraryService'

// ── Local Music (Aura 4 §7 — the local SOURCE) ──────────────────────────────
// Local Music is where files enter Aura: folder tracking, imports, Folder
// Sync, and the watcher toggle. Library membership is curated elsewhere
// (Library → All Music); this page is about the filesystem relationship.
// The watcher is a change TRIGGER — the Rust reconcile that fires on it is
// what actually scans and diffs, so the UI only ever shows DB-verified rows.
export function LocalMusic() {
  const { importFolder, importFiles, importing, progress } = useLibraryImport()
  const { syncAll, syncing, lastResult } = useLibrarySync()
  const musicFolders = useCatalogStore((s) => s.musicFolders)
  const removeMusicFolder = useCatalogStore((s) => s.removeMusicFolder)
  const localCount = useCatalogStore(
    (s) => Object.values(s.tracks).filter((t) => t.kind === 'local').length,
  )
  const missingCount = useCatalogStore(
    (s) => Object.values(s.tracks).filter((t) => t.kind === 'local' && t.missing).length,
  )
  const watchFolders = usePlayerStore((s) => s.watchFolders)
  const setWatchFolders = usePlayerStore((s) => s.setWatchFolders)
  const hydrated = useStoreHydration()
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const busy = importing || syncing

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="sticky top-0 z-10 px-7 pt-6 pb-4"
        style={{ background: 'linear-gradient(to bottom, var(--surface-base) 60%, transparent)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              Local Music
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Your folders, watched and kept in sync with the library
            </p>
            <p className="text-xs mt-1 tabular-nums" style={{ color: 'var(--text-faint)' }}>
              {localCount} local {localCount === 1 ? 'track' : 'tracks'}
              {missingCount > 0 ? ` · ${missingCount} missing` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void syncAll()}
              disabled={busy}
              className="flex items-center gap-1.5 pl-2.5 pr-3 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-40"
              style={{
                background: 'var(--glass-1)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)',
                transitionDuration: 'var(--dur-fast)',
              }}
              title="Re-scan every tracked folder"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Sync Now
            </button>
            <DropdownAdd onFolder={importFolder} onFiles={importFiles} disabled={busy} />
          </div>
        </div>

        {/* Determinate progress while a scan/import runs */}
        {busy && progress.total > 0 && (
          <div className="h-0.5 rounded-pill overflow-hidden" style={{ background: 'var(--glass-2)' }}>
            <div
              className="h-full rounded-pill transition-[width] duration-300"
              style={{
                width: `${(progress.done / progress.total) * 100}%`,
                background: 'var(--accent)',
              }}
            />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-6">
        {/* Watcher toggle */}
        <div
          className="flex items-center justify-between p-4 rounded-2xl mb-4"
          style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              <Eye size={15} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Live sync (folder watching)
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                Watched folders reconcile automatically when files change on disk
              </p>
            </div>
          </div>
          <button
            role="switch"
            aria-checked={watchFolders}
            onClick={() => setWatchFolders(!watchFolders)}
            className="relative w-10 h-6 rounded-pill transition-all shrink-0"
            style={{
              background: watchFolders ? 'var(--accent)' : 'var(--glass-3)',
              transitionDuration: 'var(--dur-fast)',
            }}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
              style={{
                left: watchFolders ? '18px' : '2px',
                background: 'white',
                transitionDuration: 'var(--dur-fast)',
              }}
            />
          </button>
          {watchFolders && <EyeOff size={0} className="hidden" />}
        </div>

        {/* Sync result feedback (last manual sync) */}
        {lastResult && !syncing && (
          <p className="text-xs mb-4 tabular-nums" style={{ color: 'var(--text-faint)' }}>
            Last sync: {lastResult.added} added · {lastResult.removed} removed · {lastResult.updated} updated
          </p>
        )}

        {/* Tracked folders */}
        <p
          className="text-[10px] font-semibold uppercase mb-2 px-1"
          style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
        >
          Tracked folders
        </p>

        {!hydrated ? (
          <SongListSkeleton />
        ) : musicFolders.length === 0 ? (
          <div className="pt-6">
            <EmptyState
              icon={
                <div className="flex items-end gap-1 h-8">
                  {[3, 5, 8, 5, 3].map((h, i) => (
                    <motion.div
                      key={i}
                      className="w-1.5 rounded-full"
                      style={{ background: 'var(--cloud-soft)' }}
                      animate={{ height: [`${h * 4}px`, `${h * 6}px`, `${h * 4}px`] }}
                      transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              }
              title="No folders yet"
              hint="Add a music folder — Aura scans it, watches it, and keeps the library in step with your disk"
              action={
                <button
                  onClick={importFolder}
                  disabled={importing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium active:scale-95 transition-all disabled:opacity-40"
                  style={{
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-border)',
                    color: 'var(--accent)',
                    transitionDuration: 'var(--dur-fast)',
                  }}
                >
                  {importing ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
                  <span>Add Music Folder</span>
                </button>
              }
            />
          </div>
        ) : (
          <div className="space-y-2">
            {musicFolders.map((folder, i) => (
              <motion.div
                key={folder}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.04, 0.25) }}
                className="flex items-center gap-3 p-3.5 rounded-2xl"
                style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'var(--glass-2)', color: 'var(--text-tertiary)' }}
                >
                  <HardDrive size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                    {folder.split(/[\\/]/).filter(Boolean).pop() || folder}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>
                    {folder}
                  </p>
                </div>
                {confirmRemove === folder ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      Stop tracking?
                    </span>
                    <button
                      onClick={() => { void removeMusicFolder(folder); setConfirmRemove(null) }}
                      className="text-xs font-medium px-2.5 py-1 rounded-lg"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      className="text-xs px-2.5 py-1 rounded-lg"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRemove(folder)}
                    aria-label={`Stop tracking ${folder}`}
                    title="Stop tracking this folder (files stay on disk)"
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                    style={{ color: 'var(--text-faint)', transitionDuration: 'var(--dur-fast)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-2)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent' }}
                  >
                    <FolderX size={14} />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        )}

        {/* Honest note about what removal means */}
        <p className="text-[11px] mt-5 px-1 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          Removing a folder here stops watching it; tracks you remove from the Library stay on
          your disk. Aura never deletes music files.
        </p>
      </div>
    </div>
  )
}

function DropdownAdd({ onFolder, onFiles, disabled }: {
  onFolder: () => void; onFiles: () => void; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium active:scale-[0.98] transition-all disabled:opacity-40"
        style={{
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent-border)',
          color: 'var(--accent)',
          transitionDuration: 'var(--dur-fast)',
        }}
      >
        <FolderOpen size={13} />
        <span>Add Music</span>
      </button>
      {open && (
        <div
          className="absolute right-0 mt-1.5 min-w-44 p-1 rounded-xl z-20"
          style={{
            background: 'var(--surface-chrome)',
            border: '1px solid var(--border-strong)',
            boxShadow: 'var(--shadow-overlay)',
          }}
        >
          <button
            onClick={() => { setOpen(false); onFolder() }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <FolderOpen size={12} /> Add Folder...
          </button>
          <button
            onClick={() => { setOpen(false); onFiles() }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <FileAudio size={12} /> Add Files...
          </button>
        </div>
      )}
    </div>
  )
}

function SongListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[68px] rounded-2xl animate-pulse"
          style={{ background: 'var(--glass-1)', animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  )
}

// keep the sync-all export referenced for manual re-syncs initiated elsewhere
void syncAllFolders
