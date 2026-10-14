// Package lifecycle implements the coordinated-shutdown handshake.
//
// The renderer persists state through a debounced IndexedDB pipeline (800 ms
// coalescing window). Closing the window immediately could drop the last change,
// so the first close attempt is held: the renderer is asked to flush
// (event "app:shutdown"), acknowledges via NotifyShutdownComplete, and only then
// does the close proceed. A hard timeout (1.5 s, as in 3.2.0) guarantees a hung
// or crashed renderer can never block quitting.
package lifecycle

import (
	"sync"
	"time"
)

// EventShutdown asks the renderer to flush pending writes.
const EventShutdown = "app:shutdown"

// DefaultTimeout bounds how long a close may be held.
const DefaultTimeout = 1500 * time.Millisecond

type Service struct {
	emit    func()
	quit    func()
	timeout time.Duration

	mu      sync.Mutex
	pending bool
	done    bool
	timer   *time.Timer
}

// New creates the service. emit sends EventShutdown to the renderer; quit
// re-issues the application quit once it is safe.
func New(emit, quit func(), timeout time.Duration) *Service {
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	return &Service{emit: emit, quit: quit, timeout: timeout}
}

// BeforeClose is the Wails OnBeforeClose hook. It returns true to veto the
// close while the renderer flushes, and false once flushing has finished.
func (s *Service) BeforeClose() (prevent bool) {
	s.mu.Lock()
	if s.done {
		s.mu.Unlock()
		return false
	}
	first := !s.pending
	if first {
		s.pending = true
		s.timer = time.AfterFunc(s.timeout, s.finish)
	}
	s.mu.Unlock()
	if first {
		s.emit()
	}
	return true
}

// NotifyShutdownComplete is bound to the frontend: the renderer calls it after
// its flush has landed.
func (s *Service) NotifyShutdownComplete() { s.finish() }

func (s *Service) finish() {
	s.mu.Lock()
	if s.done || !s.pending {
		s.mu.Unlock()
		return
	}
	s.done = true
	if s.timer != nil {
		s.timer.Stop()
	}
	s.mu.Unlock()
	s.quit()
}
