package window

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// WailsOps implements Ops with the Wails runtime plus native geometry.
type WailsOps struct{ ctx context.Context }

func NewWailsOps(ctx context.Context) *WailsOps { return &WailsOps{ctx: ctx} }

func (o *WailsOps) Size() (int, int)       { return runtime.WindowGetSize(o.ctx) }
func (o *WailsOps) SetSize(w, h int)       { runtime.WindowSetSize(o.ctx, w, h) }
func (o *WailsOps) SetMinSize(w, h int)    { runtime.WindowSetMinSize(o.ctx, w, h) }
func (o *WailsOps) SetMaxSize(w, h int)    { runtime.WindowSetMaxSize(o.ctx, w, h) }
func (o *WailsOps) IsMaximised() bool      { return runtime.WindowIsMaximised(o.ctx) }
func (o *WailsOps) Maximise()              { runtime.WindowMaximise(o.ctx) }
func (o *WailsOps) Unmaximise()            { runtime.WindowUnmaximise(o.ctx) }
func (o *WailsOps) SetAlwaysOnTop(on bool) { runtime.WindowSetAlwaysOnTop(o.ctx, on) }
func (o *WailsOps) Minimise()              { runtime.WindowMinimise(o.ctx) }
func (o *WailsOps) Unminimise()            { runtime.WindowUnminimise(o.ctx) }
func (o *WailsOps) Show()                  { runtime.WindowShow(o.ctx) }
func (o *WailsOps) Quit()                  { runtime.Quit(o.ctx) }
func (o *WailsOps) Scale() float64         { return nativeScale() }

func (o *WailsOps) Position() (int, int) {
	if x, y, ok := nativePosition(); ok {
		return x, y
	}
	return runtime.WindowGetPosition(o.ctx)
}

func (o *WailsOps) SetPosition(x, y int) {
	if !nativeSetPosition(x, y) {
		runtime.WindowSetPosition(o.ctx, x, y)
	}
}

func (o *WailsOps) WorkArea() Rect {
	if r, ok := nativeWorkArea(); ok {
		return r
	}
	if screens, err := runtime.ScreenGetAll(o.ctx); err == nil {
		for _, s := range screens {
			if s.IsPrimary {
				return Rect{0, 0, s.Size.Width, s.Size.Height}
			}
		}
	}
	return Rect{0, 0, 1920, 1080}
}

func (o *WailsOps) Displays() []Rect {
	if d := nativeDisplays(); len(d) > 0 {
		return d
	}
	return []Rect{o.WorkArea()}
}
