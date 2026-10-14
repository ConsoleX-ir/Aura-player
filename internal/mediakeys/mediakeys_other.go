//go:build !windows

// Package mediakeys: non-Windows stub. 3.2.0 shipped global media keys via
// Electron's globalShortcut; on Linux the Electron build registered them too
// (X11 grab), but the parity target here is Windows — on other platforms the
// service is an inert no-op so callers need no guards.
package mediakeys

// Command is the media:command vocabulary the renderer already handles.
type Command = string

const (
	CmdToggle   Command = "toggle"
	CmdNext     Command = "next"
	CmdPrevious Command = "previous"
)

// Service is an inert stub on non-Windows platforms.
type Service struct{ emit func(Command) }

func New(emit func(Command)) *Service {
	if emit == nil {
		emit = func(Command) {}
	}
	return &Service{emit: emit}
}

func (s *Service) Start() {}
func (s *Service) Stop()  {}
