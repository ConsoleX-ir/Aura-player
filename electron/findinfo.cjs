// ── Aura 3.0 · Find Info Online (extracted from main.cjs — Wave 1) ──────────
// Domain module: keyless song-metadata lookup across Deezer + iTunes +
// MusicBrainz. Pure logic — no Electron imports; the only dependency is the
// Provider Core (retry/backoff/typed errors/shared UA via providerFetch).
// main.cjs wires this into the 'findinfo' provider registration, unchanged.
//
// All three sources are free public search APIs that require NO API key, no
// account, and no audio upload — only plain text queries ("artist + title").
// Runs in the main process (not the renderer) so CORS never matters, the
// User-Agent MusicBrainz asks for is set in one place, and the merge/scoring
// logic stays out of the UI bundle.
//
// Each source may fail independently (offline, rate-limited, reshaped
// response); a failed source simply contributes zero candidates instead of
// failing the whole lookup. Only when EVERY source errors does the renderer
// see a network error.

const providerCore = require('./providers/core.cjs')

const FIND_USER_AGENT = 'AuraPlayer/3.0.0 (desktop music player)'

// Shared fetch — routed through the Provider Core (Phase 3), which adds
// retry with backoff, typed errors, and a shared UA on top of the timeout it
// already had. Same call signature; every caller's fail-soft catch blocks
// keep working unchanged.
async function fetchJson(url, options = {}, timeoutMs = 9000) {
  return providerCore.providerFetch(url, {
    timeoutMs,
    retries: 1,
    headers: options.headers,
  })
}

// Normalize for comparison: lowercase, strip diacritics, collapse whitespace.
function normStr(s) {
  return (s || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Strip junk that pollutes tags/filenames: "(feat. X)", "[Radio Edit]", and
// site-watermark suffixes like "BEHMELODY.IN" — same idea as the renderer's
// useLyrics cleanField, mirrored here so search queries are clean.
function cleanTag(s) {
  return (s || '')
    .replace(/\s+[A-Z0-9]{3,}\.[A-Z]{2,4}$/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Sørensen–Dice coefficient over character bigrams — forgiving similarity for
// short strings (1.0 identical, 0.0 nothing in common).
function dice(a, b) {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const grams = new Map()
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2)
    grams.set(g, (grams.get(g) || 0) + 1)
  }
  let hits = 0
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2)
    const n = grams.get(g) || 0
    if (n > 0) { hits++; grams.set(g, n - 1) }
  }
  return (2 * hits) / (a.length - 1 + b.length - 1)
}

// 0..1 — how close the found duration is to the local file's (±15s full span).
function durationScore(queryDur, candDurSec) {
  if (!queryDur || !candDurSec) return 0.5 // unknown → neutral, don't punish
  const delta = Math.abs(queryDur - candDurSec)
  return Math.max(0, 1 - delta / 15)
}

// Weighted match score: the title matters most, artist second, album and
// duration act as tie-breakers between near-identical candidates.
function scoreCandidate(q, c) {
  const t = dice(normStr(cleanTag(q.title)), normStr(cleanTag(c.title || '')))
  const a = dice(normStr(cleanTag(q.artist)), normStr(cleanTag(c.artist || '')))
  const al = q.album ? dice(normStr(cleanTag(q.album)), normStr(cleanTag(c.album || ''))) : 0
  const d = durationScore(q.duration, c.durationSec)
  return t * 0.45 + a * 0.30 + al * 0.10 + d * 0.15
}

async function searchDeezer(q) {
  const term = [cleanTag(q.artist), cleanTag(q.title)].filter(Boolean).join(' ')
  if (!term) return []
  const url = 'https://api.deezer.com/search?q=' + encodeURIComponent(term) + '&limit=8'
  const data = await fetchJson(url, {}, 9000)
  return (data.data || []).map((t) => ({
    source: 'deezer',
    title: t.title || null,
    artist: t.artist?.name || null,
    album: t.album?.title || null,
    year: null,
    genre: null,
    durationSec: t.duration || null,
    artworkUrl: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || null,
    link: t.link || null,
  }))
}

