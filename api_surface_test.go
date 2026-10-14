package main

import (
	"reflect"
	"sort"
	"testing"

	"github.com/ConsoleX-ir/aura-player/internal/dialogs"
	"github.com/ConsoleX-ir/aura-player/internal/fileopen"
	"github.com/ConsoleX-ir/aura-player/internal/library"
	"github.com/ConsoleX-ir/aura-player/internal/lifecycle"
	"github.com/ConsoleX-ir/aura-player/internal/metadata"
	"github.com/ConsoleX-ir/aura-player/internal/providers"
	"github.com/ConsoleX-ir/aura-player/internal/shell"
	"github.com/ConsoleX-ir/aura-player/internal/watcher"
	"github.com/ConsoleX-ir/aura-player/internal/window"
)

func methods(v interface{}) []string {
	t := reflect.TypeOf(v)
	out := make([]string, 0, t.NumMethod())
	for i := 0; i < t.NumMethod(); i++ {
		out = append(out, t.Method(i).Name)
	}
	sort.Strings(out)
	return out
}

// Wails exposes EVERY exported method of a bound value to the webview. This
// pins the exact surface so internal hooks (Startup, BeforeClose, …) or new
// methods cannot become callable from JavaScript by accident. Adding to the
// renderer API is deliberate: update this table in the same change.
func TestBoundAPISurface(t *testing.T) {
	want := map[string]struct {
		got  interface{}
		list []string
	}{
		"App":       {NewApp(), []string{"AppVersion"}},
		"library":   {library.NewService().API(), []string{"CheckPaths", "ResolveDroppedPaths", "ScanFolder"}},
		"dialogs":   {dialogs.NewService(nil).API(), []string{"OpenFiles", "OpenFolder", "SaveImageFile", "SavePlaylistFile", "WriteTextFile"}},
		"window":    {window.NewService("").API(), []string{"Close", "IsMaximized", "Minimize", "MiniVisible", "RestoreFromMini", "SetMiniVisible", "ToggleMaximize"}},
		"fileopen":  {fileopen.NewService(nil).API(), []string{"TakeLaunchFile"}},
		"shell":     {shell.NewService().API(), []string{"SetAsDefaultMusicPlayer", "ShowItemInFolder"}},
		"lifecycle": {lifecycle.New(func() {}, func() {}, 0).API(), []string{"NotifyShutdownComplete"}},
		"metadata":  {metadata.NewService("").API(), []string{"GetFileStats", "IsAudioFile", "ParseMetadata", "ParseMetadataBatch"}},
		"net":       {providers.NewService().API(), []string{"CacheArtwork", "FindMetadata", "ProbeOnline", "ProviderCancel", "ProviderRequest"}},
		"watcher":   {watcher.NewService().API(), []string{"WatchFolders"}},
	}
	for name, c := range want {
		wantList := append([]string(nil), c.list...)
		sort.Strings(wantList)
		if got := methods(c.got); !reflect.DeepEqual(got, wantList) {
			t.Errorf("%s: bound surface = %v, want %v", name, got, wantList)
		}
	}
}
