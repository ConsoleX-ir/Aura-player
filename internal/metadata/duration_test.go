package metadata

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// ── synthetic container builders ────────────────────────────────────────────

// minimal FLAC: "fLaC" + STREAMINFO(34B) + padding block (a real file
// always carries more blocks — the parser needs STREAMINFO fully readable).
func flacFixture(t *testing.T, sampleRate uint32, total uint64) []byte {
	t.Helper()
	info := make([]byte, 34)
	info[10] = byte(sampleRate >> 12)
	info[11] = byte(sampleRate >> 4)
	info[12] = byte(sampleRate)<<4 | 0x01 // SR low nibble + channels-1=1
	info[13] = byte(total>>32) & 0x0f     // total[35:32]
	info[14] = byte(total >> 24)
	info[15] = byte(total >> 16)
	info[16] = byte(total >> 8)
	info[17] = byte(total)
	out := []byte("fLaC")
	out = append(out, 0x00, 0x00, 0x00, 0x22) // block header: type 0, length 34
	out = append(out, info...)
	out = append(out, 0x81, 0x00, 0x00, 0x04, 0xde, 0xad, 0xbe, 0xef) // last block: padding, len 4
	return out
}

// minimal MP4: ftyp + moov/mvhd v0.
func mp4Fixture(t *testing.T, timescale uint32, duration uint32) []byte {
	t.Helper()
	box := func(typ string, body []byte) []byte {
		out := make([]byte, 8+len(body))
		binary.BigEndian.PutUint32(out[0:4], uint32(8+len(body)))
		copy(out[4:8], typ)
		copy(out[8:], body)
		return out
	}
	mvhd := make([]byte, 100)
	mvhd[0] = 0 // version 0
	// creation+modification (8 bytes) then timescale @12, duration @16
	binary.BigEndian.PutUint32(mvhd[12:16], timescale)
	binary.BigEndian.PutUint32(mvhd[16:20], duration)
	moov := box("moov", box("mvhd", mvhd))
	ftyp := box("ftyp", []byte("M4A \x00\x00\x02\x00isomiso2"))
	return append(ftyp, moov...)
}

// minimal OGG Vorbis: first page with id header, last page with granule.
func oggFixture(t *testing.T, sampleRate uint32, granule uint64) []byte {
	t.Helper()
	page := func(gran uint64, body []byte, seq uint32, last bool) []byte {
		h := make([]byte, 27)
		copy(h[0:4], "OggS")
		h[4] = 0
		if last {
			h[5] = 0x04 // EOS
		}
		binary.LittleEndian.PutUint64(h[6:14], gran)
		binary.LittleEndian.PutUint32(h[14:18], 0x11223344)
		binary.LittleEndian.PutUint32(h[18:22], seq)
		binary.LittleEndian.PutUint32(h[22:26], 0)
		h[26] = 1 // one segment in the lacing table
		out := append(h, byte(len(body)))
		return append(out, body...)
	}
	idHeader := make([]byte, 30)
	copy(idHeader[0:7], []byte("\x01vorbis"))
	idHeader[11] = 2 // channels
	binary.LittleEndian.PutUint32(idHeader[12:16], sampleRate)
	out := page(0, idHeader, 0, false)
	out = append(out, page(granule, []byte("x"), 1, true)...)
	return out
}

// minimal WAV: proper RIFF shape — "RIFF" + size + "WAVE" + fmt + data.
func wavFixture(t *testing.T, byteRate uint32, dataSize uint32) []byte {
	t.Helper()
	fmtBody := make([]byte, 16)
	binary.LittleEndian.PutUint16(fmtBody[0:2], 1) // PCM
	binary.LittleEndian.PutUint16(fmtBody[2:4], 2) // channels
	binary.LittleEndian.PutUint32(fmtBody[4:8], 44100)
	binary.LittleEndian.PutUint32(fmtBody[8:12], byteRate)
	binary.LittleEndian.PutUint16(fmtBody[12:14], 4) // block align
	chunk := func(typ string, body []byte) []byte {
		out := make([]byte, 8+len(body))
		copy(out[0:4], typ)
		binary.LittleEndian.PutUint32(out[4:8], uint32(len(body)))
		copy(out[8:], body)
		return out
	}
	body := append(chunk("fmt ", fmtBody), chunk("data", make([]byte, dataSize))...)
	out := make([]byte, 0, 12+len(body))
	out = append(out, []byte("RIFF")...)
	var sz [4]byte
	binary.LittleEndian.PutUint32(sz[:], uint32(4+len(body)))
	out = append(out, sz[:]...)
	out = append(out, []byte("WAVE")...)
	return append(out, body...)
}

// minimal ASF: header object with File Properties Object (playDuration 100ns).
func asfFixture(t *testing.T, playDur100ns uint64, prerollMs uint64) []byte {
	t.Helper()
	fpoGuid := []byte{0xA1, 0xDC, 0xAB, 0x8C, 0x47, 0xA9, 0xCF, 0x11, 0x8E, 0xE4, 0x00, 0xC0, 0x0C, 0x20, 0x53, 0x65}
	fpo := make([]byte, 80)
	copy(fpo[0:16], fpoGuid)
	binary.LittleEndian.PutUint64(fpo[16:24], 80) // object size
	binary.LittleEndian.PutUint64(fpo[40:48], playDur100ns)
	binary.LittleEndian.PutUint64(fpo[56:64], prerollMs)

	headerGuid := []byte{0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11, 0xA6, 0xD9, 0x00, 0xAA, 0x00, 0x62, 0xCE, 0x6C}
	hdrSize := uint64(30 + len(fpo))
	hdr := make([]byte, 30)
	copy(hdr[0:16], headerGuid)
	binary.LittleEndian.PutUint64(hdr[16:24], hdrSize)
	binary.LittleEndian.PutUint32(hdr[24:28], 1)
	return append(hdr, fpo...)
}

