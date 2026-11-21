# Aura Player — Theme Engine & Design System Implementation

Status: **COMPLETE — ten themes (original five + the five-theme expansion),
refined emblems, improved Ember; implemented, verified, and packaged.**
Version line: the shipped `package.json` stays `3.2.1` (no version bump was
requested); the engine itself is annotated `v3.3` in code comments as the
design-system generation it introduces.

> **Expansion note (final phase):** this document originally covered the
> five-theme engine. Sections marked *(expansion)* describe the second
> delivery wave: five additional themes (Verdant, Obsidian, Solstice, Cryo,
> Sakura), the bespoke theme-emblem set, and the Ember visual refinement.
> Architecture, persistence, migration and accessibility behavior are
> unchanged by the expansion — the new themes ride the same registry,
> engine, and CSS identity-block contract.

---

## 1. Stage 0 — Repository audit findings

### 1.1 What the repository actually is

| Item | Finding |
|---|---|
| Stack | Electron 42.5.0 + React 19 + Vite 8 + TypeScript ~6.0 + Zustand 5 + Tailwind v4 + framer-motion (no Tauri/Wails anywhere) |
| Package version | `3.2.1` (`package.json`), git branch `opt/3.2.1` with history (baseline tag `v3.2.0-baseline` on `main`) |
| Renderer entries | `src/main.tsx` (main window) and `src/mini/main.tsx` (Mini Player widget window, `mini.html`) |
| Styling architecture | Three-layer CSS custom-property system: `src/styles/tokens.css` (primitives → semantic → accent aliases), `src/styles/themes.css` (per-identity remaps), `src/index.css` (Tailwind `@theme` wiring + shared utilities) |
| Theme model BEFORE | Two orthogonal axes: `data-theme='dark'|'light'` (appearance foundation) × `data-aura-theme='<id>'` (color identity). 12 identity presets in `src/lib/themePresets.ts` (accent hex only) + `styles/themes.css` (ink tints, ambient cloud, secondary accent). A `custom` id removed the attribute and used a user-picked accent |
| Accent pipeline | `useDynamicTheme` derives `--color-dynamic-1/2/3/glow` + `--text-on-accent` from the preset hex OR the dominant color of album art (Now Playing / playlist views); writes them as inline styles on `<html>` |
| State & persistence | `playerStore` (Zustand persist → IndexedDB via `idbStorage`, custom `merge` on rehydrate); persisted `theme`, `customAccentColor`, `appearance` |
| Mini Player theming | Separate BrowserWindow; receives appearance + theme id + resolved accent vars via a 250 ms snapshot push (`useMiniPlayerBridge`), applied them itself |
| Tests present | 19 node/tsx unit suites (`scripts/a3_run_units.sh`), Playwright runtime probes, WCAG contrast evidence script (`a32_contrast_check.mjs`), real-Electron smoke probe (`a32_smoke_probe.py`) |

### 1.2 Baseline (measured on this machine, Node 24.21 / npm 11)

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc -b` | PASS (rc 0) |
| Production build | `npm run build` | PASS — 535 ms; `main` chunk 247.37 kB (gzip 74.38 kB); CSS 67.12 kB (gzip 12.92 kB) |
| Unit suites | `bash scripts/a3_run_units.sh` | 19/19 PASS |

### 1.3 Gaps identified (what "a collection of CSS overrides" was missing)

1. The 12 presets were **accent-color variants** — each remapped only the ink
   tint, ambient cloud and a secondary accent. No per-theme decorative
   treatment, surface personality, shadow tint, or typography identity.
2. No typed theme **registry with complete definitions** — the accent hex list
   (`themePresets.ts`) and the CSS identity blocks (`themes.css`) were two
   parallel sources keyed by the same ids, with no compile-time link and no
   drift guard.
3. Stored ids were trusted as-is on rehydrate (no validation/fallback).
4. The Dark/Light toggle was a primary selection model independent of identity.

### 1.4 Material discrepancies found during the audit

- The uploaded tree matches the spec's description exactly; no blocker.
- `scripts/a3_theme_test.py` contained a stale absolute path from an older
  workspace and tested the legacy 8-preset UI (see §9 for how it was handled).
- `package-lock.json` carried a stale `version: 3.2.0` field; `npm install`
  synced it to the real `3.2.1` (kept — correctness fix, zero dependency churn).

---

## 2. Final architecture

### 2.1 Theme Engine layers (`src/theme/`)

```
src/theme/
  types.ts      — NamedThemeId / ThemeId unions, AuraTheme interface,
                  compile-time completeness contract (Record<NamedThemeId,…>)
  registry.ts   — THE source of truth: five named themes + custom (accents,
                  labels, descriptions, designed brightness, Settings swatches),
                  legacy-id migration map, resolveThemeId()/themeAppearance()/
                  getTheme()/THEME_LIST helpers
  engine.ts     — applyThemeToDocument(): the ONE DOM write path
                  (data-aura-theme + data-theme), used by BOTH windows
