// Package dialogs wraps native file dialogs and the writes that follow them.
//
// Security (improvement over 3.2.0, whose fs:writeTextFile wrote to any path
// the renderer supplied): a file may only be written at a path the user
// picked in a native save dialog, once, within a short time window.
package dialogs

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/ConsoleX-ir/aura-player/internal/audiofmt"
)

// Filter is a native dialog file filter.
type Filter struct {
	Name    string
	Pattern string // e.g. "*.m3u;*.m3u8"
}

// Backend is the native dialog layer (Wails runtime in production, a fake in tests).
type Backend interface {
	OpenDirectory(ctx context.Context, title string) (string, error)
	OpenFiles(ctx context.Context, title string, filters []Filter) ([]string, error)
	SaveFile(ctx context.Context, title, defaultName string, filters []Filter) (string, error)
}

const grantTTL = 10 * time.Minute

// Service is bound to Wails.
type Service struct {
	ctx     context.Context
	backend Backend
	now     func() time.Time

	mu     sync.Mutex
	grants map[string]time.Time // path -> expiry
}

func NewService(b Backend) *Service {
	return &Service{ctx: context.Background(), backend: b, now: time.Now, grants: map[string]time.Time{}}
}

func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

// OpenFolder shows a folder picker. Returns "" when cancelled.
func (s *Service) OpenFolder() (string, error) {
	return s.backend.OpenDirectory(s.ctx, "Select Music Folder")
}

// OpenFiles shows an audio file picker. Returns an empty list when cancelled.
func (s *Service) OpenFiles() ([]string, error) {
	files, err := s.backend.OpenFiles(s.ctx, "Select Songs", []Filter{{Name: "Audio Files", Pattern: audiofmt.DialogPatterns()}})
	if files == nil {
		files = []string{}
	}
	return files, err
}

func (s *Service) grant(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	for p, exp := range s.grants { // drop expired grants
		if now.After(exp) {
			delete(s.grants, p)
		}
	}
	s.grants[path] = now.Add(grantTTL)
}

// consume returns true (once) if path was granted by a save dialog and has not expired.
func (s *Service) consume(path string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	exp, ok := s.grants[path]
	if !ok {
		return false
	}
	delete(s.grants, path)
	return !s.now().After(exp)
}

// SavePlaylistFile shows the export save dialog. Returns "" when cancelled.
func (s *Service) SavePlaylistFile(defaultName string) (string, error) {
	p, err := s.backend.SaveFile(s.ctx, "Export Playlist", defaultName, []Filter{
		{Name: "M3U Playlist", Pattern: "*.m3u;*.m3u8"},
		{Name: "All Files", Pattern: "*.*"}, // the FX-preset export reuses this dialog for .json
	})
	if err != nil || p == "" {
		return "", err
	}
	s.grant(p)
	return p, nil
}

// WriteTextFile writes UTF-8 text to a path previously chosen via SavePlaylistFile.
// It returns false (never an error) on refusal or failure, as the renderer expects.
func (s *Service) WriteTextFile(path, content string) bool {
	if !s.consume(path) {
		return false
	}
	return os.WriteFile(path, []byte(content), 0o644) == nil
}

var pngDataURL = regexp.MustCompile(`^data:image/png;base64,([A-Za-z0-9+/=]+)$`)

// maxImageBytes bounds a share-card PNG (generous: a 4K canvas is a few MB).
const maxImageBytes = 64 << 20

// SaveImageFile shows a PNG save dialog and writes the decoded data URL.
// Returns "" when cancelled or when the data URL is not a valid PNG.
func (s *Service) SaveImageFile(defaultName, dataURL string) (string, error) {
	m := pngDataURL.FindStringSubmatch(dataURL)
	if m == nil {
		return "", errors.New("not a base64 PNG data URL")
	}
	raw, err := base64.StdEncoding.DecodeString(m[1])
	if err != nil || len(raw) > maxImageBytes {
		return "", errors.New("invalid or oversized image")
	}
	p, err := s.backend.SaveFile(s.ctx, "Save Image", defaultName, []Filter{{Name: "PNG Image", Pattern: "*.png"}})
	if err != nil || p == "" {
		return "", err
	}
	if err := os.WriteFile(p, raw, 0o644); err != nil {
		return "", err
	}
	return p, nil
}
