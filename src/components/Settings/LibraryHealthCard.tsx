import { useState } from 'react'
import { ShieldCheck, ShieldAlert, Trash2, RefreshCw, ChevronDown, ChevronUp, Copy, AlertTriangle } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { toast } from '@/store/toastStore'
import { runLibraryHealthCheck } from '@/services/libraryService'
import type { LibraryHealthReport } from '@/lib/libraryHealth'
import { formatTime } from '@/lib/utils'
import { ConfirmModal } from '@/components/Modals/ConfirmModal'

// ── Library Health (Phase 1 — Library 2.0) ──────────────────────────────────
// Settings → Library card: verifies every library entry against the real
// filesystem (batched fs:checkPaths IPC), then reports
//   • missing files   — moved / deleted / unmounted since import
//   • unreadable      — file exists but imported with no playable duration
//   • duplicates      — different paths that look like the same recording
// Removal actions reuse the store's existing removal paths, which already
// carry the correct Wave 0 semantics:
//   • removeSongsFromLibrary (batch, NO tombstone) for missing files — the
//     file is gone; if it ever comes back it SHOULD re-appear;
//   • removeFromLibrary (tombstones) for duplicate/unreadable entries — the
//     files still exist on disk, so Folder Sync must not resurrect them.

type ScanState = 'idle' | 'running' | 'done'

