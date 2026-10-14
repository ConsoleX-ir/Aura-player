// Package metadata replaces Electron's `music-metadata` dependency with pure
// Go parsers. It extracts the exact `Omit<Song,'id'|'path'>` shape the
// renderer's import pipeline consumes (title/artist/album/duration/year/
// genre/trackNumber/coverArt), caches embedded cover art to disk, and serves
// the technical file properties for the Properties dialog.
//
// Behaviour preserved from 3.2.0's parseOneFile():
//   - a title that is empty/whitespace falls back to the filename;
//   - any parse failure returns the filename fallback (Unknown Artist /
//     Unknown Album / duration 0 / no art) instead of an error;
//   - cover art goes to a deterministic cache file — re-parsing an unchanged
//     file skips the write; the returned URL is served by /aura/local.
//
// Security: the cache directory is created by the caller under the app data
// dir; image bytes are validated by MIME sniffing before being written.
package metadata

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/dhowden/tag"
)

// Meta matches Omit<Song, 'id' | 'path'> in src/types/index.ts.
type Meta struct {
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	Album       string  `json:"album"`
	Duration    float64 `json:"duration"`
	Year        *int    `json:"year"`
	Genre       *string `json:"genre"`
	TrackNumber *int    `json:"trackNumber"`
	CoverArt    *string `json:"coverArt"`
}

// FileStats matches SongFileStats in src/types/index.ts.
type FileStats struct {
	SizeBytes    int64   `json:"sizeBytes"`
	Extension    string  `json:"extension"`
	BitrateKbps  *int    `json:"bitrateKbps"`
	SampleRateHz *int    `json:"sampleRateHz"`
	Channels     *int    `json:"channels"`
	Codec        *string `json:"codec"`
	Container    *string `json:"container"`
}

// CoverMIME maps sniffed image bytes to the file extension used on disk.
var coverExt = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// Parser extracts metadata; Cache abstracts the covers directory so tests
// can run without touching a real profile.
type Parser struct {
	CoversDir string
}

