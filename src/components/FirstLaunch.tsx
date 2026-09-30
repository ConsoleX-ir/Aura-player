import { useEffect, useState } from 'react'
import { AudioLines, ArrowRight, UserRound } from 'lucide-react'
import { useUserPrefsStore } from '@/store/userPrefsStore'

// ── First Launch Experience (Aura 3.0 Wave 13 — spec §13/§14) ───────────────
// ONE tasteful screen on first launch: a display-name prompt (optional!) and
// the "set Aura as your default music player" offer. Deliberately NOT a
// registration flow — one card, two questions, skippable in one click.
//
// Rules (locked):
//   • The username is optional, never an account, NEVER sent anywhere; it
//     only powers "Welcome back, <name>" greeting surfaces.
//   • The default-player offer is shown at most ONCE (dismissal is
//     permanent — userPrefs.defaultAppPromptDismissed). "Set as default"
//     calls the OS integration; on platforms where it is unavailable the
//     button is simply not offered.
//   • Everything rides the userPrefsStore (its own IndexedDB key) — no new
//     persistence machinery.

export function FirstLaunch() {
  const onboarded = useUserPrefsStore((s) => s.onboarded)
  const completeOnboarding = useUserPrefsStore((s) => s.completeOnboarding)
  const setUserPrefs = useUserPrefsStore((s) => s.setUserPrefs)
  const [name, setName] = useState('')
  const [show, setShow] = useState(false)

  // Brief delay so the boot screen resolves into the shell first — the card
  // floats OVER an already-rendered, calm app rather than popping on a blank
  // window. Purely cosmetic timing; no logic depends on it.
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 350)
    return () => window.clearTimeout(t)
  }, [])

  if (onboarded || !show) return null

  const canSetDefault = typeof window !== 'undefined'
    && !!window.electronAPI?.setAsDefaultMusicPlayer

  const finish = (displayName?: string) => {
    completeOnboarding(displayName ?? '')
    setUserPrefs({ defaultAppPromptDismissed: true }) // shown once, never again
  }

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)' }}
      data-first-launch
      role="dialog"
      aria-label="Welcome to Aura"
    >
      <div
        className="w-[420px] max-w-[calc(100vw-48px)] p-7 rounded-3xl perf-blur"
        style={{
          background: `
            linear-gradient(180deg, rgba(255,255,255,0.05), transparent 30%),
            color-mix(in srgb, var(--surface-chrome) 92%, transparent) padding-box,
            linear-gradient(155deg, var(--border-emphasis), var(--border-subtle) 40%, var(--accent-border)) border-box`,
          border: '1px solid transparent',
          boxShadow: 'var(--shadow-overlay)',
        }}
      >
        {/* Brand */}
        <div className="flex flex-col items-center text-center gap-3 mb-6">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: 'var(--glass-2)', border: '1px solid var(--border-strong)', boxShadow: '0 0 44px var(--accent-whisper)' }}
          >
            <AudioLines size={22} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <p className="text-lg font-semibold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              Welcome to Aura
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Your music, your library, your machine — nothing leaves this device.
            </p>
          </div>
        </div>

        {/* Display name — optional */}
        <label className="block mb-4" data-fl-name>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase mb-1.5" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
            <UserRound size={11} /> What should Aura call you?
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') finish(name) }}
            placeholder="A name (totally optional)"
            aria-label="Your display name"
            maxLength={40}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
            style={{ background: 'var(--surface-inset)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          />
          <span className="text-[10px] mt-1 block" style={{ color: 'var(--text-faint)' }}>
            Used only to greet you inside Aura — never an account, never sent anywhere.
          </span>
        </label>

        {/* Default player — offered once, only where the OS supports it */}
        {canSetDefault && (
          <button
            onClick={() => {
              try { window.electronAPI?.setAsDefaultMusicPlayer?.() } catch { /* OS declined — not fatal */ }
            }}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all mb-5"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
            data-fl-default
          >
            <span>
              <span className="text-xs font-medium block" style={{ color: 'var(--text-primary)' }}>
                Set Aura as your default music player
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                Opens your audio files with Aura. You can change this anytime in your OS.
              </span>
            </span>
            <ArrowRight size={14} style={{ color: 'var(--accent)' }} className="shrink-0" />
          </button>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => finish()}
            className="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium transition-all"
            style={{ background: 'var(--glass-2)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Skip
          </button>
          <button
            onClick={() => finish(name)}
            className="flex-1 px-4 py-2.5 rounded-xl text-xs font-semibold active:scale-[0.98] transition-all"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            data-fl-done
          >
            {name.trim() ? `I'm ready, ${name.trim()}` : "I'm ready"}
          </button>
        </div>
      </div>
    </div>
  )
}
