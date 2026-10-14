//go:build windows

// Package taskbar implements the Windows taskbar thumbnail controls
// (ITaskbarList3 ThumbBar) that 3.2.0 got from Electron's
// BrowserWindow.setThumbarButtons: Previous / Play-Pause / Next shown when
// hovering Aura's taskbar icon.
//
// Safety posture (this code ships without automated Windows tests): every
// COM step is checked; any failure disables the feature with a single log
// line and no further calls are made. The vtable order is the documented
// ITaskbarList3 layout (stable since Windows 7).
package taskbar

import (
	_ "embed"
	"log"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// syscallN dispatches a StdCall with up to 15 arguments (Go ≥1.18 runtime).
func syscallN(args ...uintptr) (r1 uintptr) {
	r1, _, _ = syscall.SyscallN(args[0], args[1:]...)
	return r1
}

//go:embed icons/previous.png
var iconPrevious []byte

//go:embed icons/play.png
var iconPlay []byte

//go:embed icons/pause.png
var iconPause []byte

//go:embed icons/next.png
var iconNext []byte

var (
	ole32           = windows.NewLazySystemDLL("ole32.dll")
	procCoInit      = ole32.NewProc("CoInitializeEx")
	procCoUninit    = ole32.NewProc("CoUninitialize")
	procCoCreate    = ole32.NewProc("CoCreateInstance")
	user32          = windows.NewLazySystemDLL("user32.dll")
	procCreateIcon  = user32.NewProc("CreateIconFromResourceEx")
	procDestroyIcon = user32.NewProc("DestroyIcon")
)

const (
	coinitApartmentThreaded = 0x2
	clsctxInprocServer      = 0x1
)

// ITaskbarList3 vtable indices: IUnknown(0-2), ITaskbarList(3-7), then 3.3.
const (
	vtHrInit                = 3
	vtThumbBarAddButtons    = 10
	vtThumbBarUpdateButtons = 11
	vtRelease               = 2
)

// THUMBBUTTON (x64, per shobjidl_core.h):
//
//	DWORD dwMask(0-3) · UINT iId(4-7) · UINT iBitmap(8-11) · pad(12-15)
//	HICON hIcon(16-23) · WCHAR szTip[260](24-543) · DWORD dwFlags(544-547)
//	→ size 548, padded to 552 (8-byte alignment).
const (
	thumbButtonSize = 552
	offMask         = 0
	offID           = 4
	offBitmap       = 8
	offIcon         = 16
	offFlags        = 544
	thbIcon         = 0x2 // dwMask: use hIcon
)

// Button ids shown in the thumbnail toolbar.
const (
	idPrevious = 1001
	idToggle   = 1002
	idNext     = 1003
)

// Bar wraps the per-window ITaskbarList3 pointer.
type Bar struct {
	mu    sync.Mutex
	obj   unsafe.Pointer
	vtbl  uintptr
	hwnd  windows.HWND
	icons []uintptr
	added bool
}

var (
	instance *Bar
	initOnce sync.Once
)

// Get initializes (once) the thumbnail bar for hwnd. Returns nil when the
// feature is unavailable. Safe to call repeatedly; single-window app, so
// only the first hwnd wins.
func Get(hwnd windows.HWND) *Bar {
	initOnce.Do(func() {
		hr, _, _ := procCoInit.Call(coinitApartmentThreaded)
		if hr != 0 && hr != 1 { // S_OK / S_FALSE
			log.Printf("[aura] taskbar: CoInitializeEx failed (0x%x) — thumbnail buttons disabled", hr)
			return
		}
		bar := &Bar{hwnd: hwnd}
		if !bar.init() {
			return
		}
		instance = bar
	})
	if instance == nil || instance.hwnd != hwnd {
		return nil
	}
	return instance
}

// init creates the COM object, HrInit's it and builds the HICONs.
func (b *Bar) init() bool {
	var out uintptr
	clsid := oleGUID{0x56FDF344, 0xFD6D, 0x11d0, [8]byte{0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90}} // TaskbarList
	iid := oleGUID{0xEA1AFB91, 0x9E28, 0x4B86, [8]byte{0x90, 0xE9, 0x9E, 0x9F, 0x8A, 0x5E, 0xEF, 0xAF}}   // IID_ITaskbarList3
	hr, _, _ := procCoCreate.Call(
		uintptr(unsafe.Pointer(&clsid)), 0, clsctxInprocServer,
		uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&out)),
	)
	if hr != 0 {
		log.Printf("[aura] taskbar: CoCreateInstance(ITaskbarList3) failed (0x%x) — thumbnail buttons disabled", hr)
		return false
	}
	b.obj = unsafe.Pointer(out)
	b.vtbl = *(*uintptr)(b.obj)
	if h := b.call(vtHrInit); h != 0 {
		log.Printf("[aura] taskbar: HrInit failed (0x%x) — thumbnail buttons disabled", h)
		return false
	}
	for _, png := range [][]byte{iconPrevious, iconPlay, iconPause, iconNext} {
		h, ok := hiconFromPNG(png)
		if !ok {
			log.Printf("[aura] taskbar: icon decode failed — thumbnail buttons disabled")
			return false
		}
		b.icons = append(b.icons, h)
	}
	return true
}

