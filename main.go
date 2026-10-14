// Aura Player — Wails v2 desktop host (Go backend + React/TypeScript frontend).
package main

import (
	"embed"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/ConsoleX-ir/aura-player/internal/dialogs"
	"github.com/ConsoleX-ir/aura-player/internal/fileopen"
	"github.com/ConsoleX-ir/aura-player/internal/library"
	"github.com/ConsoleX-ir/aura-player/internal/lifecycle"
	"github.com/ConsoleX-ir/aura-player/internal/media"
	"github.com/ConsoleX-ir/aura-player/internal/mediakeys"
	"github.com/ConsoleX-ir/aura-player/internal/metadata"
	"github.com/ConsoleX-ir/aura-player/internal/providers"
	"github.com/ConsoleX-ir/aura-player/internal/shell"
	"github.com/ConsoleX-ir/aura-player/internal/syswin"
	"github.com/ConsoleX-ir/aura-player/internal/watcher"
	"github.com/ConsoleX-ir/aura-player/internal/window"
)

//go:embed all:dist
var assets embed.FS

// appID is the application identity (also the single-instance lock key).
const appID = "com.consolex.aura"

// dataDir is where Aura keeps its own files (covers cache, mini-player
// position, WebView2 profile incl. IndexedDB). It survives upgrades and
// uninstalls by design.
func dataDir() string {
	base, err := os.UserConfigDir() // %APPDATA% on Windows
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "AuraPlayer")
}

func main() {
	dir := dataDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		log.Printf("cannot create data dir %s: %v", dir, err)
	}
	coversDir := filepath.Join(dir, "covers")

	app := NewApp()
	lib := library.NewService()
	dlg := dialogs.NewService(dialogs.WailsBackend{})
	win := window.NewService(dir)
	files := fileopen.NewService(os.Args[1:])
	sh := shell.NewService()
	life := lifecycle.New(
		func() { runtime.EventsEmit(app.ctx, lifecycle.EventShutdown) },
		func() { runtime.Quit(app.ctx) },
		lifecycle.DefaultTimeout,
	)
	meta := metadata.NewService(coversDir)
	netSvc := providers.NewService()
	watch := watcher.NewService()
	sys := syswin.NewService()

	// Global media keys (Windows): hardware Play/Pause/Next/Previous work
	// even when Aura isn't focused, funnelling into 'media:command' — the
	// same event the mini player rides.
	keys := mediakeys.New(func(cmd mediakeys.Command) {
		if app.ctx != nil {
			runtime.EventsEmit(app.ctx, "media:command", string(cmd))
		}
	})

	err := wails.Run(&options.App{
		Title:            "Aura Player",
		Width:            1440,
		Height:           900,
		MinWidth:         window.NormalMinW,
		MinHeight:        window.NormalMinH,
		Frameless:        true,
		BackgroundColour: &options.RGBA{R: 0x0A, G: 0x0A, B: 0x0F, A: 255},
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: media.Handler{}, // /aura/local?path=… (replaces the aura:// protocol)
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: appID,
			OnSecondInstanceLaunch: func(d options.SecondInstanceData) {
				files.HandleSecondLaunch(d.Args)
				win.RestoreMainWindow()
			},
		},
		// OS drag-and-drop: Wails hands the renderer ABSOLUTE file
		// paths (Electron's File.path has no WebView2 equivalent).
		// The Go side filters to audio and emits 'drag:dropped'.
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
			CSSDropProperty:    "--wails-drop-target",
			CSSDropValue:       "drop",
		},
		OnStartup: func(ctx context_) {
			app.startup(ctx)
			lib.Startup(ctx)
			dlg.Startup(ctx)
			win.Startup(ctx)
			files.Startup(ctx)
			meta.Startup(ctx)
			netSvc.Startup(ctx, coversDir)
			watch.Startup(ctx)
			runtime.OnFileDrop(ctx, func(x, y int, paths []string) {
				audio := make([]string, 0, len(paths))
				for _, p := range paths {
					if meta.API().IsAudioFile(p) {
						audio = append(audio, p)
					}
				}
				if len(audio) > 0 {
					runtime.EventsEmit(ctx, "drag:dropped", audio)
				}
			})
			keys.Start()
			sys.Startup()
		},
		OnBeforeClose: func(ctx context_) bool { return life.BeforeClose() },
		OnShutdown: func(ctx context_) {
			watch.Stop()
			keys.Stop()
			sys.Shutdown()
			win.Shutdown()
			app.shutdown(ctx)
		},
		Bind: []interface{}{
			app, lib.API(), dlg.API(), win.API(), files.API(), life.API(), sh.API(),
			meta.API(), netSvc.API(), watch.API(), sys.Facade(),
		},
		Windows: &windows.Options{
			// Transparent webview so the mini widget can paint its own rounded
			// corners/shadow. The main UI paints an opaque background.
			WebviewIsTransparent: true,
			WebviewUserDataPath:  filepath.Join(dir, "WebView2"),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
