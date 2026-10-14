package shell

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidatePath(t *testing.T) {
	f := filepath.Join(t.TempDir(), "a song.mp3")
	os.WriteFile(f, []byte("x"), 0o644)
	if err := validatePath(f); err != nil {
		t.Errorf("valid path rejected: %v", err)
	}
	for name, p := range map[string]string{
		"empty":      "",
		"relative":   "music/a.mp3",
		"quote":      filepath.Join(t.TempDir(), `x".mp3`),
		"newline":    filepath.Join(t.TempDir(), "x\n.mp3"),
		"missing":    filepath.Join(t.TempDir(), "gone.mp3"),
		"cmd inject": `C:\a.mp3" & calc & "`,
	} {
		if validatePath(p) == nil {
			t.Errorf("%s: accepted %q", name, p)
		}
	}
}

func TestShowItemInFolderRejectsBadPathBeforeSpawning(t *testing.T) {
	if err := NewService().ShowItemInFolder("relative/path.mp3"); err == nil {
		t.Error("expected an error")
	}
}
