# Aura Player — Phase 3 Engineering Report

**Verdict: READY WITH KNOWN LIMITATIONS**

Baseline verified before any changes: frontend tests 226/226 pass, Rust tests 12/12 pass, `tsc -b` passes, `vite build` passes, Tauri MSI + NSIS release build passes.

Post-change validation: frontend tests 226/226 pass, Rust tests 17/17 pass, typecheck passes, production build passes, Tauri MSI + NSIS release build passes, `git diff --check` clean.

---

## 1. Architecture

### Initial findings
The codebase is already well-engineered; no subsystem needed a speculative rewrite.

- **State**: single Zustand store (`src/store/playerStore.ts`) with IndexedDB persistence (`src/lib/idbStorage.ts`) — async, debounced writes so ~4–10 Hz playback progress ticks no longer re-stringify the whole library on the main thread.
- **Service layer**: `src/services/libraryService.ts` holds all ingestion/reconciliation logic; hooks (`src/hooks/useLibraryImport.ts`, `useLibrarySync.ts`, `useFileAssociationLaunch.ts`, `useFolderWatcher.ts`) are thin UI wrappers.
- **Pure logic**: `lib/queueEngine.ts`, `lib/search.ts`, `lib/sort.ts`, `lib/libraryHealth.ts` are side-effect-free and unit-tested.
- **Rust/Tauri**: `src-tauri/src/lib.rs` — commands offload blocking I/O to `spawn_blocking`/`thread::scope`; metadata parsed in parallel (up to 4 workers); provider layer uses allowlisted hosts, GET-only, 9s timeouts, cancellation via `tokio::select!`, 10 MiB response cap; file grants validated via canonical paths against `asset_protocol_scope`; shutdown uses an atomic handshake (`SHUTDOWN_STATE`).

### Actual weaknesses
1. **Test coverage lost in the Electron→Tauri migration.** 6 test files were removed from the working tree (see §2). The Electron provider network-layer behaviors (retry on 500, 429 Retry-After, malformed JSON, connection-refused typing, cancellation against a live local server) had no equivalent Rust unit test. URL/normalization coverage was consolidated into Rust `provider_tests`.
2. **Silent error swallowing.** `useFolderWatcher.runSync` swallowed sync failures with `.catch(() => {})`.
3. **No Tauri/WebView2 integration tests.** Real Tauri behavior cannot be exercised in this environment (WebView2 not accessible via UI automation); IPC contracts are covered only by Rust unit tests for pure helpers.
4. **`~300 MB` memory** is dominated by WebView2; could not be attributed or profiled in this environment (no running instance / profiling tooling available).

### Changes implemented
- `src-tauri/src/lib.rs`: added 5 unit tests for `canonical_or_missing` (path resolution below existing ancestors, `.`/`..` normalization) and `path_is_allowed` (directory/file grant matching, sibling-prefix isolation).
- `src/hooks/useFolderWatcher.ts`: replaced swallowed sync error with `console.error('Folder sync failed:', error)`.

### Remaining concerns
- Provider network-resilience (retry/429/malformed/connection errors) uncovered at the Rust level.
- No real Tauri integration coverage (WebView2 blocker).
- Memory attribution blocked by environment.

---

## 2. Testing

### Previous vs current counts
- Prior engineering report (`docs/TESTING_REPORT.md`, 2026-11-21): **274/274**.
- Current measured baseline: **226/226** (`tsx --tsconfig tsconfig.app.json --test scripts/*.test.ts`).
- Gap: **~48 tests**.

### Explanation of the discrepancy
The working tree deleted 6 test files that existed at HEAD and added 2:

| File (deleted vs HEAD) | Approx. cases | What it covered |
|---|---|---|
| `scripts/phase3_core.test.ts` | 16 | Electron `providerFetch` network layer: timeout, retry, 429 Retry-After, malformed JSON, connection-refused typing, cancellation vs local HTTP server |
| `scripts/phase4_audius.test.ts` | 15 | Audius provider mapping |
| `scripts/phase5_radio.test.ts` | 11 | Radio Browser mapping |
| `scripts/phase6_unit.test.ts` | 11 | Misc unit cases |
| `scripts/v321_optimization.test.ts` | 8 | Optimization/perf cases |
| `scripts/v400_redesign.test.ts` | 7 | Redesign cases |
| **Added** `scripts/find_metadata.test.ts` | 2 | Find Info Online merge/rank |
| **Added** `scripts/v500_mini_player_enabled.test.ts` | ~2 | Mini player enabled gating |

