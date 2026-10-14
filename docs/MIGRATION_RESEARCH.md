# Migration Research (in progress)

Status: **partial.** Sections marked ✅ are researched and cited; sections marked ⏳ are still open
and will be filled in as each phase is implemented. Research date: 2026-10-11.

## 1. Wails version decision ✅

**Selected: Wails v2.14.0** (latest stable v2; released 2026-08-10).

| Fact | Source |
|---|---|
| Wails v3 reached **beta** on 2026-08-02 (`v3.0.0-beta.0`). It is explicitly "not the final 3.0 release"; v2 "remains the current stable release". | https://v3.wails.io/blog/wails-v3-beta/ , https://github.com/wailsapp/wails/releases/tag/v3.0.0-beta.0 |
| v3 betas ship as automated **nightlies**; `beta.28` (2026-10-05) still lists Windows WebView2 crash/recovery fixes. | https://github.com/wailsapp/wails/releases/tag/v3.0.0-beta.28 |
| Latest stable v2 is `v2.14.0`. | https://github.com/wailsapp/wails/releases/tag/v2.14.0 |
| v2 does **not** support multiple windows; maintainers point to v3. | https://github.com/wailsapp/wails/issues/1480 , https://github.com/wailsapp/wails/issues/3425 |
| `v2.14.0` requires **Go ≥ 1.25.0** (its `go.mod`). Verified by building with Go 1.25.14. | `v2/go.mod` @ v2.14.0 |

Rule applied: prefer stable v2 unless v3 is demonstrably stable *and* materially better. v3 is better
for the mini player (true second window) but is still beta with Windows WebView2 fixes landing, and
this project cannot currently be tested on real Windows in the build environment. **Decision (confirmed
by the project owner, 2026-10-11): v2.14.0.**

### Consequence: mini player
Electron's mini player is a separate frameless, transparent, always-on-top `BrowserWindow`
(460×112, skip-taskbar). Wails v2 is single-window, so it becomes a **compact mode of the one window**
(resize + frameless + always-on-top). Main and mini can no longer be on screen simultaneously.
This is a documented behavioral change (see MIGRATION_REPORT once written).

## 2. Other findings from baseline inspection ✅ (code-derived, not web research)

- Audio engine (EQ, FX, crossfade) is Web Audio in the renderer → stays in the frontend.
- Renderer persistence is a debounced IndexedDB pipeline with a held-close flush handshake (1.5 s cap).
  Wails v2 `OnBeforeClose` can reproduce the handshake.
- **IndexedDB is origin-scoped.** Electron's origin ≠ Wails' `wails.localhost`, so upgrading users will not
  see existing library/state automatically. An export/import path is required.
- Local audio is streamed through a custom `aura://` protocol in Electron; Wails v2 needs an
  `AssetServer.Handler` equivalent (range-request behaviour to be verified).

## 3. Wails v2.14 behaviours verified from source ✅
- `WindowGetPosition` returns **absolute** screen coords but `WindowSetPosition` **adds the monitor work-area origin**
  (`winc/controlbase.go`), so a Get→Set round trip drifts on secondary monitors / non-zero taskbar offsets. Aura does
  mini-player geometry with Win32 `SetWindowPos` instead (`internal/window/native_windows.go`). Sizes are DPI-scaled logical px.
- `runtime.Quit` calls `OnBeforeClose` first (veto-able) → basis for the flush-before-close handshake.
- Wails binds **every exported method** of a bound value → renderer-facing `API` facades + a test pinning the surface.
- `CSSDragProperty` is configurable, but WebView2 support for reading `-webkit-app-region` is unverified, so
  `--wails-draggable` is declared next to every Electron drag declaration.
- Range requests: Wails added range support for the embedded asset FS (PR #2091, 2022). Local files are served by a custom
  `Handler` using `http.ServeContent`; WebView2's use of it is **unverified**.
  Sources: https://github.com/wailsapp/wails/pull/2091 , https://wails.io/docs/reference/runtime/window

## 4. Still to research ⏳
Metadata libraries for Go; Range/seek support through the Wails asset handler; global media keys and
taskbar thumbnail buttons on Windows; WebView2 transparency/blur for the mini widget; single-instance
and file-association launch args in Wails v2; WebView2 bootstrapper strategy and silent-install options;
Go-side folder watching; fpcalc handling; test strategy for Wails apps.

## 5. Build-environment findings ✅
The sandbox blocks `go.dev`, `golang.org`, `proxy.golang.org`, `gopkg.in`, `atomicgo.dev`, `dario.cat`,
`git.sr.ht`. Workarounds used (documented in `scripts/sandbox-build.sh` and `go.sandbox.mod`):
Go 1.25.14 from `actions/go-versions` GitHub releases; GitHub mirrors for `golang.org/x/*` and other
vanity modules; a compile-only stub for `go-toast` (git.sr.ht). None of this applies on a normal machine.
