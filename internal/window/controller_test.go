package window

import (
	"reflect"
	"testing"
)

type fakeOps struct {
	w, h, x, y       int
	minW, minH       int
	maxW, maxH       int
	maximised, top   bool
	minimised, shown bool
	work             Rect
	displays         []Rect
	quit             bool
	scale            float64
	calls            []string
}

func newOps() *fakeOps {
	return &fakeOps{w: 1440, h: 900, x: 100, y: 80, minW: NormalMinW, minH: NormalMinH, shown: true,
		work:     Rect{0, 0, 1920, 1040},
		displays: []Rect{{0, 0, 1920, 1080}, {1920, 0, 1280, 1024}}}
}
func (f *fakeOps) rec(s string)          { f.calls = append(f.calls, s) }
func (f *fakeOps) Size() (int, int)      { return f.w, f.h }
func (f *fakeOps) Position() (int, int)  { return f.x, f.y }
func (f *fakeOps) SetSize(w, h int)      { f.w, f.h = w, h; f.rec("size") }
func (f *fakeOps) SetPosition(x, y int)  { f.x, f.y = x, y; f.rec("pos") }
func (f *fakeOps) SetMinSize(w, h int)   { f.minW, f.minH = w, h; f.rec("min") }
func (f *fakeOps) SetMaxSize(w, h int)   { f.maxW, f.maxH = w, h; f.rec("max") }
func (f *fakeOps) IsMaximised() bool     { return f.maximised }
func (f *fakeOps) Maximise()             { f.maximised = true; f.rec("maximise") }
func (f *fakeOps) Unmaximise()           { f.maximised = false; f.rec("unmaximise") }
func (f *fakeOps) SetAlwaysOnTop(b bool) { f.top = b }
func (f *fakeOps) Minimise()             { f.minimised = true; f.rec("minimise") }
func (f *fakeOps) Unminimise()           { f.minimised = false; f.rec("unminimise") }
func (f *fakeOps) Show()                 { f.shown = true; f.rec("show") }
func (f *fakeOps) WorkArea() Rect        { return f.work }
func (f *fakeOps) Displays() []Rect      { return f.displays }
func (f *fakeOps) Quit()                 { f.quit = true }

type memStore struct {
	p  Point
	ok bool
}

func (m *memStore) Load() (Point, bool) { return m.p, m.ok }
func (m *memStore) Save(p Point)        { m.p, m.ok = p, true }

func setup() (*Controller, *fakeOps, *memStore, *[]bool) {
	ops, st := newOps(), &memStore{}
	var events []bool
	return New(ops, st, func(v bool) { events = append(events, v) }), ops, st, &events
}

func TestShowMiniShrinksPinsAndFloats(t *testing.T) {
	c, ops, _, ev := setup()
	c.ShowMini(false)
	if ops.w != MiniW || ops.h != MiniH {
		t.Errorf("size %dx%d, want %dx%d", ops.w, ops.h, MiniW, MiniH)
	}
	if ops.minW != MiniW || ops.maxW != MiniW || ops.maxH != MiniH {
		t.Errorf("widget must be pinned: min=%d max=%dx%d", ops.minW, ops.maxW, ops.maxH)
	}
	if !ops.top {
		t.Error("widget must float above other windows")
	}
	// default anchor = bottom-right of the work area minus a 24px margin
	if ops.x != 1920-MiniW-24 || ops.y != 1040-MiniH-24 {
		t.Errorf("default position (%d,%d)", ops.x, ops.y)
	}
	if !reflect.DeepEqual(*ev, []bool{true}) || !c.MiniVisible() {
		t.Errorf("events=%v visible=%v", *ev, c.MiniVisible())
	}
}

func TestMinLoweredBeforeShrink(t *testing.T) {
	c, ops, _, _ := setup()
	c.ShowMini(false)
	order := map[string]int{}
	for i, s := range ops.calls {
		if _, seen := order[s]; !seen {
			order[s] = i
		}
	}
	if order["min"] > order["size"] {
		t.Errorf("min size must be lowered before shrinking, calls=%v", ops.calls)
	}
}

