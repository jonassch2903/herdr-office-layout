# Repository Guidelines

## Project Overview

`herdr-office-layout` is a self-contained layout package for the **Herdr** desktop app. It renders every coding agent as a pixel-art office worker: typing when working, jumping when blocked, dozing when done, and wandering when idle. Each Herdr space (project) gets a desk group on a colored rug; clicking focuses an agent or opens a new tab. Each worker gets an old-fashioned German name and shows its current task under the desk.

- **Not an npm project.** No `package.json`, lockfile, bundler, transpiler, TypeScript source, tests, or CI. The runtime implementation is two ES modules (~600 lines) plus a layout JSON and a vendored font.
- **Runtime:** the Herdr desktop app and its embedded **gpui-shell** JavaScript mod runtime (generated typings observed for gpui-shell 0.7.1). Node/Bun are not used.
- **Package manager:** none. Source is loaded directly as ES modules by Herdr.
- **Self-imposed contract:** the mod makes no network requests, runs no programs, and reads no files outside its own folder. Herdr does not sandbox mods, so this must be preserved by review.
- **Licensing:** code is MIT (`LICENSE`); the bundled font is CC BY-SA 4.0 and must keep `office/mods/office/fonts/LICENSE-PxPlus.txt`.

The authoritative visual/behavior spec is `office/RECIPE.md`. Read it before changing rendering, geometry, or animation.

## Architecture & Data Flow

One mod folder, `office/mods/office/`, is mounted **three times** by `office/layouts/office.json`:

| Layout block | Props | Mod behavior |
| --- | --- | --- |
| `office-floor` (fixed 400 px, `window_drag`) | none | Full office: simulation, room view, timer |
| `office-rail` (fixed 28 px) | `{role: "rail", demo, agent}` | Active space / tab strip and **Neuen einstellen**; `agent` names the program to start (`"omp"` here) |
| `office-desks` (`{tab: "active"}`) | pane frame | Herdr renders the tab's panes; each header is the mod with `{role: "pane"}` and host-injected `pane` |

The role gate is `if (props()?.role) return;` in `Office.init` (`main.js:100`). Any truthy role skips the retained room view and 250 ms timer; **the floor is the no-role fall-through**. Never add `role: "floor"` — it would skip simulation setup and render without `roomView`.

```mermaid
flowchart TD
  L[office.json] --> F[office-floor: no props]
  L --> R[office-rail: role rail]
  L --> P[office-desks: tab active]
  P --> H[pane header: role pane]
  F --> I[init: seed/state + cx.new(Room) + 250ms timer]
  I --> A[agents or DEMO] --> G[group contiguous agents by space]
  G --> FIT[fit rows/cols, derive k and s] --> GEO[seats, aisles, lanes]
  GEO --> T[tick: walk trips, thoughts, cat, door, minute]
  T --> N[cx.notify only when changed]
  N --> D[render: room, rugs, desks, labels, cat, workers, overlays, hover note]
```

**Floor pipeline (`main.js:332-440`):**

1. `list = props().demo ? DEMO : agents()`; the non-demo branch calls `setAgentOrder(addresses)` every render.
2. Group **contiguous** agents by `space`; each group gets a rug color from `hash(space) % RUGS.length`, bumped once if it equals the previous group.
3. `fit()` tries 2–6 rows and computes `k` (layout px per design unit), then snaps `s` (screen px per art pixel) to half-pixel steps: `s = max(1, floor(6k)/2)`, `k = s/3`.
4. Compute desk slots (170×190 at scale `k`, 60k gaps), seats, wall/aisle y-coordinates, and side/inter-group lanes into `this.geo`.
5. Detect new agent addresses and enqueue walk-in trips from the door; prune trips for departed agents.
6. Render retained room view → rugs → desks → labels → space tags → cat → workers → night/dusk overlays → sticky note → sign.

**Retained view:** only the room is a nested `View` (`cx.new(Room, …)`). `Room.render()` calls `room(w, h, {seed, now, doorOpen})` from `art.js`, which draws wall, floor, wall furniture, cooler, and plant — **not** desks, rugs, labels, workers, or cat. `syncRoom()` JSON-compares `{w, h, seed, at, door}` (`at` floored to the minute) and calls `set_props` only when the key changes.

**Simulation (`tick`, `main.js:162-201`):** a single `cx.timer.every(250, …)` advances at most one walkway leg per walker per tick; every fourth tick (~1 s) rolls new trips and thoughts. The cat moves every tick. Trips move through `enter → going → there → back`. Busy agents (`working` or `blocked`) head back at the next tick (while visiting) or next waypoint (while walking). The timer calls `cx.notify()` only when `tick()` reports a real change.

