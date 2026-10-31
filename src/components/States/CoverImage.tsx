import { CSSProperties, ReactNode, useEffect, useState } from 'react'
import { ArtworkPlaceholder } from './ArtworkPlaceholder'
import { usePlayerStore } from '@/store/playerStore'

/* ── CoverImage (v4.0.3b) — the one cover-art <img> with failure handling ───
   Song covers come from three fragile sources: cached aura:// files (the
   covers cache can lose a file while the library still references its URL),
   remote provider CDNs (offline / expired hosts), and user data: overrides.
   Every surface used to render a bare <img>, so a dead source meant a broken
   image element plus a console error instead of a designed fallback.

   Contract:
   • A valid source loads exactly as before — lazy loading, alt text, styling
     via className/style; nothing changes for healthy covers.
   • A source that fails ONCE swaps to the existing ArtworkPlaceholder
     (deterministic per-seed gradient) and never re-requests blindly: the
     <img> is unmounted, so there is no error/retry loop and the fallback
     itself is pure CSS (it cannot fail).
   • SELF-HEALING (v4.0.3b): a dead aura:// source usually means the CACHE
     copy was lost — the artwork itself still sits inside the audio file.
     When the caller passes `songPath`, the failed cover triggers exactly
     ONE recovery attempt per source (module-level set, shared by every
     surface, so a large library can't storm the main process with
     re-parses): the main process re-extracts the embedded art, re-writes
     the cache copy and returns a cache-busted URL. A successful recovery
     re-mounts the <img> with the busted URL — a different string, so the
     per-source failure state resets naturally and the placeholder goes
     away. A recovery that fails (or a second failure) leaves the designed
     fallback in place with no further attempts.
   • A later DIFFERENT source (the user picked new artwork, the cache was
     re-populated) resets the failure state — per-src, not per-mount. */

// One recovery attempt per aura:// source per session, shared across ALL
// CoverImage mounts so N surfaces showing the same dead cover cost one
// recovery, not N.
const recoveryAttempted = new Set<string>()

interface CoverImageProps {
  src: string | null | undefined
  /** Stable key for the fallback gradient — song.id / album key / artist name. */
  seed: string
  alt?: string
  /** Sizing/shape classes — applied to BOTH the img and the fallback box so
      the fallback occupies exactly the box the cover would have. */
  className?: string
  style?: CSSProperties
  loading?: 'lazy' | 'eager'
  /** Placeholder glyph size — 'lg' for hero-size covers. */
  placeholderSize?: 'sm' | 'md' | 'lg'
  /** Optional custom fallback (a surface's own no-cover design). When given,
      it replaces the default ArtworkPlaceholder on failure. */
  fallback?: ReactNode
  /** Source audio file path — enables self-healing of dead aura:// covers
      (re-extract embedded art → re-cache → retry with a busted URL). */
  songPath?: string | null
}

export function CoverImage({ src, seed, alt = '', className, style, loading, placeholderSize = 'sm', fallback, songPath }: CoverImageProps) {
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const [healedSrc, setHealedSrc] = useState<string | null>(null)

  // Reset when the source actually changes — a fresh URL deserves a fresh try.
  useEffect(() => {
    setFailedFor((f) => (f && f !== src ? null : f))
    setHealedSrc(null)
  }, [src])

  const showSrc = healedSrc ?? src

  if (!showSrc || failedFor === showSrc) {
    if (fallback) return <>{fallback}</>
    return (
      <div className={className} style={style} aria-hidden>
        <ArtworkPlaceholder seed={seed} size={placeholderSize} />
      </div>
    )
  }
  return (
    <img
      src={showSrc}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      draggable={false}
      onError={() => {
        setFailedFor(showSrc)
        // v4.0.3b — self-heal dead aura:// covers from the source file. One
        // attempt per source; the healed URL differs from the dead one only
        // by the ignored cache-buster param, which is what lets the <img>
        // (and the failure state) start over.
        if (songPath && showSrc.startsWith('aura://') && !recoveryAttempted.has(showSrc)) {
          recoveryAttempted.add(showSrc)
          window.electronAPI?.recoverCover?.(songPath)
            .then((healed) => {
              if (typeof healed === 'string' && healed) {
                setHealedSrc(healed)
                // v4.0.3c — STORE-WIDE heal: write the recovered URL back
                // into the player store so every other surface still showing
                // the dead source (album grid, queue, sidebar, Now Playing,
                // the mini widget's next snapshot) re-renders the real cover
                // immediately instead of waiting for its own failed load and
                // private recovery.
                usePlayerStore.getState().healCoverArt(songPath, healed)
              }
            })
            .catch(() => { /* the designed fallback stays */ })
        }
      }}
    />
  )
}
