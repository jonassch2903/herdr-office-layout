import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, spaces, panes, props, run, setAgentOrder, knownAgents, terminals, pickFolder } from "herdr";
import { ink, WALL, SLOT_W, SLOT_H, SCREEN, CATS, RUGS, r, icon, txt, hash, rng, pick, look, deskLook, clutter, seated, standing, cat, room } from "./art.js";

// A pixel-art office: every agent is a little worker at a desk, and each project (a space
// someone named, else the folder the agent's terminal works in) gets its own group of desks on
// a rug. Idle workers wander, and everyone (the cat too) keeps to the walkways:
// the corridor along the wall, the aisle behind each row of desks, and the lanes past both ends
// of the rows and between the groups.
const wood = "#8a5530";
const DEMO = [
  ["working", "web-1", "Fix the login form validation"],
  ["blocked", "api", "Migrate the database schema"],
  ["done", "web-2", "Write tests for the auth flow"],
  ["idle", "docs", "Update the API documentation"],
  ["working", "api-2", "Refactor the request pipeline"],
  ["idle", "triage", "Triage the open bug reports"],
  ["idle", "lunch", "Out for lunch"],
  ["done", "ship", "Ship the release candidate"],
  ["working", "infra", "Profile the build pipeline"],
  ["idle", "standup", "Join the daily standup"],
  ["blocked", "deploy", "Deploy to production"],
  ["idle", "coffee", "Coffee break"],
].map(([status, tab_name, title], i) => {
  const space_name = i < 5 ? "web" : i < 9 ? "api" : "infra";
  return { address: `demo${i}`, status, tab_name, space: space_name, space_name, title, program: null, focused: i === 0 };
});
// Old-fashioned German given names; every worker gets one nobody else on the floor has.
const NAMES = [
  "Adelheid", "Albert", "Alfred", "Alois", "Anneliese", "Anton", "Balthasar", "Bärbel", "Bertha", "Brigitte",
  "Christa", "Dietrich", "Dorothea", "Eckhard", "Edeltraud", "Elfriede", "Else", "Emil", "Erna", "Ernst",
  "Frieda", "Friedrich", "Gertrud", "Gisela", "Gottfried", "Gudrun", "Günter", "Hannelore", "Hans", "Harald",
  "Hedwig", "Heinrich", "Heinz", "Helga", "Helmut", "Herbert", "Herta", "Hildegard", "Horst", "Inge",
  "Ingrid", "Irmgard", "Johann", "Jürgen", "Karl", "Käthe", "Klaus", "Konrad", "Kriemhild", "Kurt",
  "Liesel", "Lotte", "Ludwig", "Magda", "Manfred", "Margarete", "Marta", "Mechthild", "Monika", "Otto",
  "Reinhard", "Renate", "Rudolf", "Siegfried", "Sieglinde", "Theodor", "Traudel", "Ulrich", "Ursula", "Ute",
  "Walburga", "Walter", "Werner", "Wilhelm", "Wolfgang",
];
const THOUGHTS = ["?", "!", "♪", "♥", "...", "☼", "$", "#"];
const SPOTS = ["cooler", "cooler", "shelfL", "shelfR", "window", "door", "plant", "floor", "floor", "chat", "chat"];
// The first worker on the floor is always Michels Mum. She never joins the water-cooler crowd:
// her cooler trips lead to the smoking corner instead. Everyone else keeps the usual spots.
const MUM = "Michels Mum";
const MUM_SPOTS = SPOTS.map((k) => (k === "cooler" ? "smoke" : k));
const WALK = 0.11, CAT_WALK = 0.07; // px per ms
const busy = (a) => a.status === "working" || a.status === "blocked";
// The wall screen is the floor's dashboard: live sessions, completed turns and a short activity
// strip. `turn` is herdr-core's per-terminal count; the strip samples how many workers are busy.
const HIST = 24, HIST_MS = 10000; // one sample every 10s: four minutes
// Walk legs end on a timer, so a coarse tick leaves every corner frozen for up to one period.
// 50ms keeps the legs moving without rebuilding the floor at frame rate (renders still only
// happen when something changed). Social rolls stay on a one-second clock.
const TICK_MS = 50, ROLL_MS = 1000, WAIT_MS = 1500, CAT_WAIT_MS = 2000;
// Coffee-kitchen lines. Short enough for a 100px bubble; one speaker is picked per spot.
const SMALL_TALK = [
  "Hast du das Deploy gesehen?",
  "Bei mir läuft's.",
  "Nur noch ein Turn.",
  "Die CI ist rot.",
  "Wer hat die Tests kaputt gemacht?",
  "Kaffee?",
  "Der Build dauert wieder.",
  "Ich review das gleich.",
  "Das war kein Bug, das war ein Feature.",
  "Hast du den Kunden gefragt?",
  "Mein Prompt war zu lang.",
  "Schon Feierabend?",
];
const short = (n) => (n > 9999 ? `${Math.round(n / 1000)}k` : `${n}`);
// OMP titles look like "π > 🐙 ACT: …" or "π ⠙ 🏷️ AGNT: …": drop the logo, status glyph and
// label icon, keep the tag and task text. Then only show a title that says something about the
// work (not a shell path or the program name).
const cleanTitle = (s) => (s ?? "").replace(/^π\s*(?:>\s*)?/u, "").replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
const taskOf = (a) => {
  const t = cleanTitle(a.title), prog = a.program?.name;
  const telling = t && t !== prog && !/^[~/]|^[A-Za-z]:\\/.test(t) && !t.includes("@") && t.toLowerCase() !== a.program?.key;
  return telling ? t : "";
};
// A project is a space someone named, else the folder the agent's terminal works in: its last
// path part names the rug. Windows paths compare case-insensitively.
const dirOf = (p) => (p ?? "").replace(/[\\/]+$/, "");
const dirName = (p) => dirOf(p).split(/[\\/]/).pop() ?? "";
const winDir = (p) => /^[A-Za-z]:[\\/]|^\\\\/.test(p ?? "");
const sameDir = (a, b) => {
  const x = dirOf(a), y = dirOf(b);
  return (winDir(x) || winDir(y) ? x.toLowerCase() === y.toLowerCase() : x === y);
};
const dirKey = (p) => (winDir(p) ? dirOf(p).toLowerCase() : dirOf(p));