**Art (`art.js`):** stateless pixel-art library. Sprites are rows of palette letters (`.` transparent); `sprite()` emits one `div` per horizontal color run. All appearance is deterministic: worker looks from `hash(agent.address)`, desk clutter from `hash("desk" + slot) ^ sessionSeed`, room art from a per-view seed. Wandering, thoughts, cat destinations, and new worker names use unseeded `Math.random()`.

**Animation:** native `.transition("left"/"top")`, `.loop(...)`, and `.frames(...)` only; there is no per-frame animation code. Stable `.id()` values are mandatory for these elements.

## Key Directories

| Path | Purpose |
| --- | --- |
| `office/layouts/` | `office.json` (the runtime layout) and `office.svg` (static settings-screen preview) |
| `office/mods/office/` | The entire mod: `main.js` (state, simulation, rendering), `art.js` (sprites and room art), `mod.json`, `fonts/` |
| `office/mods/office/fonts/` | Bundled `PxPlus_IBM_VGA_8x16.ttf` and its CC BY-SA license |
| `office/` | `RECIPE.md` (behavior/architecture spec) and `preview.png` (demo-mode screenshot) |
| repository root | `README.md`, `LICENSE` (MIT), `.gitignore` |

The package is installed by copying them to `~/.config/herdr-app/layouts/` and `~/.config/herdr-app/mods/office/`. The README documents Unix paths; on Windows use the equivalent Herdr home (not documented in this repo).

## Development Commands

There is **no build, lint, or test command**. Install by copying the layout and mod into Herdr's home, then switch layouts:

```sh
# From the repository root, using the documented Unix paths
mkdir -p ~/.config/herdr-app/layouts ~/.config/herdr-app/mods
cp office/layouts/office.json office/layouts/office.svg ~/.config/herdr-app/layouts/
cp -R office/mods/office ~/.config/herdr-app/mods/

herdr-app do layout.switch --name office
herdr-app status    # must report no errors
herdr-app shot      # visual spot-check
```

- `ctrl-shift-l` cycles back to the previous layout.
- Hot reload is unreliable through a symlinked mod folder: switch away and back after edits.
- **Do not use `herdr-app check` as a gate.** It aborts with a native panic on any mod using `.transition(...)` (including this one). Verify with `layout.switch`, `herdr-app status`, and `herdr-app shot`.
- Generated `gpui-kit.d.ts` and `jsconfig.json` are per-machine editor artifacts; they are gitignored. Do not edit, commit, or hand-copy them.

**Demo mode for visual QA:** temporarily add `"props": { "demo": true }` to the `office-floor` content in the installed layout and `"demo": true` to the rail's props. It renders 12 fixed workers across `web`/`api`/`infra` in all four states, quadruples wandering, and disables floor interactions and the hire button. The checked-in layout must keep demo off.

## Git Workflow

- **Commit every finished change** in this repository as soon as it is complete — the code together with its `README.md`/`RECIPE.md`/`AGENTS.md` updates. Do not leave finished work uncommitted.
- **Never push.** Pushing is the user's step; the local commit ends the task.
- Keep a commit scoped to one change; never sweep in unrelated edits or generated editor artifacts (`gpui-kit.d.ts`, `jsconfig.json`).

## Code Conventions & Common Patterns

### Formatting and naming

- Plain JavaScript ES modules; 2-space indent, double quotes, semicolons, heavy builder chaining.
- `snake_case` appears only at host API boundaries (`tab_name`, `space_name`, `on_click`, `set_props`, `cursor_pointer`). Locals and functions are `camelCase`; constants/palettes are `UPPER_SNAKE`.
- Short aliases are intentional and pervasive: `q` = scaled + rounded, `R2` = scaled rect helper, `R` = seeded RNG, `lk` = look, `dl` = desk look, `g` = geometry, `t` = trip.
- Section comments delimit areas (`// ---- walkways ----`, `// ---- drawing ----`). Keep that style.

### State and errors