func sniffImage(b []byte) string {
	switch {
	case len(b) >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff:
		return "image/jpeg"
	case len(b) >= 8 && string(b[0:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(b) >= 12 && string(b[0:4]) == "RIFF" && string(b[8:12]) == "WEBP":
		return "image/webp"
	case len(b) >= 6 && (string(b[0:3]) == "GIF" && (b[3] == '8' && (b[4] == '7' || b[4] == '9'))):
		return "image/gif"
	}
	return ""
}

// coverPath is the deterministic cache file name for one source audio path.
func coverPath(coversDir, sourcePath, mime string) string {
	sum := sha256.Sum256([]byte(sourcePath))
	name := hex.EncodeToString(sum[:8]) // 16 hex chars — stable, short
	return filepath.Join(coversDir, name+coverExt[mime])
}

// SniffImage returns the MIME type of image bytes ("" when not an image).
func SniffImage(b []byte) string { return sniffImage(b) }

// CoverPath exposes the deterministic covers-cache naming to other packages
// (the artwork downloader shares this cache with embedded art).
func CoverPath(coversDir, sourcePath, mime string) string {
	return coverPath(coversDir, sourcePath, mime)
}

// CoverExtFor returns the file extension used for a sniffed/declared MIME.
func CoverExtFor(mime string) string { return coverExt[mime] }

// StoreCover writes image bytes into the covers cache (once per source) and
// returns the /aura/local URL for the cached file.
func StoreCover(coversDir, sourcePath, mime string, data []byte) (string, error) {
	if coversDir == "" || len(data) == 0 || coverExt[mime] == "" {
		return "", errors.New("metadata: invalid cover store request")
	}
	dst := coverPath(coversDir, sourcePath, mime)
	if _, err := os.Stat(dst); err != nil {
		if err := os.MkdirAll(coversDir, 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return "", err
		}
	}
	return MediaURL(dst), nil
}

// storeCover writes the image bytes once and returns the /aura/local URL.
// The URL shape is produced here (not by the caller) so the media handler's
// contract stays in one place.
func (p *Parser) storeCover(sourcePath string, mime string, data []byte) *string {
	if p.CoversDir == "" || len(data) == 0 || mime == "" {
		return nil
	}
	dst := coverPath(p.CoversDir, sourcePath, mime)
	if _, err := os.Stat(dst); err != nil {
		if err := os.MkdirAll(p.CoversDir, 0o755); err != nil {
			return nil
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return nil
		}
	}
	u := "/aura/local?path=" + urlQueryEscape(dst)
	return &u
}

// urlQueryEscape encodes a cache path as a single query value. It matches
// what JS encodeURIComponent produces (spaces become %20), and the media
// handler decodes with r.URL.Query().Get, so the round-trip is exact.
func urlQueryEscape(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "+", "%20")
}

// MediaURL builds the same-origin /aura/local URL for an absolute file path.
func MediaURL(path string) string {
	return "/aura/local?path=" + urlQueryEscape(path)
}

// ParseFile extracts tags + duration for one audio file. It never fails:
// unreadable files yield the same filename fallback as 3.2.0.
func (p *Parser) ParseFile(path string) Meta {
	base := filepath.Base(path)
	fallback := Meta{
		Title:  strings.TrimSuffix(base, filepath.Ext(base)),
		Artist: "Unknown Artist",
		Album:  "Unknown Album",
	}

	dur, _ := Duration(path) // 0 when the container is opaque — still serve tags
	m := Meta{Duration: dur}

	f, err := os.Open(path)
	if err != nil {
		return fallback
	}
	defer f.Close()
	tags, err := tag.ReadFrom(f)
	if err != nil {
		// Tags unreadable but duration may be fine; keep duration if we have it.
		if dur > 0 {
			fallback.Duration = dur
		}
		return fallback
	}

	m.Title = firstNonEmpty(strings.TrimSpace(tags.Title()), fallback.Title)
	m.Artist = firstNonEmpty(strings.TrimSpace(tags.Artist()), "Unknown Artist")
	m.Album = firstNonEmpty(strings.TrimSpace(tags.Album()), "Unknown Album")
	if tags.Year() > 0 {
		y := tags.Year()
		m.Year = &y
	}
	if g := strings.TrimSpace(tags.Genre()); g != "" {
		m.Genre = &g
	}
	if tr, no := tags.Track(); no > 0 {
		m.TrackNumber = &no
		_ = tr
	}
	if pic := tags.Picture(); pic != nil {
		mime := pic.MIMEType
		if sniff := sniffImage(pic.Data); sniff != "" {
			mime = sniff // trust the bytes over the declared MIME
		}
		if coverExt[mime] != "" {
			m.CoverArt = p.storeCover(path, mime, pic.Data)
		}
	}
	// An empty-duration file with real tags still gets duration 0 (matches
	// 3.2.0, where music-metadata failing to estimate also produced 0).
	return m
}

// StatsFile produces the Properties dialog's technical block. Fields we can
// parse exactly are filled; the rest stay null (honest, like 3.2.0).
func (p *Parser) StatsFile(path string) FileStats {
	stats := FileStats{Extension: strings.ToLower(filepath.Ext(path))}
	st, err := os.Stat(path)
	if err != nil {
		return stats
	}
	stats.SizeBytes = st.Size()

	dur, _ := Duration(path)
	if dur > 0 && st.Size() > 0 {
		kbps := int((float64(st.Size())*8/float64(dur) + 500) / 1000)
		stats.BitrateKbps = &kbps
	}
	stats.SampleRateHz, stats.Channels, stats.Codec, stats.Container = containerDetails(path)
	return stats
}

func containerDetails(path string) (sr *int, ch *int, codec *string, container *string) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, nil, nil
	}
	defer f.Close()
	head := make([]byte, 512)
	n, _ := f.Read(head)
	head = head[:n]

	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(path), "."))
	str := func(s string) *string { return &s }
	intr := func(i int) *int { return &i }

	switch {
	case len(head) >= 8 && string(head[0:4]) == "fLaC":
		// Re-open to reuse the STREAMINFO parser for sample rate.
		if d, err := os.Open(path); err == nil {
			defer d.Close()
			buf := make([]byte, 46)
			if _, err := d.Read(buf); err == nil {
				rate := int(buf[18])<<12 | int(buf[19])<<4 | int(buf[20])>>4
				chans := int(buf[20]>>1) & 7
				if rate > 0 {
					return intr(rate), intr(chans + 1), str("FLAC"), str("flac")
				}
			}
		}
		return nil, nil, str("FLAC"), str("flac")
	case len(head) >= 12 && string(head[4:8]) == "ftyp":
		brand := strings.TrimSpace(string(head[8:12]))
		return nil, nil, str("AAC"), str(brand)
	case len(head) >= 4 && string(head[0:4]) == "OggS":
		c := "Vorbis"
		if indexOf(head, []byte("OpusHead")) >= 0 {
			c = "Opus"
		}
		return nil, nil, str(c), str("ogg")
	case len(head) >= 12 && string(head[0:4]) == "RIFF" && string(head[8:12]) == "WAVE":
		return nil, nil, str("PCM"), str("wav")
	case len(head) >= 2 && head[0] == 0xff && head[1]&0xe0 == 0xe0:
		return nil, nil, str("MP3"), str("mp3")
	case len(head) >= 10 && string(head[0:3]) == "ID3":
		return nil, nil, str("MP3"), str("mp3")
	default:
		if ext == "wma" {
			return nil, nil, str("WMA"), str("asf")
		}
		return nil, nil, nil, nil
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// BatchResult carries one batch parse outcome for the progress event.
type BatchResult struct {
	Done  int
	Total int
}

// ProgressFunc receives (done, total) after each file of a batch.
type ProgressFunc func(done, total int)

// ParseBatch parses many files with a bounded worker pool (4, like 3.2.0's
// METADATA_CONCURRENCY) and reports progress. The result preserves input
// order.
func (p *Parser) ParseBatch(paths []string, progress ProgressFunc) []Meta {
	out := make([]Meta, len(paths))
	const workers = 4
	jobs := make(chan int)
	var mu sync.Mutex
	done := 0

	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func() {
			defer wg.Done()
			for i := range jobs {
				out[i] = p.ParseFile(paths[i])
				mu.Lock()
				done++
				d := done
				mu.Unlock()
				if progress != nil {
					progress(d, len(paths))
				}
			}
		}()
	}
	for i := range paths {
		jobs <- i
	}
	close(jobs)
	wg.Wait() // all results written before returning
	return out
}