export function LibraryHealthCard() {
  const libraryCount = usePlayerStore((s) => s.library.length)
  const removeFromLibrary = usePlayerStore((s) => s.removeFromLibrary)
  const removeSongsFromLibrary = usePlayerStore((s) => s.removeSongsFromLibrary)

  const [scanState, setScanState] = useState<ScanState>('idle')
  const [report, setReport] = useState<LibraryHealthReport | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [confirmRemoveMissing, setConfirmRemoveMissing] = useState(false)

  async function runCheck() {
    if (scanState === 'running') return
    setScanState('running')
    try {
      const r = await runLibraryHealthCheck()
      setReport(r)
      setScanState('done')
      const hasProblems = r.missing.length > 0 || r.invalid.length > 0 || r.duplicateGroups.length > 0
      setExpanded(hasProblems)
      const problems = r.missing.length + r.invalid.length
      if (problems === 0 && r.duplicateGroups.length === 0) {
        toast({ kind: 'library-health', title: 'Library is healthy', subtitle: `${r.checked} entries verified` })
      }
    } catch {
      setScanState('idle')
      toast({ kind: 'playback-error', title: 'Health check failed', subtitle: 'The scan could not complete — try again' })
    }
  }

  async function removeMissing() {
    if (!report || report.missing.length === 0) return
    removeSongsFromLibrary(report.missing.map((s) => s.id))
    setConfirmRemoveMissing(false)
    await runCheck()
  }

  async function removeOne(songId: string) {
    removeFromLibrary(songId)
    await runCheck()
  }

  const hasIssues = !!report && (report.missing.length > 0 || report.invalid.length > 0 || report.duplicateGroups.length > 0)

  return (
    <div
      className="p-4 rounded-xl"
      style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
            <ShieldCheck size={14} style={{ color: 'var(--success)' }} />
            Library Health
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {libraryCount === 0
              ? 'Import music first — the check verifies every entry against the files on disk.'
              : scanState === 'done' && report
                ? reportSummary(report)
                : 'Checks every entry against the files on disk: missing files, unreadable entries, duplicate recordings.'}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {scanState === 'done' && hasIssues && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm transition-all"
              style={{
                background: 'var(--glass-1)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)',
                transitionDuration: 'var(--dur-fast)',
              }}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Details
            </button>
          )}
          <button
            onClick={runCheck}
            disabled={scanState === 'running' || libraryCount === 0}
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
            <RefreshCw size={13} className={scanState === 'running' ? 'animate-spin' : ''} />
            {scanState === 'running' ? 'Checking…' : scanState === 'done' ? 'Re-check' : 'Run Check'}
          </button>
        </div>
      </div>

      {expanded && report && hasIssues && (
        <div className="mt-3 max-h-80 overflow-y-auto pr-1 space-y-4">
          {report.missing.length > 0 && (
            <HealthSection
              icon={<ShieldAlert size={12} style={{ color: 'var(--danger)' }} />}
              title={`Missing files (${report.missing.length})`}
              action={
                <button
                  onClick={() => setConfirmRemoveMissing(true)}
                  className="text-[11px] px-2 py-1 rounded-lg transition-colors"
                  style={{ background: 'var(--danger-veil)', color: 'var(--danger)' }}
                >
                  Remove all
                </button>
              }
            >
              {report.missing.map((s) => (
                <HealthRow key={s.id} title={s.title} subtitle={s.artist} path={s.path} onRemove={() => removeOne(s.id)} />
              ))}
            </HealthSection>
          )}

          {report.invalid.length > 0 && (
            <HealthSection
              icon={<AlertTriangle size={12} style={{ color: 'var(--warning)' }} />}
              title={`Unreadable entries (${report.invalid.length})`}
            >
              {report.invalid.map((s) => (
                <HealthRow key={s.id} title={s.title} subtitle={s.artist} path={s.path} onRemove={() => removeOne(s.id)} />
              ))}
            </HealthSection>
          )}

          {report.duplicateGroups.length > 0 && (
            <HealthSection
              icon={<Copy size={12} style={{ color: 'var(--text-tertiary)' }} />}
              title={`Possible duplicates (${report.duplicateGroups.length} ${report.duplicateGroups.length === 1 ? 'group' : 'groups'})`}
            >
              {report.duplicateGroups.map((group, gi) => (
                <div key={gi} className="rounded-lg p-2 space-y-1" style={{ background: 'var(--glass-2)' }}>
                  <p className="text-[10px] uppercase" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
                    Group {gi + 1} — keep one, remove the rest
                  </p>
                  {group.map((s, si) => (
                    <HealthRow
                      key={s.id}
                      title={s.title}
                      subtitle={`${s.artist} · ${formatTime(s.duration)}`}
                      path={s.path}
                      onRemove={group.length > 1 ? () => removeOne(s.id) : undefined}
                      keeper={si === 0}
                    />
                  ))}
                </div>
              ))}
            </HealthSection>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmRemoveMissing}
        title="Remove missing entries"
        description={`${report?.missing.length ?? 0} entr${report?.missing.length === 1 ? 'y points' : 'ies point'} to files that no longer exist on disk. Removing them only cleans Aura's index — your files are not touched.`}
        confirmLabel="Remove"
        onConfirm={removeMissing}
        onClose={() => setConfirmRemoveMissing(false)}
      />
    </div>
  )
}

function reportSummary(r: LibraryHealthReport): string {
  if (r.missing.length === 0 && r.invalid.length === 0 && r.duplicateGroups.length === 0) {
    return `All ${r.checked} entries verified — files exist and are readable.`
  }
  const parts: string[] = []
  if (r.missing.length) parts.push(`${r.missing.length} missing`)
  if (r.invalid.length) parts.push(`${r.invalid.length} unreadable`)
  if (r.duplicateGroups.length) parts.push(`${r.duplicateGroups.length} duplicate ${r.duplicateGroups.length === 1 ? 'group' : 'groups'}`)
  return `${r.checked} entries checked — ${parts.join(', ')}.`
}

function HealthSection({ icon, title, action, children }: {
  icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          {icon}
          {title}
        </p>
        {action}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function HealthRow({ title, subtitle, path, onRemove, keeper }: {
  title: string; subtitle: string; path: string; onRemove?: () => void; keeper?: boolean
}) {
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
      style={{ background: 'var(--glass-2)' }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
          {title} <span className="font-normal" style={{ color: 'var(--text-faint)' }}>— {subtitle}</span>
          {keeper && (
            <span
              className="ml-1.5 px-1 py-px rounded text-[9px] font-semibold uppercase align-middle"
              style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}
            >
              keep
            </span>
          )}
        </p>
        <p className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>{path}</p>
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg shrink-0 transition-colors"
          style={{ color: 'var(--danger)' }}
          title="Remove from library"
          aria-label={`Remove ${title} from library`}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}
