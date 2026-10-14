package window

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileStoreRoundTripAndCorruptFile(t *testing.T) {
	dir := t.TempDir()
	s := NewFileStore(dir)
	if _, ok := s.Load(); ok {
		t.Fatal("empty store must report not-found")
	}
	s.Save(Point{-1800, 240}) // negative coordinates = monitor left of primary
	if p, ok := s.Load(); !ok || p != (Point{-1800, 240}) {
		t.Errorf("round trip = %+v, %v", p, ok)
	}
	for _, bad := range []string{"{not json", `{"x":5}`, ""} {
		os.WriteFile(filepath.Join(dir, "mini-bounds.json"), []byte(bad), 0o644)
		if _, ok := s.Load(); ok {
			t.Errorf("accepted corrupt file %q", bad)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "mini-bounds.json.tmp")); err == nil {
		t.Error("temp file left behind")
	}
}