```

Rendering layers (extended, not replaced):

```
src/styles/tokens.css   — three-layer token foundation (kept intact)
src/styles/themes.css   — rewritten: five complete identity blocks
                          (ink scale, cloud, accent-2, chrome tint, shadow
                          tint, border temperature, decorative recipe) +
                          Ember/Vector light-paper systems
src/index.css           — .theme-deco element contract (static, z-index -1,
                          pointer-events none, animation-free)
```

Accent flow (unchanged pipeline, new source): registry accent hex →
`useDynamicTheme` → `--color-dynamic-*` → `--accent` aliases. Custom accent
colors, Now Playing artwork-ambient and playlist covers keep working exactly
as before (same `colorToVars` derivation, same artwork cache, same adaptive
`onAccentInk`).

### 2.2 The ten themes (shipped)

**Original wave:**

| id | Identity | Brightness | Palette | Signature decor (static, blur-free) |
|---|---|---|---|---|
| `aurora` | Northern lights, atmospheric depth (default) | dark | boreal green `#35D0A5` · turquoise `#67DCD0` · violet in decor only | 3 soft radial fields + a 3-stroke SVG ribbon sweeping the top; mint-tinted chrome/borders; pine-tinted shadows |
| `ember` | Warm editorial paper, firelight | **light** | deep parchment `#F6EEDF` · copper `#C4703B` · burgundy `#9C4A52` | refined firelight composition: SVG feTurbulence paper grain + copper top-right light, burgundy floor, dark hearth ledge, static heat-ripple arcs; serif display headings; warm ink ladder + deep firelight shadows |
| `abyss` | Ocean depths | dark (deepest) | navy ink `#050912…#112140` · teal `#31BFCB` · turquoise `#63D8E8` | SVG light shafts falling from the surface + depth gradient on the floor; ice-blue borders; trench shadows |
| `vector` | Technical precision | **light** | silver `#EFF1F4` paper · graphite ink · cobalt `#2B5BD7` | CSS blueprint grid (28 px + 112 px layers, mask-faded to the floor); tighter radii (6/10/14/18); wider caps tracking; crisper hairlines; machined shadows |
| `nebula` | Cosmic clouds | dark | violet `#A866DC` · coral `#EF8E70` · gold in decor only | violet/coral/gold washes + a sparse SVG star field (10 stars + 2 glints per 260 px tile); lavender borders; void shadows |

**Expansion wave *(expansion)*:**

