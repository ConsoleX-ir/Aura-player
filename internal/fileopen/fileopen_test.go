package fileopen

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func mk(t *testing.T, name string) string {
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPickAudioArg(t *testing.T) {
	song, txt := mk(t, "Song.MP3"), mk(t, "notes.txt")
	if got := PickAudioArg([]string{`C:\Aura\AuraPlayer.exe`, "--flag", txt, song}); got != song {
		t.Errorf("got %q want %q", got, song)
	}
	if got := PickAudioArg([]string{filepath.Join(t.TempDir(), "gone.mp3")}); got != "" {
		t.Errorf("a non-existent file must be ignored, got %q", got)
	}
	if got := PickAudioArg(nil); got != "" {
		t.Errorf("got %q", got)
	}
	if got := PickAudioArg([]string{t.TempDir() + string(filepath.Separator)}); got != "" {
		t.Errorf("directory accepted: %q", got)
	}
}

func TestTakeLaunchFileIsOneShot(t *testing.T) {
	song := mk(t, "a.flac")
	s := NewService([]string{"exe", song})
	if s.TakeLaunchFile() != song {
		t.Fatal("launch file not returned")
	}
	if s.TakeLaunchFile() != "" {
		t.Error("launch file must be returned only once")
	}
}

func TestSecondLaunchEmits(t *testing.T) {
	song := mk(t, "b.ogg")
	s := NewService(nil)
	var got string
	s.emit = func(_ context.Context, p string) { got = p }
	if s.HandleSecondLaunch([]string{"exe"}) || got != "" {
		t.Error("no audio arg: nothing should be emitted")
	}
	if !s.HandleSecondLaunch([]string{"exe", song}) || got != song {
		t.Errorf("emitted %q", got)
	}
}