- All simulation state lives as mutable fields on the `Office` view: `size`, `seed`, `trips`, `thoughts`, `seats`, `geo`, `known`, `door`, `hover`, `minute`, `n`, `cat`, `list`, `names`.
- `render()` is impure: it sets `demo`, `list`, `names`, `seats`, `trips`, `known`, and `door`. Do not assume a pure render or safe concurrent mutation.
- No `try`/`catch` or logging. Use optional chaining and defaults: `props() ?? {}`, `SCREEN[status] ?? SCREEN.idle`, `pane?.program?.name ?? "Terminal"`.
- No dependency injection or service container: import host APIs directly from `gpui-kit`/`gpui-base`/`herdr`, and keep drawing helpers in `./art.js`.
- Async is limited to `cx.spawn(async () => { const ag = (await knownAgents()).find(x => x.installed); … })` for the strip's **Neuen einstellen** button. `run(...)` is fire-and-forget. Use `cx.timer.every`, not `setTimeout`/`setInterval`.

### Rendering and geometry

- Build UI with `div()`, `h_flex()`, `v_flex()`; absolute positioning is normal. There is no DOM, HTML, CSS, or WebView.
- Two scale units: `s` is screen px per **art** pixel (sprites); `k = s / 3` is layout px per **design** unit (desks, slots, geometry). Use `s` for sprites and `q(v) = Math.round(v * k)` for layout values.
- Desk slots are 170×190 design units. Walkways are `{r, x}` places: `r = -1` is the wall corridor (`WALL - 40`), `r >= 0` is the aisle behind desk row `r`; seats add `seat: y`. `path()` routes seat → row aisle → nearest side lane → target row → target seat.
- Wall/furniture positions used by `spotPlace()` (`main.js:154-162`) are hand-matched to raw pixel coordinates in `room()` (`art.js:141-179`). Move both together.
- Night (`hour >= 19 || hour < 6`) and dusk (`17–19`) thresholds are duplicated in `main.js` and `art.js`; keep them in sync.
- Walkers passing over name labels in aisles is a documented visual caveat (`RECIPE.md` "Watch out"), not a walkway bug.

### Interaction and animation

- Clicks: call `cx.stop_propagation()` in `on_mouse_down` so desk/worker clicks do not drag the window; then `run("agent.focus", { terminal: address })`. The strip's **Neuen einstellen** button starts the rail's `agent` prop (`"omp"` in the layout) via `run("tab.new", { argv: agent.run })`, or `argv: [agent]` when Herdr's table does not know that program; with no prop it falls back to the first installed agent.
- Hover: track only a real change before `cx.notify()`. A redraw re-reports hover, so an unconditional notify loops.
- Every `.transition`, `.loop`, or `.frames` element needs a stable `.id()` (`desk-{address}`, `w-{address}`, `code-{address}-{i}`, `need-{address}`, `dvd-x/y-{address}`, `cat`). Without one, the animation restarts on every render.
- `setAgentOrder(addresses)` publishes desk order for `agent.next`/`agent.prev`; keep it on the floor and skip it only in demo mode.

### Host data contracts

`agents()` items use `.address`, `.status` (`working`/`blocked`/`done`/`idle`/unknown), `.tab_name`, `.space`, `.space_name`, `.title`, `.program`, `.focused`, and optional `.app`. `spaces()` items expose `.active`, `.name`, `.tabs[].active/.name`; `panes()` items expose `.pane`, `.status`, `.program`; `knownAgents()` items expose `.installed` and `.run`; the call is async, so `await` it inside `cx.spawn` (the spec shows it synchronously). It only lists programs with a `run` in Herdr's table (plus `programs.json`): `omp` is not one of them, so the rail's `agent: "omp"` starts as the bare command `["omp"]`.

### Invariants and gotchas

1. **Keep the floor block prop-less.** Any truthy `role` skips `Room` and the timer in `init`.
2. **Never notify on unchanged state.** Guard hover and return a `changed` flag from `tick()`.
3. **Only the room is retained.** Desks, rugs, labels, workers, and cat are rebuilt by `Office.render()`; editing `room()` will not move them.
4. **Groups assume `agents()` is contiguous by space.** A repeated non-adjacent space creates duplicate groups/rugs. Unnamed spaces get desks but no rug/tag.
5. **Arrivals animate only after the first render.** `known` starts `null`, so agents present at mount appear seated; only later addresses walk in through the door.
6. **`seats` is never pruned.** `known` and `trips` are.
7. **`deskLook()` is keyed by slot index + session seed, not address.** Desk order changes alter desk clutter; worker looks stay address-stable.
8. **`fit()` has a floor.** `s >= 1` means `k >= 1/3`; very many agents in a small window can overflow, and rows cap at 6.
9. **The pane header depends on host-injected `props().pane`.** The layout supplies only `role: "pane"`; preserve that convention or headers show `Terminal`/blank status.
10. **Demo mode is non-interactive** and must not be checked in.

