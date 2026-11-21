# Mini Player — Liquid Glass Implementation (v3.3.1)

The desktop Mini Player was redesigned around a **dedicated, theme-independent
Liquid Glass visual system** with a matte fallback, controlled by a new
persistent Settings toggle. This document records the architecture, the visual
system, the verification results and the known limitations.

## 1. What the Mini Player is (architecture retained)

The widget is a **separate frameless Tauri window** (declared in `src-tauri/tauri.conf.json` as the `mini` window label, URL `mini.html` → `src/mini/main.tsx` → `src/mini/MiniApp.tsx`). It shares nothing with the main renderer's React tree:

```
main window --('mini:state' snapshots)--> Rust event --relay--> mini window
mini window --('mini:action')----------> Rust event --'media:command'--> main renderer
```

Everything from v2.1.2/v3.2.0 is preserved: auto-show on minimize (explicitly
opened widgets survive the cycle), close-button hides only the widget,
always-on-top floating, `skipTaskbar`, keyboard focusability, seek + volume
mirroring, the sender-validated `mini:state` relay, duplicate-window guarding
(`createMiniWindow` reuses the live instance), and position persistence
(`mini-bounds.json`, debounced writes, display-validity check with a safe
fallback anchor). The window was **already** `frame: false, transparent: true,
hasShadow: false` — the card has always painted its own rounded silhouette and
CSS shadow inside the window bounds, so there is no native frame and no double
shadow to fight. **No Electron main-process code needed to change.**

Native blur materials (`backgroundMaterial: 'acrylic'` / mica) were evaluated
and **rejected**: they are Windows-11-only, fill the full window rectangle
(square corners, conflicting with the 20 px card radius), and are incompatible
with `transparent: true`. The CSS glass below achieves the intended look with
zero platform hacks and degrades gracefully.

## 2. The visual system (`src/styles/mini.css`)

A fixed neutral design language that **consumes none of the Theme Engine's
tokens** — no `--surface-*`, `--border-*`, `--accent-*`, `--text-*`, `--glass-*`
variables — so the widget renders identically under all ten themes (aurora,
ember, abyss, vector, nebula, verdant, obsidian, solstice, cryo, sakura).
Switching the app theme changes only the document-level `data-*` attributes
(kept for native-control coherence); the computed surface signature of the
card is provably unchanged (see §5).

* **Glass mode (default)** — layered surface: top sheen gradient + bottom
  refraction darkening + neutral translucent body `rgba(21,23,29,0.62)` +
  gradient hairline edge on a 1 px transparent border (the edge is the
  gradient — there is no visible rectangular frame). `backdrop-filter:
  blur(26px) saturate(1.45)`; specular inner highlights; one static diagonal
  light streak; painted drop shadow `0 14px 40px`.
* **Artwork ambient glow** — the actual cover art, blown out and blurred
  (`blur(46px)`), sits behind the card inside a rounded clipped layer, so the
  backdrop-filter frosts genuine, track-reactive depth. This is an artwork
  input, not a theme input. A neutral gradient floor keeps the glass
  convincing with no artwork. Static — rasterized once per track change.
* **Matte mode (fallback)** — same layout on a near-opaque neutral panel
  (`#24262E → #1B1D24`), no backdrop blur, no glow layer (removed from the
  DOM), softer shadow.
* **Layout (one primary layout, both modes)** — 56 px artwork with progress
  ring + hover play, truncating title/artist, seek bar with elapsed/remaining
  times, previous / play / next (white disc primary key), volume + mute,
  restore, close. The existing next-up hover preview now takes over the
  **artist slot** on hover (it can no longer collide with the seek row).
  Transport buttons disable honestly when nothing is queued.
* **Interaction** — the whole card is the drag region (`-webkit-app-region:
  drag`); artwork, transport, seek, volume, next-up and window buttons opt out
  with `no-drag`. Focus-visible rings, `role="slider"` seek semantics,
  aria-labels and tooltips follow the app's existing conventions.
* **Performance Mode** (app-wide) — rides the snapshot as `perf`; the widget
  sets `data-performance` on its root exactly like the main window: blur
  stripped onto a **fixed neutral** solid surface (deliberately not
  `var(--surface-solid)`, which would leak the theme), glow layer
  `display: none`.
* **Reduced motion** — a `prefers-reduced-motion` block kills every
  transition the widget declares; no animation runs at steady state in any
  mode.

