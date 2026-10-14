// Package shell opens files and settings in the operating system shell.
package shell

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// DefaultAppsResult matches the renderer's setAsDefaultMusicPlayer() contract.
type DefaultAppsResult struct {
	Ok             bool   `json:"ok"`
	OpenedSettings bool   `json:"openedSettings,omitempty"`
	Reason         string `json:"reason,omitempty"`
}

// validatePath accepts only an absolute path to an existing file or directory
// that cannot be mistaken for command-line syntax.
func validatePath(p string) error {
	if p == "" || !filepath.IsAbs(p) {
		return errors.New("absolute path required")
	}
	if strings.ContainsAny(p, "\"\x00\r\n") {
		return errors.New("invalid characters in path")
	}
	if _, err := os.Stat(p); err != nil {
		return err
	}
	return nil
}

// Service is the implementation behind API.
type Service struct{}

func NewService() *Service { return &Service{} }

// ShowItemInFolder reveals a file in the system file manager.
func (s *Service) ShowItemInFolder(path string) error {
	if err := validatePath(path); err != nil {
		return err
	}
	return reveal(filepath.Clean(path))
}

// OpenDefaultAppsSettings opens the OS default-apps page. File associations
// themselves are the installer's job; this only helps the user pick Aura.
func (s *Service) OpenDefaultAppsSettings() DefaultAppsResult {
	if err := openDefaultApps(); err != nil {
		return DefaultAppsResult{Ok: false, Reason: err.Error()}
	}
	return DefaultAppsResult{Ok: true, OpenedSettings: true}
}

// API is the renderer-facing surface bound to Wails.
type API struct{ s *Service }

func (s *Service) API() *API { return &API{s} }

func (a *API) ShowItemInFolder(path string) error { return a.s.ShowItemInFolder(path) }
func (a *API) SetAsDefaultMusicPlayer() DefaultAppsResult {
	return a.s.OpenDefaultAppsSettings()
}