// call invokes vtable method `index` (StdCall: this-pointer first).
func (b *Bar) call(index int, args ...uintptr) uintptr {
	proc := *(*uintptr)(unsafe.Pointer(b.vtbl + uintptr(index)*unsafe.Sizeof(uintptr(0))))
	return syscallN(append([]uintptr{proc, uintptr(b.obj)}, args...)...)
}

// Update (re)shows the three buttons with the right Play/Pause glyph.
func (b *Bar) Update(isPlaying bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.obj == nil {
		return
	}
	icons := [3]uintptr{b.icons[0], b.icons[1], b.icons[3]} // previous, play, next
	if isPlaying {
		icons[1] = b.icons[2]
	}
	buttons := make([]byte, 3*thumbButtonSize)
	ids := [3]uint32{idPrevious, idToggle, idNext}
	for i := 0; i < 3; i++ {
		row := buttons[i*thumbButtonSize : (i+1)*thumbButtonSize]
		putU32(row, offMask, thbIcon)
		putU32(row, offID, ids[i])
		putU32(row, offBitmap, 0)
		putU64(row, offIcon, uint64(icons[i]))
		putU32(row, offFlags, 0) // THBF_ENABLED == 0
	}
	var hr uintptr
	if b.added {
		hr = b.call(vtThumbBarUpdateButtons, uintptr(b.hwnd), 3, uintptr(unsafe.Pointer(&buttons[0])))
	} else {
		hr = b.call(vtThumbBarAddButtons, uintptr(b.hwnd), 3, uintptr(unsafe.Pointer(&buttons[0])))
	}
	if hr == 0 {
		b.added = true
	} else {
		log.Printf("[aura] taskbar: ThumbBar update failed (0x%x)", hr)
	}
}

// Shutdown releases the COM object and icons (app exit).
func (b *Bar) Shutdown() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.obj == nil {
		return
	}
	_ = b.call(vtRelease)
	b.obj = nil
	for _, h := range b.icons {
		procDestroyIcon.Call(h)
	}
	b.icons = nil
	procCoUninit.Call()
}

type oleGUID struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

func putU32(b []byte, off int, v uint32) {
	b[off] = byte(v)
	b[off+1] = byte(v >> 8)
	b[off+2] = byte(v >> 16)
	b[off+3] = byte(v >> 24)
}

func putU64(b []byte, off int, v uint64) {
	for i := 0; i < 8; i++ {
		b[off+i] = byte(v >> (8 * i))
	}
}

// hiconFromPNG decodes a PNG-encoded icon (Vista+ CreateIconFromResourceEx
// understands PNG payloads, which is exactly what an RT_ICON with PNG
// compression contains).
func hiconFromPNG(png []byte) (uintptr, bool) {
	if len(png) < 24 {
		return 0, false
	}
	h, _, _ := procCreateIcon.Call(
		uintptr(unsafe.Pointer(&png[0])),
		uintptr(len(png)),
		1, // fIcon
		0x00030000,
		0, 0,
		0, // LR_DEFAULTCOLOR
	)
	if h == 0 {
		return 0, false
	}
	return h, true
}