| id | Identity | Brightness | Palette | Signature decor (static, blur-free) |
|---|---|---|---|---|
| `verdant` | Deep forest, botanical canopy | dark | emerald `#3FBE7E` · moss/sage cloud `#9CC5A5` · restrained warm gold `#C9A45C` (accent-2 + decor only) | canopy-light field from the top-left, one gold light shaft, mossy floor wash, SVG branch with leaf silhouettes along the top; sage borders, loam shadows. True green family — NOT an Aurora recolor (Aurora keeps the flowing multicolor teal/violet atmosphere) |
| `obsidian` | Refined dark stone, metallic depth | dark (neutral) | obsidian/charcoal ink `#090A0C…#1A1E24` · silver primary `#C6CDD9` · pewter secondary `#98A2B3` | cold metallic sheen sweep, large static SVG facet planes (2–4% white) + facet-edge highlights, void floor; mask-faded toward the bottom; silver borders, hue-less shadows. Material depth, vs Vector's drawn structure on light paper |
| `solstice` | Golden hour, sunset horizons | **light** | sunlit paper `#FAF1DC` · amber `#D98E2B` · coral `#D96349` · gold cloud `#F2CD88` | pure-CSS sun disc glow + warm atmospheric wash + coral horizon band low in the frame; amber ink ladder; no grain (Solstice is light in the air, not material) — clearly distinct from Ember's parchment-and-copper editorial voice |
| `cryo` | Ice, glaciers, crystalline clarity | **light** | ice paper `#ECF3F8` · glacial cyan `#4AAAD1` · deep blue `#2C5E96` · ice-mist cloud `#B5D9EA` | frozen diagonal sheen, deep glacial floor wash, static SVG hexagonal crystal cluster (top-right); mask-faded toward the bottom. Genuinely bright/cold — not a blue dark theme |
| `sakura` | Cherry blossoms, refined floral | **light** | petal paper `#F9F2F1` · blossom pink `#D97A96` · burgundy-plum `#8E4A5F` · plum-charcoal ink | blush corner washes + sparse SVG blossom sprays and drifting petals (upper half only, mask-faded); serif display; strong plum-on-paper text contrast keeps it refined, never all-pink |

The lineup is balanced **5 dark / 5 light**. `custom` is retained: the
user-picked accent over the neutral base identity,
exactly the historical behavior — including preserving the user's current
appearance (pre-migration custom+light users keep their light paper).

Every theme additionally owns: `--surface-chrome` tint + opaque
`--color-chrome-solid` (menu carets), the full shadow ladder (hue-tinted),
border temperature (4 steps), and the ambient cloud family. The design keeps
"themes are not five app versions": zero component branches exist anywhere —
components read semantic tokens only.

### 2.3 Selection, persistence, migration

- **Primary model:** the named themes, selected in the existing Settings →
  Appearance location (same row, upgraded picker with identity swatch tiles,
  hover/active/check states, title tooltips). No new page, no gallery.
- **Brightness is a designed property of each theme.** The standalone
  Dark/Light toggle is retired from Settings (spec: it should no longer remain
  the primary selection model). `data-theme` is now DERIVED from the registry.
- **Command palette** keeps a brightness jump: "Theme — switch to <label>"
  jumps to the last-used theme of the other brightness (session memory in
  `lib/appearance.ts`); with `custom` selected it flips the raw appearance as
  before.
- **Validation:** `resolveThemeId()` runs on EVERY path — `setTheme` setter
  and the persist `merge` on rehydrate. Unknown/corrupt ids → default theme.
  Never throws.
- **Legacy migration map** (Theme System 3.0 → Theme Engine), brightness-aware
  with one documented exception:

| Legacy id | persisted dark → | persisted light → |
|---|---|---|
| `aurora` | `aurora` | `aurora` *(id collision with the new flagship — identity wins, see §5)* |
| `forest` | `aurora` | `vector` |
| `ocean`, `cyan`, `indigo` | `abyss` | `vector` |
| `amethyst`, `orchid` | `nebula` | `vector` |
| `sunset`, `crimson`, `champagne` | `nebula` | `ember` |
| `default`, `mono` | `aurora` | `vector` |
| `custom` | `custom` (accent color preserved) | `custom` (appearance preserved) |

  Invariant: no legacy user crosses the brightness line (light users land on
  Ember/Vector only; dark users on dark themes only) — enforced by a unit test.

### 2.4 Mini Player

