package fileopen

// API is the renderer-facing surface bound to Wails.
type API struct{ s *Service }

func (s *Service) API() *API { return &API{s} }

// TakeLaunchFile returns (once) the audio file this process was launched with.
func (a *API) TakeLaunchFile() string { return a.s.TakeLaunchFile() }
