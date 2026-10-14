// Package window implements Aura's window modes on top of Wails v2, which is
// single-window. Electron's separate mini-player BrowserWindow becomes a
// "mini mode" of the one window: the window shrinks to the 460x112 widget,
// floats above other windows and keeps its audio engine (the renderer) alive.
//
// Behaviour preserved from 3.2.0: minimizing surfaces the mini player; the
// widget's "restore" brings the full window back; its "close" dismisses the
// widget without touching the main window (so after an auto-show it leaves the
// app minimized); the widget's position persists across restarts.
package window

import (
	"math"
	"sync"
)

// Mini player geometry (3.2.0: 460x112) and the full window's minimum size.
const (
	MiniW, MiniH   = 460, 112
	NormalMinW     = 1100
	NormalMinH     = 700
	miniEdgeMargin = 24
)

type Rect struct{ X, Y, W, H int }
type Point struct{ X, Y int }

// Ops is the native window layer (Wails runtime in production, fake in tests).
type Ops interface {
	Size() (w, h int)
	Position() (x, y int)
	SetSize(w, h int)
	SetPosition(x, y int)
	SetMinSize(w, h int)
	SetMaxSize(w, h int) // 0,0 removes the limit
	IsMaximised() bool
	Maximise()
	Unmaximise()
	SetAlwaysOnTop(on bool)
	Minimise()
	Unminimise()
	Show()
	// Geometry below is in PHYSICAL screen pixels (absolute, virtual-desktop
	// coordinates); Size/SetSize/SetMinSize/SetMaxSize are LOGICAL (DPI-scaled
	// by Wails). Scale converts logical -> physical (e.g. 1.5 at 144 DPI).
	WorkArea() Rect
	Displays() []Rect
	Scale() float64
	Quit()
}

// Store persists the mini player's last position.
type Store interface {
	Load() (Point, bool)
	Save(Point)
}

// ExitAction says what happens to the main window when mini mode ends.
type ExitAction int

const (
	// Restore brings the full window back, shown and focused.
	Restore ExitAction = iota
	// Dismiss hides only the widget. The main window is left as the user had
	// it — which after an auto-show means minimized, like Electron.
	Dismiss
)

type layout struct {
	w, h      int
	pos       Point
	maximised bool
	hasLayout bool
}

// Controller is the window state machine. All methods are safe for concurrent use.
type Controller struct {
	mu     sync.Mutex
	ops    Ops
	store  Store
	notify func(visible bool)

	mini  bool
	auto  bool // mini was auto-shown by a minimize, not opened by the user
	saved layout
	// suppressAuto latches after an auto-shown widget is dismissed while the
	// window stays OS-minimized: without it the minimize poll would instantly
	// re-show the widget the user just closed. Cleared when the window is
	// genuinely restored (not minimized).
	suppressAuto bool
}

// New creates a controller. notify is called (without the lock held) whenever
// mini visibility changes; it may be nil.
func New(ops Ops, store Store, notify func(visible bool)) *Controller {
	if notify == nil {
		notify = func(bool) {}
	}
	return &Controller{ops: ops, store: store, notify: notify}
}

// MiniVisible reports whether the window is currently in mini mode.
func (c *Controller) MiniVisible() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.mini
}

func contains(r Rect, p Point) bool {
	return p.X >= r.X && p.X < r.X+r.W && p.Y >= r.Y && p.Y < r.Y+r.H
}

// miniTarget returns where the widget appears: its last position if that is
// still on a connected display, otherwise the bottom-right of the work area.
func (c *Controller) miniTarget() Point {
	if p, ok := c.store.Load(); ok {
		for _, d := range c.ops.Displays() {
			if contains(d, p) {
				return p
			}
		}
	}
	s := c.ops.Scale()
	if s <= 0 {
		s = 1
	}
	px := func(logical int) int { return int(math.Round(float64(logical) * s)) }
	wa := c.ops.WorkArea()
	return Point{X: wa.X + wa.W - px(MiniW) - px(miniEdgeMargin), Y: wa.Y + wa.H - px(MiniH) - px(miniEdgeMargin)}
}