const GAP = 60; // the walkway between two projects' desks, in slot units
const DVD = ["#e05a8a", "#5ab0e0", "#e0c040", "#7ee0a0", "#c08ae0", "#f08a4a"];

// Only the desks in use are laid out: one row up to four desks, and more rows only when they let
// the desks grow. The scale snaps to whole half pixels per art pixel (s), so desks and workers
// grow together and stay crisp.
function fit(groups, w, h) {
  const total = groups.reduce((a, n) => a + n, 0);
  let best;
  for (let rows = 1; rows <= 6; rows++) {
    if (total <= 4 && rows > 1) break;
    const cols = groups.map((n) => Math.max(1, Math.ceil(n / rows)));
    const units = cols.reduce((a, b) => a + b, 0) * SLOT_W + (groups.length - 1) * GAP;
    const k = Math.min(1, (w - 200) / units, (h - WALL) / (rows * SLOT_H + 40));
    if (!best || k > best.k + 0.08) best = { k, cols, rows };
  }
  const s = Math.max(1, Math.floor(best.k * 6) / 2);
  return { ...best, k: s / 3, s };
}

// The room (wall, floor, furniture) is half of everything drawn, and changes only with the size,
// the minute and the door: a retained view of its own, rebuilt only then.
class Room extends View {
  init(p) { this.p = p; }
  update(p) { this.p = p; }
  render() {
    const { w, h, seed, at, door } = this.p;
    return div().absolute().left(0).top(0).w(w).h(h).children(room(w, h, { seed, now: new Date(at), doorOpen: door }));
  }
}

export default class Office extends View {
  init(_p, cx) {
    this.size = { width: 1200, height: 420 };
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.trips = {};     // address → { phase: enter|going|there|back, path, i, until, spot, hurry }
    this.thoughts = {};  // address → { sym, until }
    this.seats = {};     // address → { x, y, row }
    this.geo = null;
    this.known = null;
    this.door = 0;
    this.hover = null;
    this.minute = -1;
    this.rollAt = 0;     // last wander/thought roll, once a second
    this.histAt = 0;     // last activity sample, every 10s
    this.cat = { coat: pick(rng(this.seed), CATS), path: null, i: 0, until: 0, left: false, onDesk: false, watch: null };
    this.list = [];
    this.mumAddress = null; // the first agent on the floor, always Michels Mum
    this.names = {};     // address → old German name, fixed for the session
    this.hist = [];      // busy-worker count, one sample every ~10s
    this.histSeeded = false;
    this.since = {};     // address → { status, at }, for the event ticker
    this.lastTurn = {};  // address → last seen turn, for milestone news
    this.news = [];      // floor events, newest first; the sign shows news[0]
    this.newsSeeded = false;
    this.blockedCursor = 0; // which blocked worker the stats board's queue targets
    this.pet = 0;        // cat petting bubble until this timestamp
    if (props()?.role) return;
    this.roomView = cx.new(Room, this.roomProps());
    cx.timer.every(TICK_MS, (cx) => { this.syncRoom(); if (this.tick()) cx.notify(); });
  }

  roomProps() {
    const { width: w, height: h } = this.size;
    return { w, h, seed: this.seed, at: Math.floor(Date.now() / 60000) * 60000, door: this.door > Date.now() };
  }

  syncRoom() {
    const p = this.roomProps(), key = JSON.stringify(p);
    if (key !== this.roomKey) { this.roomKey = key; this.roomView.set_props(p); }
  }

  // ---- walkways -------------------------------------------------------------
  // A place is { r, x }: r = -1 is the corridor along the wall, r ≥ 0 the aisle behind desk row r.
  // A seat adds { seat: y }: one step up from its row's aisle.

  laneY(row, off = 0) { const g = this.geo; return off + (row < 0 ? g.topY : g.top + row * g.sh + Math.round(128 * g.k)); }

  // Everyone keeps to their own line in a walkway (off), so passers-by don't merge.
  path(from, to, speed = WALK, off = 0) {
    const g = this.geo, pts = [];
    const add = (x, y, row) => pts.push({ x: Math.round(x), y: Math.round(y), r: row });
    if (from.seat != null) add(from.x, this.laneY(from.r, off), from.r);
    if (from.r !== to.r) {
      const side = [...g.lanes].sort((a, b) => Math.abs(from.x - a) + Math.abs(to.x - a) - Math.abs(from.x - b) - Math.abs(to.x - b))[0];
      add(side, this.laneY(from.r, off), from.r);
      add(side, this.laneY(to.r, off), to.r);
    }
    add(to.x, this.laneY(to.r, off), to.r);
    if (to.seat != null) add(to.x, to.seat, to.r);
    let prev = { x: from.x, y: from.seat ?? this.laneY(from.r) };
    for (const p of pts) {
      p.ms = Math.max(16, Math.round(Math.hypot(p.x - prev.x, p.y - prev.y) / speed));
      p.facing = p.y > prev.y ? "front" : p.y < prev.y ? "back" : "front";
      p.left = p.x < prev.x;
      prev = p;
    }
    return pts;
  }

  off(addr) { return ((hash(addr) % 5) - 2) * Math.round(4 * this.geo.k); }