The widget keeps receiving `theme` + derived `appearance` + resolved accent
vars through the existing 250 ms bridge snapshot, and now applies them through
the SAME `applyThemeToDocument()` engine function as the main window, so the
two surfaces can never disagree. Wire format (`MiniState`) is unchanged — no
protocol migration needed. (The widget renders no decorative layer: it is a
compact surface where the identity comes from tokens + accent lighting.)

### 2.5 How to add a future theme

1. Add the id to `NamedThemeId` in `src/theme/types.ts`.
2. Add its `AuraTheme` entry to `THEMES` in `src/theme/registry.ts` — the
   `Record<NamedThemeId, …>` typing makes a missing entry a compile error.
3. Add the `[data-aura-theme='<id>']` identity block and the
   `[data-aura-theme='<id>'] .theme-deco` recipe in `src/styles/themes.css`.
4. Add an emblem entry in `src/theme/icons.tsx` (`EMBLEMS` record — see
   §3.1). The Settings picker renders `THEME_LIST`, so it appears
   automatically; the emblem test in `scripts/a33_theme_engine.test.ts`
   fails if the entry is missing.
5. `scripts/a33_theme_engine.test.ts` enforces registry↔CSS completeness
   (block presence, ink/cloud/accent-2 ownership, decor recipe, legacy-block
   removal) — run it, then the runtime probe.

---

## 3. Asset strategy & conventions (Stage 3)

- **CSS** owns everything that can be generated: gradients, washes, the
  Vector blueprint grid, depth gradients. Pre-softened (no `filter: blur()`),
  so Performance Mode needs no special-casing.
- **SVG** is used as inline `data:image/svg+xml` URIs inside themes.css
  (aurora ribbon ~1.4 kB, ember grain + heat-ripple arcs ~1.1 kB, abyss
  shafts ~0.7 kB, nebula stars ~0.9 kB, verdant branch ~1.1 kB, obsidian
  facets ~0.7 kB, cryo crystals ~0.8 kB, sakura blossoms ~1.2 kB): zero
  network requests, no build asset pipeline, available in dev / packaged /
  every window, and they cannot 404. All under 2 kB.
- **Local raster images: none** — no theme needed them materially; avoiding
  them keeps the app free of large assets and remote requests (spec §3).
- Graceful degradation: decor layers sit behind content on `z-index: -1` with
  `pointer-events: none`; a missing/failed SVG layer degrades to the gradient
  layers underneath; a missing `.theme-deco` element (mini player) simply
  renders nothing. Decor can never affect layout or interaction.
- No remote image dependencies anywhere in the theme system.

### 3.1 Theme emblems (Settings picker icons) *(expansion)*

`src/theme/icons.tsx` holds one bespoke SVG emblem per theme (ten named +
Custom), replacing the generic lucide glyphs used by the first delivery.
Conventions — enforced by review and by the emblem unit test:

