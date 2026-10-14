// Radio Browser provider — Go port of electron/providers/radiobrowser.cjs.
// Same endpoints, same result shapes, same honest station mapping.
package providers

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ConsoleX-ir/aura-player/internal/netcore"
)

const radioBase = "https://all.api.radio-browser.info"

const (
	radioFacetTTL  = 24 * time.Hour
	radioSearchTTL = 5 * time.Minute
	radioTimeoutMs = 9_000
)

type RadioBrowser struct{ C *netcore.Client }

func radioClampLimit(v any, fallback int) int {
	return clampLimit(v, fallback, 200)
}

// cleanStationName normalizes tabs/control chars out of station names.
func cleanStationName(name string) string {
	name = strings.NewReplacer("\t", " ", "\n", " ", "\r", " ").Replace(name)
	fields := strings.Fields(name)
	return strings.Join(fields, " ")
}

func isStationPlayable(s map[string]any) bool {
	u := str(s["url_resolved"])
	if !strings.HasPrefix(u, "http") {
		return false
	}
	switch v := s["lastcheckok"].(type) {
	case float64:
		return v != 0
	case bool:
		return v
	}
	return true
}

func stationPopularity(s map[string]any) float64 {
	return num(s["votes"])*2 + num(s["clickcount"]) + num(s["clicktrend"])*3
}

func mapStation(s map[string]any) map[string]any {
	tagsRaw := str(s["tags"])
	var tags []string
	for _, t := range strings.Split(tagsRaw, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			tags = append(tags, t)
		}
		if len(tags) == 3 {
			break
		}
	}
	var tagList any
	if len(tags) > 0 {
		tagList = tags
	} else {
		tagList = []string{}
	}

	subtitleParts := []string{}
	if codec := str(s["codec"]); codec != "" {
		subtitleParts = append(subtitleParts, strings.ToUpper(codec))
	}
	if br := num(s["bitrate"]); br > 0 {
		subtitleParts = append(subtitleParts, strconv.Itoa(int(br))+" kbps")
	}
	if len(tags) > 0 {
		subtitleParts = append(subtitleParts, strings.Join(tags, ", "))
	}
	subtitle := strings.Join(subtitleParts, " · ")

	var artwork *string
	if f := str(s["favicon"]); strings.HasPrefix(f, "http") {
		artwork = &f
	}
	playable := isStationPlayable(s)
	var streamURL any
	if playable {
		streamURL = str(s["url_resolved"])
	}
	var permalink *string
	if h := str(s["homepage"]); strings.HasPrefix(h, "http") {
		permalink = &h
	}
	language := ""
	if l := str(s["language"]); l != "" {
		language = strings.TrimSpace(strings.Split(l, ",")[0])
	}
	var langPtr *string
	if language != "" {
		langPtr = &language
	}
	var cc *string
	if v := str(s["countrycode"]); v != "" {
		cc = &v
	}

	station := map[string]any{
		"id":           str(s["stationuuid"]),
		"providerId":   "radiobrowser",
		"title":        orDefault(cleanStationName(str(s["name"])), "Unnamed station"),
		"artist":       str(s["country"]),
		"durationSec":  nil,
		"artworkUrl":   artwork,
		"streamUrl":    streamURL,
		"permalink":    permalink,
		"popularity":   stationPopularity(s),
		"isStreamable": playable,
		"countrycode":  cc,
		"tags":         tagList,
		"votes":        num(s["votes"]),
		"language":     langPtr,
	}
	if subtitle != "" {
		station["subtitle"] = subtitle
	}
	return station
}

func stationsShape(j any) error {
	if _, ok := j.([]any); !ok {
		return fmt.Errorf("radiobrowser: station array required")
	}
	return nil
}

func (r *RadioBrowser) mapStations(json any) []any {
	arr, _ := json.([]any)
	out := make([]any, 0, len(arr))
	for _, raw := range arr {
		if s, ok := raw.(map[string]any); ok && str(s["stationuuid"]) != "" {
			out = append(out, mapStation(s))
		}
	}
	return out
}

