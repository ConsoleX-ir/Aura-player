// Container duration parsers (pure Go). See package docs in metadata.go.
//
// Every parser is conservative: an incomprehensible container returns an
// error (→ duration 0 → caller falls back), never a wrong number.
package metadata

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
)

var errUnknownFormat = errors.New("metadata: unknown container format")

// Duration returns the playback duration of the file at path in seconds
// (0 when unknown).
func Duration(path string) (float64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return durationFrom(f)
}

func durationFrom(r io.Reader) (float64, error) {
	head := make([]byte, 12)
	if _, err := io.ReadFull(r, head); err != nil {
		return 0, err
	}
	switch {
	case string(head[0:4]) == "fLaC":
		return flacDuration(head, r)
	case string(head[4:8]) == "ftyp": // MP4 / M4A
		return mp4Duration(head, r)
	case string(head[0:4]) == "OggS":
		return oggDuration(r, head)
	case string(head[0:4]) == "RIFF" && string(head[8:12]) == "WAVE":
		return wavDuration(r)
	case head[0] == 0x30 && head[1] == 0x26 && head[2] == 0xB2 && head[3] == 0x75: // ASF header GUID (WMA)
		return asfDuration(head, r)
	default:
		return mp3Duration(head, r)
	}
}

// ── FLAC ────────────────────────────────────────────────────────────────────
// STREAMINFO (block type 0) is always the first metadata block: 34 bytes,
// sample rate = 20 bits spanning bytes 10-12, total samples = 36 bits
// ending at byte 17. Duration is exact — no frame counting needed.
func flacDuration(head []byte, r io.Reader) (float64, error) {
	// head[4:8] is the (already validated) block header; head[8:12] are the
	// first STREAMINFO bytes.
	info := make([]byte, 34)
	copy(info[0:4], head[8:12])
	if _, err := io.ReadFull(r, info[4:]); err != nil {
		return 0, err
	}
	sampleRate := int(info[10])<<12 | int(info[11])<<4 | int(info[12])>>4
	total := int64(info[13]&0x0f)<<32 | int64(info[14])<<24 | int64(info[15])<<16 |
		int64(info[16])<<8 | int64(info[17])
	if sampleRate <= 0 {
		return 0, errUnknownFormat
	}
	return float64(total) / float64(sampleRate), nil
}

// ── MP4 / M4A ───────────────────────────────────────────────────────────────
// Walk the box tree just deep enough for moov/mvhd (duration). The moov box
// may sit at the start (faststart) or the end, so atoms are followed
// wherever they lead.
type mp4Timing struct {
	timescale  uint32
	duration   uint64
	sampleRate uint32
	channels   uint16
	sawMdhd    bool
	sawStsd    bool
}

func mp4Duration(head []byte, r io.Reader) (float64, error) {
	t, err := walkBoxes(io.MultiReader(bytes.NewReader(head), r), 0)
	if err != nil || t.timescale == 0 || t.duration == 0 {
		return 0, errUnknownFormat
	}
	return float64(t.duration) / float64(t.timescale), nil
}

func walkBoxes(r io.Reader, depth int) (mp4Timing, error) {
	var t mp4Timing
	if depth > 10 {
		return t, errUnknownFormat
	}
	var hdr [8]byte
	for {
		n, err := io.ReadFull(r, hdr[:])
		if err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				return t, nil // clean end of file
			}
			return t, err
		}
		if n < 8 {
			return t, nil
		}
		size := binary.BigEndian.Uint32(hdr[0:4])
		typ := string(hdr[4:8])
		var bodySize int64
		if size == 1 {
			var ext [8]byte
			if _, err := io.ReadFull(r, ext[:]); err != nil {
				return t, err
			}
			bodySize = int64(binary.BigEndian.Uint64(ext[:]) - 8)
		} else if size == 0 {
			bodySize = 0 // extends to EOF: let LimitReader drain
		} else {
			bodySize = int64(size - 8)
		}

		var body io.Reader = r
		if size != 0 {
			body = io.LimitReader(r, bodySize)
		}
		switch typ {
		case "moov", "trak", "mdia", "minf", "stbl":
			sub, err := walkBoxes(body, depth+1)
			if err != nil {
				return t, err
			}
			mergeTiming(&t, sub)
		case "mvhd":
			if err := readMvhd(body, &t); err != nil {
				return t, err
			}
		case "mdhd":
			if !t.sawMdhd {
				if err := readMdhd(body, &t); err != nil {
					return t, err
				}
			}
		case "stsd":
			if !t.sawStsd {
				readStsdChannels(body, &t)
				t.sawStsd = true
			}
		default:
			if _, err := io.Copy(io.Discard, body); err != nil {
				return t, err
			}
		}
		if size == 0 {
			return t, nil // box extended to EOF — done
		}
	}
}

