//go:build !windows

package window

// MainWindowHandle is a non-Windows stub (development tooling / tests).
func MainWindowHandle() uintptr { return 0 }
