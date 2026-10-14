package window

// API is the renderer-facing surface bound to Wails.
type API struct{ s *Service }

func (s *Service) API() *API { return &API{s} }

func (a *API) Minimize()             { a.s.Minimize() }
func (a *API) ToggleMaximize()       { a.s.ToggleMaximize() }
func (a *API) IsMaximized() bool     { return a.s.IsMaximized() }
func (a *API) Close()                { a.s.Close() }
func (a *API) MiniVisible() bool     { return a.s.MiniVisible() }
func (a *API) SetMiniVisible(v bool) { a.s.SetMiniVisible(v) }
func (a *API) RestoreFromMini()      { a.s.RestoreFromMini() }