- **One shared visual language:** 24×24 grid, drawn centered on (12,12),
  1.75 stroke weight, round caps/joins (matching the app's lucide defaults),
  monochrome `currentColor`. The themed swatch gradient tile behind the
  emblem carries the color identity; the emblem carries the shape identity.
- **Identity-first shapes:** aurora = flowing ribbon curtains; ember = flame
  with lit inner tongue; abyss = three surface waves receding with depth;
  vector = construction plate + node circle + cross; nebula = orbital ring +
  core + companion stars; verdant = leaf with midrib and paired veins;
  obsidian = faceted stone silhouette; solstice = sun over horizon with
  rays; cryo = hexagonal ice crystal; sakura = five-petal blossom with
  stamen dots; custom = tuning sliders (the kept convention for the
  user-tuned accent).
- **No emoji, no stock placeholders, no icon-library glyphs** for theme
  identity (the unit test fails the build if `icons.tsx` imports one).
- **Legible at the real size** (13 px inside the 28 px picker tile): shapes
  are verified visually at 3× device scale (`scripts/a33_picker_closeup.py`)
  and carry a one-time static drop-shadow for pale tiles — no runtime cost.
- **Selection never relies on color alone:** the picker shows the check
  glyph + `aria-pressed` on the selected theme.
- Plain inline SVG components — zero new dependencies, resolution-
  independent, theme-agnostic (the emblem never changes with the theme's
  own palette).

---

## 4. Motion, accessibility, performance (Stage 4)

- **Static decor contract:** the decorative layer has NO animation in any
  state (boot, switch, steady). This is deliberate and measured — see §7.
  Theme switches cross-fade through the existing `.theme-anim` window
  (color/background/border/fill/box-shadow only); the low-alpha decor swap
  beneath it reads as part of that fade.
- **prefers-reduced-motion:** all existing app-wide guarantees are preserved
  (skeleton shimmer, breathing, gel press, aurora rim, framer-motion
  `MotionConfig reducedMotion="user"`). The theme system adds no new motion.
- **Performance Mode / Ambient off:** both pre-existing switches keep working
  unchanged; the decor layer is gradient/SVG-static, so Performance Mode needs
  no rules for it (no blur to disable). All five themes remain visually
  complete with decorations hidden — identity carries through tokens.
- **No React cost:** theme application is two attribute writes + the dynamic
  accent effect (which existed before). No remounts, no context churn, no
  repeated DOM mutations; switching themes does not re-render the library.
- **Contrast:** WCAG evidence extended (`a32_contrast_check.mjs`) — see §8.
- **Dependencies added: none.**

### 4.1 Software-rendering stability (important implementation decision)

During real-Electron verification under Xvfb/llvmpipe, two renderer-wedge
modes were discovered, root-caused, and designed out:

1. A **boot-time** full-viewport opacity animation on the decor layer
   (initial design) wedged the renderer during first paint (continuous
   re-composite colliding with the SharedImage pipeline; `SharedImageManager::
   ProduceMemory` error storm; CDP evals never returning).
   Fix: the layer paints statically at boot.
2. A fade **scoped to the switch window** was still canceled mid-flight when
   the 850 ms window closed (600 ms fade < window), and that cancel + full
   repaint also wedged software-rendered sessions (deterministic hang on the
   Settings page after one UI theme click).
   Fix: the decor layer is animation-free in every state. The token cross-fade
   (which existed in 3.2.x) remains the only switch animation — this is also
   strictly cheaper and matches the "no continuous animations" requirement.

Verification: pristine baseline 3/3 clean boots; theme-engine build 4/5 wedged
before the fix; **6/6 clean boots + full 32/32 smoke pass after the fix.**

---

## 5. Design decisions & trade-offs

1. **Dark/Light toggle retired** (replaced by per-theme designed brightness).
   Rationale: the spec names brightness as a property of genuinely different
   themes; keeping a second axis would have required ten designed variants
   (5 themes × 2 appearances) and diluted each identity. Migration preserves
   the user's brightness (light → Ember/Vector by hue temperature; dark →
   hue family). `appearance` remains in state and on the mini wire (derived),
   so nothing downstream breaks.
2. **`aurora` id collision:** the legacy boreal preset and the new flagship
   share the id. Modern-id resolution wins, so a legacy `aurora`+light user
   lands on the new dark Aurora (identity preserved, brightness changes) —
   the ONE documented exception to the brightness invariant. The alternative
   (map it to a differently-named theme) would silently move the user away
   from the theme they named.
3. **`custom` keeps its historical meaning** (user accent over the neutral
   base) and additionally preserves the current appearance, so existing
   custom+light users see no change.
4. **Registry accents flow through the EXISTING dynamic pipeline** rather than
   a new one — artwork ambient, custom accents, playlist covers and the
   adaptive on-accent ink keep their tested behavior.
5. **The old 12 CSS identity blocks were removed** (not kept alongside): the
   named system replaces them, migration happens at the state layer, and
   `resolveThemeId` guarantees no stale id can reach the DOM. A unit test
   asserts the legacy blocks stay gone.

---

## 6. Changed files

### Original engine delivery

**New**
- `src/theme/types.ts`, `src/theme/registry.ts`, `src/theme/engine.ts` — the engine
- `scripts/a33_theme_engine.test.ts` — unit suite (registry completeness,
  registry↔CSS drift guard, migration invariant, fallback, store integration)
