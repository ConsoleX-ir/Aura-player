//go:build windows

// Package syswin carries renderer→OS playback state pushes (taskbar
// thumbnail icon state today; a SMTC surface would slot in here too).
package syswin

import (
	"sync"

	"github.com/ConsoleX-ir/aura-player/internal/taskbar"
	"github.com/ConsoleX-ir/aura-player/internal/window"
)

// API is the renderer-facing surface bound to Wails.
type API struct {
	mu        sync.Mutex
	isPlaying bool
}

func NewService() *API { return &API{} }

// Startup resolves the main window and arms the taskbar bar once the webview
// window exists. Failures leave the feature off silently.
func (a *API) Startup() {
	if hwnd := window.MainWindowHandle(); hwnd != 0 {
		taskbar.Get(hwnd)
	}
}

// SyncPlaybackState implements electronAPI.syncPlaybackState: the taskbar
// thumbnail's Play/Pause glyph follows the real playback state.
func (a *API) SyncPlaybackState(isPlaying bool) {
	a.mu.Lock()
	a.isPlaying = isPlaying
	a.mu.Unlock()
	if hwnd := window.MainWindowHandle(); hwnd != 0 {
		if bar := taskbar.Get(hwnd); bar != nil {
			bar.Update(isPlaying)
		}
	}
}

// Shutdown releases the taskbar bar.
func (a *API) Shutdown() {
	if hwnd := window.MainWindowHandle(); hwnd != 0 {
		if bar := taskbar.Get(hwnd); bar != nil {
			bar.Shutdown()
		}
	}
}
