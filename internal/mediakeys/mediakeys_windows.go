//go:build windows

// Package mediakeys implements the OS-level global media keys that 3.2.0 got
// from Electron's globalShortcut (MediaPlayPause / MediaNextTrack /
// MediaPreviousTrack), using Win32 RegisterHotKey + a WM_HOTKEY message pump.
//
// The keys funnel into the SAME 'media:command' event the mini player uses —
// one playback command path, exactly like the original. Registration happens
// on a dedicated locked OS thread; failures (another app owns a key) are
// skipped, never fatal — the same posture as 3.2.0's per-key check.
package mediakeys

import (
	"runtime"
	"sync"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/windows"
)

// WM constants and app-defined hotkey ids.
const (
	wmHotkey    = 0x0312
	wmQuit      = 0x0012
	idPlayPause = 1
	idNext      = 2
	idPrevious  = 3
	modNoRepeat = 0x4000 // MOD_NOREPEAT (Windows 7+)
)

// Virtual key codes for the hardware media keys.
const (
	vkMediaPlayPause = 0xB3
	vkMediaNextTrack = 0xB0
	vkMediaPrevTrack = 0xB1
)

var (
	user32         = windows.NewLazySystemDLL("user32.dll")
	procRegister   = user32.NewProc("RegisterHotKey")
	procUnregister = user32.NewProc("UnregisterHotKey")
	procGetMessage = user32.NewProc("GetMessageW")
	procPeek       = user32.NewProc("PeekMessageW")
	procPostThread = user32.NewProc("PostThreadMessageW")
)

// Command is the media:command vocabulary the renderer already handles.
type Command = string

const (
	CmdToggle   Command = "toggle"
	CmdNext     Command = "next"
	CmdPrevious Command = "previous"
)

// msg is the Win32 MSG structure (48 bytes on x64).
type msg struct {
	hwnd    windows.HWND
	message uint32
	_       uint32 // padding
	wParam  uintptr
	lParam  uintptr
	time    uint32
	_       uint32
	pt      [2]int32
}

// Service owns the hotkey pump. Safe for concurrent use.
type Service struct {
	emit func(Command) // replaceable in tests

	mu      sync.Mutex
	started bool
	ready   chan struct{}
	readyOp sync.Once
	thread  atomic.Uint32
}

// New creates the service. emit receives normalized commands.
func New(emit func(Command)) *Service {
	if emit == nil {
		emit = func(Command) {}
	}
	return &Service{emit: emit, ready: make(chan struct{})}
}

// Start launches the pump goroutine and waits until its message queue
// exists. Non-Windows behaviour is not reachable here (build tag).
func (s *Service) Start() {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.started = true
	s.mu.Unlock()

	go func() {
		runtime.LockOSThread()

		// Force message-queue creation on THIS thread, remember its id for
		// Stop, then register the hotkeys (thread affinity matters).
		var m msg
		procPeek.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0, 0)
		s.thread.Store(uint32(windows.GetCurrentThreadId()))
		s.readyOp.Do(func() { close(s.ready) })

		registered := s.registerAll()
		s.loop()
		for _, id := range registered {
			procUnregister.Call(0, uintptr(id))
		}
	}()
	<-s.ready
}

// registerAll registers each key, skipping ones already claimed elsewhere.
func (s *Service) registerAll() []int {
	var ok []int
	for _, hk := range []struct {
		id int
		vk uintptr
	}{
		{idPlayPause, vkMediaPlayPause},
		{idNext, vkMediaNextTrack},
		{idPrevious, vkMediaPrevTrack},
	} {
		if rc, _, _ := procRegister.Call(0, uintptr(hk.id), modNoRepeat, hk.vk); rc != 0 {
			ok = append(ok, hk.id)
		}
	}
	return ok
}

// loop runs GetMessageW until WM_QUIT, translating WM_HOTKEY to commands.
func (s *Service) loop() {
	var m msg
	for {
		r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if r == 0 || r == ^uintptr(0) {
			return
		}
		if m.message != wmHotkey {
			continue
		}
		switch m.wParam {
		case idPlayPause:
			s.emit(CmdToggle)
		case idNext:
			s.emit(CmdNext)
		case idPrevious:
			s.emit(CmdPrevious)
		}
	}
}

// Stop posts WM_QUIT to the pump thread. Safe to call multiple times and
// before Start.
func (s *Service) Stop() {
	s.mu.Lock()
	was := s.started
	s.started = false
	s.mu.Unlock()
	if !was {
		return
	}
	if id := s.thread.Load(); id != 0 {
		procPostThread.Call(uintptr(id), wmQuit, 0, 0)
	}
}