- `scripts/a33_theme_runtime_test.py` — Playwright runtime suite (now 48 checks)
- `scripts/a33_theme_shots.py` — visual screenshot harness (matches the repo's
  existing `*_shots.py` conventions)
- `docs/THEME_ENGINE_IMPLEMENTATION.md` — this document

**Modified**
- `src/styles/themes.css` — rewritten: identity blocks + decor recipes
- `src/index.css` — `.theme-deco` contract (+30 lines; everything else intact)
- `src/store/playerStore.ts` — `ThemeId` typing, validating `setTheme`,
  rehydrate migration in `merge`
- `src/hooks/useDynamicTheme.ts` — accents sourced from the registry; artwork
  logic byte-identical; catch-path fallback made custom-aware
- `src/lib/appearance.ts` — `setThemeAnimated` + brightness-jump helpers
- `src/App.tsx` — one engine effect replaces two legacy effects; deco element
- `src/pages/Settings.tsx` — registry-driven picker with swatch tiles; Light
  mode row removed; `data-theme-picker` test hook
- `src/components/CommandPalette.tsx` — brightness-jump command
- `src/mini/MiniApp.tsx` — theme application via the shared engine function
- `scripts/a32_contrast_check.mjs` — registry-sourced accent checks + the
  light-identity ink ladders
- `scripts/a32_smoke_probe.py` — theme sections updated to the named system;
  robustness: longer CDP eval/poll budgets for cold llvmpipe boots
- `scripts/v32_studio.test.ts` — theme assertions updated to the registry
- `scripts/a3_run_units.sh` — registers the new unit suite
- `scripts/a3_theme_test.py` — converted to a compatibility shim (preserves
  the MOCK/SEED harness blocks that `a3_w10/w11/w12/w13_test.py` source from
  this file BY NAME; executing it runs the current engine suite)
- `package-lock.json` — version field sync 3.2.0 → 3.2.1 (no dependency churn)

**Deleted**
- `src/lib/themePresets.ts` — superseded by `src/theme/registry.ts`

### Expansion delivery *(expansion)*

**New**
- `src/theme/icons.tsx` — the bespoke theme-emblem set (11 entries: ten named
  themes + Custom; plain inline SVG, no icon-library dependency)
- `scripts/a33_picker_closeup.py` — 3× device-scale close-up harness used to
  review the emblems at their real rendered size

**Modified**
- `src/theme/types.ts` — `NamedThemeId` widened to ten ids (the
  `Record<NamedThemeId,…>` contract forced every downstream switch)
- `src/theme/registry.ts` — five new `AuraTheme` entries (verdant, obsidian,
  solstice, cryo, sakura) + `THEME_LIST` order (original five → expansion →
  Custom)
- `src/styles/themes.css` — five new identity blocks + five new static
  blur-free decorative recipes; Ember block and recipe refined (deeper
  parchment base `#F6EEDF`, copper-tinted hairlines with a heavier emphasis
  step, deeper firelight shadows, hearth-ledge gradient + heat-ripple arcs,
  stronger surface-state hierarchy)
- `src/pages/Settings.tsx` — picker renders the bespoke `ThemeIcon` emblems
  (lucide glyphs removed from theme identity); description text updated to
  ten identities
- `scripts/a33_theme_engine.test.ts` — counts/ladders updated to ten themes;
  new emblem-completeness test (every id has an `EMBLEMS` entry; no icon-
  library import)
- `scripts/a32_contrast_check.mjs` — new dark `ink700` cards (verdant,
  obsidian), new light cards (solstice, cryo, sakura), three new ink ladders,
  Ember paper values synced
- `scripts/a33_theme_runtime_test.py` — extended to ten themes (identity +
  designed brightness per theme), repeated contrast-switching guard,
  expansion-theme persistence check (48 checks total)
- `scripts/a32_smoke_probe.py` — expansion coverage: Cryo via a real picker
  click + verdant/obsidian/solstice/sakura identity-attr resolution (38
  checks total)
