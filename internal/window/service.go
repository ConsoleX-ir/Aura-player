package window

import (
	"context"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventMiniVisibility is emitted to the renderer whenever mini mode toggles.
const EventMiniVisibility = "mini:visibility"

// minimizePollInterval is the OS-minimize watcher cadence. Wails v2 has no
// minimize EVENT; a cheap IsMinimised syscall at this rate restores the
// 3.2.0 behaviour (taskbar/Win+D minimize auto-shows the widget) at
// negligible cost. The widget's auto-hide on restore rides the same tick.
const minimizePollInterval = 400 * time.Millisecond

// Service is the window API bound to Wails.
type Service struct {
	ctx      context.Context
	dataDir  string
	ctl      *Controller
	pollStop chan struct{}
}

func NewService(dataDir string) *Service { return &Service{dataDir: dataDir} }

// Startup builds the controller once the Wails context exists.
func (s *Service) Startup(ctx context.Context) {
	s.ctx = ctx
	s.ctl = New(NewWailsOps(ctx), NewFileStore(s.dataDir), func(visible bool) {
		runtime.EventsEmit(ctx, EventMiniVisibility, visible)
	})
	// OS-minimize watcher (see SyncMinimizeState).
	s.pollStop = make(chan struct{})
	go func() {
		t := time.NewTicker(minimizePollInterval)
		defer t.Stop()
		for {
			select {
			case <-s.pollStop:
				return
			case <-t.C:
				minimized := runtime.WindowIsMinimised(ctx)
				s.ctl.SyncMinimizeState(minimized)
			}
		}
	}()
}

func (s *Service) Shutdown() {
	if s.pollStop != nil {
		select {
		case <-s.pollStop:
		default:
			close(s.pollStop)
		}
	}
	if s.ctl != nil {
		s.ctl.Shutdown()
	}
}

func (s *Service) Minimize()         { s.ctl.Minimize() }
func (s *Service) ToggleMaximize()   { s.ctl.ToggleMaximize() }
func (s *Service) IsMaximized() bool { return s.ctl.IsMaximized() }
func (s *Service) Close()            { s.ctl.Quit() }
func (s *Service) MiniVisible() bool { return s.ctl.MiniVisible() }

// SetMiniVisible opens (user-initiated) or dismisses the mini player.
func (s *Service) SetMiniVisible(visible bool) {
	if visible {
		s.ctl.ShowMini(false)
	} else {
		s.ctl.ExitMini(Dismiss)
	}
}

// RestoreFromMini brings the full window back (the widget's "restore" button).
func (s *Service) RestoreFromMini() { s.ctl.ExitMini(Restore) }

// RestoreMainWindow shows and focuses the window — used when a second launch
// hands over a file (see the single-instance work).
func (s *Service) RestoreMainWindow() {
	if s.ctl.MiniVisible() {
		s.ctl.ExitMini(Restore)
		return
	}
	runtime.WindowUnminimise(s.ctx)
	runtime.WindowShow(s.ctx)
}