// minimal MP3: one MPEG1 Layer III 128kbps 44.1kHz frame header + Xing count.
// Xing sits 4 (header) + 32 (MPEG1 stereo side info) = 36 bytes into the frame.
func mp3Fixture(t *testing.T, frames uint32) []byte {
	t.Helper()
	out := []byte{0xff, 0xfb, 0x90, 0x00} // MPEG1 L3, 128k, 44.1k, stereo
	frameBytes := make([]byte, 413)       // typical 128k frame size
	for i := range frameBytes {
		frameBytes[i] = 0x55
	}
	xing := make([]byte, 0, 16)
	xing = append(xing, []byte("Xing")...)
	flags := make([]byte, 4)
	binary.BigEndian.PutUint32(flags, 1)
	count := make([]byte, 4)
	binary.BigEndian.PutUint32(count, frames)
	xing = append(xing, flags...)
	xing = append(xing, count...)
	copy(frameBytes[32:32+16], xing) // frameOffset+4+sideInfo(32)-4 (header already separate)
	out = append(out, frameBytes...)
	out = append(out, frameBytes...)
	return out
}

// ── tests ───────────────────────────────────────────────────────────────────

func writeTemp(t *testing.T, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestDurations(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want float64
		tol  float64
	}{
		{"flac", flacFixture(t, 44100, 44100*180), 180, 0.01},
		{"mp4", mp4Fixture(t, 44100, 44100*95), 95, 0.01},
		{"ogg-vorbis", oggFixture(t, 48000, 48000*61), 61, 0.01},
		{"wav", wavFixture(t, 176400, 176400*33), 33, 0.01},
		{"asf", asfFixture(t, uint64(200)*1e7, 500), 199.5, 0.01},
		{"mp3-xing", mp3Fixture(t, 8000), 8000 * 1152.0 / 44100.0, 0.01},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := writeTemp(t, c.name+".bin", c.data)
			got, err := Duration(p)
			if err != nil {
				t.Fatalf("Duration(%s): %v", c.name, err)
			}
			if diff := got - c.want; diff > c.tol || diff < -c.tol {
				t.Errorf("%s duration = %.3f, want %.3f (±%.3f)", c.name, got, c.want, c.tol)
			}
		})
	}
}

func TestGarbageReturnsUnknown(t *testing.T) {
	p := writeTemp(t, "garbage.bin", []byte("this is not an audio file at all........"))
	d, err := Duration(p)
	if err == nil || d != 0 {
		t.Errorf("garbage should fail cleanly, got d=%v err=%v", d, err)
	}
}

func TestParseFileFallback(t *testing.T) {
	p := writeTemp(t, "Song Name.mp3", []byte("not really audio"))
	m := (&Parser{}).ParseFile(p)
	if m.Title != "Song Name" || m.Artist != "Unknown Artist" || m.Album != "Unknown Album" {
		t.Errorf("fallback meta wrong: %+v", m)
	}
	if m.CoverArt != nil || m.Year != nil || m.Genre != nil {
		t.Errorf("fallback meta should have nil optionals: %+v", m)
	}
}

func TestParseBatchOrderAndProgress(t *testing.T) {
	dir := t.TempDir()
	paths := make([]string, 12)
	for i := range paths {
		paths[i] = filepath.Join(dir, "track"+string(rune('A'+i))+".flac")
		data := flacFixture(t, 44100, 44100*uint64(i+1))
		if err := os.WriteFile(paths[i], data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var mu sync.Mutex
	var last BatchResult
	got := (&Parser{}).ParseBatch(paths, func(d, tot int) {
		mu.Lock()
		last = BatchResult{d, tot}
		mu.Unlock()
	})
	if len(got) != len(paths) {
		t.Fatalf("batch length %d != %d", len(got), len(paths))
	}
	for i, m := range got {
		want := float64(i + 1)
		if m.Duration < want-0.01 || m.Duration > want+0.01 {
			t.Errorf("out[%d].Duration = %.2f, want %.2f (order must be preserved)", i, m.Duration, want)
		}
		if m.Title != "track"+string(rune('A'+i)) {
			t.Errorf("out[%d].Title = %q", i, m.Title)
		}
	}
	if last.Done != len(paths) || last.Total != len(paths) {
		t.Errorf("progress final = %+v", last)
	}
}

func TestSniffImage(t *testing.T) {
	if sniffImage([]byte{0xff, 0xd8, 0xff, 0xe0}) != "image/jpeg" {
		t.Error("jpeg sniff failed")
	}
	if sniffImage([]byte("\x89PNG\r\n\x1a\nmore")) != "image/png" {
		t.Error("png sniff failed")
	}
	if sniffImage([]byte("nope")) != "" {
		t.Error("garbage should not sniff as an image")
	}
}

var _ = bytes.Equal