func mergeTiming(dst *mp4Timing, src mp4Timing) {
	if src.timescale != 0 && dst.timescale == 0 {
		dst.timescale = src.timescale
	}
	if src.duration != 0 && dst.duration == 0 {
		dst.duration = src.duration
	}
	if src.sampleRate != 0 && dst.sampleRate == 0 {
		dst.sampleRate = src.sampleRate
		dst.sawMdhd = true
	}
	if src.channels != 0 && dst.channels == 0 {
		dst.channels = src.channels
	}
}

// mvhd: version 0 → flags(3) creation(4) modification(4) timescale(4)
// duration(4); version 1 → flags(3) creation(8) modification(8) timescale(4)
// duration(8).
func readMvhd(r io.Reader, t *mp4Timing) error {
	var vf [4]byte // version + flags
	if _, err := io.ReadFull(r, vf[:]); err != nil {
		return err
	}
	if vf[0] == 1 {
		var rest [16]byte // creation(8) + modification(8)
		if _, err := io.ReadFull(r, rest[:]); err != nil {
			return err
		}
		var fields [12]byte // timescale(4) + duration(8)
		if _, err := io.ReadFull(r, fields[:]); err != nil {
			return err
		}
		t.timescale = binary.BigEndian.Uint32(fields[0:4])
		t.duration = binary.BigEndian.Uint64(fields[4:12])
		return nil
	}
	var rest [8]byte // creation(4) + modification(4)
	if _, err := io.ReadFull(r, rest[:]); err != nil {
		return err
	}
	var fields [8]byte // timescale(4) + duration(4)
	if _, err := io.ReadFull(r, fields[:]); err != nil {
		return err
	}
	t.timescale = binary.BigEndian.Uint32(fields[0:4])
	t.duration = uint64(binary.BigEndian.Uint32(fields[4:8]))
	return nil
}

// mdhd carries the track's media timescale (used as sample rate for stats).
func readMdhd(r io.Reader, t *mp4Timing) error {
	var head [4]byte // version+flags
	if _, err := io.ReadFull(r, head[:]); err != nil {
		return err
	}
	if head[0] == 1 {
		var rest [20]byte // creation(8) modification(8) timescale(4)
		if _, err := io.ReadFull(r, rest[:]); err != nil {
			return err
		}
		t.sampleRate = binary.BigEndian.Uint32(rest[16:20])
		return nil
	}
	var rest [12]byte // creation(4) modification(4) timescale(4)
	if _, err := io.ReadFull(r, rest[:]); err != nil {
		return err
	}
	t.sampleRate = binary.BigEndian.Uint32(rest[8:12])
	return nil
}

// stsd: version/flags(4) entryCount(4) then sample entries; an mp4a entry
// has channels at offset 8+8+8+8+2 within the entry (after the 16-byte
// AudioSampleEntry header prefix). We only need the first entry's channels.
func readStsdChannels(r io.Reader, t *mp4Timing) {
	var pre [8]byte // version/flags + entry count
	if _, err := io.ReadFull(r, pre[:]); err != nil {
		return
	}
	var entry [8]byte // size + format("mp4a" etc.)
	if _, err := io.ReadFull(r, entry[:]); err != nil {
		return
	}
	// AudioSampleEntry: reserved(6)+dataRefIndex(2)=8, then version(2),
	// revision(2), vendor(4), channelCount(2).
	var audio [16]byte
	if _, err := io.ReadFull(r, audio[:]); err != nil {
		return
	}
	ch := binary.BigEndian.Uint16(audio[12:14])
	if ch >= 1 && ch <= 8 {
		t.channels = ch
	}
}

