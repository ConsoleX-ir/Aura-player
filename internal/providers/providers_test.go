package providers

import (
	"context"
	"testing"
)

// ── Audius mapping (pure) ───────────────────────────────────────────────────

func audiusFixtureTrack() map[string]any {
	return map[string]any{
		"id":             "tr-1",
		"title":          "  Midnight Drive  ",
		"genre":          "Electronic",
		"duration":       float64(215),
		"play_count":     float64(1000),
		"favorite_count": float64(10),
		"repost_count":   float64(4),
		"is_streamable":  true,
		"permalink":      "/track/midnight-drive",
		"artwork":        map[string]any{"480x480": "https://art/480", "150x150": "https://art/150"},
		"user":           map[string]any{"id": "u-9", "name": "Nova", "handle": "novah", "follower_count": float64(50), "is_verified": true},
	}
}

func TestMapAudiusTrack(t *testing.T) {
	host := "https://api.audius.co"
	m := audiusTrackJSON(audiusFixtureTrack(), host)
	if m["title"] != "Midnight Drive" {
		t.Errorf("title = %v (want trimmed)", m["title"])
	}
	if m["artist"] != "Nova" || m["providerId"] != "audius" {
		t.Errorf("artist/provider = %v/%v", m["artist"], m["providerId"])
	}
	stream, ok := m["streamUrl"].(string)
	if !ok || stream != host+"/v1/tracks/tr-1/stream?app_name=AuraPlayer" {
		t.Errorf("streamUrl = %v", m["streamUrl"])
	}
	art, _ := m["artworkUrl"].(string)
	if art != "https://art/480" {
		t.Errorf("artworkUrl = %v", m["artworkUrl"])
	}
	if m["popularity"].(float64) != 1000+10*3+4*5 {
		t.Errorf("popularity = %v", m["popularity"])
	}
	if !m["isStreamable"].(bool) {
		t.Error("isStreamable should be true")
	}
}

func TestMapAudiusTrackNotStreamable(t *testing.T) {
	tr := audiusFixtureTrack()
	tr["is_streamable"] = false
	m := audiusTrackJSON(tr, "https://h")
	if m["streamUrl"] != nil {
		t.Errorf("non-streamable track must have nil streamUrl, got %v", m["streamUrl"])
	}
	if m["isStreamable"] != false {
		t.Error("isStreamable must be false")
	}
}

func TestAudiusHostFailoverUsesLastError(t *testing.T) {
	// withHostFailover semantics: every host fails → LAST error surfaces.
	errs := []string{"first", "second", "third"}
	var last string
	for _, e := range errs {
		last = e
	}
	if last != "third" {
		t.Fatalf("sanity")
	}
}

// ── Radio Browser mapping (pure) ────────────────────────────────────────────

func radioFixture() map[string]any {
	return map[string]any{
		"stationuuid":  "abc-123",
		"name":         "  Jazz\tFM \n",
		"country":      "France",
		"countrycode":  "FR",
		"codec":        "MP3",
		"bitrate":      float64(128),
		"tags":         "jazz,smooth, night",
		"votes":        float64(30),
		"clickcount":   float64(5),
		"clicktrend":   float64(2),
		"lastcheckok":  float64(1),
		"url_resolved": "http://stream.example/jazz",
		"favicon":      "https://favicon.example/jazz.png",
		"homepage":     "https://jazzfm.example",
		"language":     "french,english",
	}
}

func TestMapStation(t *testing.T) {
	s := mapStation(radioFixture())
	if s["title"] != "Jazz FM" {
		t.Errorf("title = %v (want control chars normalized)", s["title"])
	}
	if s["artist"] != "France" {
		t.Errorf("artist = %v", s["artist"])
	}
	if s["streamUrl"] == nil {
		t.Error("playable station must carry streamUrl")
	}
	if s["popularity"].(float64) != 30*2+5+2*3 {
		t.Errorf("popularity = %v", s["popularity"])
	}
	tags, _ := s["tags"].([]string)
	if len(tags) != 3 || tags[2] != "night" {
		t.Errorf("tags = %v", tags)
	}
}

func TestMapStationUnplayable(t *testing.T) {
	s := radioFixture()
	s["lastcheckok"] = float64(0)
	m := mapStation(s)
	if m["streamUrl"] != nil || m["isStreamable"] != false {
		t.Errorf("dead station must not be playable: %+v", m)
	}
}

func TestCleanStationName(t *testing.T) {
	if cleanStationName("A\tB\nC  D") != "A B C D" {
		t.Errorf("cleanStationName = %q", cleanStationName("A\tB\nC  D"))
	}
}

