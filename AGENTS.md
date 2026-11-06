# Repository Guidelines

## Project Overview

`herdr-office-layout` is a self-contained layout package for the **Herdr** desktop app. It renders every coding agent as a pixel-art office worker: typing when working, jumping when blocked, dozing when done, and wandering when idle. Each project (a named Herdr space, else the live folder of the agent's pane) gets a desk group on a colored rug; a terminal tab without an agent stands there as a **Shell-o-mat** command vending machine, and clicking a worker or machine shows its agent or tab. The first worker on the floor is always **Michels Mum**: she is always drawn as a woman and smokes in her own `RAUCHEN` corner instead of visiting the water cooler. Every other worker gets an old-fashioned German name and shows its current task under the desk. A wall-mounted **office stats** screen totals sessions and turns for every agent on the floor, counts statuses and queues blocked workers; the top-left sign shows the newest floor event; the cat sometimes sits on a blocked worker's desk; idle workers trade lines at the cooler or a chat desk; and the window follows the seasons.

- **Not an npm project.** No `package.json`, lockfile, bundler, transpiler, TypeScript source, tests, or CI. The runtime implementation is two ES modules (~1125 lines) plus a layout JSON and a vendored font.
- **Runtime:** the Herdr desktop app and its embedded **gpui-shell** JavaScript mod runtime (generated typings observed for gpui-shell 0.7.1). Node/Bun are not used.
- **Package manager:** none. Source is loaded directly as ES modules by Herdr.
- **Self-imposed contract:** the mod makes no network requests, runs no programs, and reads no files outside its own folder. Herdr does not sandbox mods, so this must be preserved by review.
- **Licensing:** code is MIT (`LICENSE`); the bundled font is CC BY-SA 4.0 and must keep `office/mods/office/fonts/LICENSE-PxPlus.txt`.

The authoritative visual/behavior spec is `office/RECIPE.md`. Read it before changing rendering, geometry, or animation.

## Architecture & Data Flow

One mod folder, `office/mods/office/`, is mounted **three times** by `office/layouts/office.json`:

| Layout block | Props | Mod behavior |
| --- | --- | --- |
| `office-floor` (fixed 400 px, `window_drag`) | none | Full office: simulation, room view, timer, desks and Shell-o-mats |
| `office-rail` (fixed 28 px) | `{role: "rail", demo, agent}` | Active space, a clickable chip per tab (program icon, name, status dot; active cream with a close x), **Neuen einstellen** (folder picker, then the `agent` program, `"omp"` here) and **Shell** (a plain terminal in the active space's folder) |
| `office-desks` (`{tab: "active"}`) | pane frame | Herdr renders the tab's panes; each header is the mod with `{role: "pane"}` and host-injected `pane` |

The role gate is `if (props()?.role) return;` in `Office.init` (`main.js:148`). Any truthy role skips the retained room view and 50 ms timer; **the floor is the no-role fall-through**. Never add `role: "floor"` — it would skip simulation setup and render without `roomView`.

```mermaid
flowchart TD
  L[office.json] --> F[office-floor: no props]
  L --> R[office-rail: role rail]
  L --> P[office-desks: tab active]
  P --> H[pane header: role pane]
  F --> I[init: seed/state + cx.new(Room) + 50ms timer]
  I --> A[agents or DEMO] --> G[group agents by project]
  G --> FIT[fit rows/cols, derive k and s] --> GEO[seats, aisles, lanes]
  GEO --> T[tick: walk trips, thoughts, cat, hist, door, minute]
  T --> N[cx.notify only when changed]
  N --> D[render: room, stats, queue, rugs, desks, Shell-o-mats, labels, workers, cat, news, overlays, hover note]
```

**Floor pipeline (`main.js:564-841`):**

1. `list = props().demo ? DEMO : agents()`; the non-demo branch calls `setAgentOrder` with the project-grouped desk order every render. `this.mumAddress` is set to `list[0]` before naming, so the first desk is always Michels Mum. Also non-demo, `shells` is built from every tab in `spaces()` that has real terminal panes in `panes()` (`p.terminal && !p.mod`; mod-only panes are skipped), is not in `agentTabs` (the tabs of `agents()`), and has no pane whose `program.agent` is true, so a split tab with an agent is already represented: it carries the tab id/name, its space, the first pane's `cwd` (falling back to the space's folder) and program.
2. Group agents **and shell tabs** by **project**: a space whose `.named` is true, else the pane `.cwd` from `panes()` (agents matched by `a.pane`, falling back to `terminals()[].cwd` when the pane reports none; keyed with its machine; Windows paths fold case), falling back to the space when it has no cwd. The pane cwd is live (the shell integration reports it), while `terminals()[].cwd` is only the launch folder. A group created by shell tabs alone still gets a rug and tag; a project's agents and shells share the same group. Each group gets a rug color from `hash(key) % RUGS.length`, bumped once if it equals the previous group.
3. `fit()` lays out one slot per agent **or shell tab** in 1–6 rows and computes `k` (layout px per design unit), then snaps `s` (screen px per art pixel) to half-pixel steps: `s = max(1, floor(6k)/2)`, `k = s/3`.
4. Compute one 170×190 slot per agent or shell (60k gaps), seats only for agents, wall/aisle y-coordinates, and side/inter-group lanes into `this.geo`; `desks` and `stations` are separate lists of slots.
5. Detect new agent addresses and enqueue walk-in trips from the door; prune trips, `since`, and `lastTurn` for departed agents. Shell stations are derived per render and keep no state.
6. Render retained room view → office stats screen → rugs → desks → Shell-o-mats → labels → project tags → workers → cat → night/dusk overlays → sticky note → sign (with the newest news line).

The **office stats screen** is not part of the retained room: `statsBoard(w, crew, turns)` builds it every render from every agent on the floor (`crew = list`) and from `terminals()` (turns, matched by address; no app filter), plus the busy-worker history in `this.hist`. It uses a 236×116 panel at y=18 with `OFFICE` + `STATS`, hangs in the wall gap between the right bookshelf and the window, falls back to the wall left of the shelves, and is omitted when neither has room. When any agent is blocked, the bottom label row becomes a blinking `NEEDS YOU` plus the German name of `blocked[this.blockedCursor % blocked.length]` and `+N` others; clicking stops propagation, runs `agent.focus` for that terminal, advances `blockedCursor`, and notifies. Demo makes it display-only.

**News:** `render()` detects status transitions through `since`, turn milestones through `lastTurn`, and arrivals through `known`, then calls `pushNews()`, which unshifts `{text, tone}` onto `this.news`, caps it at 6, and ignores an immediate duplicate. The sign draws only `news[0]`, so the newest event wins. First sight is silent; a lower `turn` resets `lastTurn` without news; demo seeds `Neuer Kollege: Dietrich`.

**Retained view:** only the room is a nested `View` (`cx.new(Room, …)`). `Room.render()` calls `room(w, h, {seed, now, doorOpen})` from `art.js`, which draws wall, floor, wall furniture, cooler, plant, and the seasonal window — **not** desks, rugs, labels, workers, cat, the office stats screen, or news. `syncRoom()` JSON-compares `{w, h, seed, at, door}` (`at` floored to the minute) and calls `set_props` only when the key changes.

**Shell-o-mats:** a tab with terminal panes but no agent is a shell window. `render()` derives one `shells` entry per such tab, groups it with the same project key as agents, and gives it a full 170×190 slot rendered by `station()` instead of a desk: a "Shell-o-mat" vending machine with a `SHELL` marquee, a green prompt screen (`>` plus a blinking `_`), coin slot, buttons, paper tape, mug and manuals. `stationLabel()` puts the tab's program icon and `Tab <name>` 130 down with `Shell-o-mat` below; a marquee LED blinks for the tab that is active in its space. Clicking selects it with `tab.select`. Shells never get seats, walk-in trips, German names, stats or `agent.next`/`agent.prev` order; a project with only shell tabs is still a group with a rug and tag.

**Simulation (`tick`, `main.js:215-270`):** a single `cx.timer.every(50, …)` advances at most one walkway leg per walker per tick; a one-second clock rolls new trips and thoughts. The fast tick lets each leg start as the previous one ends, so walkers do not stop at corners; renders still happen only when `tick()` reports a change. The cat moves every tick. Trips move through `enter → going → there → back`; an arrival holds at the door for 700ms in `enter`, then switches to `back` on its first leg so the walk-in uses real leg durations instead of 16ms jumps. Busy agents (`working` or `blocked`) head back at the next tick (while visiting) or next waypoint (while walking). A walker that finds someone standing at its next waypoint waits up to 1.5s with its legs stopped (the cat waits 2s); walkers ignore each other. Every 10s it appends the number of busy workers in `this.list` to `hist` for the wall screen. It also expires the cat's petting bubble (`this.pet`). Mum uses `MUM_SPOTS` instead of `SPOTS`: both `cooler` entries become `smoke`, a wall spot at the Raucherecke.

**Art (`art.js`):** stateless pixel-art library. Sprites are rows of palette letters (`.` transparent); `sprite()` emits one `div` per horizontal color run. All appearance is deterministic: worker looks from `hash(agent.address)`, desk clutter from `hash("desk" + slot) ^ sessionSeed`, room art from a per-view seed. `look(a, { woman: true })` forces long hair or a bun, a skirt and lipstick; `worker()` passes it for `this.mumAddress`. `window_(x, now, seed)` derives day/dusk/night from the hour and adds a season in a clipped 78×64 pane: snow Dec–Feb, petals Mar–May (April rain), a daytime sun Jun–Aug, leaves Sep–Nov, plus 8 December bulbs outside the pane. Seasonal randomness uses its own `rng(seed ^ ((month+1)*0x9e3779b9))`, so the room's `R` sequence is untouched. Wandering, thoughts, cat destinations, and new worker names use unseeded `Math.random()`.

**Animation:** native `.transition("left"/"top")`, `.loop(...)`, and `.frames(...)` only; there is no per-frame animation code. Stable `.id()` values are mandatory for these elements.

## Key Directories

| Path | Purpose |
| --- | --- |
| `office/layouts/` | `office.json` (the runtime layout) and `office.svg` (static settings-screen preview) |
| `office/mods/office/` | The entire mod: `main.js` (state, simulation, rendering), `art.js` (sprites and room art), `mod.json`, `fonts/` |
| `office/mods/office/fonts/` | Bundled `PxPlus_IBM_VGA_8x16.ttf` and its CC BY-SA license |
| `office/` | `RECIPE.md` (behavior/architecture spec) and `preview.png` (demo-mode screenshot) |
| repository root | `README.md`, `LICENSE` (MIT), `.gitignore` |

The package is installed by copying them to `<home>/layouts/` and `<home>/mods/office/`, where `<home>` is `HERDR_APP_HOME` if set, otherwise `~/.config/herdr-app` (`herdr-app --help` prints the resolved path; on Windows `~` is the user profile, so the path is e.g. `C:\Users\<you>\.config\herdr-app`).

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

**Demo mode for visual QA:** temporarily add `"props": { "demo": true }` to the `office-floor` content in the installed layout and `"demo": true` to the rail's props. It renders 12 fixed workers across `web`/`api`/`infra` in all four states, quadruples wandering, disables agent focus and the hire and shell buttons, shows three sample tab chips (`web`/`api`/`infra`) instead of the host's tabs with no Shell-o-mats (the samples are not real tabs), and makes the stats queue display-only; the cat can still be petted. The checked-in layout must keep demo off.

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

- All simulation state lives as mutable fields on the `Office` view: `size`, `seed`, `trips`, `thoughts`, `seats`, `geo`, `known`, `door`, `hover`, `minute`, `rollAt`, `histAt`, `cat`, `list`, `mumAddress`, `names`, `hist`, `histSeeded`, `since`, `lastTurn`, `news`, `newsSeeded`, `blockedCursor`, `pet`. A trip carries `phase`, `path`, `i`, `until`, `spot`, `hurry`, and `hold` (the deadline for standing still at a blocked waypoint). `cat` itself carries `path`, `i`, `until`, `left`, `resting`, `onDesk`, `watch`, and `wait`.
- `render()` is impure: it sets `demo`, `list`, `mumAddress`, `names`, `seats`, `trips`, `known`, `door`, `since`, `lastTurn`, `news`, and (first demo render) `hist`/`histSeeded` and `newsSeeded`. The queue click advances `blockedCursor`; the cat click sets `pet`. Do not assume a pure render or safe concurrent mutation.
- No `try`/`catch` or logging. Use optional chaining and defaults: `props() ?? {}`, `SCREEN[status] ?? SCREEN.idle`, `pane?.program?.name ?? "Terminal"`.
- No dependency injection or service container: import host APIs directly from `gpui-kit`/`gpui-base`/`herdr`, and keep drawing helpers in `./art.js`.
- Async is limited to `cx.spawn(async () => { const [folder, known] = await Promise.all([pickFolder(…), knownAgents()]); … })` for the strip's **Neuen einstellen** button. `run(...)` is fire-and-forget. Use `cx.timer.every`, not `setTimeout`/`setInterval`.

### Rendering and geometry

- Build UI with `div()`, `h_flex()`, `v_flex()`; absolute positioning is normal. There is no DOM, HTML, CSS, or WebView.
- Two scale units: `s` is screen px per **art** pixel (sprites); `k = s / 3` is layout px per **design** unit (desks, slots, geometry). Use `s` for sprites and `q(v) = Math.round(v * k)` for layout values.
- Desk slots are 170×190 design units. Walkways are `{r, x}` places: `r = -1` is the wall corridor (`WALL - 40`), `r >= 0` is the aisle behind desk row `r`; seats add `seat: y`. `path()` routes seat → row aisle → nearest side lane → target row → target seat.
- Wall/furniture positions used by `spotPlace()` (`main.js:203-211`) are hand-matched to raw pixel coordinates in `room()` (`art.js:212-251`). The stats screen's gap (`mid+268` to `w-348` in `statsBoard()`), its 236×116 panel at y=18, and its x=140 fallback left of the shelves use the same shelf and window coordinates. The `smoke` wall spot (x ≈ 52 + jitter) and `smokingArea()` in `art.js` (sign and ashtray at x ≈ 120) must move together as well.
- Night (`hour >= 19 || hour < 6`) and dusk (`17–19`) thresholds are duplicated in `main.js` and `art.js`; keep them in sync. The window's month ranges live only in `window_()`.
- Walkers passing over name labels in aisles is a documented visual caveat (`RECIPE.md` "Watch out"), not a walkway bug. The cat's blocked-desk trip is the one deliberate walkway exception: it approaches the seat, uses `seat.y - 7k`, and draws without the usual 30k walking offset while `onDesk`.

### Interaction and animation

- Clicks: call `cx.stop_propagation()` in `on_mouse_down` so desk/worker/queue clicks do not drag the window; then `run("agent.focus", { terminal: address })`. The stats board's `NEEDS YOU` row is a click too: it focuses `blocked[blockedCursor % blocked.length]`, advances `blockedCursor`, and notifies; in demo it is inert. Clicking the cat sets `pet = Date.now() + 2500` and shows a `♥` bubble, without moving it. The strip's **Neuen einstellen** button asks for a project folder with `pickFolder({ prompt: "Starten" })` when the active space is local; canceling starts nothing. A space on another machine skips the local picker (and passes no `folder`), so its tab starts in that space's own folder. It then starts the rail's `agent` prop (`"omp"` in the layout) via `run("tab.new", { space, folder, argv: agent.run })`, or `argv: [agent]` when Herdr's table does not know that program; with no prop it falls back to the first installed agent. The **Shell** button beside it runs `tab.new` with the active space's folder and no `argv`, so Herdr starts its default shell there; there is no picker and no agent, and an empty space folder leaves Herdr's default. The rail's tab chips run `tab.select` on click; the active chip's `x` runs `tab.close`; the wheel over the rail cycles `tab.prev`/`tab.next`. A Shell-o-mat does the same `tab.select` with its tab id. Demo chips and the demo floor have no shell stations (demo has no real tabs).
- Hover: track only a real change before `cx.notify()`. A redraw re-reports hover, so an unconditional notify loops.
- Every `.transition`, `.loop`, or `.frames` element needs a stable `.id()` (`desk-{address}`, `w-{address}`, `w-{address}-smoke`, `w-{address}-chat`, `code-{address}-{i}`, `need-{address}`, `dvd-x/y-{address}`, `stats-live`, `stats-need`, `cat`, `snow-{i}`, `xmas-{i}`, `petal-{i}`, `rain-{i}`, `leaf-{i}`). Without one, the animation restarts on every render.
- `setAgentOrder(addresses)` publishes the drawn desk order for `agent.next`/`agent.prev`; pass the project-grouped order, keep it on the floor, and skip it only in demo mode.

### Host data contracts

`agents()` items use `.address`, `.pane`, `.status` (`working`/`blocked`/`done`/`idle`/unknown), `.tab_name`, `.space`, `.space_name`, `.title`, `.program`, `.focused`, and optional `.app`. `spaces()` items expose `.active`, `.id`, `.name`, `.named`, `.folder`, `.machine`, `.tabs[].id/.index/.name/.active/.status/.settled`; `panes()` items expose `.pane`, `.tab`, `.cwd`, `.status`, `.program`; `terminals()` items (live, from herdr-core) expose `.address`, `.cwd`, `.state`, `.turn`, `.status`, `.agent`, and `.program`; `.turn` is summed for every floor address and watched for new hundreds, with no `app`/program filter. `knownAgents()` items expose `.installed` and `.run`; the call is async, so `await` it inside `cx.spawn` (the spec shows it synchronously). It only lists programs with a `run` in Herdr's table (plus `programs.json`): `omp` is not one of them, so the rail's `agent: "omp"` starts as the bare command `["omp"]`. `pickFolder({ prompt })` is async, opens the system folder picker, and resolves with the chosen path or null when canceled.

### Invariants and gotchas

1. **Keep the floor block prop-less.** Any truthy `role` skips `Room` and the timer in `init`.
2. **Never notify on unchanged state.** Guard hover and return a `changed` flag from `tick()`.
3. **Only the room is retained.** Desks, rugs, labels, workers, cat, the office stats screen, the queue, and the news line are rebuilt by `Office.render()`; editing `room()` will not move them.
4. **Groups are keyed by project, not by `agents()` order.** A named space is its own project; otherwise the pane's live folder (with its machine, case-folded on Windows) is the key, so non-adjacent agents of one folder share a rug. Read `panes()[].cwd`, never `terminals()[].cwd`: agents like omp switch projects without changing their process cwd, so the launch folder is stale. Agents without a pane cwd fall back to the terminal's, then to their space; an unnamed space whose cwd is its own `.folder` is labelled with the space name (e.g. `~`).
5. **Arrivals animate only after the first render.** `known` starts `null`, so agents present at mount appear seated; only later addresses walk in through the door.
6. **`seats` is never pruned.** `known`, `trips`, `since`, and `lastTurn` are.
7. **`deskLook()` is keyed by slot index + session seed, not address.** Desk order changes alter desk clutter; worker looks stay address-stable.
8. **`fit()` has a floor.** `s >= 1` means `k >= 1/3`; very many agents in a small window can overflow, and rows cap at 6.
9. **The pane header depends on host-injected `props().pane`.** The layout supplies only `role: "pane"`; preserve that convention or headers show `Terminal`/blank status.
10. **Demo mode disables agent focus and the hire and shell buttons**, shows three inert sample tab chips instead of the host's tabs (so no Shell-o-mats), and makes the stats queue display-only; petting the cat still works. It must not be checked in.
11. **The office stats screen hides when the wall is too narrow — and takes the queue with it.** It needs the gap between the right shelf and the window or the wall left of the shelves; `statsBoard()` returns null below about 1290px, and nothing else reserves that space. The `NEEDS YOU` row lives on that board, so a hidden board means a hidden queue.
12. **The first desk is always Michels Mum.** `render()` sets `mumAddress = list[0]`; `nameFor()` overrides that address, `worker()` calls `look(a, { woman: true })`, and `tick()` uses `MUM_SPOTS`, where both `cooler` entries become `smoke`. A former first agent gets a normal German name back. Keep the `smoke` spot in `spotPlace()` aligned with `smokingArea()` in `art.js`.
13. **The wall screen is floor-wide, never OMP-only.** `statsBoard(w, crew, turns)` receives `crew = list`; counts every status, sums `terminals().turn` for every matched address, and `tick()` samples every busy worker into `hist`. Do not reintroduce an `isOmp`/`app === "omp"` filter; the queue and the activity strip cover all agents.
14. **News and the queue are derived from observed state.** `pushNews()` is newest-first, caps `news` at 6, and drops an immediate duplicate; only `news[0]` reaches the sign. `since` and `lastTurn` start silently on first sight, are pruned when `known` drops an address, and a lower turn resets `lastTurn` without news. `blockedCursor` wraps over the current blocked list; demo mode makes the queue display-only.
15. **The cat's blocked-desk trip is the only walkway exception.** `moveCat()` picks a blocked desk with 60% chance per destination, sets `onDesk` and `watch`, rests 18–40s, and clears `watch` (and the rest) as soon as the agent is no longer blocked or gone. The desk position is `seat.y - 7k`; drawing skips the usual 30k offset and faces left. A cat click only sets `pet` (2.5s `♥`), it does not move the cat.
16. **Small talk has one speaker per spot.** For cooler or `chat` visitors, the lowest `hash(address)` speaks; a second visitor at the same `chat` desk keeps the `...` frames bubble, and thoughts are hidden there. The line is `SMALL_TALK[hash(address:until) % length]`, so it is stable for the stay (the trip's `until` is the key).
17. **Seasonal art is deterministic and isolated.** `window_(x, now, seed)` uses its own `rng(seed ^ ((month+1)*0x9e3779b9))`; never draw seasonal detail from the room's `R`, or books, knots, and clouds change. Months: Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn; December lights and April rain are extras. Seasonal `loop`s are from→to→from and need stable ids.
18. **The rail is the only view of the host's tabs.** It lists the active space's `tabs` in host order with the program icon from `panes()`, the tab name and `status`; never derive it from `agents()`, or plain-terminal and mod-only tabs disappear. Clicking runs `tab.select`, the active chip's `x` runs `tab.close`, and the wheel runs `tab.prev`/`tab.next`. Demo renders `DEMO_TABS` instead.
19. **A tab with terminal panes but no agent is a Shell-o-mat, not a worker.** `render()` derives `shells` from `spaces()` and `panes()` (`p.terminal && !p.mod`), skipping mod-only tabs, tabs with an agent pane, or an `agents()` entry; a shell tab joins its project's group by the same key, takes a full 170×190 slot through `station()`/`stationLabel()`, and clicks `tab.select`. Shells never enter `list`, `seats`, `trips`, `names`, `setAgentOrder`, or the stats board, and a project with only shell tabs still gets a rug and tag. Demo has no shell stations.

## Important Files

| File | Why it matters |
| --- | --- |
| `office/layouts/office.json` | Three-band layout, role wiring, pane frame, theme, preview path |
|`office/mods/office/main.js`|`Office` view: `fit()` 103–117, `Room` 119–128, `init` 129–175, `path()` 176–220, `tick()` 221–329, `desk()` 331–358, `nameFor()` 359–370, `label()` 371–384, `station()` 385–416, `stationLabel()` 417–425, `screen()` 426–452, `statsBoard()` 453–518, `worker()` 519–563, `render()` 564–841|
| `office/mods/office/art.js` | Sprite engine 22–33, deterministic looks 45–58, `seated()`/`standing()` 80–103, `cat()` 107, `window_()` 138–196 (seasons), `smokingArea()` 200–210, room 212–251, `SLOT_W`/`RUGS`/`SCREEN` 255–259, `deskLook()`/`clutter()` 262–281 |
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
2. One worker and one desk per running agent (no spare desks); desk order is the project-grouped order; the first desk is Michels Mum with long hair or a bun and a skirt; each project has its rug and tag. The wall screen covers every agent on the floor (not only OMP): sessions, turn total, status counts, and a four-minute activity strip. With a blocked agent its bottom row blinks `NEEDS YOU` with a German name and `+N`; clicking focuses that agent and the next click advances; with none blocked it reads `ACTIVITY · 4 MIN`. Below about 1290px the board and the queue are absent.
3. Starting an agent opens the door and a worker walks in to a new desk; the sign shows `Neu: <name>`. A permission request shows `<name> braucht dich`, finishing while away shows `<name> ist fertig`, and a terminal crossing a new hundred turns shows `<name>: N Turns`; only the newest line is visible and an immediate repeat does not duplicate it.
4. A permission request makes the worker jump and the screen blink `NEEDS YOU`; finishing while away makes it doze with `zZz`. With a blocked agent, the cat sometimes sits on that worker's desk in front of the monitor for 18–40s (or until the agent recovers), then leaves; clicking the cat shows a `♥` bubble.
5. Idle workers get up within about a minute, stay on aisles/lanes without crossing desks, and return; sending work brings them back immediately. Michels Mum walks to the `RAUCHEN` corner, stands with a cigarette and a `~` smoke wisp, and never visits the water cooler. At the cooler or a chat desk exactly one visitor shows a short German line while the other chat visitor keeps `...`, and no thought bubble appears there.
6. Clicking a worker or occupied desk focuses that agent; every desk shows a worker name and the current task title; hovering a desk shows name, tab, project, space, title, and status; clicking **Neuen einstellen** asks for a folder, then opens a tab running `omp` there (the rail's `agent` prop); canceling the picker opens nothing.
7. The window follows the month: snow and (in December) 8 colored bulbs Dec–Feb; pink petals and (in April) rain streaks Mar–May; an 8×8 sun in the daytime sky Jun–Aug; orange/brown leaves Sep–Nov. Day, sunset, night, clouds, moon, and stars are unchanged.
8. Optional visual pass: enable `demo: true` on the floor, check all four statuses and three space groups against `preview.png`, confirm the seeded `Neuer Kollege: Dietrich` sign line and that the demo queue is display-only, then remove the prop.

### Known false alarms and caveats

- `herdr-app check` native panic on `.transition(...)` is expected; do not treat it as a regression.
- Hot reload through a symlinked mod folder may not fire; switch away and back.
- Rapid layout switching can show "This view could not be re-rendered … interrupted"; retry rather than chasing it as a new bug.
- Walkers crossing name labels in aisles is known and accepted.
- Before committing a behavior change, re-check: stable IDs on animated elements, notify-only-on-change, floor block still prop-less, and font license still present.
