# Aura Player — Release Notes v2.16.0

**Phase 15: Performance & Scale pass** · 2026-09-22 · full roadmap position: Phases 1–15 of 16 complete, final gate passed

## What's new

Aura v2.16.0 is a dedicated performance and scale pass over the entire application — an audit-and-measure phase rather than a feature phase. Every perf-critical surface was re-read line by line, a permanent 15-budget performance probe was added to the test arsenal, and the two real inefficiencies the audit surfaced were fixed.

### Measured at 5,000 songs + 5,000 listening sessions

The new probe (`scripts/p15_perf_probe.py`) seeds a production build with a 5,000-track library and a 5,000-session listening history, then measures budgets that previously existed only as impressions:

| Budget | Result |
|---|---|
| First library row painted (cold navigation, 5k resident) | **719 ms** in-page (735 ms wall) — budget 5,000 ms |
| Worst lazy-view navigation settle (Favorites / History / Settings / Rewind) | **≤ 48 ms** — budget 450 ms |
| History page reopen (heaviest page, 5k sessions) | **15 ms** — budget 350 ms |
| Deep-scroll to row 5,000 (virtualized list settle) | **23 ms** — budget 250 ms |
| 5,000-track search filter settle | **917 ms** incl. artificial settle wait — budget 1,200 ms |
| 60 instant queue skips (store-level storm) | **149 ms** — budget 1,200 ms |
| Heap growth over 6 s idle-paused hold | **0.0 MB** — budget 12 MB |
| Heap growth boot → full navigation sweep | **0.0 MB** — budget 45 MB |
| Long tasks (startup / nav sweep / scroll+stress) | **4 / 1 / 1** — budget 25 each |
| Page errors across the entire probe | **0** |

All 15/15 budgets met. The list stays virtualized at 18 DOM rows out of 5,000.

### Fixed

- **Visualizer (wave mode): per-frame allocation.** The wave draw function allocated a fresh 2 KB `Uint8Array` every animation frame (~60 allocations/second while the panel was open). It now allocates once per effect — the same treatment the bars/circle modes already received in v2.1.0. This was the last remaining per-frame allocation in the app's render loops.
- **Mini player: heartbeat IPC churn while paused.** The 250 ms snapshot heartbeat shipped **identical** payloads 4×/s forever while the widget was visible and playback was paused, forcing the widget window to re-render with unchanged content. Identical snapshots are now deduplicated: a paused widget costs **zero** IPC sends and zero re-renders. Every visibility transition (show) resets the dedupe and force-pushes fresh state, so the widget can never paint a stale frame — the v2.1.2 contract is preserved exactly, verified in real Electron.

### Re-audited, confirmed clean

Zustand selector hygiene (no whole-store subscriptions, no identity-allocating selectors), row memoization with per-row narrow subscriptions, shared list virtualization, IndexedDB write coalescing + pre-hydration write gate, the playback engine's event and subscription lifecycle, Aura Pulse (zero rAF while paused or in static mode), the dynamic-theme dominant-color cache, and the event-driven folder watcher with its keyed effect. The audio engine, scrobble pipeline, and ambient system needed no changes.

### Verification

- New permanent suite: `p15_perf_probe.py` — 15 budgets, production build.
- Full regression battery green: 13 functional suites (p1 42 · p2 23 · p4 25 · p5 13 · p6 23 · p7 10 · p8 17 · p9 19 · p10 14 · p11 19 · p12 24 · v212_func 27 · v212_electron 12 in real Electron) + 12 unit suites.
- `tsc` clean, production build clean.
- **Zero new dependencies** — runtime deps remain exactly one (`music-metadata`, required by the Electron main process); everything renderer-side is bundled by Vite.

### Packaging

`Aura.Player.Setup-2.16.0.exe` (Windows). App payload (app.asar) is **1.9 MB**; the installer stays around 80 MB — well under the 100 MB budget set at the v1.10 finale.
