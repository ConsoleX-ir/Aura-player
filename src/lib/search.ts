import type { Song } from '@/types'

// ── Aura library search (Phase 1 — Library 2.0) ─────────────────────────────
// Pure, React-free query parsing + matching shared by every search surface in
// the app (Library view now; Command Palette / global search in Phase 2).
//
// Grammar (all case-insensitive, whitespace-separated, AND-composed):
//   free text            → substring match on title, artist, album, genre
//   title: needle        → substring on title
//   artist: needle       → substring on artist
//   album: needle        → substring on album
//   genre: needle        → substring on genre
//   year: 1994           → exact year match
//   "quoted phrase"      → spaces kept intact (works with or without a field)
//
// Examples:
//   `artist: aurora "run away"`  → artist contains 'aurora' AND title etc.
//                                  contains the phrase 'run away'
//   `genre: jazz year:1994`      → genre contains 'jazz' AND year === 1994

export type SearchField = 'title' | 'artist' | 'album' | 'genre' | 'year'

export interface SearchToken {
  field: SearchField | null
  /** Lowercased needle (already quote-stripped). Empty tokens are dropped. */
  text: string
  /** Set when field === 'year' and the text parses as a year number. */
  year: number | null
}

const FIELD_RE = /^(title|artist|album|genre|year):(.*)$/i

/**
 * Parses a raw query string into AND-composed tokens. Malformed field
 * prefixes (`artist:` with no value) are dropped rather than treated as
 * literal text — an empty needle can never match, so keeping it would turn
 * a half-typed query into "no results", which reads like breakage.
 */
export function parseSearchQuery(raw: string): SearchToken[] {
  const tokens: SearchToken[] = []
  let i = 0
  const n = raw.length
  // `field:` followed by whitespace (e.g. `artist: "run away"`) holds the
  // field open until the next chunk — quoted or plain — becomes its value.
  let pendingField: SearchField | null = null

  const push = (field: SearchField | null, value: string) => {
    const text = value.toLowerCase()
    if (!text) return
    const year = field === 'year' ? Number.parseInt(value, 10) : null
    tokens.push({
      field,
      text,
      year: year !== null && Number.isFinite(year) ? year : null,
    })
  }

  while (i < n) {
    // Skip whitespace between tokens.
    while (i < n && /\s/.test(raw[i])) i++
    if (i >= n) break

    let quoted = false
    if (raw[i] === '"') {
      quoted = true
      i++
    }

    let body = ''
    if (quoted) {
      // A quoted phrase runs to the closing quote (or end of input — an
      // unclosed quote still searches for what the user typed so far).
      const end = raw.indexOf('"', i)
      body = end === -1 ? raw.slice(i) : raw.slice(i, end)
      i = end === -1 ? n : end + 1
    } else {
      let j = i
      while (j < n && !/\s/.test(raw[j])) j++
      body = raw.slice(i, j)
      i = j
    }

    if (!body) continue

    if (quoted) {
      // A quoted chunk is a complete value on its own — attach it to any
      // pending field prefix, otherwise it's free text.
      push(pendingField, body)
      pendingField = null
      continue
    }

    const m = FIELD_RE.exec(body)
    if (m) {
      const field = m[1].toLowerCase() as SearchField
      let value = m[2].trim()
      // `field:"quoted value"` — the quotes ride inside the same token.
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1)
      }
      if (!value) {
        // Bare prefix (`artist: "run away"` or a half-typed query) — hold
        // the field open for the next chunk; if the query ends here the
        // pending field simply never produces a token.
        pendingField = field
        continue
      }
      push(field, value)
    } else {
      push(pendingField, body)
      pendingField = null
    }
  }

  return tokens
}

function includes(haystack: string | null | undefined, needle: string): boolean {
  return !!haystack && haystack.toLowerCase().includes(needle)
}

/** Does this one song satisfy every token? (AND semantics) */
export function matchSong(song: Song, tokens: SearchToken[]): boolean {
  for (const t of tokens) {
    if (t.field === null) {
      // Free text: the broad net — title, artist, album, genre, and (for
      // numeric queries like "1994") the year as a string.
      const hit =
        includes(song.title, t.text) ||
        includes(song.artist, t.text) ||
        includes(song.album, t.text) ||
        includes(song.genre, t.text) ||
        (song.year != null && String(song.year).includes(t.text))
      if (!hit) return false
    } else if (t.field === 'year') {
      if (t.year === null || song.year !== t.year) return false
    } else if (t.field === 'title') {
      if (!includes(song.title, t.text)) return false
    } else if (t.field === 'artist') {
      if (!includes(song.artist, t.text)) return false
    } else if (t.field === 'album') {
      if (!includes(song.album, t.text)) return false
    } else if (t.field === 'genre') {
      if (!includes(song.genre, t.text)) return false
    }
  }
  return true
}

/** One-shot helper for simple call sites: filter a song list by raw query. */
export function filterSongs(songs: Song[], rawQuery: string): Song[] {
  const tokens = parseSearchQuery(rawQuery)
  if (tokens.length === 0) return songs
  return songs.filter((s) => matchSong(s, tokens))
}

// ── Fuzzy scoring (shared with the Command Palette) ─────────────────────────
// Subsequence match with a substring boost. Lives HERE (not inside the
// palette component) so every search surface scores identically — Phase 2's
// "one shared search architecture" rule.
//
//   100  prefix match      — what you typed starts the name
//   80-x  substring        — earlier is better
//    40  subsequence      — every query char appears in order
//    -1  no match

/** Subsequence match with a substring boost — returns score or -1. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx === 0) return 100        // prefix match — what you typed starts the name
  if (idx > 0) return 80 - Math.min(idx, 20)
  // Subsequence: every query char appears in order somewhere.
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    ti = t.indexOf(q[qi], ti)
    if (ti === -1) return -1
    ti++
  }
  return 40
}

export interface LibrarySearchResult {
  /** Songs matching the query — exact (operator/substring) or fuzzy. */
  matches: Song[]
  /**
   * True when exact matching found nothing and these results are fuzzy
   * close-matches. Callers surface a "close matches" hint so the user can
   * tell the two modes apart.
   */
  fuzzy: boolean
}

/**
 * The one library-search entry point (Phase 2 — Search & Navigation 2.0):
 * exact operator/substring matching first; when that yields NOTHING and the
 * query has no field operators (a typo inside `artist:` is a constraint the
 * user wrote on purpose, not a spelling mistake to forgive), fall back to
 * fuzzy close-matches ranked by their best field score.
 */
export function searchLibrary(songs: Song[], rawQuery: string, fuzzyLimit = 40): LibrarySearchResult {
  const tokens = parseSearchQuery(rawQuery)
  if (tokens.length === 0) return { matches: songs, fuzzy: false }

  const exact = songs.filter((s) => matchSong(s, tokens))
  if (exact.length > 0) return { matches: exact, fuzzy: false }

  if (tokens.some((t) => t.field !== null)) {
    // An operator the user typed — respect it literally. `artist: aurra`
    // returning every fuzzy title would read as broken filtering.
    return { matches: [], fuzzy: false }
  }

  const q = rawQuery.trim()
  const scored: { song: Song; score: number }[] = []
  for (const song of songs) {
    const best = Math.max(
      fuzzyScore(q, song.title),
      fuzzyScore(q, song.artist) * 0.6,
      fuzzyScore(q, song.album) * 0.4,
    )
    if (best >= 0) scored.push({ song, score: best })
  }
  scored.sort((a, b) => b.score - a.score)
  return { matches: scored.slice(0, fuzzyLimit).map((s) => s.song), fuzzy: true }
}
