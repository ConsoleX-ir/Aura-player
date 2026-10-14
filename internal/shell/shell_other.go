//go:build !windows

package shell

import (
	"errors"
	"os/exec"
	"path/filepath"
)

// Non-Windows builds exist for development; reveal opens the containing folder.
func reveal(path string) error { return exec.Command("xdg-open", filepath.Dir(path)).Start() }

func openDefaultApps() error { return errors.New("only supported on Windows") }