  // Someone (or the cat) is standing at the spot p: wait a moment. Walkers heading somewhere are
  // ignored: two people walking toward each other's next waypoint used to freeze each other.
  crowded(self, p) {
    const near = (q) => q && Math.abs(q.x - p.x) < 12 * this.geo.s && Math.abs(q.y - p.y) < 8 * this.geo.s;
    if (self !== "cat" && this.cat.resting && near(this.cat.path?.[this.cat.i])) return true;
    return Object.entries(this.trips).some(([addr, t]) => addr !== self && t.phase === "there" && near(t.path[t.i]));
  }

  seatPlace(addr) { const s = this.seats[addr]; return s && { r: s.row, x: s.x, seat: s.y }; }

  spotPlace(sp) {
    const { width: w } = this.size, g = this.geo, mid = Math.round(w / 2);
    const wall = { cooler: w - 150, shelfL: mid - 250, shelfR: mid + 200, window: w - 320, door: mid - 24, smoke: 52 }[sp.key];
    if (wall != null) return { r: -1, x: Math.round(wall + sp.jx) };
    if (sp.key === "chat" && this.seats[sp.other]) { const o = this.seats[sp.other]; return { r: o.row, x: o.x + Math.round(30 * g.k) }; }
    if (sp.key === "plant") return { r: g.rows - 1, x: Math.max(g.rightX, w - 150) };
    return { r: Math.floor(sp.fy * (g.rows + 1)) - 1, x: Math.round(8 + sp.fx * (w - 70)) };
  }