// SearchStations implements op searchStations. Typed searches stay fresh
// (no cache); facet browses cache for 5 minutes.
func (r *RadioBrowser) SearchStations(ctx context.Context, params map[string]any) (any, error) {
	limit := radioClampLimit(params["limit"], 40)
	q := url.Values{
		"limit":      {strconv.Itoa(limit)},
		"hidebroken": {"true"},
		"order":      {orDefault(str(params["order"]), "votes")},
		"reverse":    {"true"},
	}
	if name := strings.TrimSpace(str(params["name"])); name != "" {
		q.Set("name", name)
	}
	for _, key := range []string{"country", "language", "tag"} {
		if v := strings.TrimSpace(str(params[key])); v != "" {
			q.Set(key, v)
		}
	}
	qs := q.Encode()
	cacheTTL := time.Duration(0)
	if str(params["name"]) == "" {
		cacheTTL = radioSearchTTL
	}
	var json any
	var err error
	if cacheTTL > 0 {
		json, err = r.C.CachedJSON(ctx, "rb:search:"+qs, cacheTTL, func() (any, error) {
			return r.C.ProviderFetch(ctx, radioBase+"/json/stations/search?"+qs,
				netcore.FetchOptions{TimeoutMs: radioTimeoutMs, Validate: stationsShape})
		})
	} else {
		json, err = r.C.ProviderFetch(ctx, radioBase+"/json/stations/search?"+qs,
			netcore.FetchOptions{TimeoutMs: radioTimeoutMs, Validate: stationsShape})
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"stations": r.mapStations(json)}, nil
}

// facets fetches one facet list (countries / languages / tags).
func (r *RadioBrowser) facets(ctx context.Context, cacheKey, path string, limit int) (any, error) {
	json, err := r.C.CachedJSON(ctx, cacheKey, radioFacetTTL, func() (any, error) {
		return r.C.ProviderFetch(ctx, radioBase+path,
			netcore.FetchOptions{TimeoutMs: radioTimeoutMs, Validate: stationsShape})
	})
	if err != nil {
		return nil, err
	}
	arr, _ := json.([]any)
	out := make([]any, 0, len(arr))
	for _, raw := range arr {
		if m, ok := raw.(map[string]any); ok {
			name := str(m["name"])
			count := num(m["stationcount"])
			if name != "" && count > 0 {
				out = append(out, map[string]any{"value": name, "label": name, "count": count})
			}
		}
	}
	_ = limit
	return map[string]any{"facets": out}, nil
}

// Countries implements op countries.
func (r *RadioBrowser) Countries(ctx context.Context, params map[string]any) (any, error) {
	return r.facets(ctx, "rb:countries", "/json/countries?order=stationcount&reverse=true", 0)
}

// Languages implements op languages.
func (r *RadioBrowser) Languages(ctx context.Context, params map[string]any) (any, error) {
	return r.facets(ctx, "rb:languages", "/json/languages?order=stationcount&reverse=true&limit=100", 100)
}

// Tags implements op tags.
func (r *RadioBrowser) Tags(ctx context.Context, params map[string]any) (any, error) {
	return r.facets(ctx, "rb:tags", "/json/tags?order=stationcount&reverse=true&limit=60", 60)
}

// ClickStation implements op clickStation — the citizenship play ping.
// Fire-and-forget semantics: never a failure surface.
func (r *RadioBrowser) ClickStation(ctx context.Context, params map[string]any) (any, error) {
	id := strings.TrimSpace(str(params["stationId"]))
	if id == "" {
		return map[string]any{"ok": false}, nil
	}
	zero := 0
	_, err := r.C.ProviderFetch(ctx, radioBase+"/json/url/"+url.PathEscape(id),
		netcore.FetchOptions{TimeoutMs: 4000, Retries: &zero})
	if err != nil {
		return map[string]any{"ok": false}, nil
	}
	return map[string]any{"ok": true}, nil
}
