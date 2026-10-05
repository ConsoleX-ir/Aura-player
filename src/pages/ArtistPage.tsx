import { useMemo } from 'react'
import { Play, ArrowLeft, Radio, Disc3, User } from 'lucide-react'
import { usePlayerStore } from '@/store/playerStore'
import { VirtualSongList } from '@/components/Library/VirtualSongList'
import { EmptyState } from '@/components/States/EmptyState'
import { ArtworkPlaceholder } from '@/components/States/ArtworkPlaceholder'
import { startSmartRadio } from '@/lib/smartRadioActions'
import {
  songsByArtist, albumsOfArtist, relatedArtists, totalRuntimeSec, normName,
} from '@/lib/artistAlbum'
import { formatRuntime } from '@/lib/utils'

// ── Artist Page (Phase 9) ───────────────────────────────────────────────────
// A view over the user's OWN library for one artist: their tracks, their
// albums, and artists related through shared genres. Everything here is
// local — clearly distinct from Explore's online artist pages (which show
// streaming catalogs). Plays ride the existing queue funnel; Start Radio
// reuses the Smart Music Engine with the artist's most-played track as seed.

export function ArtistPage() {
  const library = usePlayerStore((s) => s.library)
  const selectedArtist = usePlayerStore((s) => s.selectedArtist)
  const setSelectedArtist = usePlayerStore((s) => s.setSelectedArtist)
  const setActiveView = usePlayerStore((s) => s.setActiveView)
  const setSelectedAlbum = usePlayerStore((s) => s.setSelectedAlbum)
  const playSong = usePlayerStore((s) => s.playSong)
  // Re-resolve on library change too — a removed artist degrades honestly.
  const songs = useMemo(
    () => (selectedArtist ? songsByArtist(library, selectedArtist) : []),
    [library, selectedArtist],
  )
  const albums = useMemo(() => albumsOfArtist(songs), [songs])
  const related = useMemo(
    () => (selectedArtist ? relatedArtists(library, selectedArtist) : []),
    [library, selectedArtist],
  )

  // Artist radio seed: the artist's most-played track is the honest local
  // proxy for "what defines this artist to you" — resolved by the engine's
  // own familiarity weights (startSmartRadio ranks picks; track[0] is a
  // deterministic, always-valid local seed).
  const tracks = useMemo(
    () => albums.flatMap((a) => a.songs),
    [albums],
  )

  const openAlbum = (artist: string, album: string) => {
    setSelectedAlbum({ artist, album })
    setActiveView('album')
  }

  const openArtist = (name: string) => {
    setSelectedArtist(name)
    setActiveView('artist')
  }

  const back = () => {
    setSelectedArtist(null)
    setActiveView('library')
  }

  if (!selectedArtist || songs.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-7 pt-6">
          <button onClick={back} className="text-xs mb-3 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
            <ArrowLeft size={12} /> Back to Library
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<User size={22} />}
            title={selectedArtist ? 'Nothing here anymore' : 'No artist selected'}
            hint={selectedArtist ? 'The tracks for this artist are no longer in your library.' : 'Pick a song and use its ⋯ menu → Go to Artist.'}
          />
        </div>
      </div>
    )
  }

  const covers = [...new Set(tracks.map((t) => t.coverArt).filter(Boolean))].slice(0, 4) as string[]
  const runtime = totalRuntimeSec(tracks)

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto px-7 pb-6">
        <button onClick={back} className="text-xs mt-5 mb-4 flex items-center gap-1 transition-colors" style={{ color: 'var(--text-tertiary)' }}>
          <ArrowLeft size={12} /> Back to Library
        </button>

        {/* Hero */}
        <div className="flex items-center gap-5 mb-6">
          <div className="w-24 h-24 rounded-2xl overflow-hidden shrink-0 grid grid-cols-2" style={{ background: 'var(--glass-2)' }}>
            {covers.length > 0
              ? covers.map((c) => (
                  <img key={c} src={c} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                ))
              : <div className="col-span-2 w-full h-full flex items-center justify-center"><User size={28} style={{ color: 'var(--text-faint)' }} /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {selectedArtist}
            </h1>
            <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}>
              <User size={10} />
              {albums.length} {albums.length === 1 ? 'album' : 'albums'} · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
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
                title="Play all tracks by this artist"
              >
                <Play size={12} fill="currentColor" />
                Play
              </button>
              <button
                onClick={() => { void startSmartRadio(tracks[0]) }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium active:scale-95 transition-all"
                style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                title="Start a Smart Radio around this artist's top track"
              >
                <Radio size={12} />
                Start Radio
              </button>
            </div>
          </div>
        </div>

        {/* Albums */}
        {albums.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold uppercase mb-2 flex items-center gap-2" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
              <Disc3 size={11} /> Albums
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {albums.map((a) => {
                const cover = a.songs.find((s) => s.coverArt)?.coverArt ?? null
                return (
                  <button
                    key={`${a.key.normArtist}||${a.key.normAlbum}`}
                    onClick={() => openAlbum(a.key.artist, a.key.album)}
                    className="flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
                    style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)' }}
                    title={`Open album ${a.key.album}`}
                  >
                    <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style={{ background: 'var(--glass-2)' }}>
                      {cover
                        ? <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                        : <ArtworkPlaceholder seed={a.key.normAlbum} size="sm" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{a.key.album}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>
                        {a.songs.length} {a.songs.length === 1 ? 'track' : 'tracks'}{a.songs[0]?.year ? ` · ${a.songs[0].year}` : ''}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* Related (local, genre-shared) */}
        {related.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[11px] font-semibold uppercase mb-2 flex items-center gap-2" style={{ color: 'var(--text-faint)', letterSpacing: 'var(--tracking-caps)' }}>
              <User size={11} /> Related in your library
            </h2>
            <div className="flex flex-wrap gap-2">
              {related.map((name) => (
                <button
                  key={normName(name)}
                  onClick={() => openArtist(name)}
                  className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all active:scale-95"
                  style={{ background: 'var(--glass-1)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}
                  title={`Open ${name}`}
                >
                  {name}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Tracks — the shared virtualized list (queue = the artist's tracks) */}
        <VirtualSongList songs={tracks} queue={tracks} className="rounded-xl" />
      </div>
    </div>
  )
}
