import { ArrowLeft, Play, Shuffle, Music2, Trash2, Pencil, ListPlus, Download, Loader2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { VirtualSongList } from '@/components/Library/VirtualSongList'
import { useState } from 'react'
import { PlaylistModal } from '@/components/Modals/PlaylistModal'
import { ConfirmModal } from '@/components/Modals/ConfirmModal'
import { AddSongsModal } from '@/components/Modals/AddSongsModal'
import { useLibraryExport } from '@/hooks/useLibraryExport'
import { EmptyState } from '@/components/States/EmptyState'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'

export function PlaylistPage() {
  // Narrow selectors — avoids re-rendering the whole page on unrelated store
  // mutations like the playback progress tick.
  const playlists = usePlayerStore((s) => s.playlists)
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId)
  const library = usePlayerStore((s) => s.library)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const setSelectedPlaylistId = usePlayerStore((s) => s.setSelectedPlaylistId)
  const playSong = usePlayerStore((s) => s.playSong)
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle)
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist)

  const playlist = playlists.find((p) => p.id === selectedPlaylistId)
  const songs = (playlist?.songIds ?? []).map((id) => library.find((s) => s.id === id)).filter(Boolean) as typeof library

  const [showRenameModal, setShowRenameModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showAddSongsModal, setShowAddSongsModal] = useState(false)
  const { exportPlaylist, exporting } = useLibraryExport()

  if (!playlist) return null

  const handlePlay = () => {
    if (songs.length) playSong(songs[0], songs)
  }
  const handleShuffle = () => {
    if (songs.length) { toggleShuffle(); playSong(songs[Math.floor(Math.random() * songs.length)], songs) }
  }
  const handleDeleteConfirmed = () => {
    deletePlaylist(playlist.id)
    setActiveView('library')
    setSelectedPlaylistId(null)
  }

  const coverArt = songs.find((s) => s.coverArt)?.coverArt ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Hero header */}
      <div className="relative px-7 pt-6 pb-6 overflow-hidden shrink-0">
        {/* Blurred cover background + scrim so text always reads */}
        {coverArt && (
          <div className="absolute inset-0 overflow-hidden opacity-20" aria-hidden>
            <img src={coverArt} alt="" className="w-full h-full object-cover blur-3xl scale-110" />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, transparent 0%, var(--surface-base) 92%)' }}
          aria-hidden
        />
        <div className="relative flex items-start gap-5">
          {/* Back */}
          <button
            onClick={() => { setActiveView('library'); setSelectedPlaylistId(null) }}
            aria-label="Back to library"
            className="p-2 rounded-xl transition-all mt-1 shrink-0"
            style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--glass-2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--glass-1)' }}
          >
            <ArrowLeft size={14} />
          </button>

          {/* Cover */}
          <div
            className="w-24 h-24 rounded-2xl overflow-hidden shrink-0"
            style={{
              background: 'var(--glass-2)',
              border: '1px solid var(--border-default)',
              boxShadow: 'var(--shadow-3)',
            }}
          >
            {coverArt
              ? <img src={coverArt} alt="" className="w-full h-full object-cover" />
              // Playlist without any artwork → generated aura from its own name
              : <ArtworkPlaceholder seed={`playlist:${playlist.id}`} size="lg" />
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 pt-1">
            <p
              className="text-[11px] font-semibold uppercase mb-1"
              style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}
            >
              Playlist
            </p>
            <h1
              className="text-2xl font-bold truncate"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              {playlist.name}
            </h1>
            <p className="text-xs mt-1 tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {songs.length} {songs.length === 1 ? 'song' : 'songs'}
            </p>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={handlePlay}
                disabled={!songs.length}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium active:scale-95 transition-all disabled:opacity-30"
                style={{
                  background: 'var(--accent-dim)',
                  border: '1px solid var(--accent-border)',
                  color: 'var(--accent)',
                  transitionDuration: 'var(--dur-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-dim)' }}
              >
                <Play size={14} fill="currentColor" className="ml-0.5" />
                Play
              </button>
              <GhostButton onClick={handleShuffle} disabled={!songs.length}>
                <Shuffle size={14} />
                Shuffle
              </GhostButton>
              <GhostButton onClick={() => setShowAddSongsModal(true)}>
                <ListPlus size={14} />
                Add Songs
              </GhostButton>
              <GhostButton onClick={() => exportPlaylist(playlist.name, songs)} disabled={!songs.length || exporting}
                title="Export as M3U — opens in VLC, Winamp, and most other media players">
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export
              </GhostButton>
              <GhostButton iconOnly onClick={() => setShowDeleteModal(true)} danger title="Delete playlist">
                <Trash2 size={14} />
              </GhostButton>
              <GhostButton iconOnly onClick={() => setShowRenameModal(true)} title="Rename playlist">
                <Pencil size={14} />
              </GhostButton>
            </div>
          </div>
        </div>
      </div>

      {/* Song list — its own bounded scroll region, separate from the hero above */}
      <div className="flex-1 min-h-0">
        {songs.length === 0 ? (
          <div className="h-full flex items-center justify-center pb-10">
            <EmptyState
              compact
              icon={<Music2 size={22} />}
              title="No songs in this playlist yet"
              hint="Add tracks from your library to build this one up"
              action={
                <button
                  onClick={() => setShowAddSongsModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium active:scale-95 transition-all"
                  style={{
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-border)',
                    color: 'var(--accent)',
                    transitionDuration: 'var(--dur-fast)',
                  }}
                >
                  <ListPlus size={12} />
                  Add Songs
                </button>
              }
            />
          </div>
        ) : (
          <VirtualSongList
            songs={songs}
            queue={songs}
            playlistId={playlist.id}
            className="h-full overflow-y-auto px-7 pb-4"
          />
        )}
      </div>

      <PlaylistModal
        open={showRenameModal}
        mode="rename"
        playlist={playlist}
        onClose={() => setShowRenameModal(false)}
      />

      <ConfirmModal
        open={showDeleteModal}
        title="Delete Playlist"
        description={`"${playlist.name}" will be permanently deleted. Your songs stay in your library — only the playlist itself is removed.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirmed}
        onClose={() => setShowDeleteModal(false)}
      />

      <AddSongsModal
        open={showAddSongsModal}
        playlist={playlist}
        onClose={() => setShowAddSongsModal(false)}
      />
    </div>
  )
}

/* Shared secondary action button for the hero row — glass chip that warms
   on hover; `danger` swaps the hover state to the danger family. */
function GhostButton({ children, onClick, disabled, iconOnly, danger, title }: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  iconOnly?: boolean
  danger?: boolean
  title?: string
}) {
  const baseColor = danger ? 'var(--text-faint)' : 'var(--text-secondary)'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={iconOnly ? title : undefined}
      className={`flex items-center ${iconOnly ? 'p-2' : 'gap-2 px-4 py-2'} rounded-xl text-sm active:scale-95 transition-all disabled:opacity-30`}
      style={{
        background: 'var(--glass-1)',
        border: '1px solid var(--border-default)',
        color: baseColor,
        transitionDuration: 'var(--dur-fast)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--danger-veil)' : 'var(--glass-2)'
        e.currentTarget.style.color = danger ? 'var(--danger)' : 'var(--text-primary)'
        e.currentTarget.style.borderColor = danger ? 'var(--danger-border)' : 'var(--border-strong)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--glass-1)'
        e.currentTarget.style.color = baseColor
        e.currentTarget.style.borderColor = 'var(--border-default)'
      }}
    >
      {children}
    </button>
  )
}
