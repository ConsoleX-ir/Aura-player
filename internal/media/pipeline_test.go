package media

import (
	"encoding/binary"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/ConsoleX-ir/aura-player/internal/metadata"
)

// id3Apic builds an APIC frame body (the cover the parse should cache).
func id3Apic(png []byte) []byte {
	body := []byte{0x00}
	body = append(body, []byte("image/png")...)
	body = append(body, 0x00, 0x03, 0x00)
	body = append(body, png...)
	out := make([]byte, 10+len(body))
	copy(out[0:4], "APIC")
	binary.BigEndian.PutUint32(out[4:8], uint32(len(body)))
	copy(out[10:], body)
	return out
}

func id3Text(id, text string) []byte {
	body := append([]byte{0x00}, []byte(text)...)
	body = append(body, 0x00)
	out := make([]byte, 10+len(body))
	copy(out[0:4], id)
	binary.BigEndian.PutUint32(out[4:8], uint32(len(body)))
	copy(out[10:], body)
	return out
}

// syncsafe encodes n as an ID3v2 syncsafe u32.
func syncsafe(n int) [4]byte {
	return [4]byte{byte(n >> 21 & 0x7f), byte(n >> 14 & 0x7f), byte(n >> 7 & 0x7f), byte(n & 0x7f)}
}

// taggedMP3 builds a small ID3v2.3-tagged MP3 with real audio frames.
func taggedMP3(t *testing.T, title string, png []byte) []byte {
	t.Helper()
	frames := append(id3Text("TIT2", title), id3Text("TPE1", "Artist")...)
	frames = append(frames, id3Apic(png)...)
	tag := []byte{'I', 'D', '3', 3, 0, 0}
	ss := syncsafe(len(frames))
	tag = append(tag, ss[:]...)
	tag = append(tag, frames...)
	audio := make([]byte, 40000)
	for i := range audio {
		audio[i] = 0x55
	}
	audio[0], audio[1], audio[2], audio[3] = 0xff, 0xfb, 0x90, 0x00
	return append(tag, audio...)
}

// TestImportToPlaybackPipeline is the Stage-3 integration check: parse a
// tagged file through the Go metadata service, then load the cover AND the
// audio through the same-origin media handler the renderer uses.
func TestImportToPlaybackPipeline(t *testing.T) {
	dir := t.TempDir()
	covers := filepath.Join(dir, "covers")
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89")
	audio := taggedMP3(t, "Integration Song", png)
	audioPath := filepath.Join(dir, "song.mp3")
	if err := os.WriteFile(audioPath, audio, 0o644); err != nil {
		t.Fatal(err)
	}

	meta := (&metadata.Parser{CoversDir: covers}).ParseFile(audioPath)
	if meta.Title != "Integration Song" || meta.Artist != "Artist" {
		t.Fatalf("meta = %+v", meta)
	}
	if meta.CoverArt == nil || *meta.CoverArt == "" {
		t.Fatal("no cover art URL produced")
	}

	// 1. Cover URL must resolve through the handler with image/png.
	coverU, err := url.Parse(*meta.CoverArt)
	if err != nil {
		t.Fatalf("cover URL unparseable: %v", err)
	}
	rec := serve(t, http.MethodGet, coverU.Query().Get("path"), "")
	if rec.Code != 200 {
		t.Fatalf("cover fetch = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("cover content-type = %q", ct)
	}
	body, _ := io.ReadAll(rec.Body)
	if string(body) != string(png) {
		t.Error("cover bytes differ from embedded art")
	}

	// 2. Audio must stream with Range support (seeking).
	seek := serve(t, http.MethodGet, audioPath, "bytes=100-199")
	if seek.Code != http.StatusPartialContent {
		t.Fatalf("range fetch = %d, want 206", seek.Code)
	}
	if got := seek.Body.Len(); got != 100 {
		t.Errorf("range body = %d bytes, want 100", got)
	}
	cr := seek.Header().Get("Content-Range")
	if cr == "" {
		t.Error("missing Content-Range on 206")
	}

	// 3. Full-file GET keeps Accept-Ranges advertised (WebView2 probes it).
	full := serve(t, http.MethodGet, audioPath, "")
	if full.Code != 200 || full.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("full fetch = %d, Accept-Ranges = %q", full.Code, full.Header().Get("Accept-Ranges"))
	}
}
