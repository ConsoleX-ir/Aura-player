package metadata

import (
	"encoding/binary"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// id3v2Frame builds one v2.3 text frame (or APIC for pictures).
func id3TextFrame(id, text string) []byte {
	body := append([]byte{0x00}, append([]byte(text), 0x00)...) // encoding 0 = latin1
	out := make([]byte, 10+len(body))
	copy(out[0:4], id)
	binary.BigEndian.PutUint32(out[4:8], uint32(len(body)))
	copy(out[10:], body)
	return out
}

func id3ApicFrame(mime string, data []byte) []byte {
	body := []byte{0x00}
	body = append(body, []byte(mime)...)
	body = append(body, 0x00, 0x03) // picture type 3 = front cover
	body = append(body, 0x00)       // empty description
	body = append(body, data...)
	out := make([]byte, 10+len(body))
	copy(out[0:4], "APIC")
	binary.BigEndian.PutUint32(out[4:8], uint32(len(body)))
	copy(out[10:], body)
	return out
}

// mp3WithTags: ID3v2.3 tag + one 128kbps frame body (duration via CBR estimate).
func mp3WithTags(t *testing.T, title, artist, album string, png []byte) []byte {
	frames := append(id3TextFrame("TIT2", title), id3TextFrame("TPE1", artist)...)
	frames = append(frames, id3TextFrame("TALB", album)...)
	frames = append(frames, id3ApicFrame("image/png", png)...)
	tagBytes := []byte{'I', 'D', '3', 3, 0, 0}
	size := len(frames)
	var sz [4]byte
	sz[0] = byte(size >> 21 & 0x7f)
	sz[1] = byte(size >> 14 & 0x7f)
	sz[2] = byte(size >> 7 & 0x7f)
	sz[3] = byte(size & 0x7f)
	tagBytes = append(tagBytes, sz[:]...)
	tagBytes = append(tagBytes, frames...)

	// ~5 seconds of 128kbps audio: a real MPEG1 L3 128k/44.1k frame header
	// followed by filler (the CBR estimator needs a valid sync + bitrate).
	audio := make([]byte, 80000)
	for i := range audio {
		audio[i] = 0x55
	}
	audio[0], audio[1], audio[2], audio[3] = 0xff, 0xfb, 0x90, 0x00
	return append(tagBytes, audio...)
}

func TestParseFileFull(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nfakepngbytes")
	data := mp3WithTags(t, "Neon Skyline", "Aurora Borealis", "Night Drive", png)
	dir := t.TempDir()
	covers := filepath.Join(dir, "covers")
	p := filepath.Join(dir, "song.mp3")
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}

	m := (&Parser{CoversDir: covers}).ParseFile(p)
	if m.Title != "Neon Skyline" || m.Artist != "Aurora Borealis" || m.Album != "Night Drive" {
		t.Errorf("tags wrong: %+v", m)
	}
	// 80000 bytes at 128kbps ≈ 5.0 s (CBR estimate).
	if m.Duration < 4.8 || m.Duration > 5.2 {
		t.Errorf("duration = %.2f, want ~5.0", m.Duration)
	}
	if m.CoverArt == nil {
		t.Fatal("coverArt missing")
	}
	// The URL must be same-origin and the cache file must exist and sniff as PNG.
	wantPrefix := "/aura/local?path="
	if len(*m.CoverArt) < len(wantPrefix) || (*m.CoverArt)[:len(wantPrefix)] != wantPrefix {
		t.Fatalf("cover URL = %q, want prefix %q", *m.CoverArt, wantPrefix)
	}
	// Decode the query value back to a path and verify the cached bytes.
	q := (*m.CoverArt)[len(wantPrefix):]
	cachedPath, err := url.QueryUnescape(q)
	if err != nil {
		t.Fatalf("cover URL query undecodable: %v", err)
	}
	if !strings.HasPrefix(cachedPath, covers) {
		t.Fatalf("cached path %q escapes covers dir %q", cachedPath, covers)
	}
	cached, err := os.ReadFile(cachedPath)
	if err != nil {
		t.Fatalf("cache file unreadable: %v", err)
	}
	if string(cached) != string(png) {
		t.Error("cached image bytes differ from embedded art")
	}
}

func TestCoverCacheDeterministic(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nx")
	data := mp3WithTags(t, "T", "A", "L", png)
	dir := t.TempDir()
	covers := filepath.Join(dir, "covers")
	p := filepath.Join(dir, "s.mp3")
	os.WriteFile(p, data, 0o644)
	p2 := (&Parser{CoversDir: covers}).ParseFile(p)
	p3 := (&Parser{CoversDir: covers}).ParseFile(p) // re-parse: same name, no rewrite
	if *p2.CoverArt != *p3.CoverArt {
		t.Errorf("cover URL not deterministic: %q vs %q", *p2.CoverArt, *p3.CoverArt)
	}
	entries, _ := os.ReadDir(covers)
	if len(entries) != 1 {
		t.Errorf("covers dir should hold exactly one file, got %d", len(entries))
	}
}
