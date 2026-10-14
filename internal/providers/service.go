// Package providers — service.go: the renderer-facing allowlist dispatcher.
//
// Mirrors Electron's provider core IPC: the renderer names a provider id +
// op (both allowlisted here); it can never fetch an arbitrary URL. Errors
// return as { kind, message } payloads the renderer's client layer maps to
// ProviderError — never as Go panics or raw strings.
package providers

import (
	"context"
	"fmt"
	"net/url"

	"github.com/ConsoleX-ir/aura-player/internal/metadata"
	"github.com/ConsoleX-ir/aura-player/internal/netcore"
)

// Service is bound to Wails as the `net` API.
type Service struct {
	ctx       context.Context
	C         *netcore.Client
	coversDir string
	aud       *Audius
	rad       *RadioBrowser
	find      *FindInfo
}

func NewService() *Service {
	c := netcore.NewClient()
	return &Service{
		C:    c,
		aud:  &Audius{C: c},
		rad:  &RadioBrowser{C: c},
		find: &FindInfo{C: c},
	}
}

// Startup receives the Wails context and the covers cache directory used by
// CacheArtwork. The directory is decided by the backend, never by the
// renderer ( confinement: cached bytes can only land under the app's own
// covers cache).
func (s *Service) Startup(ctx context.Context, coversDir string) {
	s.ctx = ctx
	s.coversDir = coversDir
}

// API is the renderer-facing facade: only the five contract methods are
// bound; Startup/coversDir stay unreachable from JavaScript.
type API struct{ s *Service }

func (s *Service) API() *API { return &API{s} }

// opFunc is one allowlisted operation.
type opFunc func(ctx context.Context, params map[string]any) (any, error)

// ops is the security boundary: only these (provider, op) pairs exist.
func (s *Service) ops() map[string]map[string]opFunc {
	return map[string]map[string]opFunc{
		"audius": {
			"searchTracks":      s.aud.SearchTracks,
			"searchArtists":     s.aud.SearchArtists,
			"trending":          s.aud.Trending,
			"underground":       s.aud.Underground,
			"artistTracks":      s.aud.ArtistTracks,
			"fresh":             s.aud.Fresh,
			"searchPlaylists":   s.aud.SearchPlaylists,
			"trendingPlaylists": s.aud.TrendingPlaylists,
			"playlistTracks":    s.aud.PlaylistTracks,
		},
		"radiobrowser": {
			"searchStations": s.rad.SearchStations,
			"countries":      s.rad.Countries,
			"languages":      s.rad.Languages,
			"tags":           s.rad.Tags,
			"clickStation":   s.rad.ClickStation,
		},
		"findinfo": {
			"search": func(ctx context.Context, params map[string]any) (any, error) {
				return s.find.Find(ctx, FindQuery{
					Title:    str(params["title"]),
					Artist:   str(params["artist"]),
					Album:    str(params["album"]),
					Duration: num(params["duration"]),
				})
			},
		},
	}
}

// errPayload is the typed failure shape the renderer recognizes.
type errPayload struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Status  int    `json:"status,omitempty"`
}

func payloadOf(err error) errPayload {
	if fe, ok := err.(*netcore.FetchError); ok {
		return errPayload{Kind: fe.Kind, Message: fe.Message, Status: fe.Status}
	}
	return errPayload{Kind: netcore.KindNetwork, Message: err.Error()}
}

// ProviderRequest implements electronAPI.providerRequest. It ALWAYS resolves:
// either with the op's raw result or with an errPayload object — the
// renderer's isProviderErrorPayload guard distinguishes the two.
func (s *Service) ProviderRequest(requestId, providerId, op string, params map[string]any) any {
	if len(requestId) == 0 || len(requestId) > 64 {
		return errPayload{Kind: netcore.KindMalformed, Message: "requestId must be a short string"}
	}
	if params == nil {
		params = map[string]any{}
	}
	table := s.ops()
	provider, ok := table[providerId]
	if !ok {
		return errPayload{Kind: netcore.KindUnavailable, Message: fmt.Sprintf("Unknown provider %q", providerId)}
	}
	fn, ok := provider[op]
	if !ok {
		return errPayload{Kind: netcore.KindMalformed, Message: fmt.Sprintf("Provider %q has no op %q", providerId, op)}
	}

	ctx, off := s.C.BeginRequest(s.ctx, requestId)
	defer off()
	res, err := fn(ctx, params)
	if err != nil {
		if ctx.Err() != nil && isCancellation(err) {
			return errPayload{Kind: netcore.KindNetwork, Message: "cancelled"}
		}
		return payloadOf(err)
	}
	return res
}

// isCancellation reports whether err is a context cancellation (not a real
// network failure).
func isCancellation(err error) bool {
	if fe, ok := err.(*netcore.FetchError); ok {
		return fe.Message == "cancelled"
	}
	return false
}

// ProviderCancel aborts a still-in-flight request (best-effort, no error).
func (s *Service) ProviderCancel(requestId string) { s.C.CancelRequest(requestId) }

// ProbeOnline implements electronAPI.probeOnline (diagnostic shape).
func (s *Service) ProbeOnline() netcore.ProbeResult { return s.C.ProbeOnline(s.ctx) }

// FindMetadata implements electronAPI.findMetadata directly (the Properties
// flow bypasses the provider op table, like net:findMetadata did).
func (s *Service) FindMetadata(query FindQuery) any {
	res, err := s.find.Find(s.ctx, query)
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	return res
}

// ── artwork cache (electronAPI.cacheArtwork) ────────────────────────────────

// CacheArtwork downloads a remote image into the covers cache and returns
// the /aura/local URL, or nil on failure (the renderer treats null as
// "download failed", exactly like 3.2.0).
func (s *Service) CacheArtwork(rawURL string) *string {
	if s.coversDir == "" {
		return nil
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil
	}
	body, err := s.C.DownloadBinary(s.ctx, rawURL, 20_000)
	if err != nil || len(body) == 0 {
		return nil
	}
	mime := metadata.SniffImage(body)
	if mime == "" {
		return nil
	}
	link, err := metadata.StoreCover(s.coversDir, rawURL, mime, body)
	if err != nil {
		return nil
	}
	return &link
}

// ── API facade methods (the bound surface) ──────────────────────────────────

func (a *API) ProviderRequest(requestId, providerId, op string, params map[string]any) any {
	return a.s.ProviderRequest(requestId, providerId, op, params)
}
func (a *API) ProviderCancel(requestId string)    { a.s.ProviderCancel(requestId) }
func (a *API) ProbeOnline() netcore.ProbeResult   { return a.s.ProbeOnline() }
func (a *API) FindMetadata(query FindQuery) any   { return a.s.FindMetadata(query) }
func (a *API) CacheArtwork(rawURL string) *string { return a.s.CacheArtwork(rawURL) }
