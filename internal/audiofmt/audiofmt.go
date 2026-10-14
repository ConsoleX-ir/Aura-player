// Package audiofmt is the single source of truth for which file types Aura
// treats as playable audio or servable artwork.
package audiofmt

import (
	"path/filepath"
	"strings"
)

// AudioExts mirrors AUDIO_EXTS from the 3.2.0 Electron main process.
var AudioExts = []string{".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".opus", ".wma"}

var mimeByExt = map[string]string{
	".mp3":  "audio/mpeg",
	".flac": "audio/flac",
	".wav":  "audio/wav",
	".ogg":  "audio/ogg",
	".m4a":  "audio/mp4",
	".aac":  "audio/aac",
	".opus": "audio/ogg; codecs=opus",
	".wma":  "audio/x-ms-wma",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
	".gif":  "image/gif",
}

func ext(path string) string { return strings.ToLower(filepath.Ext(path)) }

// IsAudio reports whether path has a supported audio extension.
func IsAudio(path string) bool {
	e := ext(path)
	for _, a := range AudioExts {
		if a == e {
			return true
		}
	}
	return false
}

// MIME returns the content type for a servable (audio or image) path.
func MIME(path string) (string, bool) {
	m, ok := mimeByExt[ext(path)]
	return m, ok
}

// DialogPatterns returns the glob patterns for a native "Audio Files" filter.
func DialogPatterns() string {
	parts := make([]string, len(AudioExts))
	for i, e := range AudioExts {
		parts[i] = "*" + e
	}
	return strings.Join(parts, ";")
}
