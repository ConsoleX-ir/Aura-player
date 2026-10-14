// Renderer-facing API for the folder watcher (Wave 4 parity).
package watcher

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventWatchChange carries one debounced { folder, at } payload.
const EventWatchChange = "watch:changed"

// API is the renderer-facing surface bound to Wails.
type API struct{ s *Service }

// Service wraps the Watcher with the Wails event bridge.
type Service struct {
	ctx context.Context
	w   *Watcher
}

// NewService creates the service.
func NewService() *Service {
	return &Service{}
}

// Startup receives the Wails context and arms the notification bridge.
func (s *Service) Startup(ctx context.Context) {
	s.ctx = ctx
	s.w = New(func(c Change) {
		runtime.EventsEmit(ctx, EventWatchChange, c)
	})
}

func (s *Service) API() *API { return &API{s} }

// WatchFolders replaces the whole watcher set; returns the count actually
// watched (0 in a plain browser — the renderer treats that as a no-op).
func (a *API) WatchFolders(folders []string) int {
	if a.s.w == nil {
		return 0
	}
	return a.s.w.Watch(folders)
}

// Stop releases every handle (app shutdown).
func (s *Service) Stop() {
	if s.w != nil {
		s.w.Stop()
	}
}
