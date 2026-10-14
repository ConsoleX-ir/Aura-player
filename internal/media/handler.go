// Package media serves local audio files and cached artwork to the webview.
//
// It replaces Electron's `aura://local?path=...` protocol. Wails v2 only routes
// same-origin http(s) requests to its asset server, so the equivalent URL is
// `/aura/local?path=<url-encoded absolute path>`.
//
// Security (improvement over 3.2.0, which served ANY path on disk): only
// regular files with a known audio or image extension are served.
package media

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/ConsoleX-ir/aura-player/internal/audiofmt"
)

// Prefix is the URL path handled by this package.
const Prefix = "/aura/local"

// Handler is an http.Handler for Prefix. Range requests (needed for audio
// seeking) are handled by http.ServeContent.
type Handler struct{}

func (Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != Prefix {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	p := r.URL.Query().Get("path")
	if p == "" {
		http.Error(w, "missing path", http.StatusBadRequest)
		return
	}
	// Absolute paths only; reject traversal-looking input rather than clean it.
	if !filepath.IsAbs(p) || strings.Contains(p, "..") && filepath.Clean(p) != p {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	p = filepath.Clean(p)

	mime, ok := audiofmt.MIME(p)
	if !ok {
		http.Error(w, "file type not allowed", http.StatusForbidden)
		return
	}

	f, err := os.Open(p)
	if err != nil {
		http.Error(w, "file not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		http.Error(w, "not a regular file", http.StatusForbidden)
		return
	}

	w.Header().Set("Content-Type", mime)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}