## 3. Settings toggle

**Label:** `Liquid Glass Mini Player` — in **Settings → Appearance** (below
Ambient Visuals), using the existing `SettingRow` + `Toggle` components.

* **Single source of truth:** `playerStore.miniLiquidGlass` (default **true** —
  the widget is designed glass-first), persisted through the store's existing
  idbStorage persistence (`partialize`), so it survives restarts and needs no
  new storage.
* **Transport to the widget:** the flag rides every `mini:state` snapshot as
  `liquidGlass` (plus `perf` for Performance Mode). The bridge subscribes to
  `playerStore`, so a Settings flip applies to an open widget **instantly** —
  no close/reopen. `undefined` (stale sender) resolves to glass ON
  deterministically.
* **Visual mode only:** toggling never touches playback, the queue, volume,
  or widget visibility. A stale pre-upgrade snapshot cannot disable the widget.
* Both modes are wired through the same component tree — one layout, no
  remount, a ≤250 ms background/opacity cross-fade.

## 4. Files

| File | Change |
| --- | --- |
| `src/styles/mini.css` | **new** — the fixed neutral Liquid Glass system (mini document only) |
| `src/mini/MiniApp.tsx` | redesigned visuals; `liquidGlass`/`perf` snapshot fields; `data-mini-mode` probe hook; Performance Mode attribute; honest disabled transport |
| `src/mini/main.tsx` | imports `mini.css`; updated entry contract docs |
| `src/hooks/useMiniPlayerBridge.ts` | snapshot carries `liquidGlass` + `perf`; `playerStore` subscription for instant live apply (dedupe preserved) |
| `src/store/playerStore.ts` | `miniLiquidGlass` state + setter + persistence (single source of truth) |
| `src/pages/Settings.tsx` | the `Liquid Glass Mini Player` row in Appearance |
| `scripts/a34_mini_glass.test.ts` | store/Settings/CSS contract unit tests |
| `src-tauri/src/lib.rs` | mini player commands (mini_seek, mini_set_volume, mini_action) |

Tauri window management, playback/audio/IPC internals: implemented via `src-tauri/src/lib.rs` and `src/services/tauriLibrary.ts`.

## 5. Verification (actual results, Aura 3.3.1 baseline)

| Check | Command | Result |
| --- | --- | --- |
| Types | `npx tsc -b --force` | PASS (rc 0) |
| Production build | `npx vite build` | PASS — main 247.72 kB (gzip 74.57), mini css 6.99 kB |
| Unit suites | `bash scripts/a3_run_units.sh` | 21/21 PASS (incl. new `a34_mini_glass.test.ts`) |
| Liquid Glass runtime (Tauri) | Host-dependent; WebView2 UI not accessible via UIA in validation host | Not observable |
| App smoke regression | Host-dependent | Not observable |
| Theme Engine runtime regression | Host-dependent | Not observable |
| Theme independence (runtime) | Host-dependent | Not observable |
| Live toggle / persistence | Host-dependent | Not observable |
| Installer build | `cargo build --release` + Tauri bundler | PASS — MSI and NSIS generated |

## 6. Known limitations

1. **`backdrop-filter` frosts page content, not the OS desktop.** The window
   itself is transparent, so the desktop shows through the translucent card
   *sharply* (with the dark neutral tint over it); the *blur* applies to the
   artwork glow layer and anything else in the widget's own compositing. True
   OS-level acrylic/mica was rejected as fragile (§1). The design compensates
   with the tinted body + glow so the glass reads correctly on any wallpaper.
2. **Windows-specific items are unverified in this environment** (Linux CI):
   real-GPU transparency/rounded-corner composition, native dragging feel,
   DWM shadow interplay, and the Windows installer target. The window flags
   involved are unchanged from v2.1.2, which shipped those paths.
3. **First-frame mode flash:** for a matte user, a freshly *created* widget
   window may paint glass for up to ~250 ms before the first snapshot lands
   (the bridge's boot-race grace window). Subsequent opens are instant.
4. **Size semantics:** the widget is fixed-size by design (460×112); saved
   position is restored and display-validated, size is constant. Dragging and
   out-of-range-bounds recovery were not re-tested in this pass (unchanged
   Phase 13 mechanism).
5. **Electron's Chromium `:has()` support** is required (present in the
   bundled runtime); the artist/next-up slot swap degrades to "both visible"
   on engines without it.