// ── OGG (Vorbis / Opus / FLAC-in-OGG) ───────────────────────────────────────
// Duration = last page's granule position / sample rate. Sample rate comes
// from the identification header (Vorbis), 48000 (Opus, mandated), or the
// embedded FLAC STREAMINFO.
func oggDuration(r io.Reader, head []byte) (float64, error) {
	// Grab the full rest of the file — ogg pages are small; simplest correct
	// approach is to scan sequentially and keep the last granule.
	rest, err := io.ReadAll(r)
	if err != nil {
		return 0, err
	}
	buf := append(append([]byte{}, head...), rest...)

	sampleRate := detectOggRate(buf)
	if sampleRate == 0 {
		return 0, errUnknownFormat
	}
	granule := lastOggGranule(buf)
	if granule <= 0 {
		return 0, errUnknownFormat
	}
	return float64(granule) / float64(sampleRate), nil
}

func lastOggGranule(buf []byte) int64 {
	var last int64 = -1
	for i := 0; i+27 <= len(buf); {
		if string(buf[i:i+4]) != "OggS" {
			break
		}
		granule := int64(binary.LittleEndian.Uint64(buf[i+6 : i+14]))
		segments := int(buf[i+26])
		pageSize := 27 + segments
		if i+27+segments > len(buf) {
			return last
		}
		for s := 0; s < segments; s++ {
			pageSize += int(buf[i+27+s])
		}
		if i+pageSize > len(buf) {
			return last
		}
		last = granule
		i += pageSize
	}
	return last
}

func detectOggRate(buf []byte) uint32 {
	// Vorbis identification: page body starts with \x01vorbis (7 bytes).
	if idx := indexOf(buf[:min(len(buf), 256)], []byte("\x01vorbis")); idx >= 0 {
		off := idx + 7 + 4 + 1 // pattern + version(u32) + channels(u8)
		if off+4 <= len(buf) {
			return binary.LittleEndian.Uint32(buf[off : off+4])
		}
	}
	// Opus: "OpusHead" — output rate is ALWAYS 48 kHz per spec.
	if idx := indexOf(buf[:min(len(buf), 256)], []byte("OpusHead")); idx >= 0 {
		return 48000
	}
	// FLAC-in-OGG: first packet is "\x7fFLAC" + STREAMINFO.
	if idx := indexOf(buf[:min(len(buf), 256)], []byte("\x7fFLAC")); idx >= 0 {
		off := idx + 9 // magic(5) + version(2) + headerCount(2)
		if off+18 <= len(buf) {
			sr := int(buf[off+10])<<12 | int(buf[off+11])<<4 | int(buf[off+12])>>4
			return uint32(sr)
		}
	}
	return 0
}

