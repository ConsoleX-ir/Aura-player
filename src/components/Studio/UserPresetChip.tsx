import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, Pencil, Copy, Trash2, Check, X } from 'lucide-react'

// ── Studio user-preset chip (v3.2.0) ────────────────────────────────────────
// One visual language for BOTH preset families (custom EQ curves and custom
// effect states): click the name to apply, ⋯ opens Rename / Duplicate /
// Delete, rename swaps the chip for an inline input. Keyboard: the ⋯ menu is
// a real Radix menu (arrow keys built in) and the rename input commits on
// Enter, cancels on Escape.

export function UserPresetChip({
  name, active, onApply, onRename, onDuplicate, onDelete,
}: {
  name: string
  active: boolean
  onApply: () => void
  onRename: (newName: string) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(name)

  if (renaming) {
    return (
      <span className="flex items-center gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) { onRename(draft); setRenaming(false) }
            if (e.key === 'Escape') { setRenaming(false); setDraft(name) }
          }}
          placeholder="Preset name"
          aria-label={`Rename preset ${name}`}
          autoFocus
          className="px-2 py-1 rounded-lg text-[11px] outline-none w-28"
          style={{ background: 'var(--surface-inset)', border: '1px solid var(--accent-border)', color: 'var(--text-primary)' }}
        />
        <button
          onClick={() => { if (draft.trim()) { onRename(draft); setRenaming(false) } }}
          aria-label="Confirm rename"
          title="Confirm rename"
          className="p-1 rounded-md icon-hover"
          style={{ color: 'var(--success)' }}
        >
          <Check size={11} />
        </button>
        <button
          onClick={() => { setRenaming(false); setDraft(name) }}
          aria-label="Cancel rename"
          title="Cancel rename"
          className="p-1 rounded-md icon-hover"
          style={{ color: 'var(--text-faint)' }}
        >
          <X size={11} />
        </button>
      </span>
    )
  }

  return (
    <span
      className="flex items-center gap-0.5 pl-2.5 pr-1 py-1 rounded-lg text-[11px] font-medium"
      style={{
        background: active ? 'var(--accent-dim)' : 'var(--glass-2)',
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--border-default)'}`,
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
      data-studio-preset={name}
    >
      <button
        onClick={onApply}
        title={`Apply ${name}`}
        className="transition-colors"
        style={{ color: 'inherit' }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'inherit' }}
      >
        {name}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label={`Preset options for ${name}`}
            title="Preset options"
            className="p-0.5 rounded transition-colors"
            style={{ color: 'var(--text-faint)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)' }}
          >
            <MoreHorizontal size={11} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="min-w-36 p-1 rounded-xl text-sm"
            style={{
              zIndex: 'var(--z-dropdown)',
              background: 'var(--surface-chrome)',
              border: '1px solid var(--border-strong)',
              backdropFilter: 'blur(var(--blur-glass))',
              boxShadow: 'var(--shadow-overlay)',
            }}
            sideOffset={4} align="start"
          >
            <DropdownMenu.Item
              className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none"
              onSelect={() => { setDraft(name); setRenaming(true) }}
            >
              <Pencil size={12} /> Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none"
              onSelect={onDuplicate}
            >
              <Copy size={12} /> Duplicate
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="menuitem-danger flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none"
              onSelect={onDelete}
            >
              <Trash2 size={12} /> Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  )
}

/** Save-this-state pill — the shared "Save as Preset" affordance. */
export function SavePresetControl({
  label, disabled, onSave,
}: {
  label: string
  disabled: boolean
  onSave: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={label}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all disabled:opacity-40"
        style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
      >
        {label}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) { onSave(draft); setOpen(false) }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Preset name"
        aria-label="Preset name"
        autoFocus
        className="px-2 py-1 rounded-lg text-[11px] outline-none w-32"
        style={{ background: 'var(--surface-inset)', border: '1px solid var(--accent-border)', color: 'var(--text-primary)' }}
      />
      <button
        onClick={() => { if (draft.trim()) { onSave(draft); setOpen(false) } }}
        className="px-2 py-1 rounded-lg text-[11px] font-medium"
        style={{ background: 'var(--accent-dim)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
      >
        Save
      </button>
    </span>
  )
}
