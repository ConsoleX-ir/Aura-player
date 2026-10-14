package metadata

import (
	"context"

	"github.com/ConsoleX-ir/aura-player/internal/audiofmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventMetadataProgress streams (done, total) during ParseMetadataBatch.
const EventMetadataProgress = "metadata:progress"

// API is the renderer-facing surface bound to Wails (metadata service).
type API struct{ s *Service }

// Service owns the parser and the Wails context.
type Service struct {
	ctx    context.Context
	parser *Parser
}

// NewService builds the service; coversDir is the app's covers cache.
func NewService(coversDir string) *Service {
	return &Service{parser: &Parser{CoversDir: coversDir}}
}

// Startup receives the Wails context.
func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

func (s *Service) API() *API { return &API{s} }

// ParseMetadata implements electronAPI.parseMetadata. Unreadable files fall
// back to the filename, like 3.2.0.
func (a *API) ParseMetadata(path string) Meta { return a.s.parser.ParseFile(path) }

// ParseMetadataBatch implements electronAPI.parseMetadataBatch: bounded
// concurrency, order-preserving, progress streamed via the
// metadata:progress event.
func (a *API) ParseMetadataBatch(paths []string) []Meta {
	return a.s.parser.ParseBatch(paths, func(done, total int) {
		if a.s.ctx != nil {
			runtime.EventsEmit(a.s.ctx, EventMetadataProgress, done, total)
		}
	})
}

// GetFileStats implements electronAPI.getFileStats (Properties dialog).
func (a *API) GetFileStats(path string) FileStats { return a.s.parser.StatsFile(path) }

// CheckAudioPath reports whether a dropped/launched path is an audio file
// (used by the drag-drop bridge before scanning folders).
func (a *API) IsAudioFile(path string) bool { return audiofmt.IsAudio(path) }
