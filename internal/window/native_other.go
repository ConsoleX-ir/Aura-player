//go:build !windows

package window

// Non-Windows builds exist for development tooling (binding generation, tests).
// They report "unknown" so WailsOps falls back to the Wails runtime.

func nativePosition() (int, int, bool) { return 0, 0, false }
func nativeSetPosition(x, y int) bool  { return false }
func nativeScale() float64             { return 1 }
func nativeWorkArea() (Rect, bool)     { return Rect{}, false }
func nativeDisplays() []Rect           { return nil }
