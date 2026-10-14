package window

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// FileStore persists the mini player position as JSON (same file name as 3.2.0).
type FileStore struct {
	mu   sync.Mutex
	path string
}

func NewFileStore(dir string) *FileStore {
	return &FileStore{path: filepath.Join(dir, "mini-bounds.json")}
}

func (s *FileStore) Load() (Point, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		return Point{}, false
	}
	var v struct {
		X *int `json:"x"`
		Y *int `json:"y"`
	}
	if json.Unmarshal(b, &v) != nil || v.X == nil || v.Y == nil {
		return Point{}, false // corrupt or incomplete: fall back to the default anchor
	}
	return Point{*v.X, *v.Y}, true
}

// Save writes atomically (temp file + rename) so a crash cannot leave a torn file.
func (s *FileStore) Save(p Point) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, _ := json.Marshal(map[string]int{"x": p.X, "y": p.Y})
	if os.MkdirAll(filepath.Dir(s.path), 0o755) != nil {
		return
	}
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		_ = os.Rename(tmp, s.path)
	}
}
