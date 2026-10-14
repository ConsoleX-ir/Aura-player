// Find Info Online — Go port of electron/findinfo.cjs. Keyless song-metadata
// lookup across Deezer + iTunes + MusicBrainz. Each source may fail
// independently; only when EVERY source errors does the caller see a network
// error. Scoring and cross-source merging are byte-compatible with the .cjs
// original (Dice bigrams over normalized strings).
package providers

import (
	"context"
	"math"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"github.com/ConsoleX-ir/aura-player/internal/netcore"
	"golang.org/x/text/unicode/norm"
)

const findUserAgent = "AuraPlayer/3.2.0 (desktop music player)"

// FindInfo implements the findinfo provider.
type FindInfo struct{ C *netcore.Client }

// normStr lowercases, strips diacritics (NFD decompose + drop combining
// marks — same result as JS's NFKD + \p{M} strip for practical inputs) and
// collapses whitespace.
func normStr(s string) string {
	var b strings.Builder
	for _, r := range []rune(norm.NFD.String(strings.ToLower(s))) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(r)
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

var (
	siteWatermark = regexp.MustCompile(`(?i)\s+[A-Z0-9]{3,}\.[A-Z]{2,4}$`)
	parenJunk     = regexp.MustCompile(`\s*\(.*?\)\s*`)
	bracketJunk   = regexp.MustCompile(`\s*\[.*?\]\s*`)
)

// cleanTag strips "(feat. X)", "[Radio Edit]" and site-watermark suffixes.
func cleanTag(s string) string {
	s = siteWatermark.ReplaceAllString(s, "")
	s = parenJunk.ReplaceAllString(s, " ")
	s = bracketJunk.ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(s), " ")
}

// dice is the Sørensen–Dice coefficient over character bigrams.
func dice(a, b string) float64 {
	if a == b {
		return 1
	}
	if len(a) < 2 || len(b) < 2 {
		return 0
	}
	grams := make(map[string]int, len(a))
	for i := 0; i < len(a)-1; i++ {
		grams[a[i:i+2]]++
	}
	hits := 0
	for i := 0; i < len(b)-1; i++ {
		g := b[i : i+2]
		if n := grams[g]; n > 0 {
			hits++
			grams[g] = n - 1
		}
	}
	return (2 * float64(hits)) / (float64(len(a)-1) + float64(len(b)-1))
}

func durationScore(queryDur, candDurSec float64) float64 {
	if queryDur == 0 || candDurSec == 0 {
		return 0.5 // unknown → neutral, don't punish
	}
	delta := math.Abs(queryDur - candDurSec)
	return math.Max(0, 1-delta/15)
}

// candidate mirrors one raw source result before merging.
type candidate struct {
	source      string
	title       *string
	artist      *string
	album       *string
	year        *int
	genre       *string
	durationSec *float64
	artworkUrl  *string
	link        *string
	score       float64
}