- `scripts/a33_theme_shots.py` — ten-theme screenshot pass
- `scripts/v32_studio.test.ts` — registry lineup assertions updated to the
  ten-theme registry

**Not modified:** README.md and every other README; `src/styles/tokens.css`
(foundation kept intact); all pages (Library/Explore/NowPlaying/Studio/etc.);
`src-tauri/`; the audio/playback/IPC stack.

---

## 7. Validation — commands and ACTUAL results

### Original engine delivery

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc -b` | PASS (rc 0) |
| Production build | `npm run build` | PASS — 566 ms; `main` 247.65 kB (gzip 74.54 kB; baseline 247.37/74.38 → +0.16 kB); CSS 70.91 kB (gzip 14.15 kB; baseline 67.12/12.92 → +1.2 kB gzip — the five identity blocks + decor recipes) |
| Unit suites | `bash scripts/a3_run_units.sh` | **20/20 PASS** (19 pre-existing + new `a33_theme_engine`) |
| Contrast evidence | `node scripts/a32_contrast_check.mjs` | PASS — all foundation checks + 5 accent pairs (3.67–9.67:1, each ≥3 with its adaptive ink) + Ember/Vector ladders (secondary/tertiary ≥4.5 over card AND page; faint ≥3.0) |
| Theme runtime (Playwright, production build) | `python3 scripts/a33_theme_runtime_test.py` | 30/30 PASS (original five-theme scope) |
| Real-Electron smoke (Xvfb, `--disable-gpu`) | `xvfb-run python3 scripts/a32_smoke_probe.py` | 32/32 PASS (pre-expansion scope) |
| Boot-stability probe (fresh profile × N) | `/home/z/my-project/scripts/wedge_test.sh` | baseline 3/3 OK; pre-fix engine build 4/5 wedged; post-fix 6/6 OK |
| Visual review | `python3 scripts/a33_theme_shots.py` | 10 screenshots (Library + Settings × 5 themes) reviewed; five distinct, intentional identities confirmed |

### Expansion delivery (final — measured on this machine, Node 24 / npm 11)

| Check | Command | Result |
|---|---|---|
| Baseline before expansion (post-engine tree) | `npx tsc -b` / `npm run build` / units / contrast | tsc PASS; build 607 ms (main 247.65 kB / gzip 74.54; CSS 70.91 kB / gzip 14.15); units 20/20; contrast PASS — recorded before any expansion edit |
| Type check (final) | `npx tsc -b` | PASS (rc 0) |
| Production build (final) | `npm run build` | PASS — 632 ms; `main` **247.65 kB (gzip 74.54 — byte-equal size to baseline: emblems are tree-shaken into lazy chunks)**; CSS **80.27 kB (gzip 16.15; +2.0 kB gzip for five identity blocks + five decorative recipes)** |
| Unit suites (final) | `bash scripts/a3_run_units.sh` | **20/20 PASS** (incl. updated `a33_theme_engine` 10/10 with the emblem test, updated `v32_studio`) |
| Contrast evidence (final) | `node scripts/a32_contrast_check.mjs` | PASS — **10/10 accent pairs** (3.67–11.85:1, each ≥3 with its adaptive on-accent ink) + **5/5 light ink ladders** (secondary/tertiary ≥4.5 over card AND page; faint ≥3.0; page is the binding background for the three new papers) |
| Theme runtime (Playwright, production build) | `python3 scripts/a33_theme_runtime_test.py` | **48/48 PASS** — picker renders 10+Custom; per-theme identity attr + designed brightness (10 themes); surface/accent-2 cascade remaps (≥8 distinct each, 10/10 observed distinct values); per-theme deco recipes; pointer-transparent decor; **repeated dark↔light contrast switching settles correctly ×3 cycles**; custom keeps appearance; persistence across reload for an original-wave (ember) AND an expansion-wave (cryo) id; legacy `ocean`+light → `vector`; invalid id → `aurora`; zero page errors |
| Real-Electron smoke (Xvfb `:99/:100`, llvmpipe, `--disable-gpu`) | `python3 scripts/a32_smoke_probe.py` | **38/38 PASS** — boot, playbar, sidebar, Audio Studio, Settings; **Nebula AND Cryo applied via real picker clicks**; adaptive on-accent ink; aurora/abyss/verdant/obsidian/solstice/sakura/vector identity-attr resolution; sidebar collapse both ways; Mini Player window lifecycle + widget DOM + theme tokens; Ember click flips `data-theme` to light; zero renderer console errors |
| Boot-stability probe (fresh profile × 3, expansion build) | `/home/z/my-project/scripts/wedge_test.sh` | **3/3 EVAL_OK** (no renderer wedge from the expanded CSS) |
| Switch-cost probe (all ten identities, Settings page, llvmpipe) | `/home/z/my-project/scripts/switch_measure.py` | setAttribute + computed-style read: **0.00–0.05 s per identity** (no regression vs 0.00–0.01 s pre-expansion; worst case imperceptible) |
| Rapid-switch stress (real Electron, llvmpipe) | `/home/z/my-project/scripts/switch_stress.py` | completed; renderer responsive throughout (no wedge) |
| Visual review | `python3 scripts/a33_theme_shots.py` + `scripts/a33_picker_closeup.py` | 20 screenshots (Library + Settings × 10 themes) + 1 3× picker close-up reviewed; ten distinct intentional identities; emblems coherent, aligned and legible at tile size; Ember visibly refined (deeper parchment, directional copper light, hearth ledge, ripple arcs) |

Environment note: `xvfb-run` is unavailable on the current machine
(missing `xauth`); the smoke probe ran under a manually started `Xvfb :99`
with the same `--disable-gpu` software-rendering conditions as the original
delivery — a harness difference, not an application one.

### Manually verified at the DOM level (not covered above)

- Command-palette brightness jump (session memory) — code-reviewed + type-checked;
  the palette itself is exercised by the smoke probe only for rendering paths.
- Mini player visual appearance per theme — the widget's theme application goes
  through the same engine function verified by the smoke probe (`mini theme
  tokens resolve`, window lifecycle); per-theme widget screenshots were not
  captured.

### Not performed (environment limitations)

- Windows runtime (SMTC, thumbar, NSIS installer) — no Windows host, as in the
  3.2.1 baseline report.
- `npm audit` — not run as part of this task; no dependencies were added.
- Playback of an actual audio file end-to-end: the environment has no audio
  output device; playback-critical code paths are UNCHANGED by this task
  (verified by diff: no `useAudio`, `audioFx`, `queueEngine`, crossfade, EQ or
  IPC files touched beyond the theme integration points listed in §6).

---

## 8. Known limitations

1. The decorative layers are static by design (see §4.1) — no animated
   background variants exist to disable; "Ambient Visuals" continues to govern
   the pre-existing artwork orbs / Aura Pulse layer.
2. `aurora` legacy-id brightness exception (§5.2) — one documented migration
   nuance, unit-tested. Legacy ids migrate to the ORIGINAL five themes only;
   the expansion wave is reachable by direct selection (intentional: legacy
   mappings were audited and keep their documented values).
3. Under software rendering (llvmpipe), first boots are slower in general
   (pre-existing baseline property); the probe harness now budgets for it.
4. The command palette brightness jump memory is session-only by design.
5. Screenshots under `scripts/shots_theme_engine/` are generated artifacts and
   excluded from the delivery archive; regenerate with
   `python3 scripts/a33_theme_shots.py` and `scripts/a33_picker_closeup.py`.
6. *(expansion)* The emblem drop-shadow is a static one-time raster for
   legibility on pale tiles; if a future theme uses a near-white swatch the
   emblem may need its per-tile contrast re-checked visually.
7. *(expansion)* Windows runtime (SMTC, thumbar, NSIS installer) remains
   untested — no Windows host in this environment (same as every prior
   delivery of this tree).
