# Aura Player 5.0.0 — Installer Launch Investigation

**Date:** 2026-11-22  
**Status:** FIX IMPLEMENTED; INSTALLER ACCEPTANCE PENDING

## Finding

The incident reproduced on the available Windows host. Windows Installer logs confirmed a successful 5.0.0 MSI installation (event 11707). The installed `aura-player.exe` then exited on direct launch with code 0 while an older Aura process already owned the application’s single-instance event window. Inspection of that owner showed it had no main window; it retained only the single-instance event window and a hidden mini-player. There were no matching Application Error or Windows Error Reporting crash events. The WebView2 Runtime 157.0.4341.60 was present.

The process was not crashing in WebView2 or failing to load packaged assets. It was a hidden primary instance. The `tauri-plugin-single-instance` Windows implementation exits a secondary launch with code 0. Aura’s callback returned before showing the main window when no valid audio file path was supplied, so a normal shortcut launch did nothing visible. Closing only the main window could leave the hidden mini-player window and the single-instance lock alive.

This behavior affects MSI and NSIS payloads alike: both bundles contain the same Tauri application executable and share the same app identifier and single-instance behavior. The incident is in app lifecycle handling, not the MSI database versus NSIS wrapper. A clean first-install run of both rebuilt installers has not been observed here.

## Changes

- Every single-instance callback now unminimizes, shows, and focuses the main window before checking whether audio paths were forwarded.
- `shutdown_complete` now exits the whole app after the renderer flush, instead of closing only the main window and leaving the hidden mini window alive.
- Added `scripts/v500_installer_launch_regression.test.ts` with checks for no-argument relaunch restoration and whole-app shutdown.

## Validation

| Check | Result |
|---|---|
| TypeScript typecheck | PASS |
| Focused launch regression checks | PASS — 2/2 |
| Rust `cargo check` | PASS |
| Tauri release build | PASS — MSI and NSIS both generated |
| Rebuilt release executable | PASS — visible `Aura Player` window and responsive process |
| No-argument relaunch while primary is running | PASS — second launch exited code 0; primary remained visible |
| MSI installation from the rebuilt package | BLOCKED — no isolated Windows test environment available |
| NSIS installation from the rebuilt package | BLOCKED — no isolated Windows test environment available |
| UI-driven clean shutdown check | BLOCKED — computer-use input could read Aura’s accessibility tree, but could not operate the app window |

The available Windows host already contains Aura user data and is not an isolated test machine. To avoid overwriting that installation or changing the user’s library and file associations, the rebuilt MSI and NSIS packages were not installed on this host. The rebuilt executable was launched directly from the release build folder; this does not prove installer installation success.

## Rebuilt packages

The new MSI and NSIS files are in `installer/`. Their sizes and SHA-256 hashes are listed in `installer/RELEASE_INFO.md`. The previous packages are retained in `installer/archive/pre-lifecycle-fix/`.

## Follow-up required before distribution

Install each rebuilt package in a clean Windows VM or disposable Windows account, launch from its created shortcut without file arguments, close Aura normally, and launch it again. Record MSI and NSIS outcomes separately. Until those runs pass, the installer launch claim remains pending.