func TestExitRestoresExactLayoutAndSavesMiniPosition(t *testing.T) {
	c, ops, st, ev := setup()
	c.ShowMini(false)
	ops.x, ops.y = 500, 300 // user dragged the widget
	c.ExitMini(Restore)
	if ops.w != 1440 || ops.h != 900 || ops.x != 100 || ops.y != 80 {
		t.Errorf("layout %dx%d@(%d,%d), want 1440x900@(100,80)", ops.w, ops.h, ops.x, ops.y)
	}
	if ops.minW != NormalMinW || ops.minH != NormalMinH || ops.maxW != 0 || ops.maxH != 0 || ops.top {
		t.Errorf("limits not restored: min=%dx%d max=%dx%d top=%v", ops.minW, ops.minH, ops.maxW, ops.maxH, ops.top)
	}
	if st.p != (Point{500, 300}) {
		t.Errorf("mini position not persisted: %+v", st.p)
	}
	if !reflect.DeepEqual(*ev, []bool{true, false}) {
		t.Errorf("events = %v", *ev)
	}
}

func TestMaximisedWindowIsRestoredToMaximised(t *testing.T) {
	c, ops, _, _ := setup()
	ops.maximised = true
	c.ShowMini(false)
	if ops.maximised {
		t.Error("must unmaximise before shrinking")
	}
	c.ExitMini(Restore)
	if !ops.maximised {
		t.Error("maximised state lost")
	}
}

func TestMinimizeAutoShowsAndDismissLeavesAppMinimized(t *testing.T) {
	c, ops, _, _ := setup()
	c.Minimize()
	if !c.MiniVisible() {
		t.Fatal("minimize must surface the mini player")
	}
	c.ExitMini(Dismiss) // widget "close" button
	if !ops.minimised {
		t.Error("closing an auto-shown widget leaves the app minimized (3.2.0 behaviour)")
	}
}

func TestDismissOfUserOpenedWidgetLeavesMainWindowVisible(t *testing.T) {
	c, ops, _, _ := setup()
	c.ShowMini(false) // the P key / pill button
	c.ExitMini(Dismiss)
	if ops.minimised {
		t.Error("user-opened widget: closing it must not minimize the app")
	}
}

func TestRestoreShowsAndUnminimises(t *testing.T) {
	c, ops, _, _ := setup()
	c.Minimize()
	c.ExitMini(Restore)
	if ops.minimised || !ops.shown {
		t.Errorf("minimised=%v shown=%v", ops.minimised, ops.shown)
	}
}

func TestMinimizeOnVisibleWidgetUpgradesAutoFlag(t *testing.T) {
	// 3.2.0: showMiniPlayer({auto:true}) on an already-visible widget upgrades the flag.
	c, ops, _, ev := setup()
	c.ShowMini(false)
	c.ShowMini(true)
	if len(*ev) != 1 {
		t.Errorf("no second notification expected, got %v", *ev)
	}
	c.ExitMini(Dismiss)
	if !ops.minimised {
		t.Error("auto flag should have been upgraded")
	}
}

func TestIdempotentAndSafeOutsideMini(t *testing.T) {
	c, ops, _, ev := setup()
	c.ExitMini(Restore) // not in mini mode: no-op
	if len(ops.calls) != 0 || len(*ev) != 0 {
		t.Errorf("unexpected effects: %v %v", ops.calls, *ev)
	}
	c.ShowMini(false)
	n := len(ops.calls)
	c.ShowMini(false)
	if len(ops.calls) != n {
		t.Error("second ShowMini must not re-layout")
	}
}

func TestSavedPositionOnConnectedDisplayIsReused(t *testing.T) {
	c, ops, st, _ := setup()
	st.Save(Point{2200, 200}) // second monitor
	c.ShowMini(false)
	if ops.x != 2200 || ops.y != 200 {
		t.Errorf("(%d,%d), want (2200,200)", ops.x, ops.y)
	}
}

func TestSavedPositionOnDisconnectedDisplayFallsBack(t *testing.T) {
	c, ops, st, _ := setup()
	st.Save(Point{5000, 4000}) // monitor was unplugged
	c.ShowMini(false)
	if ops.x != 1920-MiniW-24 || ops.y != 1040-MiniH-24 {
		t.Errorf("(%d,%d) should fall back to the default anchor", ops.x, ops.y)
	}
}

func TestMaximizeIsIgnoredInMini(t *testing.T) {
	c, ops, _, _ := setup()
	c.ShowMini(false)
	c.ToggleMaximize()
	if ops.maximised || c.IsMaximized() {
		t.Error("the widget must not be maximizable")
	}
	c.ExitMini(Restore)
	c.ToggleMaximize()
	if !ops.maximised || !c.IsMaximized() {
		t.Error("toggle should maximize the full window")
	}
}

