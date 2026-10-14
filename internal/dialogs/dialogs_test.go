package dialogs

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type fake struct{ savePath string }

func (fake) OpenDirectory(context.Context, string) (string, error) { return "", nil }
func (fake) OpenFiles(context.Context, string, []Filter) ([]string, error) {
	return nil, nil
}
func (f fake) SaveFile(context.Context, string, string, []Filter) (string, error) {
	return f.savePath, nil
}

func TestWriteRequiresDialogGrant(t *testing.T) {
	dir := t.TempDir()
	chosen := filepath.Join(dir, "list.m3u")
	other := filepath.Join(dir, "evil.bat")
	s := NewService(fake{savePath: chosen})

	if s.WriteTextFile(other, "x") {
		t.Fatal("wrote to a path that never came from a dialog")
	}
	if _, err := os.Stat(other); err == nil {
		t.Fatal("file was created")
	}

	p, err := s.SavePlaylistFile("list.m3u")
	if err != nil || p != chosen {
		t.Fatalf("SavePlaylistFile = %q, %v", p, err)
	}
	if s.WriteTextFile(other, "x") {
		t.Error("a grant for one path must not allow another")
	}
	if !s.WriteTextFile(chosen, "#EXTM3U") {
		t.Fatal("granted write refused")
	}
	if b, _ := os.ReadFile(chosen); string(b) != "#EXTM3U" {
		t.Errorf("content = %q", b)
	}
	if s.WriteTextFile(chosen, "again") {
		t.Error("grant must be single-use")
	}
}

func TestGrantExpires(t *testing.T) {
	chosen := filepath.Join(t.TempDir(), "x.m3u")
	s := NewService(fake{savePath: chosen})
	base := time.Now()
	s.now = func() time.Time { return base }
	s.SavePlaylistFile("x.m3u")
	s.now = func() time.Time { return base.Add(grantTTL + time.Second) }
	if s.WriteTextFile(chosen, "late") {
		t.Error("expired grant was honoured")
	}
}

func TestCancelledSaveGrantsNothing(t *testing.T) {
	s := NewService(fake{savePath: ""})
	if p, err := s.SavePlaylistFile("x.m3u"); p != "" || err != nil {
		t.Errorf("got %q, %v", p, err)
	}
}

func TestSaveImage(t *testing.T) {
	out := filepath.Join(t.TempDir(), "card.png")
	s := NewService(fake{savePath: out})
	png := []byte{0x89, 'P', 'N', 'G', 1, 2, 3}
	url := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)

	p, err := s.SaveImageFile("card.png", url)
	if err != nil || p != out {
		t.Fatalf("got %q, %v", p, err)
	}
	if b, _ := os.ReadFile(out); string(b) != string(png) {
		t.Errorf("bytes differ: %v", b)
	}
	for _, bad := range []string{"", "data:text/html;base64,AAAA", "data:image/png;base64,!!!", "data:image/jpeg;base64,AAAA"} {
		if p, err := s.SaveImageFile("x.png", bad); err == nil || p != "" {
			t.Errorf("accepted %q", bad)
		}
	}
}

func TestOpenFilesNeverNil(t *testing.T) {
	files, _ := NewService(fake{}).OpenFiles()
	if files == nil {
		t.Error("OpenFiles must return [] (not null) when cancelled")
	}
}
