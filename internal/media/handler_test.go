package media

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func serve(t *testing.T, method, path, rng string) *httptest.ResponseRecorder {
	t.Helper()
	u := Prefix
	if path != "" {
		u += "?path=" + url.QueryEscape(path)
	}
	req := httptest.NewRequest(method, u, nil)
	if rng != "" {
		req.Header.Set("Range", rng)
	}
	rec := httptest.NewRecorder()
	Handler{}.ServeHTTP(rec, req)
	return rec
}

func writeFile(t *testing.T, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestServesFullFile(t *testing.T) {
	p := writeFile(t, "a.mp3", []byte("0123456789"))
	rec := serve(t, http.MethodGet, p, "")
	if rec.Code != 200 || rec.Body.String() != "0123456789" {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "audio/mpeg" {
		t.Errorf("content-type = %q", ct)
	}
	if rec.Header().Get("Accept-Ranges") != "bytes" {
		t.Error("missing Accept-Ranges")
	}
}

func TestRangeRequests(t *testing.T) {
	p := writeFile(t, "a.flac", []byte("0123456789"))
	cases := []struct {
		name, rng, body, contentRange string
		code                          int
	}{
		{"closed", "bytes=2-4", "234", "bytes 2-4/10", 206},
		{"open-ended", "bytes=7-", "789", "bytes 7-9/10", 206},
		{"suffix = final N bytes", "bytes=-3", "789", "bytes 7-9/10", 206}, // 1.x misread this as "from 0"
		{"end past EOF is clamped", "bytes=5-999999", "56789", "bytes 5-9/10", 206},
		{"start past EOF", "bytes=50-60", "", "bytes */10", 416},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := serve(t, http.MethodGet, p, c.rng)
			if rec.Code != c.code {
				t.Fatalf("status %d, want %d", rec.Code, c.code)
			}
			if c.code == 206 && rec.Body.String() != c.body {
				t.Errorf("body %q, want %q", rec.Body.String(), c.body)
			}
			if got := rec.Header().Get("Content-Range"); got != c.contentRange {
				t.Errorf("Content-Range %q, want %q", got, c.contentRange)
			}
		})
	}
}

func TestRejections(t *testing.T) {
	dir := t.TempDir()
	secret := filepath.Join(dir, "secret.txt")
	os.WriteFile(secret, []byte("x"), 0o644)
	audioDir := filepath.Join(dir, "folder.mp3") // a directory with an audio-looking name
	os.Mkdir(audioDir, 0o755)

	cases := []struct {
		name, path string
		code       int
	}{
		{"missing param", "", 400},
		{"relative path", "music/a.mp3", 400},
		{"traversal", dir + "/sub/../../etc/passwd.mp3", 400},
		{"non-media extension", secret, 403},
		{"directory named like audio", audioDir, 403},
		{"nonexistent", filepath.Join(dir, "gone.mp3"), 404},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if rec := serve(t, http.MethodGet, c.path, ""); rec.Code != c.code {
				t.Errorf("status %d, want %d", rec.Code, c.code)
			}
		})
	}
	if rec := serve(t, http.MethodPost, writeFile(t, "b.mp3", []byte("x")), ""); rec.Code != 405 {
		t.Errorf("POST status %d, want 405", rec.Code)
	}
}

func TestHeadAndImages(t *testing.T) {
	img := writeFile(t, "cover.jpg", []byte("jpegdata"))
	rec := serve(t, http.MethodHead, img, "")
	if rec.Code != 200 || rec.Body.Len() != 0 || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Errorf("HEAD: %d len=%d ct=%q", rec.Code, rec.Body.Len(), rec.Header().Get("Content-Type"))
	}
}

func TestWrongPrefix(t *testing.T) {
	rec := httptest.NewRecorder()
	Handler{}.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/other", nil))
	if rec.Code != 404 {
		t.Errorf("status %d, want 404", rec.Code)
	}
}