func TestShutdownPersistsMiniPosition(t *testing.T) {
	c, ops, st, _ := setup()
	c.ShowMini(false)
	ops.x, ops.y = 700, 650
	c.Shutdown()
	if st.p != (Point{700, 650}) {
		t.Errorf("saved %+v", st.p)
	}
}

// At 150% scaling the widget occupies 690x168 physical pixels with a 36px margin;
// the anchor must account for that or it would overhang the screen edge.
func TestDefaultAnchorIsDPIAware(t *testing.T) {
	c, ops, _, _ := setup()
	ops.scale = 1.5
	c.ShowMini(false)
	wantX := 1920 - 690 - 36
	wantY := 1040 - 168 - 36
	if ops.x != wantX || ops.y != wantY {
		t.Errorf("(%d,%d), want (%d,%d)", ops.x, ops.y, wantX, wantY)
	}
	if ops.w != MiniW || ops.h != MiniH {
		t.Errorf("logical size must stay %dx%d, got %dx%d", MiniW, MiniH, ops.w, ops.h)
	}
}

func (f *fakeOps) Scale() float64 {
	if f.scale == 0 {
		return 1
	}
	return f.scale
}

// ── OS-minimize poll reconciliation (Wails v2 has no minimize event) ────────

func TestPollAutoShowsWidgetOnOSMinimize(t *testing.T) {
	c, ops, _, ev := setup()
	c.SyncMinimizeState(true) // taskbar click / Win+D
	if !c.MiniVisible() {
		t.Fatal("OS minimize must auto-show the widget")
	}
	if ops.minimised {
		t.Error("widget must be visible: the iconic window must be un-minimised")
	}
	if len(*ev) != 1 || (*ev)[0] != true {
		t.Errorf("visibility events = %v", *ev)
	}
}

func TestPollNeverTouchesExplicitWidget(t *testing.T) {
	c, _, _, _ := setup()
	c.ShowMini(false) // user opened it with P
	c.SyncMinimizeState(true)
	if !c.MiniVisible() {
		t.Fatal("explicit widget must stay")
	}
	// Win+D with the explicit widget: the window may go iconic, the widget
	// decision is never second-guessed.
	c.SyncMinimizeState(false)
	if !c.MiniVisible() {
		t.Fatal("restore must not dismiss an explicitly opened widget")
	}
}

func TestDismissedAutoWidgetStaysDismissedUntilRealRestore(t *testing.T) {
	c, ops, _, _ := setup()
	ops.minimised = true
	c.SyncMinimizeState(true) // OS minimize → widget
	c.ExitMini(Dismiss)       // user closes the widget (auto → re-minimise)
	if c.MiniVisible() {
		t.Fatal("dismiss must exit mini mode")
	}
	if !ops.minimised {
		t.Fatal("dismissed auto widget leaves the app minimized (3.2.0 parity)")
	}
	// The next poll must NOT resurrect the widget the user just closed.
	c.SyncMinimizeState(true)
	if c.MiniVisible() {
		t.Fatal("suppress latch failed: dismissed widget re-appeared")
	}
	// A genuine restore clears the latch; the NEXT minimize auto-shows again.
	c.SyncMinimizeState(false)
	c.SyncMinimizeState(true)
	if !c.MiniVisible() {
		t.Fatal("after a real restore, a fresh minimize must auto-show again")
	}
}

func TestRestoreButtonClearsSuppressLatch(t *testing.T) {
	c, ops, _, _ := setup()
	ops.minimised = true
	c.SyncMinimizeState(true)
	c.ExitMini(Dismiss)
	c.SyncMinimizeState(true)
	if c.MiniVisible() {
		t.Fatal("latch failed")
	}
	// User restores from the taskbar: window un-minimised without the widget.
	ops.minimised = false
	c.SyncMinimizeState(false)
	// New OS minimize shows the widget again (latch was cleared).
	c.SyncMinimizeState(true)
	if !c.MiniVisible() {
		t.Fatal("latch must clear on restore")
	}
}

func TestPollQuietWhenWindowVisible(t *testing.T) {
	c, _, _, ev := setup()
	c.SyncMinimizeState(false)
	c.SyncMinimizeState(false)
	if c.MiniVisible() || len(*ev) != 0 {
		t.Error("visible window: poll must do nothing")
	}
}
