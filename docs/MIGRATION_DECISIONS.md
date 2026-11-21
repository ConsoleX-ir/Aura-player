# Migration Decisions

## ADR 0001 — Add Tauri beside Electron (superseded)

- Status: Superseded by ADR 0011
- Date: 2026-11-19
- Context: The migration instructions require preserving the only working implementation until the replacement demonstrates parity. The pre-migration tree was checkpointed in Git before additive Tauri work.
- Decision: Introduce the Tauri application additively under `src-tauri/`. Keep `electron/`, the Electron package entry, dependencies, and existing build scripts untouched at this stage. Do not route the default app build to Tauri yet.
- Consequences: The project temporarily carries both desktop shells. Commit `a541c40` is the pre-migration recovery point; Electron source, entry point, dependencies, and scripts remain available. Cleanup can happen only after parity and release validation.

## ADR 0002 — Preserve the Web Audio engine during shell migration

- Status: Accepted for initial migration; revisit only with measured evidence
- Date: 2026-11-19
- Context: `src/lib/playbackController.ts` owns one HTMLAudioElement and a persistent Web Audio graph used by the main UI, mini player, EQ, effects, meters, and listening accounting. Replacing it would change decoding, DSP, crossfade, analyzers, and CORS behavior simultaneously with the host migration.
- Decision: Keep playback and DSP in the WebView while replacing Electron infrastructure. Do not add a native audio engine in the foundation stage.
- Consequences: Existing browser media codec and CORS behavior remains relevant. A future native-audio decision requires specific requirements, parity tests, and comparative measurements.

## ADR 0003 — Use Tauri 2 with Rust commands and least-privilege capabilities

- Status: Accepted
- Date: 2026-11-19
- Context: Current official Tauri documentation describes Tauri 2 command invocation and capability-based access control. The frontend has no existing Tauri API dependency, and Electron's context-isolated preload exposes an intentionally curated bridge.
- Decision: Start with a Tauri 2 shell and a minimal capability set. Migrate the bridge into typed frontend adapters calling narrow Rust commands/events; grant plugin permissions only as required by each migrated feature.
- Consequences: IPC names/payloads and event lifecycle must be tested as API contracts. Commands that touch files must apply explicit validation/scoping rather than exposing unrestricted filesystem access.

## ADR 0004 — Keep browser-native persistence initially

- Status: Accepted for initial migration; revisit after compatibility testing
- Date: 2026-11-19
- Context: Zustand persistence already uses IndexedDB (`src/lib/idbStorage.ts`) and has an existing legacy localStorage migration and coordinated flush path. Replacing it with SQLite or Rust-managed settings would add a data conversion risk unrelated to establishing the Tauri host.
- Decision: Keep current IndexedDB/Zustand persistence during the shell and bridge migration. Reassess only if a requirement or measurement justifies changing the storage model.
- Consequences: Tauri webview origin/storage behavior must be checked against the Electron origin so existing user data remains discoverable or gets an explicit migration path.

## ADR 0005 — Initial Windows bundle target is NSIS (superseded)

- Status: Superseded by ADR 0012
- Date: 2026-11-19
- Context: The stated release requirement is a Windows installer. Existing project packaging uses an interactive NSIS installer. Current Tauri Windows bundling supports NSIS and MSI.
- Decision: Configure the initial Tauri bundle for NSIS to match the existing installer style. File associations, upgrade behavior, WebView2 bootstrapper mode, and default-player setup remain to be implemented and tested before release.
- Consequences: An NSIS artifact can be targeted after build prerequisites are available; installer parity is not yet implemented or verified.

## ADR 0011 — Make Tauri the only active target

- Status: Accepted; release verification remains open
- Date: 2026-11-20
- Context: The migration implementation is in place, and the project needs one clear development and release path while retaining a recoverable Electron fallback.
- Decision: Route root `dev`, tests, builds, and Windows release packaging to Tauri. Remove Electron and Electron-only packages/scripts from the root project. The legacy Electron implementation is preserved on the `electron-legacy-backup` Git branch (recover with `git checkout electron-legacy-backup`).
- Consequences: The root clean install is Tauri-only. Zero Electron implementation or dependency references remain in the active project. Tauri parity and runtime validation gate release readiness.

## ADR 0012 — Produce both MSI and NSIS installers

- Status: Accepted; MSI generated, install validation blocked
- Date: 2026-11-20
- Context: The NSIS setup executable was generated but Windows rejected it before showing installer UI with “Illegal System DLL Relocation.” Tauri supports both WiX MSI and NSIS bundles.
- Decision: Configure Tauri to build both installer formats. Keep MSI available as a supported alternative and keep NSIS for comparison until a healthy Windows run establishes whether the failure is host-specific or package-specific.
- Consequences: MSI and NSIS are generated from the same Tauri executable. A successful build does not prove install, upgrade, file association, launch, or uninstall behavior; those require a Windows runtime check.

