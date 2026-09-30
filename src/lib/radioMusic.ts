// ── Radio music-focus filter (Aura 3.0 — spec §9) ───────────────────────────
// Radio Browser is a GENERAL station directory: its top-voted lists and its
// tag facets are full of news / talk / politics / sports / religious-talk
// stations. Aura's Radio tab is a MUSIC surface — spec §9 says to remove or
// filter the non-music side of the directory.
//
// Rules locked by the spec:
//   • Metadata-driven only. Decisions use the station's TAGS (the directory's
//     own categories) — never the station NAME (§9: "Do not make unsafe
//     assumptions based solely on station names").
//   • A station with NO tag data is KEPT: no categories means no evidence,
//     and hiding a possibly-music station would be the same mistake in
//     reverse.
//   • Genre FACET chips are filtered with the same marker list, so the
//     dropdown curates toward music categories instead of offering "News"
//     as a browsing genre.
//   • User-curated surfaces (radio favorites) are NOT filtered — an explicit
//     user choice outranks the directory's categories.
//
// Deliberately dependency-free (no @/ imports) so the node unit suite can
// import it directly.

/**
 * Non-music category markers, matched as whole words inside a station's
 * combined tag string. Conservative by design — the explicit spec categories
 * (news / talk / politics / religious talk) plus the unambiguous non-music
 * directory categories. Music genres NEVER match: 'gospel', 'christian
 * music', 'worship' etc. stay (a genre tag containing "christmas" or
 * "gospel" is music; "religion"/"prayer"/"sermon" is talk).
 */
const NON_MUSIC_MARKERS: RegExp =
  /\b(news|talk|talkshow|discussion|debate|interview|politics|political|government|elections?|sport|sports|football|soccer|baseball|basketball|cricket|tennis|golf|formula1|comedy|science|education|educational|business|finance|economy|weather|traffic|history|philosophy|society|culture|cultural|literature|religion|religious|spiritual(?:ity)?|prayer|sermon|bible|podcast|storytelling|audiobook)\b/i

/** True when the tag text contains a non-music category marker. */
export function isNonMusicTagText(tagText: string | null | undefined): boolean {
  if (!tagText) return false
  return NON_MUSIC_MARKERS.test(tagText)
}

/**
 * Should this station be listed in Aura's music-focused Radio tab?
 * Untagged stations are kept (no category evidence — see module header);
 * tagged stations are dropped only on an explicit non-music marker.
 */
export function isMusicStation(tags?: string[] | null): boolean {
  if (!tags || tags.length === 0) return true
  return !isNonMusicTagText(tags.join(', '))
}

/** Type-free station shape the filter works on (structural, no imports). */
interface Tagged {
  tags?: string[] | null
}

/** Filter a station list down to music stations (order preserved). */
export function filterMusicStations<T extends Tagged>(stations: T[]): T[] {
  return stations.filter((s) => isMusicStation(s.tags))
}

/**
 * Filter a genre-facet list the same way, so the Genre dropdown offers music
 * categories (pop, rock, jazz, …) rather than the directory's talk genres.
 */
export function filterMusicFacets<F extends { value: string }>(facets: F[]): F[] {
  return facets.filter((f) => !isNonMusicTagText(f.value))
}