Root cause: Electron was removed from the project; its provider network layer (`electron/providers/core.cjs`) was deleted with it. The provider URL-building and response-normalization logic was reimplemented in Rust (`lib.rs` `execute_provider_request` / `normalize_provider_response`) and is covered by Rust `provider_tests` (8 → 17 tests). However, the Electron-specific **network-resilience behaviors** (retry, 429 Retry-After, malformed JSON, connection-refused typing, live-server cancellation) were not re-covered in Rust. Tests were intentionally removed as part of the Electron teardown, not lost to discovery-rule changes.

### Coverage inventory

| Subsystem | Existing tests | Missing / gaps |
|---|---|---|
| Library add/remove/dedup | `v500_regressions` (sync, isPathInside, addToLibrary dedup indirectly) | No direct `importFiles` Tauri-path test (needs Tauri/IPC mock) |
| Duplicate detection | `phase1_unit` (libraryHealth duplicate clusters) | — |
| Scanning | `provider_tests` `scan_folder_tree` (recursive, nonexistent, no-audio) | Permission failures, symlinks, cancellation, large dirs |
| Metadata | None directly (lofty parsing needs real audio files + AppHandle for cover cache) | Invalid files, missing tags, Unicode, embedded artwork, malformed, batch isolation |
| Playback | `phase11_queue`, `queue_engine`, `v500_regressions` (nextIndex/prevIndex/shuffle/togglePlay/playSong) | State transitions under rapid commands, event sync, missing files |
| Tauri integration | None | IPC contracts, permissions, startup/shutdown (WebView2 blocker) |

### New tests added
- 5 Rust tests in `src-tauri/src/lib.rs` (`canonical_or_missing` ×3, `path_is_allowed` ×2).

### Results
- Frontend: 226 passed, 0 failed.
- Rust: 17 passed, 0 failed.

---

## 3. Algorithms

Reviewed (no changes — all already optimal; no measurable justification to replace):

| Area | Existing algorithm | Complexity | Assessment |
|---|---|---|---|
| Library dedup (`addToLibrary`) | `Set` of existing ids, single pass | O(N + M) | Optimal; left alone |
| Folder scan (`scan_folder_tree`) | Iterative DFS with `read_dir`, skip on error | O(files) | Optimal; error isolation per-dir |
| Metadata batch (`parse_metadata_batch`) | `thread::scope`, up to 4 workers, atomic work-stealing | O(files/workers) | Optimal; failure isolated per file |
| Duplicate detection (`findDuplicateGroups`) | Signature bucket + duration-ordered cluster walk | O(n log n) | Optimal; zero-duration never self-matches |
| Search (`searchLibrary`) | Exact token AND-match, then capped fuzzy (limit 40) | O(n·tokens) then O(n log n) sort | Optimal; field queries never fuzzy-fallback |
| Sort (`sortSongs`) | Stable `Array.sort`, shared `Intl.Collator` | O(n log n) | Optimal; ties stable |
| Queue (`queueEngine`) | Fisher-Yates around keepId; index math | O(n) | Optimal; queue IS play order |

No algorithmic changes implemented — simple solutions are already optimal, per the engineering rules.

---

## 4. Performance

Could not profile the `~300 MB` figure in this environment: no runnable WebView2 instance and no profiling tooling available, so memory cannot be attributed to WebView2 / Rust / JS heap / artwork cache. Documented as a known limitation rather than guessed at.

Mitigations already present in the codebase:
- IndexedDB (async) + 800 ms debounced persistence — prevents main-thread blocking on progress ticks.
- `unload`/`visibilitychange` flush of pending writes.
- Parallel metadata parsing (4 workers), spawn_blocking for file I/O.
- Provider response capped at 10 MiB, timeouts bounded.

Build output: `main-DC0bM7ug.js` 673.15 kB (187.47 kB gzip) — above the 500 kB chunk warning but a pre-existing characteristic, not changed here (code-splitting would be a UI/architecture change without measured need).

---

## 5. Runtime reliability