async function searchITunes(q) {
  const term = [cleanTag(q.artist), cleanTag(q.title)].filter(Boolean).join(' ')
  if (!term) return []
  const url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(term) +
    '&media=music&entity=song&limit=8'
  const data = await fetchJson(url, {}, 9000)
  return (data.results || []).map((t) => ({
    source: 'itunes',
    title: t.trackName || null,
    artist: t.artistName || null,
    album: t.collectionName || null,
    year: t.releaseDate ? parseInt(t.releaseDate.slice(0, 4), 10) || null : null,
    genre: t.primaryGenreName || null,
    durationSec: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
    artworkUrl: t.artworkUrl100 ? t.artworkUrl100.replace(/100x100bb/, '600x600bb') : null,
    link: t.trackViewUrl || null,
  }))
}

async function searchMusicBrainz(q) {
  // Lucene-ish query: quoted phrases survive multi-word titles/artists.
  const parts = []
  if (cleanTag(q.title))  parts.push('recording:"' + cleanTag(q.title).replace(/"/g, '') + '"')
  if (cleanTag(q.artist)) parts.push('artist:"' + cleanTag(q.artist).replace(/"/g, '') + '"')
  if (parts.length === 0) return []
  const url = 'https://musicbrainz.org/ws/2/recording?query=' + encodeURIComponent(parts.join(' AND ')) +
    '&fmt=json&limit=8'
  // MusicBrainz asks clients to identify themselves and keep to ~1 req/sec —
  // one request per explicit user search fits comfortably within both rules.
  const data = await fetchJson(url, { headers: { 'User-Agent': FIND_USER_AGENT } }, 10000)
  return (data.recordings || []).map((r) => {
    const artistNames = (r['artist-credit'] || [])
      .map((ac) => ac.name || ac.artist?.name)
      .filter(Boolean)
    const datedRelease = (r.releases || []).find((rel) => rel.date)
    return {
      source: 'musicbrainz',
      title: r.title || null,
      artist: artistNames.join(', ') || null,
      album: r.releases?.[0]?.title || null,
      year: datedRelease ? parseInt(datedRelease.date.slice(0, 4), 10) || null : null,
      genre: null,
      durationSec: r.length ? Math.round(r.length / 1000) : null,
      artworkUrl: null, // Cover Art Archive needs extra per-release requests — skip
      link: r.id ? 'https://musicbrainz.org/recording/' + r.id : null,
    }
  })
}

async function findCandidates(q) {
  if (!cleanTag(q.title) && !cleanTag(q.artist)) {
    return { ok: false, error: 'empty_query' }
  }

  const settled = await Promise.allSettled([
    searchDeezer(q), searchITunes(q), searchMusicBrainz(q),
  ])
  const anyResolved = settled.some((s) => s.status === 'fulfilled')
  if (!anyResolved) return { ok: false, error: 'network_error' }

  // Flatten, score, then merge near-duplicates across sources: the same
  // song found on Deezer AND iTunes should appear as ONE candidate with
  // both source badges and the best fields of each, not as two rows.
  const scored = []
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      for (const c of s.value) scored.push({ ...c, score: scoreCandidate(q, c) })
    }
  }
  scored.sort((a, b) => b.score - a.score)

  const groups = new Map()
  for (const c of scored) {
    const key = normStr(cleanTag(c.title)) + '|' + normStr(cleanTag(c.artist).split(',')[0] || '')
    const prev = groups.get(key)
    if (!prev) {
      groups.set(key, { ...c, sources: [c.source], links: c.link ? [c.link] : [] })
      continue
    }
    // Fill blanks / keep the best-valued field from the higher-ranked twin
    if (!prev.title  && c.title)  prev.title  = c.title
    if (!prev.artist && c.artist) prev.artist = c.artist
    if (!prev.album  && c.album)  prev.album  = c.album
    if (!prev.year   && c.year)   prev.year   = c.year
    if (!prev.genre  && c.genre)  prev.genre  = c.genre
    if (!prev.artworkUrl && c.artworkUrl) prev.artworkUrl = c.artworkUrl
    if (prev.durationSec == null && c.durationSec != null) prev.durationSec = c.durationSec
    if (!prev.sources.includes(c.source)) prev.sources.push(c.source)
    if (c.link && !prev.links.includes(c.link) && prev.links.length < 3) prev.links.push(c.link)
    if (c.score > prev.score) prev.score = c.score
  }

  const candidates = [...groups.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ source, link, ...rest }) => rest) // internal fields stay internal

  return { ok: true, candidates }
}

module.exports = { findCandidates, FIND_USER_AGENT }