  // Every 50ms: walkers turn corners; a leg never waits for the next whole tick to start, so the
  // walk keeps its speed instead of stopping at every corner. Once a second: who gets up,
  // thoughts, the cat. Every 10s: the activity strip.
  tick() {
    if (!this.geo) return false;
    const now = Date.now();
    let changed = false;
    if (now - this.histAt >= HIST_MS) {
      this.histAt = now;
      this.hist.push(this.list.filter(busy).length);
      if (this.hist.length > HIST) this.hist.shift();
      changed = true;
    }
    const minute = new Date().getMinutes();
    if (minute !== this.minute) { this.minute = minute; changed = true; }
    const roll = now - this.rollAt >= ROLL_MS;
    if (roll) this.rollAt = now;
    for (const a of this.list) {
      const t = this.trips[a.address];
      if (t) {
        if (busy(a) && t.phase === "there") this.headBack(a, t, t.path[t.i], now), changed = true;
        else if (busy(a) && t.phase === "going") t.hurry = true;
        if (now < t.until) continue;
        if (t.i < t.path.length - 1 && !(t.hurry && t.phase === "going")) {
          if (this.crowded(a.address, t.path[t.i + 1])) {
            if (!t.hold) { t.hold = now + WAIT_MS; changed = true; } // stop swinging the legs on the spot
            if (now < t.hold) { t.until = now + TICK_MS; continue; }
          }
          t.hold = 0; t.i++; t.until = now + t.path[t.i].ms; changed = true; continue;
        }
        const at = t.path[t.i];
        t.hold = 0;
        changed = true;
        if (t.phase === "going" && !t.hurry) Object.assign(t, { phase: "there", until: now + 3000 + Math.random() * 8000 });
        else if (t.phase === "back") delete this.trips[a.address];
        else this.headBack(a, t, at, now);
      } else if (roll && !busy(a) && Math.random() < (a.status === "done" ? 0.015 : 0.035) * (this.demo ? 4 : 1)) {
        const others = this.list.filter((o) => o.address !== a.address && !this.trips[o.address]);
        const spots = a.address === this.mumAddress ? MUM_SPOTS : SPOTS;
        let key = spots[Math.floor(Math.random() * spots.length)];
        if (key === "chat" && !others.length) key = "floor";
        const spot = { key, other: key === "chat" ? others[Math.floor(Math.random() * others.length)].address : null,
          jx: Math.random() * 30 - 15, fx: Math.random(), fy: Math.random() };
        const path = this.path(this.seatPlace(a.address), this.spotPlace(spot), WALK, this.off(a.address));
        this.trips[a.address] = { phase: "going", spot, path, i: 0, until: now + path[0].ms, hold: 0 };
        changed = true;
      } else if (roll && !this.thoughts[a.address] && Math.random() < (busy(a) ? 0.006 : 0.025)) {
        this.thoughts[a.address] = { sym: THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)], until: now + 2500 + Math.random() * 3000 };
        changed = true;
      }
    }
    for (const [k, t] of Object.entries(this.thoughts)) if (now >= t.until) { delete this.thoughts[k]; changed = true; }
    changed = this.moveCat(now) || changed;
    if (this.pet && now >= this.pet) { this.pet = 0; changed = true; }
    if (this.door && now >= this.door) { this.door = 0; changed = true; }
    return changed;
  }

  headBack(a, t, at, now) {
    const path = this.path({ r: at.r, x: at.x }, this.seatPlace(a.address), WALK, this.off(a.address));
    Object.assign(t, { phase: "back", path, i: 0, until: now + path[0].ms, hurry: false, hold: 0 });
  }

  // The sign's third line. Keep only a short tail; the newest event wins.
  pushNews(text, tone = "#6b5a4a") {
    if (this.news[0]?.text === text) return;
    this.news.unshift({ text, tone });
    if (this.news.length > 6) this.news.pop();
  }

  moveCat(now) {
    const c = this.cat, g = this.geo;
    // A blocked worker's desk is the best seat in the house. Leave as soon as they recover.
    if (c.watch) {
      const a = this.list.find((x) => x.address === c.watch);
      if (!a || a.status !== "blocked") { c.watch = null; c.until = Math.min(c.until, now); }
    }
    if (now < c.until) return false;
    if (c.path && c.i < c.path.length - 1) {
      if (this.crowded("cat", c.path[c.i + 1])) {
        if (!c.wait) c.wait = now + CAT_WAIT_MS;
        if (now < c.wait) { c.until = now + TICK_MS; return false; }
      }
      c.wait = 0; c.i++; c.until = now + c.path[c.i].ms; c.left = c.path[c.i].left; return true; }
    const at = c.path?.[c.i] ?? { r: -1, x: Math.round(this.size.width / 3) };
    if (c.path && !c.resting) {
      c.resting = true;
      c.until = now + (c.onDesk
        ? c.watch ? 18000 + Math.random() * 22000 : 1200 + Math.random() * 1800
        : Math.random() < 0.4 ? 8000 + Math.random() * 15000 : 1000 + Math.random() * 3000);
      return false;
    }
    // Prefer a blocked worker's desk; otherwise keep to the walkways.
    const blocked = this.list.filter((a) => a.status === "blocked" && this.seats[a.address]);
    const target = blocked.length && Math.random() < 0.6 ? blocked[Math.floor(Math.random() * blocked.length)] : null;
    const from = c.onDesk ? { r: at.r, x: at.x, seat: at.y } : { r: at.r, x: at.x };
    if (target) {
      const st = this.seats[target.address], k = g.k;
      const to = { r: st.row, x: Math.round(st.x + 20 * k), seat: Math.round(st.y - 7 * k) };
      c.path = this.path(from, to, CAT_WALK, Math.round((Math.random() * 16 - 8) * k));
      Object.assign(c, { i: 0, until: now + c.path[0].ms, left: true, resting: false, onDesk: true, watch: target.address });
    } else {
      const to = { r: Math.floor(Math.random() * (g.rows + 1)) - 1, x: Math.round(8 + Math.random() * (this.size.width - 60)) };
      c.path = this.path(from, to, CAT_WALK, Math.round((Math.random() * 16 - 8) * k));
      Object.assign(c, { i: 0, until: now + c.path[0].ms, left: c.path[0].left, resting: false, onDesk: false, watch: null });
    }
    return true;
  }

  // ---- drawing --------------------------------------------------------------

  desk(a, i, x, y, k, night) {
    const q = (v) => Math.round(v * k), R2 = (x, y, w, h, c) => r(q(x), q(y), q(w), q(h), c);
    const dl = deskLook(i, this.seed), status = a.status;
    const lit = a.focused || night;
    const el = div().absolute().left(x).top(y).w(q(SLOT_W)).h(q(130))
      .child(R2(52, 0, 66, 44, "#2b2f3a").child(this.screen(a, k)))
      .child(R2(80, 44, 10, 6, "#2b2f3a")).child(R2(70, 50, 30, 3, "#2b2f3a"))
      .child(R2(24, 52, 122, 12, "#f0dcb0")).child(R2(24, 64, 122, 20, "#d4b27c")).child(R2(24, 64, 122, 3, "#b48a52"))
      .child(R2(28, 84, 8, 18, "#b48a52")).child(R2(134, 84, 8, 18, "#b48a52"))
      .child(R2(66, 54, 38, 6, "#e7e9ee")).child(R2(110, 44, 9, 10, dl.mug))
      // lamp
      .child(R2(30, 50, 14, 3, "#3a3a3a")).child(R2(35, 32, 3, 18, "#3a3a3a")).child(R2(28, 26, 18, 8, dl.lamp))
      .when(lit, (e) => e.child(R2(26, 34, 22, 18, "#ffe9a055")).child(R2(31, 34, 12, 3, "#fff3b0")))
      .children(clutter(dl.clutter, R2))
      .child(R2(150, 58, 16, 40, dl.tower ? "#d9dce3" : "#3a3f4a").child(R2(3, 6, 8, 2, "#555")).child(R2(5, 26, 4, 4, status === "working" ? "#5ee08a" : "#777")));
    if (status === "working") el.child(txt("~", Math.max(8, q(12)), "#ffffff99").absolute().left(q(110)).top(q(30)).id(`steam-${i}`).frames(["", "~", "≈", "~"], 450));
    return el.id(`desk-${a.address}`).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => !this.demo && run("agent.focus", { terminal: a.address }))
      .on_hover((hov, cx) => {
        // Only a real change redraws: a redraw re-reports hover, and notifying again would loop.
        const next = hov ? a.address : this.hover === a.address ? null : this.hover;
        if (next !== this.hover) { this.hover = next; cx.notify(); }
      });
  }

  // The first worker on the floor is always Michels Mum. Everyone else gets a free old German
  // name; newcomers pick one nobody at a desk has, and a former Mum gets a normal name back.
  nameFor(a, used) {
    if (a.address === this.mumAddress) { this.names[a.address] = MUM; used.add(MUM); return MUM; }
    let name = this.names[a.address];
    if (!name || name === MUM || used.has(name)) {
      const free = NAMES.filter((n) => !used.has(n));
      name = free[Math.floor(Math.random() * free.length)] ?? NAMES[Math.floor(Math.random() * NAMES.length)];
      this.names[a.address] = name;
    }
    used.add(name);
    return name;
  }

  label(a, x, y, k) {
    const q = (v) => Math.round(v * k), fs = Math.max(8, q(12)), sub = Math.max(8, q(10));
    const task = taskOf(a) || a.tab_name;
    return v_flex().absolute().left(x).top(y + q(130)).w(q(SLOT_W)).items_center().gap(q(2))
      .child(h_flex().gap(q(6)).items_center()
        .child(icon(a.program, q(14)))
        .child(txt(this.names[a.address] ?? "", fs, a.focused ? "#fff8e1" : ink)))
      .when(!!task, (e) => e.child(h_flex().w(q(SLOT_W)).justify_center()
        .child(txt(task, sub, "#5f4a38").w(q(SLOT_W) - q(12)).whitespace_normal().text_center())));
  }

  screen(a, k) {
    const q = (v) => Math.round(v * k);
    const s = r(q(6), q(5), q(54), q(34), SCREEN[a.status] ?? SCREEN.idle);
    if (a.status === "working")
      return s.children([0, 1, 2, 3].map((i) => r(q(5), q(5 + i * 7), q(10), Math.max(1, q(3)), "#7ee0a0")
        .id(`code-${a.address}-${i}`).loop("width", { from: q(6), to: q(40 - i * 6), period: 600 + ((i * 337) % 700) + (a.address.length * 53) % 300 })));
    if (a.status === "blocked") {
      const fs = Math.max(8, q(12)), roomy = q(34) >= 2 * fs + 2;
      return s.flex().items_center().justify_center().child(v_flex().items_center().id(`need-${a.address}`).loop("opacity", { from: 0.25, to: 1, period: 700 })
        .children(roomy ? [txt("NEEDS", fs, "#fff8e1"), txt("YOU", fs, "#fff8e1")] : [txt("!", fs, "#fff8e1")]));
    }
    if (a.status === "done") return s.flex().items_center().justify_center().child(txt("OK", Math.max(8, q(16)), "#bfe0ff"));
    // Idle: a screensaver logo bouncing off the edges.
    const R = rng(hash(a.address)), lw = Math.max(14, q(24)), lh = Math.max(8, q(12)), fs = Math.max(8, q(10));
    return s.child(div().absolute().top(0).w(lw).h(q(34)).id(`dvd-x-${a.address}`)
      .loop("left", { from: 0, to: q(54) - lw, period: 3600 + Math.floor(R() * 2400), easing: "linear" })
      .child(div().absolute().left(0).w(lw).h(lh).bg(pick(R, DVD)).flex().items_center().justify_center().id(`dvd-y-${a.address}`)
        .loop("top", { from: 0, to: q(34) - lh, period: 2200 + Math.floor(R() * 1600), easing: "linear" })
        .child(txt("DVD", fs, "#36404c"))));
  }

  // ---- wall stats -----------------------------------------------------------
  // The floor's live dashboard: every agent on the floor, their completed turns, status counts
  // and a four-minute strip of how many workers were busy (`hist` is sampled in tick()). A
  // needs-you queue cycles through blocked workers on click. It hangs between the right
  // bookshelf and the window, or left of the shelves when the wall is narrower; it is rebuilt
  // every render (only the room under it is retained) and null when neither fits.
  statsBoard(w, crew, turns) {
    const bw = 236, bh = 116, mid = Math.round(w / 2);
    const gapL = mid + 268, gapR = w - 348; // past the right shelf, before the window
    let x = Math.round((gapL + gapR - bw) / 2);
    if (x < gapL + 8 || x + bw > gapR - 8) { // no room between the shelf and the window
      x = 140; // left of the left shelf, beside the sign
      if (x + bw > mid - 268) return null;
    }
    const y = 18, live = crew.length > 0;
    const count = (st) => crew.filter((a) => a.status === st).length;
    const blocked = crew.filter((a) => a.status === "blocked");
    const bars = Array.from({ length: HIST }, (_, i) => this.hist[i - (HIST - this.hist.length)] ?? 0);
    const peak = Math.max(1, ...bars), barW = 8;
    const stat = (c, label, n) => h_flex().items_center().gap(2)
      .child(div().w(4).h(4).bg(c))
      .child(txt(label, 10, "#a9b8cc"))
      .child(txt(String(n), 10, "#fff1d6"));
    return div().absolute().left(x).top(y).w(bw).h(bh).bg("#2b2f3a").border(3).border_color("#6b3f1f")
      .child(v_flex().absolute().left(0).top(0).w(bw - 6).h(bh - 6).bg("#121a24").p(7).gap(2).overflow_hidden()
        .child(h_flex().items_center().gap(4)
          .child(txt("OFFICE", 16, "#fff1d6"))
          .child(txt("STATS", 10, "#7d8a9a"))
          .child(div().flex_1())
          .child(div().w(4).h(4).bg(live ? "#5ee08a" : "#5b5b66").id("stats-live")
            .when(live, (e) => e.loop("opacity", { from: 0.3, to: 1, period: 900 })))
          .child(txt(live ? "LIVE" : "OFF", 10, live ? "#7ee0a0" : "#7d8a9a")))
        .child(h_flex().items_end().justify_between()
          .child(h_flex().items_end().gap(4)
            .child(txt(String(crew.length), 16, "#fff1d6"))
            .child(txt("SESSIONS", 10, "#8fa0b8")))
          .child(h_flex().items_end().gap(4)
            .child(txt(short(turns), 16, "#e0c040"))
            .child(txt("TURNS", 10, "#8fa0b8"))))
        .child(h_flex().justify_between()
          .child(stat("#5ee08a", "WORKING", count("working")))
          .child(stat("#e0504a", "NEEDS YOU", count("blocked"))))
        .child(h_flex().justify_between()
          .child(stat("#7aa8e0", "DONE", count("done")))
          .child(stat("#8a90a0", "IDLE", count("idle"))))
        .when(blocked.length > 0, (e) => {
          const target = blocked[this.blockedCursor % blocked.length];
          const who = this.names[target.address] ?? target.tab_name;
          const label = `${who}${blocked.length > 1 ? ` +${blocked.length - 1}` : ""}`;
          return e.child(h_flex().items_center().gap(4).cursor_pointer()
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              if (this.demo) return;
              this.blockedCursor = (this.blockedCursor + 1) % blocked.length;
              run("agent.focus", { terminal: target.address });
              cx.notify();
            })
            .child(txt("NEEDS YOU", 10, "#ff8a7a").id("stats-need")
              .loop("opacity", { from: 0.45, to: 1, period: 650 }))
            .child(div().flex_1())
            .child(txt(label, 10, "#fff1d6").truncate()));
        })
        .when(blocked.length === 0, (e) => e.child(h_flex().items_center().gap(4)
          .child(txt("ACTIVITY", 10, "#8fa0b8"))
          .child(div().flex_1())
          .child(txt("4 MIN", 8, "#63738a"))))
        .child(h_flex().items_end().gap(1).w(bw - 6 - 14)
          .children(bars.map((v) => div().w(barW)
            .h(v ? Math.max(2, Math.round((v / peak) * 16)) : 2).bg(v ? "#5ee08a" : "#26313f")))));
  }

  // The worker, at their seat or out walking. Each leg of a walk animates natively.
  worker(a, k, s) {
    const lk = look(a, { woman: a.address === this.mumAddress }), t = this.trips[a.address], id = `w-${a.address}`, seat = this.seats[a.address];
    let pos = seat, ms = 16, body;
    if (!t) {
      body = seated(lk, s, a.status === "done").id(`${id}-sit`);
      if (a.status === "working") body.loop("top", { from: 0, to: -Math.max(1, Math.round(s * 0.7)), period: lk.bob });
      if (a.status === "blocked") body.loop("top", { from: 0, to: -4 * s, period: 700 });
    } else {
      const p = t.path[t.i], there = t.phase === "there", enter = t.phase === "enter";
      pos = p;
      ms = enter ? 16 : p.ms;
      const wall = t.spot.key in { cooler: 1, shelfL: 1, shelfR: 1, window: 1, door: 1, smoke: 1 };
      const facing = enter ? "front" : there ? (wall ? "back" : "front") : p.facing;
      const item = there && t.spot.key === "cooler" ? "cup"
        : there && t.spot.key === "smoke" ? "cig"
        : there && t.spot.key.startsWith("shelf") ? "book" : null;
      body = standing(lk, s, facing, !there && !enter && !t.hold, item, id);
    }
    const th = this.thoughts[a.address];
    const there = t?.phase === "there";
    const atCooler = there && t.spot.key === "cooler";
    const chatting = there && t.spot.key === "chat";
    // One speaker per spot: two bubbles at the cooler or a shared desk would sit on top of each
    // other. The lowest address hash talks; the other keeps sipping.
    const mates = atCooler || chatting ? this.list.filter((o) => {
      const ot = this.trips[o.address];
      return ot?.phase === "there" && ot.spot.key === t.spot.key
        && (t.spot.key !== "chat" || ot.spot.other === t.spot.other);
    }) : [];
    const speaks = !mates.length || mates.sort((a, b) => hash(a.address) - hash(b.address))[0].address === a.address;
    const talk = (atCooler || chatting) && speaks
      ? SMALL_TALK[hash(`${a.address}:${t.until}`) % SMALL_TALK.length] : null;
    return div().id(id).absolute().left(pos.x).top(pos.y).w(16 * s).h(20 * s)
      .transition("left", { duration: ms, easing: "linear" }).transition("top", { duration: ms, easing: "linear" })
      .cursor_pointer().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(() => !this.demo && run("agent.focus", { terminal: a.address }))
      .child(body)
      .when(!t && a.status === "done", (e) => e.child(txt("z", 16, "#24406e").absolute().left(14 * s).top(-2 * s).id(`${id}-z`).frames(["z", "zZ", "zZz", ""], 500)))
      .when(t?.phase === "there" && t.spot.key === "smoke", (e) => e.child(txt("~", 12, "#e8e8e8")
        .absolute().left(13 * s).top(-4 * s).id(`${id}-smoke`).frames(["", "~", "≈", "~", ""], 700)))
      .when(!!talk, (e) => e.child(bubble(txt(talk, 10, ink).w(100).whitespace_normal()).left(10 * s).top(-6 * s)))
      .when(chatting && !talk, (e) => e.child(bubble(txt(".", 12, ink).id(`${id}-chat`).frames([".", "..", "..."], 400)).left(10 * s).top(-6 * s)))
      .when(!!th && !chatting && !atCooler, (e) => e.child(bubble(txt(th.sym, 12, ink)).left(11 * s).top(-6 * s)));
  }

  render() {
    const p = props() ?? {};
    this.demo = !!p.demo;
    if (p.role === "pane") {
      const pane = panes().find((x) => x.pane === p.pane);
      const st = pane?.status;
      return h_flex().size_full().px(10).gap(8).items_center().bg("#c99a62")
        .child(icon(pane?.program)).child(txt(pane?.program?.name ?? "Terminal", 12, ink))
        .child(div().flex_1())
        .child(txt(st === "blocked" ? "NEEDS YOU" : (st ?? "").toUpperCase(), 12, st === "blocked" ? "#a8322a" : ink));
    }
    if (p.role === "rail") {
      const s = spaces().find((s) => s.active), tab = s?.tabs.find((t) => t.active), demo = !!p.demo;
      return h_flex().size_full().bg(wood).px(16).items_center()
        .child(txt(`${s?.name ?? ""} / ${tab?.name ?? ""}`, 12, "#fff1d6"))
        .child(div().flex_1())
        .child(div().px(8).py(2).bg("#fbfbf6").border(2).border_color("#6b3f1f").cursor_pointer()
          .hover((e) => e.bg("#fff1d6"))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            if (demo) return;
            const want = p.agent; // the program to start ("omp" in the layout); unset: most-used installed
            const remote = !!s?.machine; // pickFolder sees this machine only
            cx.spawn(async () => {
              const [folder, known] = await Promise.all([
                remote ? null : pickFolder({ prompt: "Starten" }),
                knownAgents(),
              ]);
              if (!remote && !folder) return;
              const ag = want
                ? known.find((x) => x.installed && (x.key === want || x.run[0] === want))
                : known.find((x) => x.installed);
              run("tab.new", {
                ...(s ? { space: s.id } : {}),
                ...(folder ? { folder } : {}),
                ...(ag ? { argv: ag.run } : want ? { argv: [want] } : {}),
              });
            });
          })
          .child(txt("Neuen einstellen", 12, ink)));
    }
    // props.demo fills the desks with sample workers in every state (for previews).
    const list = p.demo ? DEMO : agents();
    this.list = list;
    this.mumAddress = list[0]?.address ?? null;
    const usedNames = new Set();
    for (const a of list) this.nameFor(a, usedNames);
    const crew = list;
    const terms = p.demo ? [] : terminals();
    const nowMs = Date.now();
    const arrivals = this.known ? list.filter((a) => !this.known.has(a.address)) : [];
    const turnOf = new Map(terms.map((t) => [t.address, Number(t.turn) || 0]));
    for (const a of list) {
      const prev = this.since[a.address];
      if (prev?.status !== a.status) {
        this.since[a.address] = { status: a.status, at: nowMs };
        if (prev) {
          if (a.status === "blocked") this.pushNews(`${this.names[a.address]} braucht dich`, "#a8322a");
          else if (a.status === "done") this.pushNews(`${this.names[a.address]} ist fertig`, "#2f6b4f");
        }
      }
      if (turnOf.has(a.address)) {
        const turn = turnOf.get(a.address), last = this.lastTurn[a.address];
        if (last == null || turn < last) this.lastTurn[a.address] = turn;
        else if (Math.floor(turn / 100) > Math.floor(last / 100)) {
          this.lastTurn[a.address] = turn;
          this.pushNews(`${this.names[a.address]}: ${Math.floor(turn / 100) * 100} Turns`, "#8a6a2a");
        }
      }
    }
    for (const a of arrivals) this.pushNews(`Neu: ${this.names[a.address]}`, "#2f6b4f");
    if (p.demo && !this.newsSeeded) {
      this.news = [];
      this.pushNews("Neuer Kollege: Dietrich", "#2f6b4f");
      this.newsSeeded = true;
    }
    const addresses = new Set(crew.map((a) => a.address));
    const turns = p.demo ? 128 : terms
      .filter((t) => addresses.has(t.address))
      .reduce((n, t) => n + (Number(t.turn) || 0), 0);
    if (p.demo && !this.histSeeded) {
      const R = rng(this.seed ^ 0x51ed);
      this.hist = Array.from({ length: HIST }, () => 2 + Math.floor(R() * 9));
      this.histSeeded = true;
    }

    const { width: w, height: h } = this.size, now = new Date(), hour = now.getHours();
    const night = hour >= 19 || hour < 6;
    const stats = this.statsBoard(w, crew, turns);
    // One group of desks per project: a space someone named, else the folder the agent's
    // terminal works in. Agents of one project share a rug even when their spaces differ.
    const cwdOf = new Map(terms.map((t) => [t.address, t.cwd]));
    const spaceOf = new Map(p.demo ? [] : spaces().map((s) => [s.id, s]));
    const projectOf = (a) => {
      if (p.demo) return { key: `space:${a.space}`, name: a.space_name };
      const space = spaceOf.get(a.space), cwd = cwdOf.get(a.address), dir = dirName(cwd);
      if (space?.named) return { key: `space:${a.space}`, name: space.name || a.space_name };
      if (!cwd) return { key: `space:${a.space}`, name: a.space_name || "" };
      return {
        key: `dir:${space?.machine ?? ""}:${dirKey(cwd)}`,
        name: sameDir(cwd, space?.folder) ? (a.space_name || dir) : (dir || a.space_name || ""),
      };
    };
    const groups = [], byKey = new Map();
    for (const a of list) {
      const { key, name } = projectOf(a);
      let g = byKey.get(key);
      if (!g) { g = { key, space: a.space, name, agents: [] }; byKey.set(key, g); groups.push(g); }
      g.agents.push(a);
    }
    if (!groups.length) groups.push({ key: "", space: null, name: "", agents: [] });
    // agent.next / agent.prev follow the desks as drawn, not the host's space order.
    if (!p.demo) setAgentOrder(groups.flatMap((g) => g.agents.map((a) => a.address)));
    const projectName = new Map(groups.flatMap((g) => g.agents.map((a) => [a.address, g.name])));
    // A rug colour per project, fixed by its key, never the same as the group beside it.
    groups.forEach((g, gi) => {
      g.rug = hash(p.demo ? (g.space ?? g.name) : g.key) % RUGS.length;
      if (gi && g.rug === groups[gi - 1].rug) g.rug = (g.rug + 1) % RUGS.length;
    });
    const { k, s, cols, rows } = fit(groups.map((g) => g.agents.length), w, h);
    const sw = Math.round(SLOT_W * k), sh = Math.round(SLOT_H * k), gap = Math.round(GAP * k), q = (v) => Math.round(v * k);
    const width = cols.reduce((a, b) => a + b, 0) * sw + (groups.length - 1) * gap;
    const top = WALL + q(40), lanes = [];
    const desks = []; // { a, x, y, row }
    let x0 = Math.round((w - width) / 2);
    groups.forEach((g, gi) => {
      Object.assign(g, { x: x0, w: cols[gi] * sw, rows: Math.ceil(g.agents.length / cols[gi]) });
      for (let j = 0; j < g.agents.length; j++)
        desks.push({ a: g.agents[j], x: x0 + (j % cols[gi]) * sw, y: top + Math.floor(j / cols[gi]) * sh, row: Math.floor(j / cols[gi]) });
      x0 += g.w + gap;
      if (gi < groups.length - 1) lanes.push(x0 - gap + Math.round((gap - 16 * s) / 2));
    });
    const left = groups[0].x, right = left + width;
    const leftX = Math.max(4, left - 16 * s - 6), rightX = Math.min(w - 16 * s - 4, right + 6);
    this.geo = { k, s, sh, top, rows, topY: WALL - 40, leftX, rightX, lanes: [leftX, ...lanes, rightX] };

    // Newcomers walk in through the door.
    const ts = Date.now();
    for (const d of desks) {
      const a = d.a;
      this.seats[a.address] = { x: d.x + q(61), y: d.y + q(50), row: d.row };
      if (this.known && !this.known.has(a.address)) {
        const door = this.spotPlace({ key: "door", jx: 0 });
        const path = [{ x: door.x, y: this.laneY(-1), r: -1, ms: 16 }, ...this.path(door, this.seatPlace(a.address), WALK, this.off(a.address))];
        this.trips[a.address] = { phase: "enter", spot: { key: "door" }, path, i: 0, until: ts + 700, hold: 0 };
        this.door = ts + 4000;
      }
    }
    this.known = new Set(list.map((a) => a.address));
    for (const key of Object.keys(this.since)) if (!this.known.has(key)) delete this.since[key];
    for (const key of Object.keys(this.lastTurn)) if (!this.known.has(key)) delete this.lastTurn[key];
    for (const key of Object.keys(this.trips)) if (!this.known.has(key)) delete this.trips[key];
    for (const t of Object.values(this.trips)) if (t.phase === "enter" && ts >= t.until) t.phase = "back";

    const c = this.cat, cp = c.path?.[c.i] ?? { x: Math.round(w / 3), y: this.geo.topY, ms: 16 };
    const onDesk = c.onDesk && c.i === (c.path?.length ?? 0) - 1;
    const petting = this.pet > Date.now();
    const hd = desks.find((d) => d.a.address === this.hover), hovered = hd?.a;
    return div().id("office-root").relative().size_full().overflow_hidden().bg("#e2a465")
      .on_size_change((size, cx) => { this.size = size; this.syncRoom(); cx.notify(); })
      .child(this.roomView)
      .when(!!stats, (e) => e.child(stats))
      .children(groups.filter((g) => g.name).map((g) => {
        const [col, edge] = RUGS[g.rug], rw = g.w + q(16), rh = g.rows * sh + q(4);
        return r(g.x - q(8), top - q(8), rw, rh, col).border(3).border_color(edge)
          .child(r(q(6), q(6), rw - q(12) - 6, rh - q(12) - 6, col).border(1).border_color(`${edge}aa`));
      }))
      .children(desks.map((d, i) => this.desk(d.a, i, d.x, d.y, k, night)))
      .children(desks.map((d) => this.label(d.a, d.x, d.y, k)))
      .children(groups.filter((g) => g.name).map((g) => {
        const edge = RUGS[g.rug][1], ts = Math.max(8, q(16));
        return div().absolute().left(g.x - q(8)).top(top - q(8) - ts - 8).px(8).py(4).bg(edge)
          .child(txt(g.name.slice(0, 20), ts, "#fff8e1"));
      }))
      .children(list.map((a) => this.worker(a, k, s)))
      .child(div().id("cat").absolute().left(cp.x).top(cp.y + (onDesk ? 0 : Math.round(30 * k)))
        .transition("left", { duration: cp.ms, easing: "linear" }).transition("top", { duration: cp.ms, easing: "linear" })
        .cursor_pointer()
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.pet = Date.now() + 2500; cx.notify(); })
        .child(cat(c.coat, s, onDesk ? true : c.left))
        .when(petting, (e) => e.child(bubble(txt("♥", 12, "#b83a5a")).left(10 * s).top(-6 * s))))
      .when(night, (e) => e.child(r(0, 0, w, h, "#0b123650")))
      .when(hour >= 17 && hour < 19, (e) => e.child(r(0, 0, w, h, "#f2a65a1a")))
      .when(!!hovered, (e) => {
        const x = Math.min(hd.x + sw - 10, w - 200);
        const who = [this.names[hovered.address], hovered.tab_name].filter(Boolean).join(" · ");
        const where = [projectName.get(hovered.address), hovered.space_name].filter((v, i, all) => v && all.indexOf(v) === i).join(" · ");
        const task = taskOf(hovered);
        return e.child(v_flex().absolute().left(x).top(hd.y).w(180).p(8).gap(4).bg("#fff27a").border(2).border_color("#d8c440")
          .child(txt(who, 12, ink).truncate())
          .child(txt(where, 12, "#6b5a4a").truncate())
          .when(!!task, (e) => e.child(txt(task, 12, "#6b5a4a").whitespace_normal()))
          .child(txt(hovered.status.toUpperCase(), 12, hovered.status === "blocked" ? "#a8322a" : ink)));
      })
      .child(v_flex().absolute().left(16).top(14).gap(4).p(8).bg("#fbfbf6").border(3).border_color("#6b3f1f")
        .child(txt("THE OFFICE", 16)).child(txt(`${list.length} on the clock`, 12, "#6b5a4a"))
        .when(!!this.news.length, (e) => e.child(txt(this.news[0].text, 10, this.news[0].tone).w(92).whitespace_normal())));
  }
}

const bubble = (content) => div().absolute().px(4).py(2).bg("#ffffff").border(2).border_color(ink).child(content);
