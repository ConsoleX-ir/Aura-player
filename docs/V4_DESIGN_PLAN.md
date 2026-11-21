# Aura Player v4.0.0 — Design Plan & Architecture Notes

Status: implementation plan (Step 2 of the v4 spec). Companion to `docs/PERFORMANCE_REPORT.md`
(3.2.1) — that report's baseline measurements and optimization inventory are the starting
point for this release and are extended, not replaced.

---

## 0. Architecture discrepancy — read this first

The v4 task description assumes "the initial Wails migration task has been completed"
and instructs to continue from that implementation. **No Wails implementation exists in
this workspace** — verified by search: no `*.go`, no `go.mod`, no `wails.json`, no Wails
imports anywhere; the only mention of Wails is a negative statement in the 3.2.1
performance report. The previous release cycle explicitly rejected a Wails migration and
delivered the optimized **Electron 3.2.1** tree (branch `opt/3.2.1`).

Per the spec's own governing rules — "Continue from the current implementation rather
than starting a new project", "Do not blindly rewrite it, replace working systems", and
"If the current Wails implementation differs from the expected architecture, document
the discrepancy and resolve it carefully" — v4.0.0 is implemented **on the actual current
codebase: Electron 42.5.0 + React 19 + TypeScript 6 + Vite 8 + Tailwind 4 + framer-motion
12 + zustand 5**. The Wails-specific rules of the spec (§12) are honored in spirit: the
existing architecture is kept intact, no runtime migration is started, no Electron
replacement is introduced, and the Go/JS boundary rules translate to "do not add
high-frequency IPC".

## 1. What the audit found (Step 1 evidence)

### Design foundation (better than the spec assumes)
- `src/styles/tokens.css` — three-layer token system: primitives (`--aura-*`), semantic
  surfaces/text/borders/status, accent aliases driven at runtime by `useDynamicTheme`
  (theme preset / custom picker / album-art ambient). Motion durations, easing curves,
  radius ladder, shadow ladder, z-index registry, blur tokens, focus ring.
- `src/styles/themes.css` — Theme System 3.0: **12 theme identities** (ConsoleX, Ocean
  Deep, Amethyst, Cyan Frost, Emerald, Crimson, Amber, Mono, Orchid, Indigo, Champagne,
  Aurora), each remapping the primitive ink scale + ambient cloud + a secondary accent,
  orthogonal to the **Dark/Light appearance modes** (WCAG-tuned light papers per identity).
- `src/index.css` — glass utilities, Performance Mode (`data-performance="on"` strips
  backdrop-filter + decorative animation), ambient kill-switch (`data-ambient="off"`),
  `prefers-reduced-motion` handling, `content-visibility:auto` album grids, liquid/gel
  selection system, theme cross-fade (`theme-anim`), dynamic accent orb background.
- Spec-vocabulary aliases already exist (`--background-page`, `--control-hover`, …).

### Performance optimizations that MUST survive v4 (spec §11.5)
| # | Optimization | Where | Status |
|---|---|---|---|
| P1 | Progress-tick isolation: native `timeupdate` (~4Hz) → zustand `progress`; only `<PillSeek/>` subscribes — player-bar chrome does not re-render on ticks | `playbackController.ts:271`, `PlayerBar.tsx` (PillSeek) | preserve |
| P2 | Narrow zustand selectors in all mounted-always components (Sidebar, TitleBar, PlayerBar) | everywhere | preserve |
| P3 | 11 lazy routes; Library eager (landing view) | `App.tsx` | preserve |
| P4 | `content-visibility:auto` + `contain-intrinsic-size` on large grids | `index.css` | preserve |
| P5 | Performance Mode + Ambient off + reduced-motion stillness contracts | `index.css`, `liquid.ts` | preserve & extend |
| P6 | Debounced IndexedDB persistence + coordinated shutdown flush | `idbStorage.ts`, `main.cjs` | untouched |
| P7 | v3.2.1 fixes: async `aura://` handler, Set-based import dedupe, debounced mini-bounds save, destroyed-window IPC guards | `main.cjs`, `playerStore` | untouched |
| P8 | Bundle discipline: 30 JS chunks 792.4KB + 65.5KB CSS; asar 1,655,327 B (post-3.2.1) | `dist/` | verify no regression |

### Surfaces audited
- **Shell** (`App.tsx`): `.dynamic-bg` wall (two static accent orbs + base ink), TitleBar,
  floating Sidebar, lazy page host, floating PlayerBar, overlays. Boot screen while IDB
  rehydrates. `MotionConfig reducedMotion="user"` global contract.
