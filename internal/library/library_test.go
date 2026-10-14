package library

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func tree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mk := func(rel string) {
		p := filepath.Join(root, rel)
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range []string{"a.mp3", "b.FLAC", "notes.txt", "sub/c.ogg", "sub/deep/d.opus", "sub/cover.jpg"} {
		mk(f)
	}
	return root
}

func names(fs []AudioFile) []string {
	n := make([]string, len(fs))
	for i, f := range fs {
		n[i] = f.Name
	}
	sort.Strings(n)
	return n
}

func eq(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestScanFolderRecursiveAndCaseInsensitive(t *testing.T) {
	got, err := NewService().ScanFolder(tree(t))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"a.mp3", "b.FLAC", "c.ogg", "d.opus"}
	if !eq(names(got), want) {
		t.Errorf("got %v want %v", names(got), want)
	}
	for _, f := range got {
		if f.MtimeMs <= 0 {
			t.Errorf("%s: mtimeMs not set", f.Name)
		}
	}
}

func TestScanMissingRootIsEmptyNotError(t *testing.T) {
	got, err := NewService().ScanFolder(filepath.Join(t.TempDir(), "nope"))
	if err != nil || len(got) != 0 || got == nil {
		t.Errorf("got %v, %v; want empty non-nil, nil", got, err)
	}
}

func TestScanStopsOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := scan(ctx, tree(t)); err == nil {
		t.Error("expected context error")
	}
}

// Regression test for the 3.2.0 defect: dropping a folder threw a TypeError.
func TestResolveDroppedFolderAndFiles(t *testing.T) {
	root := tree(t)
	loose := filepath.Join(t.TempDir(), "loose.m4a")
	os.WriteFile(loose, []byte("x"), 0o644)
	junk := filepath.Join(t.TempDir(), "readme.txt")
	os.WriteFile(junk, []byte("x"), 0o644)

	res, err := NewService().ResolveDroppedPaths([]string{root, loose, junk, filepath.Join(root, "missing")})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Folders) != 1 || res.Folders[0] != root {
		t.Errorf("folders = %v", res.Folders)
	}
	want := []string{"a.mp3", "b.FLAC", "c.ogg", "d.opus", "loose.m4a"}
	if !eq(names(res.Files), want) {
		t.Errorf("files = %v want %v", names(res.Files), want)
	}
}

func TestCheckPaths(t *testing.T) {
	root := tree(t)
	good := filepath.Join(root, "a.mp3")
	got := NewService().CheckPaths([]string{good, filepath.Join(root, "gone.mp3"), "", root})
	if len(got) != 3 { // the empty path is dropped, as in 3.2.0
		t.Fatalf("len = %d, want 3", len(got))
	}
	if !got[0].Exists || got[0].SizeBytes != 1 || got[0].MtimeMs <= 0 {
		t.Errorf("good: %+v", got[0])
	}
	if got[1].Exists {
		t.Errorf("missing file reported as existing: %+v", got[1])
	}
	if got[2].Exists {
		t.Errorf("a directory must not count as a healthy file: %+v", got[2])
	}
}

func TestCheckPathsOrderAndScale(t *testing.T) {
	root := t.TempDir()
	var paths []string
	for i := 0; i < 600; i++ {
		p := filepath.Join(root, "f"+string(rune('a'+i%26))+".mp3")
		paths = append(paths, p)
	}
	os.WriteFile(filepath.Join(root, "fa.mp3"), []byte("x"), 0o644)
	got := NewService().CheckPaths(paths)
	for i, g := range got {
		if g.Path != paths[i] {
			t.Fatalf("order broken at %d", i)
		}
	}
}
