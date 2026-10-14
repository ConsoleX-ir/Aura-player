package lifecycle

// API is the renderer-facing surface bound to Wails.
type API struct{ s *Service }

func (s *Service) API() *API { return &API{s} }

// NotifyShutdownComplete is called by the renderer once its state flush landed.
func (a *API) NotifyShutdownComplete() { a.s.NotifyShutdownComplete() }
