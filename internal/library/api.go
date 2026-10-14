package library

// API is the renderer-facing surface bound to Wails. Only methods defined here
// are callable from the webview; Service keeps its lifecycle hooks private to Go.
type API struct{ s *Service }

func (s *Service) API() *API { return &API{s} }

func (a *API) ScanFolder(root string) ([]AudioFile, error) { return a.s.ScanFolder(root) }
func (a *API) ResolveDroppedPaths(paths []string) (Resolved, error) {
	return a.s.ResolveDroppedPaths(paths)
}
func (a *API) CheckPaths(paths []string) []PathCheck { return a.s.CheckPaths(paths) }