func scoreCandidate(q FindQuery, c candidate) float64 {
	t := dice(normStr(cleanTag(q.Title)), normStr(cleanTag(deref(c.title))))
	a := dice(normStr(cleanTag(q.Artist)), normStr(cleanTag(deref(c.artist))))
	al := 0.0
	if q.Album != "" {
		al = dice(normStr(cleanTag(q.Album)), normStr(cleanTag(deref(c.album))))
	}
	d := durationScore(q.Duration, derefF(c.durationSec))
	return t*0.45 + a*0.30 + al*0.10 + d*0.15
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefF(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}

// FindQuery is the renderer's FindMetadataQuery.
type FindQuery struct {
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Album    string  `json:"album"`
	Duration float64 `json:"duration"`
}

func (f *FindInfo) fetchJSON(ctx context.Context, urlStr string, headers map[string]string, timeoutMs int) (any, error) {
	if timeoutMs <= 0 {
		timeoutMs = 9000
	}
	retries := 1
	return f.C.ProviderFetch(ctx, urlStr, netcore.FetchOptions{
		TimeoutMs: timeoutMs,
		Retries:   &retries,
		Headers:   headers,
	})
}

func (f *FindInfo) searchDeezer(ctx context.Context, q FindQuery) ([]candidate, error) {
	term := strings.TrimSpace(strings.TrimSpace(cleanTag(q.Artist)) + " " + strings.TrimSpace(cleanTag(q.Title)))
	if term == "" {
		return nil, nil
	}
	json, err := f.fetchJSON(ctx, "https://api.deezer.com/search?q="+queryEscape(term)+"&limit=8", nil, 9000)
	if err != nil {
		return nil, err
	}
	data, _ := json.(map[string]any)["data"].([]any)
	out := make([]candidate, 0, len(data))
	for _, raw := range data {
		t, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		c := candidate{source: "deezer"}
		if v := str(t["title"]); v != "" {
			c.title = &v
		}
		if artist, ok := t["artist"].(map[string]any); ok {
			if v := str(artist["name"]); v != "" {
				c.artist = &v
			}
		}
		if album, ok := t["album"].(map[string]any); ok {
			if v := str(album["title"]); v != "" {
				c.album = &v
			}
			art := firstNonEmptyStr(str(album["cover_xl"]), str(album["cover_big"]), str(album["cover_medium"]))
			if art != "" {
				c.artworkUrl = &art
			}
		}
		if d := num(t["duration"]); d > 0 {
			c.durationSec = &d
		}
		if v := str(t["link"]); v != "" {
			c.link = &v
		}
		out = append(out, c)
	}
	return out, nil
}

func queryEscape(s string) string {
	// Matches JS encodeURIComponent: keep unreserved chars, escape the rest.
	var b strings.Builder
	for _, ch := range []byte(s) {
		c := rune(ch)
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9',
			c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(ch)
		default:
			const hex = "0123456789ABCDEF"
			b.WriteByte('%')
			b.WriteByte(hex[ch>>4])
			b.WriteByte(hex[ch&0xf])
		}
	}
	return b.String()
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func (f *FindInfo) searchITunes(ctx context.Context, q FindQuery) ([]candidate, error) {
	term := strings.TrimSpace(strings.TrimSpace(cleanTag(q.Artist)) + " " + strings.TrimSpace(cleanTag(q.Title)))
	if term == "" {
		return nil, nil
	}
	json, err := f.fetchJSON(ctx, "https://itunes.apple.com/search?term="+queryEscape(term)+"&media=music&entity=song&limit=8", nil, 9000)
	if err != nil {
		return nil, err
	}
	results, _ := json.(map[string]any)["results"].([]any)
	out := make([]candidate, 0, len(results))
	for _, raw := range results {
		t, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		c := candidate{source: "itunes"}
		if v := str(t["trackName"]); v != "" {
			c.title = &v
		}
		if v := str(t["artistName"]); v != "" {
			c.artist = &v
		}
		if v := str(t["collectionName"]); v != "" {
			c.album = &v
		}
		if rd := str(t["releaseDate"]); len(rd) >= 4 {
			y := 0
			for _, ch := range rd[:4] {
				if ch < '0' || ch > '9' {
					y = 0
					break
				}
				y = y*10 + int(ch-'0')
			}
			if y > 0 {
				c.year = &y
			}
		}
		if v := str(t["primaryGenreName"]); v != "" {
			c.genre = &v
		}
		if ms := num(t["trackTimeMillis"]); ms > 0 {
			sec := math.Round(ms / 1000)
			c.durationSec = &sec
		}
		if v := str(t["artworkUrl100"]); v != "" {
			art := strings.ReplaceAll(v, "100x100bb", "600x600bb")
			c.artworkUrl = &art
		}
		if v := str(t["trackViewUrl"]); v != "" {
			c.link = &v
		}
		out = append(out, c)
	}
	return out, nil
}

func (f *FindInfo) searchMusicBrainz(ctx context.Context, q FindQuery) ([]candidate, error) {
	var parts []string
	if t := cleanTag(q.Title); t != "" {
		parts = append(parts, `recording:"`+strings.ReplaceAll(t, `"`, ``)+`"`)
	}
	if a := cleanTag(q.Artist); a != "" {
		parts = append(parts, `artist:"`+strings.ReplaceAll(a, `"`, ``)+`"`)
	}
	if len(parts) == 0 {
		return nil, nil
	}
	urlStr := "https://musicbrainz.org/ws/2/recording?query=" + queryEscape(strings.Join(parts, " AND ")) + "&fmt=json&limit=8"
	// MusicBrainz asks clients to identify themselves; one request per
	// explicit user search fits their rate guidance.
	json, err := f.fetchJSON(ctx, urlStr, map[string]string{"User-Agent": findUserAgent}, 10000)
	if err != nil {
		return nil, err
	}
	recordings, _ := json.(map[string]any)["recordings"].([]any)
	out := make([]candidate, 0, len(recordings))
	for _, raw := range recordings {
		r, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		c := candidate{source: "musicbrainz"}
		if v := str(r["title"]); v != "" {
			c.title = &v
		}
		var names []string
		if credits, ok := r["artist-credit"].([]any); ok {
			for _, cr := range credits {
				cm, ok := cr.(map[string]any)
				if !ok {
					continue
				}
				if n := str(cm["name"]); n != "" {
					names = append(names, n)
					continue
				}
				if artist, ok := cm["artist"].(map[string]any); ok {
					if n := str(artist["name"]); n != "" {
						names = append(names, n)
					}
				}
			}
		}
		if len(names) > 0 {
			j := strings.Join(names, ", ")
			c.artist = &j
		}
		if releases, ok := r["releases"].([]any); ok && len(releases) > 0 {
			if rel, ok := releases[0].(map[string]any); ok {
				if v := str(rel["title"]); v != "" {
					c.album = &v
				}
			}
			for _, rel := range releases {
				rm, ok := rel.(map[string]any)
				if !ok {
					continue
				}
				if d := str(rm["date"]); d != "" {
					y := 0
					for _, ch := range d {
						if ch < '0' || ch > '9' {
							break
						}
						y = y*10 + int(ch-'0')
					}
					if y > 0 {
						c.year = &y
					}
					break
				}
			}
		}
		if ms := num(r["length"]); ms > 0 {
			sec := math.Round(ms / 1000)
			c.durationSec = &sec
		}
		if id := str(r["id"]); id != "" {
			l := "https://musicbrainz.org/recording/" + id
			c.link = &l
		}
		out = append(out, c)
	}
	return out, nil
}

// Find implements the findCandidates flow: all three sources in parallel,
// scored, near-duplicates merged, top 8 returned.
func (f *FindInfo) Find(ctx context.Context, q FindQuery) (any, error) {
	if cleanTag(q.Title) == "" && cleanTag(q.Artist) == "" {
		return map[string]any{"ok": false, "error": "empty_query"}, nil
	}

	type result struct {
		cands []candidate
		err   error
	}
	ch := make(chan result, 3)
	go func() {
		c, err := f.searchDeezer(ctx, q)
		ch <- result{c, err}
	}()
	go func() {
		c, err := f.searchITunes(ctx, q)
		ch <- result{c, err}
	}()
	go func() {
		c, err := f.searchMusicBrainz(ctx, q)
		ch <- result{c, err}
	}()

	anyResolved := false
	var scored []candidate
	for i := 0; i < 3; i++ {
		res := <-ch
		if res.err == nil {
			anyResolved = true
			for _, c := range res.cands {
				c.score = scoreCandidate(q, c)
				scored = append(scored, c)
			}
		}
	}
	if !anyResolved {
		return map[string]any{"ok": false, "error": "network_error"}, nil
	}

	sort.SliceStable(scored, func(i, j int) bool { return scored[i].score > scored[j].score })

	type group struct {
		best    map[string]any
		sources []string
		links   []string
		score   float64
	}
	groups := make(map[string]*group)
	var order []string
	for _, c := range scored {
		key := normStr(cleanTag(deref(c.title))) + "|" + normStr(firstSegment(cleanTag(deref(c.artist))))
		g, ok := groups[key]
		if !ok {
			g = &group{
				best: map[string]any{
					"title": c.title, "artist": c.artist, "album": c.album,
					"year": c.year, "genre": c.genre, "durationSec": c.durationSec,
					"artworkUrl": c.artworkUrl,
				},
				sources: []string{c.source},
				links:   linksOf(c.link),
				score:   c.score,
			}
			groups[key] = g
			order = append(order, key)
			continue
		}
		fillStr(g.best, "title", c.title)
		fillStr(g.best, "artist", c.artist)
		fillStr(g.best, "album", c.album)
		fillNum(g.best, "year", c.year)
		fillStr(g.best, "genre", c.genre)
		fillStr(g.best, "artworkUrl", c.artworkUrl)
		if g.best["durationSec"] == nil && c.durationSec != nil {
			g.best["durationSec"] = c.durationSec
		}
		if !contains(g.sources, c.source) {
			g.sources = append(g.sources, c.source)
		}
		if c.link != nil && !contains(g.links, *c.link) && len(g.links) < 3 {
			g.links = append(g.links, *c.link)
		}
		if c.score > g.score {
			g.score = c.score
		}
	}

	type merged struct {
		key   string
		score float64
	}
	list := make([]merged, 0, len(order))
	for _, k := range order {
		list = append(list, merged{k, groups[k].score})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].score > list[j].score })
	if len(list) > 8 {
		list = list[:8]
	}

	candidates := make([]map[string]any, 0, len(list))
	for _, m := range list {
		g := groups[m.key]
		candidates = append(candidates, map[string]any{
			"title": g.best["title"], "artist": g.best["artist"], "album": g.best["album"],
			"year": g.best["year"], "genre": g.best["genre"], "durationSec": g.best["durationSec"],
			"artworkUrl": g.best["artworkUrl"], "sources": g.sources, "links": g.links,
			"score": g.score,
		})
	}
	return map[string]any{"ok": true, "candidates": candidates}, nil
}

func firstSegment(s string) string {
	if i := strings.Index(s, ","); i >= 0 {
		return s[:i]
	}
	return s
}

func linksOf(l *string) []string {
	if l == nil {
		return []string{}
	}
	return []string{*l}
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func fillStr(m map[string]any, key string, v *string) {
	if m[key] == nil && v != nil {
		m[key] = v
	}
}

func fillNum(m map[string]any, key string, v *int) {
	if m[key] == nil && v != nil {
		m[key] = v
	}
}
