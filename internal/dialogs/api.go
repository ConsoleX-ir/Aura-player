package dialogs

// API is the renderer-facing surface bound to Wails.
type API struct{ s *Service }

func (s *Service) API() *API { return &API{s} }

func (a *API) OpenFolder() (string, error)  { return a.s.OpenFolder() }
func (a *API) OpenFiles() ([]string, error) { return a.s.OpenFiles() }
func (a *API) SavePlaylistFile(defaultName string) (string, error) {
	return a.s.SavePlaylistFile(defaultName)
}
func (a *API) WriteTextFile(path, content string) bool { return a.s.WriteTextFile(path, content) }
func (a *API) SaveImageFile(defaultName, dataURL string) (string, error) {
	return a.s.SaveImageFile(defaultName, dataURL)
}
