# herdr-office-layout

The **Office** layout for the Herdr app: a pixel-art office where every coding agent is a little
office worker at a desk. Typing, stuck waiting on you, dozing after a finished job, or off at the
water cooler: you can tell at a glance. The first worker is always Michels Mum, and she sneaks off
to the smoking corner instead. See [office/RECIPE.md](office/RECIPE.md) for how it is built.

![Office](office/preview.png)

## Installation

Herdr reads layouts from `<home>/layouts/` and mods from `<home>/mods/`, where `<home>` is
`HERDR_APP_HOME` if set, otherwise `~/.config/herdr-app`. `herdr-app --help` prints it as
`Home: …` and resolves it for your platform (on Windows `~` is your user profile, so the path
is e.g. `C:\Users\<you>\.config\herdr-app`).

### With an AI agent

Paste this prompt into your agent (Claude Code, Codex, omp, …). No local checkout needed: the
agent downloads the repository itself and removes the temporary copy when done.

```text
Install the Office layout from https://github.com/jonassch2903/herdr-office-layout into Herdr.

1. Resolve Herdr's home: use $HERDR_APP_HOME if set, otherwise ~/.config/herdr-app.
   `herdr-app --help` prints it as "Home: ...". If that folder does not exist, stop
   and tell me instead of creating it (Herdr makes it on first launch).
2. Fetch the repository into a temporary folder: `git clone --depth 1
   https://github.com/jonassch2903/herdr-office-layout.git <tmp>`, or without git download
   and unpack https://codeload.github.com/jonassch2903/herdr-office-layout/zip/refs/heads/main.
   Keep it outside the Herdr home.
3. Copy <tmp>/office/layouts/office.json and <tmp>/office/layouts/office.svg into
   <home>/layouts/, and the whole <tmp>/office/mods/office/ folder into
   <home>/mods/office/. The mod folder must keep the name "office" and contain
   mod.json, main.js, art.js and fonts/. Replace existing copies at exactly those
   paths; change nothing else in the Herdr home. Delete the temporary copy afterwards.
4. Switch to the layout: herdr-app do layout.switch --name office
5. Verify with herdr-app status: it must report no errors. Do not run
   `herdr-app check`; it panics on this mod's animations and proves nothing. If
   office was already active and the old version is still on screen, switch away and
   back (ctrl-shift-l) and re-run the switch command.
6. Report which files you copied, the switch result and the status output.
```

Installing needs no build step and no dependencies: the mod is plain ES modules plus the
bundled pixel font. The agent only fetches the repository.

### By hand

Get the files first, either with `git clone --depth 1
https://github.com/jonassch2903/herdr-office-layout.git` or from
https://github.com/jonassch2903/herdr-office-layout/archive/refs/heads/main.zip, then:

1. Copy `office/layouts/*` into `~/.config/herdr-app/layouts/`.
2. Copy `office/mods/office` into `~/.config/herdr-app/mods/`.
3. Pick **office** in the Herdr settings, or run:
   ```sh
   herdr-app do layout.switch --name office
   ```

`ctrl-shift-l` cycles back to your previous layout. Delete the copies to remove it.

Nothing to install: the pixel font ships with the mod. It makes no network requests, runs no
programs of its own and reads no files outside its folder. The wood strip under the office lists
every tab of the current space; click a chip to switch tabs. Clicking **Neuen einstellen** in the
same strip asks for a project folder, then opens a new tab running `omp` there, as set by the
rail's `agent` prop in the layout (Herdr's `tab.new`). Canceling the folder picker opens nothing.
A space on another machine skips the local picker and starts in that space's own folder.
Clicking **Shell** beside it opens a plain terminal in the active space's folder, with no picker
and no agent: the place to run the project's commands. Every terminal tab without an agent shows
up on its project's rug as a **Shell-o-mat**, a little command vending machine with the tab name
under it.

## The office

| Worker | Screen | Agent status |
| --- | --- | --- |
| Bobbing at the keyboard, coffee steaming | green, code scrolling | working |
| Jumping | red, blinking **NEEDS YOU** | blocked: waiting for you |
| Head down, `zZz` | blue `OK` | done while you weren't looking |
| Sitting still, or out wandering | bouncing DVD screensaver | idle |

- Idle workers (and now and then finished ones) get up and wander: to the water cooler (back with
  a cup), a bookshelf (with a book), the window, the door, the plant, or another worker's desk for
  a chat. They keep to the walkways and hurry back when their agent starts working. Michels Mum,
  the first worker on the floor, never visits the water cooler: she goes to the `RAUCHEN` corner
  and smokes a cigarette instead. At the cooler and at a shared desk they trade short office
  lines; the cat sometimes naps on a blocked worker's keyboard (click it to pet it). The sign on
  the wall shows the latest floor event: a new colleague, a finished job, a blocked agent, or a
  turn milestone.
- New agents walk in through the door to their desk.
- Every worker looks different (hair, skin, hairstyle, glasses), and their shirt colour follows the
  kind of agent. Michels Mum always looks like a woman (long hair or a bun, a skirt, lipstick).
  Every other worker gets an old-fashioned German name and a line under the desk with what they
  are working on, taken from the terminal title. Desks get random clutter, and an office cat
  roams the floor.
- The clock shows the real time, the window goes from day to sunset to night and follows the
  seasons (snow, blossom and rain, summer sun, autumn leaves; a string of lights in December),
  and the room dims at night while desk lamps come on.
- A wall-mounted **office stats** screen shows live sessions and completed turns for every agent
  on the floor, counts for working / needs you / done / idle, and a four-minute activity strip.
  When someone is blocked, its **NEEDS YOU** line names the next one; click it to jump there.
- Click a worker to jump to that agent. Hover a desk for a sticky note with its name, tab,
  project, space, title and status.
- Each project gets its own group of desks and shell stations on a coloured rug, with its name
  on a tag: a space someone named, or else the live folder the agent works in.
- Only the slots in use are drawn: one desk per agent and one Shell-o-mat per tab without an
  agent, one row up to four slots, more rows when they fit better. Everything scales with the
  slot count and workers stay crisp.
- The wood strip is also the tab bar: every tab of the active space is a chip with its program
  icon, name and agent status. Click one to switch, close the active one with its `x`, or roll the
  wheel over the strip to cycle tabs. The office floor keeps showing every agent and every shell
  tab in every space.
- Click **Neuen einstellen** in the strip below the office, pick the project folder, and `omp`
  starts there. **Shell** beside it opens a plain terminal in the active space's folder: no
  agent and no picker, just a shell ready for the project's commands.
- A terminal tab without an agent is drawn as a **Shell-o-mat** on its project's rug: a command
  vending machine with a blinking prompt, a paper tape and the tab name underneath. Click it to
  show that tab; a project with only shell tabs gets a rug of its own.
- Workers keep to their own line in the walkways and wait for each other (and the cat).

Under the office a wood strip lists the current space and all of its tabs plus the **Neuen
einstellen** and **Shell** buttons, and your terminals get the rest of the window in wood frames.

## Credits

- Font: [PxPlus IBM VGA 8x16](https://int10h.org/oldschool-pc-fonts/) by VileR, CC BY-SA 4.0
  (licence in `office/mods/office/fonts/`).

## License

Code: [MIT](LICENSE). The bundled font keeps its own CC BY-SA 4.0 licence.