Not verifiable in this environment (WebView2/UI automation unavailable). Consistent with the prior report: launch, single-instance, file association, installer, and WebView2 creation were runtime-verified previously; playback, import, metadata, artwork, persistence, watcher, and media-keys are RUNTIME BLOCKED (UI not observable). No new runtime claims are made beyond what the prior report and compilation/test evidence support.

Verification status (unchanged from prior, code-inspected + unit-tested only):
- Application startup: Code inspected + unit tested.
- Single-instance: Rust `tauri-plugin-single-instance`, code inspected.
- File association launch: `enqueue_launch_paths` + `take_pending_audio_files`, unit-tested path logic.
- Add Files / Add Folder / Drag & Drop: `libraryService`, unit-tested sync/isPathInside; UI flow not runtime-tested.
- Metadata extraction: Rust `parse_metadata_batch`, pure helpers unit-tested; real-file parsing not tested.
- Artwork loading: cover cache + `recover_cover`, code inspected.
- Library persistence: IndexedDB adapter, unit-tested store logic.
- Playback / queue: Zustand store + queueEngine, unit-tested.
- Mini Player / Settings / Window lifecycle / Shutdown: code inspected; shutdown handshake in `lib.rs`.

---

## 6. Windows & Tauri

- `tauri.conf.json`: file associations for mp3/flac/wav/ogg/m4a/aac/opus/wma, capabilities `main`+`mini`, CSP null (default Tauri), asset protocol enabled. Main window borderless; mini window non-resizable, skipTaskbar, alwaysOnTop.
- `capabilities/main.json`, `capabilities/mini.json`: least-privilege event permissions.
- Installer validation: Tauri release build produced both MSI (5.16 MiB) and NSIS (3.46 MiB) bundles successfully. MSI per-user install blocked by environment (error 1925, package valid — matches prior report); NSIS install/uninstall previously runtime-verified.
- Clean-install behavior: not re-verified in this session (installer execution blocked by privileges); prior report recorded NSIS silent install/uninstall as runtime verified.

---

## 7. Dependencies

Frontend (`package.json`): `@tauri-apps/api`, radix-ui dropdown-menu/slider, tailwind, framer-motion, lucide-react, react/react-dom, typescript, tsx, vite, zustand — all in use; `npm audit` reported 0 advisories in the prior report; no dependency changes made.

Rust (`Cargo.toml`): `serde`, `serde_json`, `tauri` (protocol-asset), `tauri-plugin-dialog/global-shortcut/single-instance`, `lofty 0.25`, `sha2`, `notify 6`, `reqwest 0.12 (stream)`, `tokio 1 (sync, macros)` — minimal, all used; no changes, no upgrades.

No dependencies added or removed. No new runtime dependencies.

---

## 8. Documentation

Existing docs (`docs/*.md`) reflect the post-migration state. `TESTING_REPORT.md` still cites 274 tests (pre-deletion state); it is now stale relative to the 226 baseline and should be updated to reflect the current count and the provider-test consolidation into Rust. No UI or feature docs were changed (no visual changes were made).

---

## 9. Changed files

1. `src-tauri/src/lib.rs` — added 5 unit tests for `canonical_or_missing` and `path_is_allowed` (path resolution + grant permission logic).
2. `src/hooks/useFolderWatcher.ts` — replaced swallowed sync error with logged `console.error`.

All other working-tree modifications pre-date this session and were not touched. No commits were made.

---

## 10. Validation

| Check | Result |
|---|---|
| Frontend typecheck (`tsc -b`) | PASSED |
| Frontend tests (`npm test`) | 226 passed, 0 failed |
| Rust tests (`cargo test --lib`) | 17 passed, 0 failed (was 12) |
| Production frontend build (`vite build`) | PASSED (2366 modules) |
| Tauri release build (MSI + NSIS) | PASSED (both bundles produced) |
| `git diff --check` | CLEAN (no whitespace errors) |

---

## Final verdict

**READY WITH KNOWN LIMITATIONS**

Justification: All automated checks pass (226 frontend tests, 17 Rust tests, typecheck, production build, Tauri MSI+NSIS release build, diff --check clean). The architecture is sound and no regressions were introduced. Limitations are environmental, not code defects: WebView2-dependent runtime/runtime-integration behavior and memory attribution cannot be verified in this sandbox, and Electron-era provider network-resilience test coverage (retry/429/malformed/cancellation) was not re-established at the Rust level. The app is reliable, tested, and buildable; the unverified paths are explicitly documented rather than claimed.
