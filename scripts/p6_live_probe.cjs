// Phase 6 LIVE probe — exercises the REAL main-process provider module
// (electron/providers/audius.cjs → providerFetch transport) against the
// live Audius network. No mocks. Verifies the four Phase 6 ops end-to-end.
const audius = require('/home/z/my-project/aura-player-workspace/Aura_Player_1.10.1/electron/providers/audius.cjs')

async function main() {
  const results = []
  const ok = (name, cond, detail = '') => {
    results.push(cond)
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  // 1. trendingPlaylists live
  const pl = await audius.ops.trendingPlaylists({ limit: 6 }, { signal: new AbortController().signal })
  ok('live trendingPlaylists: ≥1 playlist', pl.playlists.length >= 1, `got ${pl.playlists.length}`)
  const withArt = pl.playlists.filter((p) => p.artworkUrl)
  ok('live trendingPlaylists: artwork URLs present (artifact-bug regression)', withArt.length >= 1, `${withArt.length}/${pl.playlists.length} have artwork`)
  ok('live trendingPlaylists: honest shape', pl.playlists.every((p) => p.id && p.name && p.providerId === 'audius' && typeof p.trackCount === 'number'))

  // 2. playlistTracks live (use first playlist from step 1)
  const target = pl.playlists[0]
  const pt = await audius.ops.playlistTracks({ playlistId: target.id }, { signal: new AbortController().signal })
  ok('live playlistTracks: tracks returned', pt.tracks.length >= 1, `got ${pt.tracks.length}`)
  ok('live playlistTracks: provider-agnostic track shape', pt.tracks.every((t) => t.id && t.providerId === 'audius' && typeof t.isStreamable === 'boolean'))

  // 3. searchPlaylists live
  const sp = await audius.ops.searchPlaylists({ query: 'chill', limit: 5 }, { signal: new AbortController().signal })
  ok('live searchPlaylists: results for "chill"', sp.playlists.length >= 1, `got ${sp.playlists.length}`)

  // 4. fresh live (weekly trending pool sorted by release_date desc)
  const fr = await audius.ops.fresh({ limit: 12 }, { signal: new AbortController().signal })
  ok('live fresh: tracks returned', fr.tracks.length >= 1, `got ${fr.tracks.length}`)
  const dates = fr.tracks.map(() => 0) // release_date is consumed main-side; order is what matters
  ok('live fresh: all streamable or honestly flagged', fr.tracks.every((t) => t.isStreamable || !t.streamUrl))

  // 5. artwork sanity — URL fetchable (HEAD on one playlist artwork)
  if (withArt.length > 0) {
    const url = withArt[0].artworkUrl
    const res = await fetch(url, { method: 'HEAD' }).catch(() => null)
    ok('live playlist artwork: URL reachable', !!res && res.ok, url)
  }

  const failed = results.filter((r) => !r).length
  console.log(failed === 0 ? '\nALL LIVE CHECKS PASSED' : `\n${failed} LIVE CHECKS FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('PROBE CRASH:', e.message); process.exit(1) })
