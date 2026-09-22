import { memo, useState } from 'react'
import { Play, Heart, MoreHorizontal, ListPlus, ListX, Trash2, FolderOpen, Info, Sparkles, Radio, Mic2, Disc3, ListEnd, ArrowRightToLine } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePlayerStore } from '@/store/playerStore'
import { useUiStore } from '@/store/uiStore'
import { formatTime, cn } from '@/lib/utils'
import { startSmartRadio } from '@/lib/smartRadioActions'
import type { Song } from '@/types'
import { ConfirmModal } from '@/components/Modals/ConfirmModal'
import { PlaylistPickerModal } from '@/components/Modals/PlaylistPickerModal'
import { ArtworkPlaceholder, UnknownValue } from '@/components/States/ArtworkPlaceholder'

interface SongRowProps {
  song: Song
  index: number
  queue: Song[]
  showAlbumArt?: boolean
  /** When the row is rendered inside a specific playlist's view, this enables
   *  a "Remove from Playlist" action scoped to just that playlist. */
  playlistId?: string
}

// Narrow selectors only — the previous full `usePlayerStore()` destructure
// subscribed every row to the ENTIRE store, so all N rows re-rendered on
// every single state change, including the ~4-10Hz progress tick during
// playback. `memo` alone does NOT prevent this: memo only skips a re-render
// triggered by the *parent* passing the same props — it has no effect on a
// re-render triggered by the component's own store subscription firing.
// Selecting individual primitives (and a per-song boolean for `favorites`,
// rather than the whole array) means each row only re-renders when something
// about *that row* actually changed.
export const SongRow = memo(function SongRow({ song, index, queue, showAlbumArt = true, playlistId }: SongRowProps) {
  const currentSongId = usePlayerStore((s) => s.currentSong?.id)
  const isPlaying = usePlayerStore((s) => s.isPlaying)
  const isFav = usePlayerStore((s) => s.favorites.includes(song.id))
  const playSong = usePlayerStore((s) => s.playSong)
  const toggleFavorite = usePlayerStore((s) => s.toggleFavorite)
  const removeFromPlaylist = usePlayerStore((s) => s.removeFromPlaylist)
  const removeFromLibrary = usePlayerStore((s) => s.removeFromLibrary)
  const setSelectedArtist = usePlayerStore((s) => s.setSelectedArtist)
  const setSelectedAlbum = usePlayerStore((s) => s.setSelectedAlbum)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const playNextInQueue = usePlayerStore((s) => s.playNextInQueue)
  const addToQueueEnd = usePlayerStore((s) => s.addToQueueEnd)
  const isActive = currentSongId === song.id
  const [confirmRemoveLibrary, setConfirmRemoveLibrary] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // v2.1.2: "Add to Playlist" opens the searchable picker modal instead of
  // inlining every playlist into this menu (a 100-playlist library made the
  // menu taller than the screen). The picker reads the store itself, so this
  // row no longer subscribes to `playlists` at all — one less re-render
  // trigger for every visible row whenever any playlist changes.
  // Properties — Wave 3 UX upgrade: a full page (Windows-Media-Player style)
  // instead of the old modal. 'find' jumps straight to the keyless online
  // lookup section of the same page.
  const openProperties = useUiStore((s) => s.openProperties)

  return (
    <div
      onDoubleClick={() => playSong(song, queue)}
      tabIndex={0}
      onKeyDown={(e) => {
        // Phase 2 — keyboard navigation: Enter plays the focused row.
        // Deliberately NOT handled here: arrow keys (global transport skip)
        // and Space (global play/pause) keep their app-wide meaning even
        // while a row is focused — library focus never steals the
        // transport keys, so no key does two things at once.
        if (e.key === 'Enter') {
          e.preventDefault()
          playSong(song, queue)
        }
      }}
      aria-label={`Play ${song.title} by ${song.artist}`}
      className={cn(
        'song-row group relative flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors',
        'focus:outline-none',
        isActive && 'song-row-active'
      )}
      style={{
        transitionDuration: 'var(--dur-instant)',
        background: isActive ? 'var(--accent-dim)' : undefined,
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--surface-inset)' }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Active-row accent edge — a quiet "this is the one" marker */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
      )}

      {/* Index / play */}
      <div className="w-7 shrink-0 flex items-center justify-center">
        {isActive && isPlaying
          ? <PlayingBars />
          : <span
              className={cn('text-xs tabular-nums group-hover:hidden')}
              style={{ color: isActive ? 'var(--accent)' : 'var(--text-faint)' }}
            >
              {index + 1}
            </span>
        }
        <button onClick={() => playSong(song, queue)}
          aria-label={`Play ${song.title}`}
          className={cn('hidden group-hover:flex items-center justify-center w-5 h-5 rounded-full transition-all',
            isActive && isPlaying ? '!hidden' : ''
          )}
          style={{ color: 'var(--text-on-accent)', background: 'var(--glass-3)' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-selected)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--glass-3)' }}
        >
          <Play size={9} fill="currentColor" className="ml-px" />
        </button>
      </div>

      {showAlbumArt && (
        <div className="w-9 h-9 shrink-0 rounded-lg overflow-hidden">
          {song.coverArt
            ? <img src={song.coverArt} alt="" className="w-full h-full object-cover" loading="lazy" />
            : <ArtworkPlaceholder seed={song.id} size="sm" />
          }
        </div>
      )}

      {/* Title */}
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm truncate')}
          style={{ color: isActive ? 'var(--accent)' : 'var(--text-primary)', fontWeight: isActive ? 500 : 400 }}>
          {song.title}
        </p>
        {/* Missing metadata (Unknown Artist) gets the quietest voice in the
            row — visible, but clearly a placeholder, not broken data. */}
        <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
          {isUnknown(song.artist) ? <UnknownValue>{song.artist}</UnknownValue> : song.artist}
        </p>
      </div>

      {/* Album */}
      <p className="text-xs truncate w-36 hidden md:block" style={{ color: 'var(--text-faint)' }}>
        {isUnknown(song.album) ? <UnknownValue>{song.album}</UnknownValue> : song.album}
      </p>

      {/* Duration */}
      <span className="text-xs tabular-nums shrink-0 w-9 text-right" style={{ color: 'var(--text-faint)' }}>
        {formatTime(song.duration)}
      </span>

      {/* Actions */}
      {/* v2.1.2 glitch fix: while this row's `...` menu is open the pointer
          is over the PORTALED menu — outside this row's DOM — so group-hover
          would fade the controls and reset the background, making the open
          menu look orphaned. :has() keeps both anchored while data-state=open. */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 has-[button[data-state='open']]:opacity-100 transition-opacity shrink-0">
        <button onClick={(e) => { e.stopPropagation(); toggleFavorite(song.id) }}
          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
          className="p-1.5 rounded-lg transition-all"
          style={{ color: isFav ? 'var(--favorite)' : 'var(--text-faint)' }}
          onMouseEnter={(e) => { if (!isFav) e.currentTarget.style.color = 'var(--favorite)' }}
          onMouseLeave={(e) => { if (!isFav) e.currentTarget.style.color = 'var(--text-faint)' }}
        >
          <Heart size={12} fill={isFav ? 'currentColor' : 'none'} />
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              aria-label={`More actions for ${song.title}`}
              className="p-1.5 rounded-lg transition-all"
              style={{ color: 'var(--text-faint)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent' }}
            >
              <MoreHorizontal size={12} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-[200] min-w-44 p-1 rounded-xl text-sm"
              style={{
                zIndex: 'var(--z-dropdown)',
                background: 'var(--surface-chrome)',
                border: '1px solid var(--border-strong)',
                backdropFilter: 'blur(var(--blur-glass))',
                boxShadow: 'var(--shadow-overlay)',
              }}
              sideOffset={4} align="end">

              {/* v2.1.2: opens the searchable playlist picker — every playlist
                  stays reachable, the menu itself stays one row tall. */}
              <DropdownMenu.Item
                onClick={() => setPickerOpen(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              >
                <ListPlus size={13} />
                Add to Playlist…
              </DropdownMenu.Item>

              {/* Phase 7 — Smart Music Engine: a deterministic local radio
                  seeded by THIS track (artist/genre/era similarity, listening
                  history, favorites, skips, hour-of-day context). */}
              <DropdownMenu.Item
                onClick={() => { void startSmartRadio(song) }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              >
                <Radio size={13} />
                Start Radio
              </DropdownMenu.Item>

              {/* Phase 11 — queueing: manual actions always beat Smart Queue. */}
              <DropdownMenu.Item
                onClick={() => playNextInQueue(song)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              >
                <ArrowRightToLine size={13} />
                Play Next
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onClick={() => addToQueueEnd(song)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              >
                <ListEnd size={13} />
                Add to Queue
              </DropdownMenu.Item>

              {/* Phase 9 — drill into the artist / album pages. */}
              {!isUnknown(song.artist) && (
                <DropdownMenu.Item
                  onClick={() => { setSelectedArtist(song.artist); setActiveView('artist') }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
                >
                  <Mic2 size={13} />
                  Go to Artist
                </DropdownMenu.Item>
              )}
              {!isUnknown(song.album) && (
                <DropdownMenu.Item
                  onClick={() => { setSelectedAlbum({ artist: song.artist, album: song.album }); setActiveView('album') }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
                >
                  <Disc3 size={13} />
                  Go to Album
                </DropdownMenu.Item>
              )}

              <DropdownMenu.Separator className="my-1" style={{ height: 1, background: 'var(--border-default)' }} />

              <DropdownMenu.Item
                onClick={() => openProperties(song.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              >
                <Info size={13} />
                Properties
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onClick={() => openProperties(song.id, { initialFind: true })}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              >
                <Sparkles size={13} />
                Find Info Online
              </DropdownMenu.Item>

              <DropdownMenu.Item
                onClick={() => window.electronAPI?.showItemInFolder(song.path)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              >
                <FolderOpen size={13} />
                Show in Folder
              </DropdownMenu.Item>

              {playlistId && (
                <DropdownMenu.Item
                  onClick={() => removeFromPlaylist(playlistId, song.id)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
                >
                  <ListX size={13} />
                  Remove from Playlist
                </DropdownMenu.Item>
              )}

              <DropdownMenu.Item
                onClick={() => setConfirmRemoveLibrary(true)}
                className="menuitem-danger flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer outline-none transition-colors"
              >
                <Trash2 size={13} />
                Remove from Library
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <ConfirmModal
        open={confirmRemoveLibrary}
        title="Remove from Library"
        description={`"${song.title}" will be removed from your library, playlists, and favorites. The file on your device is not deleted.`}
        confirmLabel="Remove"
        onConfirm={() => removeFromLibrary(song.id)}
        onClose={() => setConfirmRemoveLibrary(false)}
      />

      <PlaylistPickerModal
        open={pickerOpen}
        songTitle={song.title}
        songId={song.id}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
})

// "Unknown Artist" / "Unknown Album" (and blank) — the metadata scanner's
// fallback strings. Centralised so future taggers can special-case cleanly.
const UNKNOWN_RE = /^(unknown (artist|album)|unknown)$/i
function isUnknown(value: string): boolean {
  return !value.trim() || UNKNOWN_RE.test(value.trim())
}

// CSS-only animation (see .animate-playing-bar in index.css) — avoids a
// framer-motion instance per visible row just for three bouncing bars
function PlayingBars() {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="w-0.5 rounded-full animate-playing-bar perf-spin"
          style={{ height: '100%', background: 'var(--accent)', animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  )
}
