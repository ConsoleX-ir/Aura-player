package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// testNotify collects Change events with their arrival times.
type testNotify struct {
	mu     sync.Mutex
	seen   []Change
	notify func(Change)
}

func newTestNotify() *testNotify {
	t := &testNotify{}
	t.notify = func(c Change) {
		t.mu.Lock()
		t.seen = append(t.seen, c)
		t.mu.Unlock()
	}
	return t
}

func (t *testNotify) events() []Change {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]Change(nil), t.seen...)
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition not met within %v", timeout)
}

func TestWatchReplaceSemantics(t *testing.T) {
	dirA := t.TempDir()
	dirB := t.TempDir()
	n := newTestNotify()
	w := New(n.notify)
	defer w.Stop()

	got := w.Watch([]string{dirA, dirB})
	if got != 2 {
		t.Fatalf("watched = %d, want 2", got)
	}
	if w.Count() != 2 {
		t.Fatalf("Count = %d, want 2", w.Count())
	}
	// Replace with just dirA: dirB must stop being watched.
	got = w.Watch([]string{dirA})
	if got != 1 || w.Count() != 1 {
		t.Fatalf("after replace: watched=%d count=%d, want 1/1", got, w.Count())
	}

	// A change in dirB must NOT notify; a change in dirA must.
	if err := os.WriteFile(filepath.Join(dirB, "x.mp3"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1600 * time.Millisecond) // > debounce window
	if evs := n.events(); len(evs) != 0 {
		t.Fatalf("dirB events leaked after replace: %+v", evs)
	}
	if err := os.WriteFile(filepath.Join(dirA, "y.mp3"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 3*time.Second, func() bool { return len(n.events()) == 1 })
	evs := n.events()
	if evs[0].Folder != dirA {
		t.Errorf("event folder = %q, want %q", evs[0].Folder, dirA)
	}
	if evs[0].At == 0 {
		t.Errorf("event At must carry the burst start, got 0")
	}
}

func TestDebounceCollapsesBursts(t *testing.T) {
	dir := t.TempDir()
	n := newTestNotify()
	w := New(n.notify)
	defer w.Stop()

	if w.Watch([]string{dir}) != 1 {
		t.Fatal("watch failed")
	}
	// Simulate a burst: many writes inside the debounce window.
	for i := 0; i < 20; i++ {
		name := filepath.Join(dir, "burst"+string(rune('a'+i))+".tmp")
		if err := os.WriteFile(name, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Millisecond)
	}
	waitFor(t, 3*time.Second, func() bool { return len(n.events()) >= 1 })
	time.Sleep(300 * time.Millisecond) // allow stragglers (there should be none)
	if evs := n.events(); len(evs) != 1 {
		t.Errorf("burst of 20 writes produced %d notifications, want exactly 1", len(evs))
	}
}

func TestRecursiveSubdirectoryWatched(t *testing.T) {
	dir := t.TempDir()
	sub := filepath.Join(dir, "nested", "deep")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	n := newTestNotify()
	w := New(n.notify)
	defer w.Stop()

	if w.Watch([]string{dir}) != 1 {
		t.Fatal("watch failed")
	}
	if err := os.WriteFile(filepath.Join(sub, "song.flac"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 3*time.Second, func() bool { return len(n.events()) == 1 })
}

func TestNewSubdirectoryIsPickedUp(t *testing.T) {
	dir := t.TempDir()
	n := newTestNotify()
	w := New(n.notify)
	defer w.Stop()

	if w.Watch([]string{dir}) != 1 {
		t.Fatal("watch failed")
	}
	newDir := filepath.Join(dir, "created-later")
	if err := os.MkdirAll(newDir, 0o755); err != nil {
		t.Fatal(err)
	}
	time.Sleep(400 * time.Millisecond) // let the create event extend the walk
	if err := os.WriteFile(filepath.Join(newDir, "z.mp3"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 3*time.Second, func() bool { return len(n.events()) >= 1 })
}

func TestVanishedFolderIsSkipped(t *testing.T) {
	dir := t.TempDir()
	ghost := filepath.Join(t.TempDir(), "does-not-exist")
	n := newTestNotify()
	w := New(n.notify)
	defer w.Stop()

	got := w.Watch([]string{dir, ghost})
	if got != 1 {
		t.Fatalf("watched = %d, want 1 (ghost skipped)", got)
	}
}
