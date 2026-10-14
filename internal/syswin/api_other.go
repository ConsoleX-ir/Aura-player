//go:build !windows

// Non-Windows stub: 3.2.0's setThumbarButtons was already a documented no-op
// outside Windows; the state is simply recorded.
package syswin

// API is the renderer-facing surface bound to Wails.
type API struct{ isPlaying bool }

func NewService() *API { return &API{} }

func (a *API) Startup() {}

// SyncPlaybackState records the state (no OS surface on this platform).
func (a *API) SyncPlaybackState(isPlaying bool) { a.isPlaying = isPlaying }

func (a *API) Shutdown() {}