// ShowMini enters mini mode. auto marks a minimize-triggered show.
func (c *Controller) ShowMini(auto bool) {
	c.mu.Lock()
	if c.mini {
		if auto {
			c.auto = true
		}
		c.mu.Unlock()
		return
	}
	w, h := c.ops.Size()
	x, y := c.ops.Position()
	c.saved = layout{w: w, h: h, pos: Point{x, y}, maximised: c.ops.IsMaximised(), hasLayout: true}
	if c.saved.maximised {
		c.ops.Unmaximise()
	}
	t := c.miniTarget()
	// Lift the full window's minimum before shrinking, and pin the size so the
	// widget cannot be resized.
	c.ops.SetMinSize(MiniW, MiniH)
	c.ops.SetMaxSize(MiniW, MiniH)
	c.ops.SetSize(MiniW, MiniH)
	c.ops.SetPosition(t.X, t.Y)
	c.ops.SetAlwaysOnTop(true)
	// An OS-minimize auto-show finds the window iconic: the widget must be
	// VISIBLE, so un-minimise (a no-op when the window is already shown).
	c.ops.Unminimise()
	c.mini, c.auto = true, auto
	c.mu.Unlock()
	c.notify(true)
}

// ExitMini leaves mini mode, restoring the full window's size and position.
func (c *Controller) ExitMini(action ExitAction) {
	c.mu.Lock()
	if !c.mini {
		c.mu.Unlock()
		return
	}
	x, y := c.ops.Position()
	c.store.Save(Point{x, y})
	wasAuto := c.auto

	c.ops.SetAlwaysOnTop(false)
	c.ops.SetMaxSize(0, 0)
	c.ops.SetMinSize(NormalMinW, NormalMinH)
	if c.saved.hasLayout {
		c.ops.SetSize(c.saved.w, c.saved.h)
		c.ops.SetPosition(c.saved.pos.X, c.saved.pos.Y)
		if c.saved.maximised {
			c.ops.Maximise()
		}
	}
	c.mini, c.auto = false, false
	switch {
	case action == Restore:
		c.ops.Unminimise()
		c.ops.Show()
	case wasAuto:
		c.suppressAuto = true // the dismiss must survive the minimize poll
		c.ops.Minimise()
	}
	c.mu.Unlock()
	c.notify(false)
}

// SyncMinimizeState reconciles the mini player with the window's real
// minimized state, polled by the service (Wails v2 has no minimize event).
// Single direction, 3.2.0 parity: an OS-initiated minimize (taskbar click,
// Win+D) while no widget is visible auto-shows it. An explicitly opened
// widget, or one the user just dismissed, is never second-guessed.
func (c *Controller) SyncMinimizeState(minimized bool) {
	c.mu.Lock()
	if !minimized {
		// A genuine restore clears any dismiss latch.
		c.suppressAuto = false
		c.mu.Unlock()
		return
	}
	if c.mini || c.suppressAuto {
		c.mu.Unlock()
		return
	}
	c.mu.Unlock()
	c.ShowMini(true)
}

// Minimize is the title-bar minimize button: it surfaces the mini player.
func (c *Controller) Minimize() { c.ShowMini(true) }

// ToggleMaximize maximizes or restores the full window (no-op in mini mode).
func (c *Controller) ToggleMaximize() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.mini {
		return
	}
	if c.ops.IsMaximised() {
		c.ops.Unmaximise()
	} else {
		c.ops.Maximise()
	}
}

// IsMaximized reports whether the full window is maximized.
func (c *Controller) IsMaximized() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.mini && c.ops.IsMaximised()
}

// Shutdown persists the widget position if the app quits while in mini mode.
func (c *Controller) Shutdown() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.mini {
		x, y := c.ops.Position()
		c.store.Save(Point{x, y})
	}
}

// Quit closes the application.
func (c *Controller) Quit() { c.ops.Quit() }