- **Sidebar** (`Sidebar.tsx`, 3.2): floating glass card, collapse to 56px rail, travelling
  gel pill selection (LiquidTabs), two groups + playlists + now-playing chip.
- **PlayerBar** (`PlayerBar.tsx`, "Playbar 3.0"): liquid-glass slab, top-edge seek line
  (PillSeek) with hover-only time labels, volume OSD, panel anchors, mini toggle.
- **Mini player** (`mini/MiniApp.tsx` + `mini.html`): separate transparent frameless
  always-on-top BrowserWindow; state pushed from main window bridge (`mini:state` ~per
  tick); artwork + progress ring + seek + transport + volume; actions via `mini:action`.
- **Black frame (mini)** — root-cause analysis:
  1. The card paints `boxShadow: 0 12px 40px` inside a `p-2` (8px) transparent window
     inset — the shadow clips hard at the window bounds, producing a rectangular dark
     halo that reads as a "black frame".
  2. The BrowserWindow does not set an explicit transparent `backgroundColor`; Electron's
     default background can composite as black before/during first paint on Windows.
  3. Frameless Windows windows default `thickFrame: true`; combined with transparency
     this is a documented source of 1px OS frame artifacts on Windows.
  Fixes (all documented Electron options / CSS — no hacks): `backgroundColor:
  '#00000000'`, `thickFrame: false`, larger transparent inset (16px) with a softer,
  smaller-radius shadow, and an explicit rounded-corner window shape painted only by CSS.
- **Audio Studio**: page + MasterCard / EqualizerCard / AudioFxCard / UserPresetChip —
  controls already wired to the real engine (preamp, balance, limiter, 10-band EQ, FX
  rack, presets, bypass). Gaps vs v4 spec: no EQ response curve, spectrum analyzer not
  embedded in the workspace, presentation is "settings cards" rather than a console.
- **Home/landing = Library page** (eager, greeting, view toggles); Welcome = FirstLaunch
  modal (name + default-player offer, shown once).

## 2. Design system v4 (Step 3) — "Mica" material layer, zero new dependencies

Extend the existing three-layer token system with a **material layer** (Windows 11
inspired, Aura identity — not a generic glass clone):

- **Mica wall** (window base): the `.dynamic-bg` evolves from two bare orbs into a
  layered, *still* composition — vertical luminance gradient + low-alpha accent orb pair
  + a wide "horizon" wash. All static CSS (no animation), Performance Mode downgrades to
  pre-baked radial gradients (existing pattern), `data-ambient="off"` removes the orbs.
- **Acrylic chrome** (floating surfaces): sidebar, player bar, mini player, panels keep
  translucency but standardize on shared tokens: `--material-acrylic` (background
  recipe), `--edge-highlight` (1px inner top highlight), `--edge-hairline` (gradient
  hairline border). One recipe, five consumers — replaces five divergent inline stacks.
- **Depth ladder**: base wall → content (cards) → floating chrome (acrylic) → overlay.
  Z-index registry unchanged.
- **Control language**: Win11-proportioned controls — slightly tighter radii on buttons/
  inputs (`--radius-control: 10px`), consistent 1px borders + inner highlight, accent
  focus rings (already present). No neon, no rainbow, no indiscriminate glow.
- **Motion**: existing duration/easing tokens are adopted as the single vocabulary; new
  effects are limited to enter/exit and hover feedback (compositor-only). No perpetual
  background motion anywhere (spec §10); Performance Mode + reduced-motion stillness
  rules apply to every new class.
- **Themes**: all 12 identities + Dark/Light preserved untouched (spec §4); the material
  layer is token-driven so every identity resolves automatically. New tokens get light
  values in the existing light block.

## 3. Implementation slices (Steps 4–6)