func indexOf(haystack, needle []byte) int {
	if len(needle) > len(haystack) {
		return -1
	}
	for i := 0; i <= len(haystack)-len(needle); i++ {
		match := true
		for j := range needle {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

// ── WAV ─────────────────────────────────────────────────────────────────────
// fmt chunk gives byteRate; data chunk gives payload size. Exact for PCM.
func wavDuration(r io.Reader) (float64, error) {
	// The 12-byte RIFF/WAVE prologue was already consumed by the caller's head.
	var byteRate uint32
	var dataSize uint32
	for {
		var ch [8]byte
		if _, err := io.ReadFull(r, ch[:]); err != nil {
			return 0, errUnknownFormat
		}
		size := binary.LittleEndian.Uint32(ch[4:8])
		switch string(ch[0:4]) {
		case "fmt ":
			var fmtChunk [16]byte
			if _, err := io.ReadFull(r, fmtChunk[:]); err != nil {
				return 0, err
			}
			byteRate = binary.LittleEndian.Uint32(fmtChunk[8:12])
			size = 0 // already consumed
		case "data":
			dataSize = size
			size = 0
		}
		if _, err := io.CopyN(io.Discard, r, int64(size)); err != nil {
			return 0, errUnknownFormat
		}
		if byteRate != 0 && dataSize != 0 {
			return float64(dataSize) / float64(byteRate), nil
		}
	}
}

// ── ASF / WMA ───────────────────────────────────────────────────────────────
// Header object → File Properties Object: PlayDuration (100ns units) minus
// Preroll. GUIDs are little-endian mixed-endian per the ASF spec.
func asfDuration(head []byte, r io.Reader) (float64, error) {
	rest := io.MultiReader(bytes.NewReader(head), r)
	// Header object: GUID(16) + size u64 + count u32 + 2 reserved.
	var hdr [30]byte
	if _, err := io.ReadFull(rest, hdr[:]); err != nil {
		return 0, err
	}
	headerSize := binary.LittleEndian.Uint64(hdr[16:24])
	if headerSize < 30 || headerSize > 1<<30 {
		return 0, errUnknownFormat
	}
	body := make([]byte, headerSize-30)
	if _, err := io.ReadFull(rest, body); err != nil {
		return 0, err
	}
	// Scan objects for the File Properties Object GUID.
	var guid = []byte{0xA1, 0xDC, 0xAB, 0x8C, 0x47, 0xA9, 0xCF, 0x11, 0x8E, 0xE4, 0x00, 0xC0, 0x0C, 0x20, 0x53, 0x65}
	for off := 0; off+24 <= len(body); {
		size := binary.LittleEndian.Uint64(body[off+16 : off+24])
		if size < 24 || off+int(size) > len(body) {
			return 0, errUnknownFormat
		}
		if string(body[off:off+16]) == string(guid) {
			if size < 80 {
				return 0, errUnknownFormat
			}
			playDuration := binary.LittleEndian.Uint64(body[off+40 : off+48]) // 100ns units
			preroll := binary.LittleEndian.Uint64(body[off+56 : off+64])      // ms
			sec := float64(playDuration)/1e7 - float64(preroll)/1e3
			if sec < 0 {
				sec = 0
			}
			return sec, nil
		}
		off += int(size)
	}
	return 0, errUnknownFormat
}

// ── MP3 ─────────────────────────────────────────────────────────────────────
// 1. Skip an ID3v2 tag if present.
// 2. Locate the first valid frame header.
// 3. Prefer the Xing/Info (or VBRI) frame count → exact duration.
// 4. Fall back to the CBR estimate: remaining bytes × 8 / bitrate.
func mp3Duration(head []byte, r io.Reader) (float64, error) {
	rest, err := io.ReadAll(r)
	if err != nil {
		return 0, err
	}
	buf := append(append([]byte{}, head...), rest...)

	offset := 0
	if len(buf) >= 10 && string(buf[0:3]) == "ID3" && buf[3] != 0xff {
		tagSize := int(buf[6]&0x7f)<<21 | int(buf[7]&0x7f)<<14 | int(buf[8]&0x7f)<<7 | int(buf[9]&0x7f)
		offset = 10 + tagSize
	}
	if offset+4 > len(buf) {
		return 0, errUnknownFormat
	}

	// Find the first frame sync within a small window (some files have junk).
	var fh mp3FrameHeader
	found := false
	for i := offset; i < len(buf)-4 && i < offset+4096; i++ {
		if f, ok := parseFrameHeader(buf[i : i+4]); ok {
			fh = f
			offset = i
			found = true
			break
		}
	}
	if !found {
		return 0, errUnknownFormat
	}

	if frames, ok := xingFrameCount(buf, offset, fh); ok {
		return float64(frames) * float64(fh.SamplesPerFrame) / float64(fh.SampleRate), nil
	}
	if frames, ok := vbriFrameCount(buf, offset); ok {
		return float64(frames) * float64(fh.SamplesPerFrame) / float64(fh.SampleRate), nil
	}
	audioBytes := len(buf) - offset
	secs := float64(audioBytes) * 8 / float64(fh.Bitrate)
	return secs, nil
}

type mp3FrameHeader struct {
	Bitrate         int // bits/s
	SampleRate      int
	SamplesPerFrame int
	ChannelMode     int
	Version         int // 3 = MPEG1, 2 = MPEG2/2.5
}

// Bitrate/samplerate tables for MPEG Layer III (kbit/s and Hz).
var bitrateV1L3 = [16]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0}
var bitrateV2L3 = [16]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0}
var sampleRates = [4][4]int{ // [raw version bits][index]
	{11025, 12000, 8000, 0},  // 00 = MPEG2.5
	{0, 0, 0, 0},             // 01 = reserved
	{22050, 24000, 16000, 0}, // 10 = MPEG2
	{44100, 48000, 32000, 0}, // 11 = MPEG1
}

func parseFrameHeader(b []byte) (mp3FrameHeader, bool) {
	var h mp3FrameHeader
	if b[0] != 0xff || b[1]&0xe0 != 0xe0 {
		return h, false
	}
	version := int(b[1]>>3) & 3 // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
	layer := int(b[1]>>1) & 3   // 1=Layer III
	if version == 1 || layer != 1 {
		return h, false
	}
	brIdx := int(b[2] >> 4)
	srIdx := int(b[2]>>2) & 3
	if brIdx == 0 || brIdx == 15 || srIdx == 3 {
		return h, false
	}
	if version == 3 {
		h.Bitrate = bitrateV1L3[brIdx] * 1000
	} else {
		h.Bitrate = bitrateV2L3[brIdx] * 1000
	}
	h.SampleRate = sampleRates[version][srIdx]
	if h.Bitrate == 0 || h.SampleRate == 0 {
		return h, false
	}
	h.Version = version
	h.ChannelMode = int(b[3] >> 6)
	if version == 3 {
		h.SamplesPerFrame = 1152
	} else {
		h.SamplesPerFrame = 576
	}
	return h, true
}

// Xing/Info header lives 32 bytes (MPEG1 stereo) / 17 (MPEG1 mono) /
// 9 (MPEG2 stereo) / 8+1 (MPEG2 mono) into the frame, after "Xing"/"Info".
func xingFrameCount(buf []byte, frameOffset int, fh mp3FrameHeader) (uint32, bool) {
	sideInfo := 17
	if fh.Version == 3 {
		if fh.ChannelMode == 3 {
			sideInfo = 17
		} else {
			sideInfo = 32
		}
	} else {
		if fh.ChannelMode == 3 {
			sideInfo = 9
		} else {
			sideInfo = 17
		}
	}
	off := frameOffset + 4 + sideInfo
	if off+8 > len(buf) {
		return 0, false
	}
	tag := string(buf[off : off+4])
	if tag != "Xing" && tag != "Info" {
		return 0, false
	}
	flags := binary.BigEndian.Uint32(buf[off+4 : off+8])
	if flags&1 == 0 {
		return 0, false
	}
	if off+12 > len(buf) {
		return 0, false
	}
	return binary.BigEndian.Uint32(buf[off+8 : off+12]), true
}

// VBRI (Fraunhofer) header sits 32 bytes into the frame.
func vbriFrameCount(buf []byte, frameOffset int) (uint32, bool) {
	off := frameOffset + 4 + 32
	if off+8 > len(buf) || string(buf[off:off+4]) != "VBRI" {
		return 0, false
	}
	// version(2) delay(2) quality(2) bytes(4) frames(4)
	if off+26 > len(buf) {
		return 0, false
	}
	return binary.BigEndian.Uint32(buf[off+22 : off+26]), true
}
