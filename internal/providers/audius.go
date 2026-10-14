// Package providers ports Electron's online provider modules to Go:
//   - audius (streaming: search/trending/underground/fresh/playlists)
//   - radiobrowser (live radio directory)
//   - findinfo (keyless metadata lookup: Deezer + iTunes + MusicBrainz)
//
// The op names and result JSON shapes are byte-compatible with the .cjs
// originals so the renderer's provider layer needs no changes.
package providers

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/ConsoleX-ir/aura-player/internal/netcore"
)

const appName = "AuraPlayer"

// ── shared mapping helpers (same semantics as the .cjs mappers) ────────────

func clampLimit(v any, fallback, max int) int {
	n := fallback
	switch x := v.(type) {
	case float64:
		n = int(math.Floor(x))
	case int:
		n = x
	case string:
		if p, err := strconv.Atoi(x); err == nil {
			n = p
		}
	}
	if n <= 0 {
		return fallback
	}
	if n > max {
		return max
	}
	return n
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func pickArtwork(artwork any) string {
	m, ok := artwork.(map[string]any)
	if !ok {
		return ""
	}
	for _, k := range []string{"480x480", "150x150", "1000x1000", "640x640"} {
		if s := str(m[k]); s != "" {
			return s
		}
	}
	return ""
}

// ── Audius ──────────────────────────────────────────────────────────────────

type Audius struct{ C *netcore.Client }

const (
	audiusHostListTTL = 10 * time.Minute
	audiusMaxHosts    = 3
	audiusTimeoutMs   = 9_000
)

// hosts returns the discovery list (api.audius.co first, then failover
// hosts), cached for 10 minutes. A failed discovery degrades to the primary
// host — an optimization only, never an error.
func (a *Audius) hosts(ctx context.Context) []string {
	if v, ok := a.C.CacheGet("audius:hosts"); ok {
		if hosts, ok := v.([]string); ok && len(hosts) > 0 {
			return hosts
		}
	}
	hosts := []string{"https://api.audius.co"}
	var noRetry = 0
	_ = noRetry
	json, err := a.C.ProviderFetch(ctx, "https://api.audius.co", netcore.FetchOptions{
		TimeoutMs: 5000,
		Validate: func(j any) error {
			m, ok := j.(map[string]any)
			if !ok {
				return fmt.Errorf("audius host list: object required")
			}
			data, ok := m["data"].([]any)
			if !ok {
				return fmt.Errorf("audius host list: data[] required")
			}
			for _, h := range data {
				s, _ := h.(string)
				if !strings.HasPrefix(s, "https://") {
					return fmt.Errorf("audius host list: invalid hosts")
				}
			}
			return nil
		},
	})
	if err == nil {
		var discovered []string
		if m, ok := json.(map[string]any); ok {
			if data, ok := m["data"].([]any); ok {
				hostRe := regexp.MustCompile(`^https://[a-z0-9.-]+`)
				for _, h := range data {
					if s, _ := h.(string); hostRe.MatchString(s) {
						discovered = append(discovered, s)
					}
				}
			}
		}
		if len(discovered) > 0 {
			seen := map[string]bool{"https://api.audius.co": true}
			hosts = []string{"https://api.audius.co"}
			for _, h := range discovered {
				if !seen[h] {
					seen[h] = true
					hosts = append(hosts, h)
				}
				if len(hosts) >= 6 {
					break
				}
			}
		}
	}
	a.C.CacheSet("audius:hosts", hosts, audiusHostListTTL)
	return hosts
}

// apiGet runs one Audius call with host failover: validation errors and
// transport failures move to the next host; the LAST typed error wins.
func (a *Audius) apiGet(ctx context.Context, path string, params url.Values, validate func(any) error) (any, error) {
	hosts := a.hosts(ctx)
	q := url.Values{"app_name": {appName}}
	for k, vs := range params {
		for _, v := range vs {
			q.Add(k, v)
		}
	}
	qs := q.Encode()
	var lastErr error
	for _, host := range hosts[:min(audiusMaxHosts, len(hosts))] {
		res, err := a.C.ProviderFetch(ctx, host+path+"?"+qs, netcore.FetchOptions{
			TimeoutMs: audiusTimeoutMs,
			Validate:  validate,
		})
		if err == nil {
			return res, nil
		}
		if ctx.Err() != nil {
			return nil, err
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

// dataArr extracts the validated `data` array from an Audius response.
func dataArr(j any) ([]any, error) {
	m, ok := j.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("audius: object required")
	}
	data, ok := m["data"].([]any)
	if !ok {
		return nil, fmt.Errorf("audius: data[] required")
	}
	return data, nil
}

func tracksShape(j any) error {
	_, err := dataArr(j)
	return err
}

// Track is the provider-agnostic shape the renderer's UI consumes.
type Track struct {
	ID           string   `json:"id"`
	ProviderID   string   `json:"providerId"`
	Title        string   `json:"title"`
	Artist       string   `json:"artist"`
	ArtistHandle *string  `json:"artistHandle"`
	ArtistID     *string  `json:"artistId"`
	Subtitle     string   `json:"subtitle,omitempty"`
	DurationSec  *float64 `json:"durationSec"`
	ArtworkURL   *string  `json:"artworkUrl"`
	StreamURL    *string  `json:"streamUrl"`
	Permalink    *string  `json:"permalink"`
	Popularity   float64  `json:"popularity"`
	IsStreamable bool     `json:"isStreamable"`
}

type Artist struct {
	ID         string  `json:"id"`
	ProviderID string  `json:"providerId"`
	Name       string  `json:"name"`
	Handle     *string `json:"handle"`
	AvatarURL  *string `json:"avatarUrl"`
	Followers  float64 `json:"followers"`
	IsVerified bool    `json:"isVerified"`
}

type Playlist struct {
	ID         string  `json:"id"`
	ProviderID string  `json:"providerId"`
	Name       string  `json:"name"`
	Subtitle   *string `json:"subtitle"`
	Permalink  *string `json:"permalink"`
	Popularity float64 `json:"popularity"`
	TrackCount int     `json:"trackCount"`
	ArtworkURL *string `json:"artworkUrl"`
}

func trackPopularity(t map[string]any) float64 {
	pc := num(t["play_count"])
	fc := num(t["favorite_count"])
	rc := num(t["repost_count"])
	return pc + fc*3 + rc*5
}

func num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case int:
		return float64(x)
	}
	return 0
}

func isTrackStreamable(t map[string]any) bool {
	if s, ok := t["is_streamable"].(bool); ok && !s {
		return false
	}
	if d, ok := t["is_delete"].(bool); ok && d {
		return false
	}
	return num(t["duration"]) > 0
}

func sptr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func fptr(f float64) *float64 {
	return &f
}

func mapAudiusTrack(t map[string]any, host string) Track {
	user, _ := t["user"].(map[string]any)
	title := strings.TrimSpace(str(t["title"]))
	if title == "" {
		title = "Untitled"
	}
	artist := "Unknown Artist"
	var handle, artistID *string
	if user != nil {
		if n := strings.TrimSpace(str(user["name"])); n != "" {
			artist = n
		} else if h := strings.TrimSpace(str(user["handle"])); h != "" {
			artist = h
		}
		if h := str(user["handle"]); h != "" {
			handle = &h
		}
		if id := str(user["id"]); id != "" {
			artistID = &id
		}
	}
	var dur *float64
	if d := num(t["duration"]); d > 0 {
		dur = fptr(d)
	}
	streamable := isTrackStreamable(t)
	var streamURL *string
	if streamable {
		u := host + "/v1/tracks/" + url.PathEscape(str(t["id"])) + "/stream?app_name=" + appName
		streamURL = &u
	}
	var permalink *string
	if p := str(t["permalink"]); p != "" {
		full := "https://audius.co" + p
		permalink = &full
	}
	art := pickArtwork(t["artwork"])
	var artwork *string
	if art != "" {
		artwork = &art
	}
	sub := str(t["genre"])
	return Track{
		ID:           str(t["id"]),
		ProviderID:   "audius",
		Title:        title,
		Artist:       artist,
		ArtistHandle: handle,
		ArtistID:     artistID,
		Subtitle:     sub,
		DurationSec:  dur,
		ArtworkURL:   artwork,
		StreamURL:    streamURL,
		Permalink:    permalink,
		Popularity:   trackPopularity(t),
		IsStreamable: streamable,
	}
}

func mapAudiusUser(u map[string]any) Artist {
	name := strings.TrimSpace(str(u["name"]))
	if name == "" {
		name = strings.TrimSpace(str(u["handle"]))
	}
	if name == "" {
		name = "Unknown Artist"
	}
	var handle *string
	if h := str(u["handle"]); h != "" {
		handle = &h
	}
	var avatar *string
	if a := pickArtwork(u["profile_picture"]); a != "" {
		avatar = &a
	}
	verified, _ := u["is_verified"].(bool)
	return Artist{
		ID:         str(u["id"]),
		ProviderID: "audius",
		Name:       name,
		Handle:     handle,
		AvatarURL:  avatar,
		Followers:  num(u["follower_count"]),
		IsVerified: verified,
	}
}

func mapAudiusPlaylist(p map[string]any) Playlist {
	user, _ := p["user"].(map[string]any)
	name := strings.TrimSpace(str(p["playlist_name"]))
	if name == "" {
		name = "Untitled playlist"
	}
	trackCount := 0
	if contents, ok := p["playlist_contents"].([]any); ok {
		for _, c := range contents {
			if cm, ok := c.(map[string]any); ok {
				if _, has := cm["track_id"]; has {
					trackCount++
				} else if _, has := cm["track"]; has {
					trackCount++
				}
			}
		}
	} else {
		trackCount = int(num(p["track_count"]))
	}
	var subtitle *string
	if user != nil {
		if n := str(user["name"]); n != "" {
			subtitle = &n
		} else if h := str(user["handle"]); h != "" {
			subtitle = &h
		}
	}
	var permalink *string
	if pm := str(p["permalink"]); pm != "" {
		full := "https://audius.co" + pm
		permalink = &full
	}
	var artwork *string
	if a := pickArtwork(p["artwork"]); a != "" {
		artwork = &a
	}
	pop := num(p["favorite_count"])*3 + num(p["repost_count"])*5 + math.Floor(num(p["total_play_count"])/100)
	return Playlist{
		ID:         str(p["id"]),
		ProviderID: "audius",
		Name:       name,
		Subtitle:   subtitle,
		Permalink:  permalink,
		Popularity: pop,
		TrackCount: trackCount,
		ArtworkURL: artwork,
	}
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func trackArtist(t map[string]any) string {
	if user, ok := t["user"].(map[string]any); ok {
		if n := strings.TrimSpace(str(user["name"])); n != "" {
			return n
		}
		if h := strings.TrimSpace(str(user["handle"])); h != "" {
			return h
		}
	}
	return "Unknown Artist"
}

func trackHandle(t map[string]any) *string {
	if user, ok := t["user"].(map[string]any); ok {
		if h := str(user["handle"]); h != "" {
			return &h
		}
	}
	return nil
}

func trackArtistID(t map[string]any) *string {
	if user, ok := t["user"].(map[string]any); ok {
		if id := str(user["id"]); id != "" {
			return &id
		}
	}
	return nil
}

func trackDuration(t map[string]any) *float64 {
	if d := num(t["duration"]); d > 0 {
		return &d
	}
	return nil
}

func artworkPtr(t map[string]any) *string {
	if a := pickArtwork(t["artwork"]); a != "" {
		return &a
	}
	return nil
}

func permalink(t map[string]any) *string {
	if p := str(t["permalink"]); p != "" {
		full := "https://audius.co" + p
		return &full
	}
	return nil
}

func streamURL(t map[string]any, host string) *string {
	if !isTrackStreamable(t) {
		return nil
	}
	u := host + "/v1/tracks/" + url.PathEscape(str(t["id"])) + "/stream?app_name=" + appName
	return &u
}

func (a *Audius) tracksOp(ctx context.Context, path string, params url.Values, host string) (any, error) {
	json, err := a.C.ProviderFetch(ctx, host+path+"?"+withAppName(params), netcore.FetchOptions{
		TimeoutMs: audiusTimeoutMs, Validate: tracksShape,
	})
	if err != nil {
		return nil, err
	}
	return a.wrapTracks(json, host)
}

func (a *Audius) wrapTracks(json any, host string) (any, error) {
	data, err := dataArr(json)
	if err != nil {
		return nil, err
	}
	tracks := make([]any, 0, len(data))
	for _, raw := range data {
		if tm, ok := raw.(map[string]any); ok && str(tm["id"]) != "" {
			tracks = append(tracks, audiusTrackJSON(tm, host))
		}
	}
	return map[string]any{"tracks": tracks}, nil
}

// trackList converts a validated data[] response into the JSON-safe track list.
func (a *Audius) trackList(json any, host string) ([]any, error) {
	data, err := dataArr(json)
	if err != nil {
		return nil, err
	}
	tracks := make([]any, 0, len(data))
	for _, raw := range data {
		if tm, ok := raw.(map[string]any); ok && str(tm["id"]) != "" {
			tracks = append(tracks, audiusTrackJSON(tm, host))
		}
	}
	return tracks, nil
}

func withAppName(params url.Values) string {
	q := url.Values{"app_name": {appName}}
	for k, vs := range params {
		for _, v := range vs {
			q.Add(k, v)
		}
	}
	return q.Encode()
}

func queryOf(params map[string]any, key string) string {
	return strings.TrimSpace(str(params[key]))
}

// SearchTracks implements op searchTracks.
func (a *Audius) SearchTracks(ctx context.Context, params map[string]any) (any, error) {
	q := queryOf(params, "query")
	if q == "" {
		return map[string]any{"tracks": []any{}}, nil
	}
	limit := clampLimit(params["limit"], 20, 100)
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		json, err := a.C.ProviderFetch(ctx, host+"/v1/tracks/search?"+withAppName(url.Values{
			"query": {q}, "limit": {strconv.Itoa(limit)},
		}), netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: tracksShape})
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		return a.wrapTracks(json, host)
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

// SearchArtists implements op searchArtists.
func (a *Audius) SearchArtists(ctx context.Context, params map[string]any) (any, error) {
	q := queryOf(params, "query")
	if q == "" {
		return map[string]any{"artists": []any{}}, nil
	}
	limit := clampLimit(params["limit"], 12, 100)
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		json, err := a.C.ProviderFetch(ctx, host+"/v1/users/search?"+withAppName(url.Values{
			"query": {q}, "limit": {strconv.Itoa(limit)},
		}), netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: tracksShape})
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		data, err := dataArr(json)
		if err != nil {
			lastErr = err
			continue
		}
		artists := []any{}
		for _, raw := range data {
			u, ok := raw.(map[string]any)
			if !ok || str(u["id"]) == "" {
				continue
			}
			artists = append(artists, map[string]any{
				"id": str(u["id"]), "providerId": "audius",
				"name": userName(u), "handle": userHandle(u),
				"avatarUrl": userAvatar(u), "followers": num(u["follower_count"]),
				"isVerified": boolOf(u["is_verified"]),
			})
		}
		return map[string]any{"artists": artists}, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

func userName(u map[string]any) string {
	if n := strings.TrimSpace(str(u["name"])); n != "" {
		return n
	}
	if h := strings.TrimSpace(str(u["handle"])); h != "" {
		return h
	}
	return "Unknown Artist"
}

func userHandle(u map[string]any) *string {
	if h := str(u["handle"]); h != "" {
		return &h
	}
	return nil
}

func userAvatar(u map[string]any) *string {
	if a := pickArtwork(u["profile_picture"]); a != "" {
		return &a
	}
	return nil
}

func boolOf(v any) bool {
	b, _ := v.(bool)
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Trending implements op trending (5-min cache per host).
func (a *Audius) Trending(ctx context.Context, params map[string]any) (any, error) {
	limit := clampLimit(params["limit"], 24, 100)
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		json, err := a.C.CachedJSON(ctx, fmt.Sprintf("audius:trending:%d:%s", limit, host), 5*time.Minute, func() (any, error) {
			return a.C.ProviderFetch(ctx, host+"/v1/tracks/trending?"+withAppName(url.Values{
				"limit": {strconv.Itoa(limit)},
			}), netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: tracksShape})
		})
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		return a.wrapTracks(json, host)
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

// Underground implements op underground (5-min cache per host).
func (a *Audius) Underground(ctx context.Context, params map[string]any) (any, error) {
	limit := clampLimit(params["limit"], 24, 100)
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		json, err := a.C.CachedJSON(ctx, fmt.Sprintf("audius:underground:%d:%s", limit, host), 5*time.Minute, func() (any, error) {
			return a.C.ProviderFetch(ctx, host+"/v1/tracks/trending/underground?"+withAppName(url.Values{
				"limit": {strconv.Itoa(limit)},
			}), netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: tracksShape})
		})
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		return a.wrapTracks(json, host)
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

// ArtistTracks implements op artistTracks (sorted by plays).
func (a *Audius) ArtistTracks(ctx context.Context, params map[string]any) (any, error) {
	id := queryOf(params, "artistId")
	if id == "" {
		return map[string]any{"artist": nil, "tracks": []any{}}, nil
	}
	limit := clampLimit(params["limit"], 24, 100)
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		json, err := a.C.ProviderFetch(ctx, host+"/v1/users/"+url.PathEscape(id)+"/tracks?"+withAppName(url.Values{
			"limit": {strconv.Itoa(limit)}, "sort": {"plays"},
		}), netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: tracksShape})
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		tracks, err := a.trackList(json, host)
		if err != nil {
			lastErr = err
			continue
		}
		var artist any
		if data, derr := dataArr(json); derr == nil && len(data) > 0 {
			if t0, ok := data[0].(map[string]any); ok {
				if user, ok := t0["user"].(map[string]any); ok {
					artist = map[string]any{
						"id": str(user["id"]), "providerId": "audius",
						"name": userName(user), "handle": userHandle(user),
						"avatarUrl": userAvatar(user), "followers": num(user["follower_count"]),
						"isVerified": boolOf(user["is_verified"]),
					}
				}
			}
		}
		return map[string]any{"artist": artist, "tracks": tracks}, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

// Fresh implements op fresh — weekly trending pool sorted by release date
// (Audius has no release-date endpoint; labeled fresh+trending in the UI).
func (a *Audius) Fresh(ctx context.Context, params map[string]any) (any, error) {
	limit := clampLimit(params["limit"], 24, 100)
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		json, err := a.C.CachedJSON(ctx, fmt.Sprintf("audius:fresh:%d:%s", limit, host), 5*time.Minute, func() (any, error) {
			return a.C.ProviderFetch(ctx, host+"/v1/tracks/trending?"+withAppName(url.Values{
				"time": {"week"}, "limit": {"100"},
			}), netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: tracksShape})
		})
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		data, err := dataArr(json)
		if err != nil {
			lastErr = err
			continue
		}
		valid := make([]map[string]any, 0, len(data))
		for _, raw := range data {
			if t, ok := raw.(map[string]any); ok && str(t["id"]) != "" {
				valid = append(valid, t)
			}
		}
		sort.SliceStable(valid, func(i, j int) bool {
			ti := parseDate(str(valid[i]["release_date"]))
			tj := parseDate(str(valid[j]["release_date"]))
			return ti.After(tj)
		})
		if len(valid) > limit {
			valid = valid[:limit]
		}
		tracks := make([]any, 0, len(valid))
		for _, t := range valid {
			tracks = append(tracks, audiusTrackJSON(t, host))
		}
		return map[string]any{"tracks": tracks}, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

func parseDate(s string) time.Time {
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

// anyStr dereferences optional strings into plain interface values so the
// JSON the renderer sees is `null` (not a typed nil pointer) when absent.
func anyStr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func anyF(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func audiusTrackJSON(t map[string]any, host string) map[string]any {
	return map[string]any{
		"id": str(t["id"]), "providerId": "audius",
		"title":  orDefault(strings.TrimSpace(str(t["title"])), "Untitled"),
		"artist": trackArtist(t), "artistHandle": anyStr(trackHandle(t)), "artistId": anyStr(trackArtistID(t)),
		"subtitle": str(t["genre"]), "durationSec": anyF(trackDuration(t)),
		"artworkUrl": anyStr(artworkPtr(t)), "streamUrl": anyStr(streamURL(t, host)),
		"permalink": anyStr(permalink(t)), "popularity": trackPopularity(t),
		"isStreamable": isTrackStreamable(t),
	}
}

func (a *Audius) playlistsOp(ctx context.Context, op string, path string, params map[string]any, cacheKey string, ttl time.Duration) (any, error) {
	limit := clampLimit(params["limit"], 12, 100)
	shape := func(j any) error { _, err := dataArr(j); return err }
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		var json any
		var err error
		if cacheKey != "" {
			json, err = a.C.CachedJSON(ctx, fmt.Sprintf("%s:%d:%s", cacheKey, limit, host), ttl, func() (any, error) {
				return a.C.ProviderFetch(ctx, host+path+"?"+withAppName(url.Values{"limit": {strconv.Itoa(limit)}}),
					netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: shape})
			})
		} else {
			json, err = a.C.ProviderFetch(ctx, host+path+"?"+withAppName(url.Values{"limit": {strconv.Itoa(limit)}}),
				netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: shape})
		}
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		data, derr := dataArr(json)
		if derr != nil {
			lastErr = derr
			continue
		}
		playlists := make([]any, 0, len(data))
		for _, raw := range data {
			if p, ok := raw.(map[string]any); ok && str(p["id"]) != "" {
				pl := mapAudiusPlaylist(p)
				playlists = append(playlists, map[string]any{
					"id": pl.ID, "providerId": pl.ProviderID, "name": pl.Name,
					"subtitle": pl.Subtitle, "permalink": pl.Permalink,
					"popularity": pl.Popularity, "trackCount": pl.TrackCount,
					"artworkUrl": pl.ArtworkURL,
				})
			}
		}
		return map[string]any{"playlists": playlists}, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

// SearchPlaylists implements op searchPlaylists.
func (a *Audius) SearchPlaylists(ctx context.Context, params map[string]any) (any, error) {
	q := queryOf(params, "query")
	if q == "" {
		return map[string]any{"playlists": []any{}}, nil
	}
	limit := clampLimit(params["limit"], 12, 100)
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		json, err := a.C.ProviderFetch(ctx, host+"/v1/playlists/search?"+withAppName(url.Values{
			"query": {q}, "limit": {strconv.Itoa(limit)},
		}), netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: tracksShape})
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		data, derr := dataArr(json)
		if derr != nil {
			lastErr = derr
			continue
		}
		playlists := make([]any, 0, len(data))
		for _, raw := range data {
			if p, ok := raw.(map[string]any); ok && str(p["id"]) != "" {
				pl := mapAudiusPlaylist(p)
				playlists = append(playlists, map[string]any{
					"id": pl.ID, "providerId": pl.ProviderID, "name": pl.Name,
					"subtitle": pl.Subtitle, "permalink": pl.Permalink,
					"popularity": pl.Popularity, "trackCount": pl.TrackCount,
					"artworkUrl": pl.ArtworkURL,
				})
			}
		}
		return map[string]any{"playlists": playlists}, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}

// TrendingPlaylists implements op trendingPlaylists (10-min cache).
func (a *Audius) TrendingPlaylists(ctx context.Context, params map[string]any) (any, error) {
	return a.playlistsOp(ctx, "trendingPlaylists", "/v1/playlists/trending", params, "audius:playlists", 10*time.Minute)
}

// PlaylistTracks implements op playlistTracks (full track objects).
func (a *Audius) PlaylistTracks(ctx context.Context, params map[string]any) (any, error) {
	id := queryOf(params, "playlistId")
	if id == "" {
		return map[string]any{"playlist": nil, "tracks": []any{}}, nil
	}
	var lastErr error
	for _, host := range a.hosts(ctx)[:min(audiusMaxHosts, len(a.hosts(ctx)))] {
		json, err := a.C.ProviderFetch(ctx, host+"/v1/playlists/"+url.PathEscape(id)+"/tracks?"+withAppName(url.Values{}),
			netcore.FetchOptions{TimeoutMs: audiusTimeoutMs, Validate: tracksShape})
		if err != nil {
			if ctx.Err() != nil {
				return nil, err
			}
			lastErr = err
			continue
		}
		return a.wrapTracks(json, host)
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, &netcore.FetchError{Kind: netcore.KindNetwork, Message: "All Audius hosts failed"}
}
