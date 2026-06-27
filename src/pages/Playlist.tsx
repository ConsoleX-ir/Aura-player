import { AnimatePresence } from 'framer-motion'
import { ArrowLeft, Play, Shuffle, Music2, Trash2 } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { SongRow } from '@/components/Library/SongRow'

export function PlaylistPage() {
  const { playlists, selectedPlaylistId, library, setActiveView, setSelectedPlaylistId,
    playSong, toggleShuffle, deletePlaylist } = usePlayerStore()

  const playlist = playlists.find((p) => p.id === selectedPlaylistId)
  const songs = (playlist?.songIds ?? []).map((id) => library.find((s) => s.id === id)).filter(Boolean) as typeof library

  if (!playlist) return null

  const handlePlay = () => {
    if (songs.length) playSong(songs[0], songs)
  }
  const handleShuffle = () => {
    if (songs.length) { toggleShuffle(); playSong(songs[Math.floor(Math.random() * songs.length)], songs) }
  }
  const handleDelete = () => {
    if (confirm(`Delete "${playlist.name}"?`)) {
      deletePlaylist(playlist.id)
      setActiveView('library')
      setSelectedPlaylistId(null)
    }
  }

  const coverArt = songs.find((s) => s.coverArt)?.coverArt ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Hero header */}
      <div className="relative px-7 pt-6 pb-6 overflow-hidden">
        {/* Blurred cover background */}
        {coverArt && (
          <div className="absolute inset-0 overflow-hidden opacity-20">
            <img src={coverArt} alt="" className="w-full h-full object-cover blur-3xl scale-110" />
          </div>
        )}
        <div className="relative flex items-start gap-5">
          {/* Back */}
          <button onClick={() => { setActiveView('library'); setSelectedPlaylistId(null) }}
            className="p-2 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)] text-white/50 hover:text-white/80 transition-all mt-1 shrink-0">
            <ArrowLeft size={14} />
          </button>

          {/* Cover */}
          <div className="w-24 h-24 rounded-2xl overflow-hidden bg-[var(--color-glass-mid)] border border-[var(--color-border)] shrink-0 shadow-2xl">
            {coverArt
              ? <img src={coverArt} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center">
                  <Music2 size={28} className="text-white/15" />
                </div>
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/25 mb-1">Playlist</p>
            <h1 className="text-2xl font-bold text-white/90 truncate" style={{ fontFamily: 'var(--font-display)' }}>
              {playlist.name}
            </h1>
            <p className="text-xs text-white/30 mt-1">{songs.length} songs</p>

            {/* Action buttons */}
            <div className="flex items-center gap-2 mt-4">
              <button onClick={handlePlay} disabled={!songs.length}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[var(--color-glass-strong)] border border-[var(--color-border-mid)] text-white/80 text-sm font-medium hover:bg-white/15 active:scale-95 transition-all disabled:opacity-30">
                <Play size={14} fill="currentColor" className="ml-0.5" />
                Play
              </button>
              <button onClick={handleShuffle} disabled={!songs.length}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)] text-white/50 text-sm hover:text-white/80 hover:bg-[var(--color-glass-mid)] active:scale-95 transition-all disabled:opacity-30">
                <Shuffle size={14} />
                Shuffle
              </button>
              <button onClick={handleDelete}
                className="p-2 rounded-xl bg-[var(--color-glass)] border border-[var(--color-border)] text-white/25 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-all">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Song list */}
      <div className="flex-1 overflow-y-auto px-7 pb-4">
        {songs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Music2 size={24} className="text-white/10" />
            <p className="text-xs text-white/25">No songs in this playlist yet</p>
            <p className="text-[11px] text-white/15">Right-click any song to add it</p>
          </div>
        )}

        <AnimatePresence>
          {songs.map((song, i) => (
            <SongRow key={song.id} song={song} index={i} queue={songs} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
