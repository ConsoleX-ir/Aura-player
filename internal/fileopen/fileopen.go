// Package fileopen handles "open with Aura" launches (Windows file
// association): the first launch's argv, and later launches forwarded by the
// single-instance lock.
package fileopen

import (
	"context"
	"os"
	"sync"

	"github.com/ConsoleX-ir/aura-player/internal/audiofmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventFileOpened is emitted to the renderer with the file path.
const EventFileOpened = "file:opened"

// PickAudioArg returns the first argument that is an existing audio file.
// (3.2.0 only checked the extension; also requiring a real file avoids
// handing the renderer a dead path.)
func PickAudioArg(args []string) string {
	for _, a := range args {
		if !audiofmt.IsAudio(a) {
			continue
		}
		if st, err := os.Stat(a); err == nil && st.Mode().IsRegular() {
			return a
		}
	}
	return ""
}

// Service is bound to Wails.
type Service struct {
	ctx context.Context

	mu     sync.Mutex
	launch string
	// emit is replaceable in tests.
	emit func(ctx context.Context, path string)
}

func NewService(initialArgs []string) *Service {
	return &Service{
		launch: PickAudioArg(initialArgs),
		emit: func(ctx context.Context, p string) {
			runtime.EventsEmit(ctx, EventFileOpened, p)
		},
	}
}

func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

// TakeLaunchFile returns (once) the file this process was launched with, or "".
// The renderer calls it after its listener is registered, which avoids the race
// of emitting before the UI exists.
func (s *Service) TakeLaunchFile() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.launch
	s.launch = ""
	return p
}

// HandleSecondLaunch forwards a second launch's file to the running renderer.
// It reports whether an audio file was found.
func (s *Service) HandleSecondLaunch(args []string) bool {
	p := PickAudioArg(args)
	if p == "" {
		return false
	}
	s.emit(s.ctx, p)
	return true
}