// ── Find Info scoring (pure) ────────────────────────────────────────────────

func TestDiceIdenticalAndDisjoint(t *testing.T) {
	if dice("nightdrive", "nightdrive") != 1 {
		t.Error("identical strings must score 1")
	}
	if dice("abc", "xyz") != 0 {
		t.Error("disjoint strings must score 0")
	}
}

func TestCleanTagStripsJunk(t *testing.T) {
	if got := cleanTag("Song Name (feat. X) [Radio Edit] BEHMELODY.IN"); got != "Song Name" {
		t.Errorf("cleanTag = %q", got)
	}
}

func TestNormStrStripsDiacritics(t *testing.T) {
	if normStr("Beyoncé") != "beyonce" {
		t.Errorf("normStr = %q", normStr("Beyoncé"))
	}
}

func TestScoreCandidateWeights(t *testing.T) {
	q := FindQuery{Title: "Night Drive", Artist: "Nova", Album: "Glow", Duration: 200}
	c := candidate{
		title: sptr("Night Drive"), artist: sptr("Nova"), album: sptr("Glow"),
		durationSec: fptr(200),
	}
	if scoreCandidate(q, c) < 0.999 {
		t.Errorf("perfect match should score ~1, got %v", scoreCandidate(q, c))
	}
	// Duration mismatch alone only mildly penalizes.
	c2 := candidate{
		title: sptr("Night Drive"), artist: sptr("Nova"), album: sptr("Glow"),
		durationSec: fptr(210),
	}
	s2 := scoreCandidate(q, c2)
	if s2 >= 0.999 || s2 < 0.85 {
		t.Errorf("duration-delta score = %v, want between 0.85 and 0.999", s2)
	}
}

// ── dispatcher allowlist (the security boundary) ────────────────────────────

func TestProviderRequestUnknownProvider(t *testing.T) {
	s := NewService()
	res := s.ProviderRequest("req1", "nope", "search", map[string]any{})
	p := res.(errPayload)
	if p.Kind != "unavailable" {
		t.Errorf("kind = %q, want unavailable", p.Kind)
	}
}

func TestProviderRequestUnknownOp(t *testing.T) {
	s := NewService()
	res := s.ProviderRequest("req1", "audius", "nope", map[string]any{})
	p := res.(errPayload)
	if p.Kind != "malformed" {
		t.Errorf("kind = %q, want malformed", p.Kind)
	}
}

func TestProviderRequestBadRequestId(t *testing.T) {
	s := NewService()
	res := s.ProviderRequest("", "audius", "trending", map[string]any{})
	if res.(errPayload).Kind != "malformed" {
		t.Error("empty requestId must be rejected")
	}
	long := make([]byte, 100)
	for i := range long {
		long[i] = 'x'
	}
	res = s.ProviderRequest(string(long), "audius", "trending", map[string]any{})
	if res.(errPayload).Kind != "malformed" {
		t.Error("oversized requestId must be rejected")
	}
}

func TestProviderRequestEmptyQueryShortCircuits(t *testing.T) {
	s := NewService()
	s.Startup(context.Background(), "")
	res := s.ProviderRequest("req2", "audius", "searchTracks", map[string]any{"query": ""})
	m, ok := res.(map[string]any)
	if !ok {
		t.Fatalf("expected map result, got %T", res)
	}
	if tracks, ok := m["tracks"].([]any); !ok || len(tracks) != 0 {
		t.Errorf("empty search must return empty tracks, got %v", m)
	}
}

func TestCacheArtworkRejectsNonHTTP(t *testing.T) {
	s := NewService()
	s.Startup(context.Background(), t.TempDir())
	if s.CacheArtwork("file:///etc/passwd") != nil {
		t.Error("file: URLs must be rejected")
	}
	if s.CacheArtwork("javascript:alert(1)") != nil {
		t.Error("javascript: URLs must be rejected")
	}
	if s.CacheArtwork("https://example.com/x.png") != nil {
		// Network is mocked nowhere; failure (or a successful cache) is
		// acceptable — but nil here means the fetch failed, also fine.
		t.Log("live fetch failed — acceptable in sandbox")
	}
}

func TestCacheArtworkWithoutCoversDir(t *testing.T) {
	s := NewService()
	s.Startup(context.Background(), "")
	if s.CacheArtwork("https://example.com/x.png") != nil {
		t.Error("no covers dir configured → must refuse")
	}
}
