import { useMemo } from 'react'
import { Play, ArrowLeft, Disc3, User } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { VirtualSongList } from '@/components/Library/VirtualSongList'
import { EmptyState } from '@/components/States/EmptyState'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { songsByArtist, albumsOfArtist, totalRuntimeSec, type AlbumKey } from '@/lib/artistAlbum'
import { formatRuntime } from '@/lib/utils'

// ── Album Page (Phase 9) ────────────────────────────────────────────────────
// A view over the user's OWN library for one album: ordered track list
// (trackNumber-aware), the album's artwork as the hero, and a link to the
// artist page. Local-only by definition — online playlists/albums live in
// Explore under their provider's name.

export function AlbumPage() {
  const library = usePlayerStore((s) => s.library)
  const selectedAlbum = usePlayerStore((s) => s.selectedAlbum)
  const setSelectedAlbum = usePlayerStore((s) => s.setSelectedAlbum)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const setSelectedArtist = usePlayerStore((s) => s.setSelectedArtist)
  const playSong = usePlayerStore((s) => s.playSong)

  const key: AlbumKey | null = useMemo(() => {
    if (!selectedAlbum) return null
    const artistSongs = songsByArtist(library, selectedAlbum.artist)
    const album = artistSongs.filter((s) => s.album.trim().toLowerCase() === selectedAlbum.album.trim().toLowerCase())
    if (album.length === 0) return null
    return {
      artist: selectedAlbum.artist,
      album: selectedAlbum.album,
      normArtist: selectedAlbum.artist.trim().toLowerCase(),
      normAlbum: selectedAlbum.album.trim().toLowerCase(),
    }
  }, [library, selectedAlbum])

  const tracks = useMemo(() => {
    if (!key) return []
    const artistSongs = songsByArtist(library, key.artist)
    return albumsOfArtist(artistSongs).find(
      (a) => a.key.normAlbum === key.normAlbum,
    )?.songs ?? []
  }, [library, key])

  const openArtist = () => {
    if (!key) return
    setSelectedArtist(key.artist)
    setActiveView('artist')
  }

  const back = () => {
    setSelectedAlbum(null)
    setActiveView('library')
  }

  if (!key || tracks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-7 pt-6">
          <button onClick={back} className="text-xs mb-3 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
            <ArrowLeft size={12} /> Back to Library
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<Disc3 size={22} />}
            title={key ? 'Nothing here anymore' : 'No album selected'}
            hint={key ? 'The tracks for this album are no longer in your library.' : 'Pick a song and use its ⋯ menu → Go to Album.'}
          />
        </div>
      </div>
    )
  }

  const cover = tracks.find((t) => t.coverArt)?.coverArt ?? null
  const runtime = totalRuntimeSec(tracks)
  const year = tracks.map((t) => t.year).find((y) => y != null) ?? null

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-6">
        <button onClick={back} className="text-xs mt-5 mb-4 flex items-center gap-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>
          <ArrowLeft size={12} /> Back to Library
        </button>

        {/* Hero */}
        <div className="flex items-center gap-5 mb-6">
          <div className="w-28 h-28 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center" style={{ background: 'var(--glass-2)' }}>
            {cover
              ? <img src={cover} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              : <ArtworkPlaceholder seed={key.normAlbum} size="lg" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {key.album}
            </h1>
            <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}>
              <button onClick={openArtist} className="flex items-center gap-1 transition-colors" style={{ color: 'var(--text-tertiary)' }} title={`Open artist ${key.artist}`}>
                <User size={10} /> {key.artist}
              </button>
              {year ? <>· {year}</> : null}
              · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
              {runtime > 0 && <> · {formatRuntime(runtime)}</>}
              <span className="ml-1 px-1.5 py-px rounded-md text-[9px] font-semibold uppercase" style={{ background: 'var(--glass-2)', color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>
                Local
              </span>
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() => playSong(tracks[0], tracks)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium active:scale-95 transition-all"
                style={{ background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
                title="Play the album from the top"
              >
                <Play size={12} fill="currentColor" />
                Play
              </button>
            </div>
          </div>
        </div>

        {/* Tracks — shared virtualized list; queue = the album */}
        <VirtualSongList songs={tracks} queue={tracks} className="rounded-xl" />
      </div>
    </div>
  )
}