| Slice | Scope | Key changes |
|---|---|---|
| S1 Foundation | `tokens.css`, `index.css`, `themes.css` | material tokens, mica wall, acrylic recipe, control radius, new utilities (all stillness-ruled) |
| S2 Shell slice | Sidebar, PlayerBar, mini player, mini window | Win11 nav sections + active outline; always-visible timestamps; **Aurora Line** signature progress (gradient fill + glow head + 10% segments + buffered span + hover scrub); mini redesign (ambient capsule) + window fixes above |
| S3 Home/Welcome | Library landing, FirstLaunch | cinematic greeting band, continue-listening row (existing history data), quick actions; polished welcome card |
| S4 Audio Studio | AudioStudio page + cards | console layout with real-time status row (engine state), SVG EQ response curve computed from real band gains, embedded spectrum analyzer (existing analyser data path), effects rack styling, presets row |
| S5 Consistency pass | dialogs, menus, settings, remaining pages | adopt material tokens where surfaces diverge; no behavior changes |
| S6 Perf & packaging | bundle audit, smoke, asar/AppImage | verify P1–P8; measure installer proxy before/after; version → 4.0.0 everywhere |

Performance gates for every slice: no new continuous animation; no new subscription to
`progress` outside PillSeek/MiniApp state pushes; no new runtime dependency; CSS-only
where possible; `tsc -b` + unit suites green after each slice; headless smoke (CDP)
0-console-error gate.

## 4. Verification strategy (Step 6–7, spec §15)

- `npx tsc -b`, `npm run build`, `bash scripts/a3_run_units.sh` (existing 18 suites +
  v3.2.1 regression suite) + new v4 regression tests (tokens present, mini window flags,
  Aurora Line isolation preserved — PillSeek still the only progress subscriber).
- Headless packaged smoke via CDP (Xvfb) — interactive time, console errors, idle RSS,
  3.2.1 vs 4.0.0 same-method comparison.
- asar size + AppImage size as the installer-size proxy on Linux (NSIS/Windows: not
  producible here — documented limitation, command provided).
- Theme/appearance coverage: every theme identity in both modes via the smoke harness
  boot + manual checklist for Windows (documented).
- Manual-on-Windows checklist: installer build, SMTC, thumbar, mini black-frame
  verification on real DWM, drag-drop gestures, audio listening pass.

## 5. Version & release

- `package.json` → 4.0.0; artifact name already templated (`Aura.Player.Setup-4.0.0.exe`);
  README version-history entry; `RELEASE_NOTES_v4.0.0.md`; this document.
- Final deliverable: verified `Aura_Player_4.0.0.tar.gz` (source, no node_modules/build
  output/secrets), extracted-and-rebuilt verification, separate reporting of archive vs
  installer size.

---

## 6. Outcome record (as-shipped)

All six slices implemented on `feat/4.0.0`:

| Slice | Status | Evidence |
|---|---|---|
| S1 Foundation | done | `tokens.css` material block (dark + light), `index.css` mica wall + `.acrylic` + Aurora Line classes |
| S2 Shell | done | PlayerBar acrylic + Aurora Line + persistent timestamps; Sidebar captions + accent pill outline; MiniApp acrylic capsule; `main.cjs` window fixes (`backgroundColor '#00000000'`, `thickFrame: false`, 464×116) |
| S3 Home/Welcome | done | Library hero (aurora underline, lifetime time), Continue-listening row (lastPlayed aggregates), FirstLaunch acrylic + one-shot bars |
| S4 Audio Studio | done | two-column console, `EqResponseCurve.tsx` (SVG from real band gains), `StudioSpectrum.tsx` (real analyser, mount-scoped rAF, perf-mode pause), FX card header fix |
| S5 Consistency | done | divergent chrome recipes normalized (grep `padding-box` → index.css only); flyout panels already token-coherent, left as-is |
| S6 Perf & release | done | metrics below; version 4.0.0; `v400_redesign.test.ts` (10 contracts, suite 20/20) |

Measured before/after (same machine, same harness):

- Renderer assets 879,157 → 890,400 B (+1.3%); asar 1,658,812 → 1,670,826 B (+0.7%);
  AppImage 89,876,323 → 89,880,450 B (+0.005%).
- Headless packaged smoke n=3: interactive median 304.5 → 282.5 ms (noise), idle RSS
  446.8 → 448.8 MB (noise), 0 console errors in every run, 5 Electron processes.
- Visual verification (packaged, Xvfb + CDP screenshots via `scripts/v400_visual_check.mjs`):
  welcome, library dark+light, Audio Studio console, mini player — all rendered as designed;
  two defects found and fixed during review (brand-bar heights, FX-card header squeeze).

Honest limitations (unchanged from 3.2.1 practice): no Windows host here — NSIS installer,
SMTC/thumbar, real-DWM mini frame check, drag-drop gestures and the audio listening pass
remain manual on Windows; all runtime numbers are Linux/headless (regression-grade, not
Windows-representative).
