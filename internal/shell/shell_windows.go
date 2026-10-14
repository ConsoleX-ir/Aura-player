//go:build windows

package shell

import (
	"os/exec"
	"syscall"
)

// explorer.exe needs the raw command line: Go's argument quoting breaks
// `/select,"C:\path with spaces\song.mp3"`. validatePath guarantees the path
// has no quote characters, so wrapping it in quotes here is safe.
func reveal(path string) error {
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + path + `"`}
	// explorer.exe exits with status 1 even on success, so only a start failure is an error.
	return cmd.Start()
}

func openDefaultApps() error {
	return exec.Command("explorer.exe", "ms-settings:defaultapps").Start()
}
