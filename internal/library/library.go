// Package library implements Aura's native filesystem operations: folder
// scanning, drag-and-drop path resolution and library health checks.
package library

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/ConsoleX-ir/aura-player/internal/audiofmt"
)

// AudioFile matches the renderer's { path, name, mtimeMs } shape.
type AudioFile struct {
	Path    string  `json:"path"`
	Name    string  `json:"name"`
	MtimeMs float64 `json:"mtimeMs"`
}

// Resolved is the result of resolving dropped paths.
type Resolved struct {
	Files   []AudioFile `json:"files"`
	Folders []string    `json:"folders"`
}

// PathCheck matches the renderer's PathCheck type.
type PathCheck struct {
	Path      string  `json:"path"`
	Exists    bool    `json:"exists"`
	SizeBytes int64   `json:"sizeBytes"`
	MtimeMs   float64 `json:"mtimeMs"`
}

const (
	maxCheckPaths = 50_000
	checkWorkers  = 16
)

// Service is bound to Wails and exposed to the frontend.
type Service struct {
	ctx context.Context
}

func NewService() *Service { return &Service{ctx: context.Background()} }

// Startup receives the Wails application context so long scans stop at shutdown.
func (s *Service) Startup(ctx context.Context) { s.ctx = ctx }

func mtimeMs(info fs.FileInfo) float64 { return float64(info.ModTime().UnixNano()) / 1e6 }

// ScanFolder recursively lists audio files under root. Like the Electron
// implementation it skips unreadable directories and does not follow symlinks.
func (s *Service) ScanFolder(root string) ([]AudioFile, error) {
	return scan(s.ctx, root)
}

func scan(ctx context.Context, root string) ([]AudioFile, error) {
	out := []AudioFile{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir // unreadable directory: skip, keep scanning
			}
			return nil
		}
		if d.Type().IsRegular() && audiofmt.IsAudio(d.Name()) {
			var m float64
			if info, e := d.Info(); e == nil {
				m = mtimeMs(info)
			}
			out = append(out, AudioFile{Path: p, Name: d.Name(), MtimeMs: m})
		}
		return nil
	})
	if err != nil && ctx.Err() != nil {
		return nil, err
	}
	return out, nil
}

// ResolveDroppedPaths turns a mix of dropped files and folders into a flat
// list of audio files plus the folders that were dropped. (The 3.2.0 version
// threw a TypeError for any dropped folder: it spread an un-awaited Promise.)
func (s *Service) ResolveDroppedPaths(paths []string) (Resolved, error) {
	res := Resolved{Files: []AudioFile{}, Folders: []string{}}
	for _, p := range paths {
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		switch {
		case info.IsDir():
			res.Folders = append(res.Folders, p)
			files, err := scan(s.ctx, p)
			if err != nil {
				return res, err
			}
			res.Files = append(res.Files, files...)
		case info.Mode().IsRegular() && audiofmt.IsAudio(p):
			res.Files = append(res.Files, AudioFile{Path: p, Name: filepath.Base(p), MtimeMs: mtimeMs(info)})
		}
	}
	return res, nil
}

// CheckPaths stats every path (bounded concurrency). A path that cannot be
// stat'ed reports exists:false instead of failing the whole batch.
func (s *Service) CheckPaths(paths []string) []PathCheck {
	list := make([]string, 0, len(paths))
	for _, p := range paths {
		if p != "" {
			list = append(list, p)
		}
	}
	if len(list) > maxCheckPaths {
		list = list[:maxCheckPaths]
	}

	out := make([]PathCheck, len(list))
	var wg sync.WaitGroup
	sem := make(chan struct{}, checkWorkers)
	for i, p := range list {
		if s.ctx.Err() != nil {
			out[i] = PathCheck{Path: p}
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, p string) {
			defer wg.Done()
			defer func() { <-sem }()
			info, err := os.Stat(p)
			if err != nil {
				out[i] = PathCheck{Path: p}
				return
			}
			out[i] = PathCheck{Path: p, Exists: info.Mode().IsRegular(), SizeBytes: info.Size(), MtimeMs: mtimeMs(info)}
		}(i, p)
	}
	wg.Wait()
	return out
}
