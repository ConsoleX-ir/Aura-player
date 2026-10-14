//go:build windows

package window

import (
	"os"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Wails v2 does not expose the HWND, and its WindowGetPosition/SetPosition are
// asymmetric on Windows (Get returns absolute coordinates, Set adds the current
// monitor's work-area origin). Geometry that must round-trip is therefore done
// with Win32 directly, in absolute physical pixels.

var (
	user32                  = windows.NewLazySystemDLL("user32.dll")
	procEnumWindows         = user32.NewProc("EnumWindows")
	procGetWindowThreadPID  = user32.NewProc("GetWindowThreadProcessId")
	procIsWindowVisible     = user32.NewProc("IsWindowVisible")
	procIsWindow            = user32.NewProc("IsWindow")
	procGetWindow           = user32.NewProc("GetWindow")
	procGetWindowRect       = user32.NewProc("GetWindowRect")
	procSetWindowPos        = user32.NewProc("SetWindowPos")
	procGetDpiForWindow     = user32.NewProc("GetDpiForWindow")
	procMonitorFromPoint    = user32.NewProc("MonitorFromPoint")
	procGetMonitorInfoW     = user32.NewProc("GetMonitorInfoW")
	procEnumDisplayMonitors = user32.NewProc("EnumDisplayMonitors")
)

const (
	gwOwner               = 4
	swpNoSize             = 0x0001
	swpNoZOrder           = 0x0004
	swpNoActivate         = 0x0010
	monitorDefaultPrimary = 1
)

type rect struct{ Left, Top, Right, Bottom int32 }
type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}

var (
	hwndMu    sync.Mutex
	cachedWnd windows.HWND

	enumMu      sync.Mutex
	enumBest    windows.HWND
	enumBestA   int64
	enumPID     uint32
	enumMonitor []Rect

	enumWindowsCB  = syscall.NewCallback(enumWindowsProc)
	enumMonitorsCB = syscall.NewCallback(enumMonitorsProc)
)

func enumWindowsProc(hwnd, _ uintptr) uintptr {
	var pid uint32
	procGetWindowThreadPID.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid != enumPID {
		return 1
	}
	if v, _, _ := procIsWindowVisible.Call(hwnd); v == 0 {
		return 1
	}
	if owner, _, _ := procGetWindow.Call(hwnd, gwOwner); owner != 0 {
		return 1
	}
	var r rect
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if a := int64(r.Right-r.Left) * int64(r.Bottom-r.Top); a > enumBestA {
		enumBest, enumBestA = windows.HWND(hwnd), a
	}
	return 1
}

func enumMonitorsProc(hMon, _, _, _ uintptr) uintptr {
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	if ok, _, _ := procGetMonitorInfoW.Call(hMon, uintptr(unsafe.Pointer(&mi))); ok != 0 {
		m := mi.Monitor
		enumMonitor = append(enumMonitor, Rect{int(m.Left), int(m.Top), int(m.Right - m.Left), int(m.Bottom - m.Top)})
	}
	return 1
}

// appWindow returns the app's main window: the largest visible, ownerless
// top-level window of this process. The result is cached while it stays valid.
func appWindow() windows.HWND {
	hwndMu.Lock()
	defer hwndMu.Unlock()
	if cachedWnd != 0 {
		if ok, _, _ := procIsWindow.Call(uintptr(cachedWnd)); ok != 0 {
			return cachedWnd
		}
		cachedWnd = 0
	}
	enumMu.Lock()
	enumBest, enumBestA, enumPID = 0, 0, uint32(os.Getpid())
	procEnumWindows.Call(enumWindowsCB, 0)
	cachedWnd = enumBest
	enumMu.Unlock()
	return cachedWnd
}

func nativePosition() (int, int, bool) {
	h := appWindow()
	if h == 0 {
		return 0, 0, false
	}
	var r rect
	if ok, _, _ := procGetWindowRect.Call(uintptr(h), uintptr(unsafe.Pointer(&r))); ok == 0 {
		return 0, 0, false
	}
	return int(r.Left), int(r.Top), true
}

func nativeSetPosition(x, y int) bool {
	h := appWindow()
	if h == 0 {
		return false
	}
	ok, _, _ := procSetWindowPos.Call(uintptr(h), 0, uintptr(int32(x)), uintptr(int32(y)), 0, 0,
		swpNoSize|swpNoZOrder|swpNoActivate)
	return ok != 0
}

func nativeScale() float64 {
	h := appWindow()
	if h == 0 || procGetDpiForWindow.Find() != nil {
		return 1
	}
	if dpi, _, _ := procGetDpiForWindow.Call(uintptr(h)); dpi != 0 {
		return float64(dpi) / 96
	}
	return 1
}

func nativeWorkArea() (Rect, bool) {
	mon, _, _ := procMonitorFromPoint.Call(0, monitorDefaultPrimary) // POINT{0,0} packs to 0
	if mon == 0 {
		return Rect{}, false
	}
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	if ok, _, _ := procGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi))); ok == 0 {
		return Rect{}, false
	}
	w := mi.Work
	return Rect{int(w.Left), int(w.Top), int(w.Right - w.Left), int(w.Bottom - w.Top)}, true
}

func nativeDisplays() []Rect {
	enumMu.Lock()
	defer enumMu.Unlock()
	enumMonitor = nil
	procEnumDisplayMonitors.Call(0, 0, enumMonitorsCB, 0)
	return append([]Rect(nil), enumMonitor...)
}
