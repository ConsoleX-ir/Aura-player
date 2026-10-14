// Package watcher replaces Electron's recursive fs.watch with a Go-side
// watcher. Semantics are inherited from 3.2.0:
//
//   - Watch(folders) REPLACES the whole watcher set every call (the renderer
//     sends the full desired set, making add/remove bookkeeping impossible
//     to drift);
//   - change bursts are DEBounced per folder (1.2 s) before the renderer
//     hears anything — one reconciliation per burst, not per chattr;
//   - a folder that cannot be watched (deleted, permission) is skipped, not
//     an error;
//   - zero polling: while nothing changes this costs nothing.
//
// Recursive watching walks each folder and registers every subdirectory with
// one shared fsnotify handle; create events on new subdirectories extend the
// walk lazily.
package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// DebounceWindow matches main.cjs's 1200 ms per-folder debounce.
const DebounceWindow = 1200 * time.Millisecond

// Change is one debounced change event for one watched folder.
type Change struct {
	Folder string `json:"folder"`
	At     int64  `json:"at"` // epoch ms when the burst STARTED (pre-debounce)
}

// Watcher owns the live watcher set. Safe for concurrent use.
type Watcher struct {
	notify func(Change)

	mu      sync.Mutex
	handle  *fsnotify.Watcher
	roots   map[string]bool
	pending map[string]*time.Timer // root folder → debounce timer
	burst   map[string]int64       // root folder → burst start (ms)
}

func New(notify func(Change)) *Watcher {
	if notify == nil {
		notify = func(Change) {}
	}
	return &Watcher{
		notify:  notify,
		roots:   map[string]bool{},
		pending: map[string]*time.Timer{},
		burst:   map[string]int64{},
	}
}

// Count reports how many root folders are currently watched.
func (w *Watcher) Count() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.roots)
}

// Watch replaces the watcher set with exactly folders (recursive).
// Returns the number of folders actually watched.
func (w *Watcher) Watch(folders []string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.unwatchLocked()

	handle, err := fsnotify.NewWatcher()
	if err != nil {
		return 0
	}
	w.handle = handle
	go w.pump(handle)

	watched := 0
	for _, folder := range folders {
		if folder == "" {
			continue
		}
		if w.walkAdd(folder) {
			w.roots[folder] = true
			watched++
		}
	}
	return watched
}

// walkAdd watches dir and every subdirectory; false when dir itself is
// unwatchable (deleted, permissions).
func (w *Watcher) walkAdd(dir string) bool {
	if w.handle == nil {
		return false
	}
	if err := w.handle.Add(dir); err != nil {
		return false
	}
	_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() && p != dir {
			if err := w.handle.Add(p); err != nil {
				return filepath.SkipDir
			}
		}
		return nil
	})
	return true
}

// pump drains the shared handle until it closes.
func (w *Watcher) pump(handle *fsnotify.Watcher) {
	events := handle.Events
	errors := handle.Errors
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return
			}
			w.onEvent(ev)
		case <-errors:
			// folder deleted mid-watch etc. — ignore; the follow-up
			// reconciliation re-stats everything anyway
		}
	}
}

// onEvent extends the walk into created directories and (re)schedules the
// debounced notification.
func (w *Watcher) onEvent(ev fsnotify.Event) {
	root := w.rootOf(ev.Name)
	if root == "" {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.roots[root] {
		return
	}
	if ev.Op&fsnotify.Create != 0 {
		if st, err := os.Stat(ev.Name); err == nil && st.IsDir() {
			w.walkAdd(ev.Name)
		}
	}
	if _, live := w.burst[root]; !live {
		w.burst[root] = time.Now().UnixMilli()
	}
	if timer, ok := w.pending[root]; ok {
		timer.Stop()
	}
	folder := root
	w.pending[root] = time.AfterFunc(DebounceWindow, func() {
		w.mu.Lock()
		delete(w.pending, folder)
		start := w.burst[folder]
		delete(w.burst, folder)
		w.mu.Unlock()
		if start == 0 {
			return
		}
		w.notify(Change{Folder: folder, At: start})
	})
}

// rootOf maps an event path back to its watched root (longest prefix match).
func (w *Watcher) rootOf(path string) string {
	w.mu.Lock()
	defer w.mu.Unlock()
	best := ""
	for root := range w.roots {
		if len(root) > len(best) && hasPathPrefix(path, root) {
			best = root
		}
	}
	return best
}

func hasPathPrefix(path, root string) bool {
	if path == root {
		return true
	}
	if len(path) <= len(root) {
		return false
	}
	sep := byte(filepath.Separator)
	return path[:len(root)] == root && path[len(root)] == sep
}

// unwatchLocked stops and clears everything (caller holds w.mu).
func (w *Watcher) unwatchLocked() {
	if w.handle != nil {
		_ = w.handle.Close() // closes Events → pump goroutine exits
		w.handle = nil
	}
	w.roots = map[string]bool{}
	for f, timer := range w.pending {
		timer.Stop()
		delete(w.pending, f)
	}
	w.burst = map[string]int64{}
}

// Stop tears everything down (app shutdown).
func (w *Watcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.unwatchLocked()
}