## Important Files

| File | Why it matters |
| --- | --- |
| `office/layouts/office.json` | Three-band layout, role wiring, pane frame, theme, preview path |
| `office/mods/office/main.js` | `Office` view: `fit()` 59–71, `Room` 75–82, `init` 85–103, `path()` 122–141, `tick()` 164–203, `desk()` 226–251, `nameFor()` 254–263, `label()` 265–274, `screen()` 276–295, `worker()` 298–324, `render()` 326–449 |
| `office/mods/office/art.js` | Sprite engine 22–33, deterministic looks 44–51, seated/standing/cat 74–100, room 141–179, rugs/screens 183–198, desk clutter 200–209 |
| `office/mods/office/mod.json` | Exactly `{"place":"none"}`; the folder name plus a default-exported `View` is the real contract |
| `office/mods/office/fonts/PxPlus_IBM_VGA_8x16.ttf` | Auto-loaded pixel font; family string `PxPlus IBM VGA 8x16` in `art.js` |
| `office/RECIPE.md` | Exact visual spec, behavior contract, caveats, and "Done when" checklist |
| `office/layouts/office.svg` | Static 160×100 settings preview; `preview` is Herdr-home-relative |
| `office/preview.png` | README screenshot captured in demo mode; not used at runtime |
| `README.md` | Install steps, feature summary, credits, license split |
| `.gitignore` | Ignores generated `gpui-kit.d.ts` and `jsconfig.json` |

## Runtime/Tooling Preferences

- Target **Herdr + gpui-shell**, not Node or a browser. Imports resolve only to built-ins `gpui-kit`, `gpui-base`, `herdr`, plus relative `./art.js`.
- Use Herdr/gpui-kit APIs: `View`, `cx.new`, `cx.timer.every`, `cx.spawn`, `cx.notify`, `cx.stop_propagation`, `div`/`h_flex`/`v_flex`, `.id`, `.transition`, `.loop`, `.frames`, `.on_click`, `.on_hover`, `.on_mouse_down`, `.on_size_change`.
- Do not add npm dependencies, a bundler, TypeScript, a build step, or browser/Node APIs. ES2022 features (`Array.prototype.at`, optional chaining, nullish coalescing, async/await) are fine.
- `mod.json` stays `{"place":"none"}` so Herdr does not auto-dock an extra copy; the layout places the mod explicitly.
- Keep the font folder, family string, and license together. Herdr auto-loads `.ttf`/`.otf` from `mods/office/fonts/`.
- Keep code MIT and the font CC BY-SA 4.0 separate. If redistributing the mod folder alone, include the README credit (VileR / int10h.org) because `LICENSE-PxPlus.txt` is only the generic license text.

## Testing & QA

**There are no automated tests, lint, type-check, coverage, snapshots, or CI in this repository.** QA is manual, inside a running Herdr instance. Do not introduce a test framework or package manager unless explicitly requested.

### Manual acceptance checklist

Grounded in `office/RECIPE.md` "Done when":

1. Install, switch to `office`, and confirm `herdr-app status` reports no errors; capture `herdr-app shot`.
2. One worker per running agent; one row of four desks by default; desk order follows `agents()`; each named space has its rug and tag.
3. Starting an agent opens the door and a worker walks in to a new desk.
4. A permission request makes the worker jump and the screen blink `NEEDS YOU`; finishing while away makes it doze with `zZz`.
5. Idle workers get up within about a minute, stay on aisles/lanes without crossing desks, and return; sending work brings them back immediately.
6. Clicking a worker or occupied desk focuses that agent; every desk shows an old German name and the current task title; hovering a desk shows name, tab, space, title, and status; clicking **Neuen einstellen** in the strip opens a tab running `omp` (the rail's `agent` prop).
7. Optional visual pass: enable `demo: true` on the floor, check all four statuses and three space groups against `preview.png`, then remove the prop.

### Known false alarms and caveats

- `herdr-app check` native panic on `.transition(...)` is expected; do not treat it as a regression.
- Hot reload through a symlinked mod folder may not fire; switch away and back.
- Rapid layout switching can show "This view could not be re-rendered … interrupted"; retry rather than chasing it as a new bug.
- Walkers crossing name labels in aisles is known and accepted.
- Before committing a behavior change, re-check: stable IDs on animated elements, notify-only-on-change, floor block still prop-less, and font license still present.
