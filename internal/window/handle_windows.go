//go:build windows

package window

import "golang.org/x/sys/windows"

// MainWindowHandle exposes the app's main (webview owner) HWND to other
// Windows-only integrations (taskbar thumbnail buttons). Returns 0 when the
// window cannot be found yet.
func MainWindowHandle() windows.HWND { return appWindow() }