Tauri's Windows installer guide documents MSI (WiX) and NSIS as supported bundle choices. The current Tauri bundler pins NSIS 3.13; upstream changelog shows that as the latest dated release. No compatible newer stub was available in this environment. See [Tauri Windows installers](https://v2.tauri.app/distribute/windows-installer/) and [NSIS release history](https://github.com/nsis-dev/nsis/blob/master/Docs/src/history.but).

## ADR 0006 — Isolate the migration WebView profile

- Status: Accepted for development; re-evaluate for production data migration
- Date: 2026-11-19
- Context: Tauri development startup reached WebView2 but failed with `0x800700AA` (“The requested resource is in use”). The machine has a pre-existing `%LOCALAPPDATA%/com.consolex.aura/EBWebView` profile. Reusing or deleting that profile during initial development could collide with another app process or disturb user data.
- Decision: Give Tauri development a separate application identifier and point its `localData` directory to `./dev-data` in `src-tauri/tauri.dev.conf.json`; Tauri resolves this relative to the debug executable under the project target tree. Keep the release identifier and default data directory unchanged.
- Consequences: Dev WebView storage is isolated and sandbox-writable; it does not prove compatibility with Electron's IndexedDB origin or the eventual production Tauri profile. Production must choose and test an explicit IndexedDB migration strategy.

## ADR 0007 — Grant local media access from explicit user picks

- Status: Accepted for the initial Tauri import slice; runtime review pending
- Date: 2026-11-19
- Context: The Electron app serves local audio and artwork through its `aura://local` protocol. Tauri's WebView needs a file URL scheme to pass local audio to the existing HTML audio engine, while Rust commands need access to selected paths for scanning and metadata.
- Decision: Keep path validation in Rust, persist canonical folder/file grants only after native dialog selection, and add those paths to Tauri's dynamic asset-protocol scope. Use `convertFileSrc` for local audio/artwork. The frontend does not receive unrestricted filesystem APIs.
- Consequences: This keeps Rust as the access boundary and avoids copying large audio files. Restart restoration, WebView range/CORS behavior, removable drives, symlinks, and old Electron libraries without grants still require explicit runtime/compatibility testing. Metadata uses Lofty for the first slice; it may not cover every format/tag behavior supported by `music-metadata`, so fixture-based comparison is required before parity.

## ADR 0008 — Use Tauri single-instance plugin and queue file launches

- Status: Implemented; process-level behavior verified, renderer import and installed association behavior blocked.
- Date: 2026-11-20
- Context: Windows can start the application with one or more audio paths, including while an Aura process already exists. The renderer can mount after native startup and must not lose launch arguments.
- Decision: Register the official Tauri single-instance plugin first. Canonicalize, validate, grant, and queue supported existing audio paths in Rust. Restore/focus the main window, emit a wake-up event, and let the renderer drain the queue through the existing shared import path.
- Consequences: Startup and forwarded launches share one queue and library workflow. Actual NSIS installation and Explorer activation still require runtime verification.

## ADR 0009 — Do not add a second remote artwork disk cache

- Status: Accepted.
- Date: 2026-11-20
- Context: Tauri already stores embedded art in its scoped app cache. Find Info Online receives a remote artwork URL and persists selected metadata in IndexedDB.
- Decision: Keep embedded artwork caching/recovery native and grant-scoped. Persist only validated HTTPS URLs for remote provider artwork under Tauri; Electron continues using its existing `cacheArtwork` implementation. Do not introduce a duplicate Tauri download/cache command.
- Consequences: Remote artwork requires the provider/CDN URL to remain reachable. A dedicated cache command can be reconsidered only if offline persistence becomes a requirement.

## ADR 0010 — Keep provider semantics in the renderer and bound transport in Rust

- Status: Implemented; live Tauri network behavior still needs runtime verification.
- Date: 2026-11-20
- Context: The shared provider client sends structured operations and normalized results into React; accepting a renderer-supplied URL would bypass the narrow native boundary.
- Decision: Pass `{ requestId, providerId, op, params }` to a Rust adapter. Rust constructs allowlisted Audius/Radio Browser URLs, applies timeout/body/redirect limits, supports cancellation, maps responses to the renderer's normalized shapes, and returns typed provider errors. Preserve the Electron implementation as the parity reference.
- Consequences: Transport and normalization are covered by Rust tests, but live provider calls, retries/failover parity, and Find Info Online still need validation in Tauri before claiming full provider parity.

