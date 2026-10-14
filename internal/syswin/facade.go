package syswin

// APIfacade keeps Startup/Shutdown unreachable from JavaScript: only the
// playback-state contract method is bound (same pattern as providers.API).
type APIfacade struct{ s *API }

// Facade returns the renderer-facing binding.
func (a *API) Facade() *APIfacade { return &APIfacade{a} }

// SyncPlaybackState implements electronAPI.syncPlaybackState.
func (f *APIfacade) SyncPlaybackState(isPlaying bool) { f.s.SyncPlaybackState(isPlaying) }
