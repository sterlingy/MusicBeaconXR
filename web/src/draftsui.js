// The Globe tab's "My beacons": the user's own grids, custom maps and planted
// songs (src/drafts.js), kept on this device (src/draftstore.js), drawn on
// the map and blended into the music as the user layer. No server yet: this
// is step 1 of docs/beacon-database-plan.md.

import * as D from "./drafts.js";
import { DraftStore } from "./draftstore.js";
import { SharedMap, supabaseFetcher } from "./shared.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { Auth } from "./auth.js";
import * as S from "./submit.js";
import { tilesAround } from "./shared.js";
import { shareGlow } from "./glow.js";

const KIND_LABEL = { gen: "generated", edited: "edited", plant: "planted song", map: "map beacon" };
/** How often the shared map checks the tiles around you, and how far you move before it checks sooner. */
const SHARED_EVERY_MS = 60000, SHARED_MOVE_DEG = 0.05;
const UID = "u:"; // engine ids of user beacons: "u:" + pool entry key

/**
 * Wires My beacons into the page. `ctx` gives what it needs from app.js:
 * engine, input, ui, $, view, select, setMsg, esc, fmtDist, label (canvas
 * text), moodColor, renderInspector, canvas.
 */
export function initDrafts(ctx) {
  const { engine, ui, $, esc, setMsg } = ctx;
  const store = new DraftStore();
  const st = {
    doc: D.normalizeDoc(D.emptyDoc()),
    pool: null,
    byKey: new Map(),
    beacons: new Map(), // entry key -> beacon object the engine and UI use
    shares: null,
    placing: null, // map id while placing beacons by tapping the map
    lastFix: null, // the latest location fix {lat, lon, accuracy, at}
    offer: null,
    offerKey: "",
    ready: false,
    shared: null, // the shared map (step 2): other people's beacons, by 1 degree tile
    sharedAt: 0,
    sharedPos: null,
  };
  st.shared = new SharedMap({ fetcher: supabaseFetcher({ url: SUPABASE_URL, key: SUPABASE_KEY }), cache: store.tileCache() });
  const auth = new Auth({ url: SUPABASE_URL, key: SUPABASE_KEY });
  const rest = (...a) => auth.rest(...a);
  /** Reads public rows without signing in. */
  const publicGet = async (path) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY } });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  };
  const favCounts = new Map(); // shared beacon key -> how many people favorited it
  let songTimer = 0;
  st.shared.onSong = () => { clearTimeout(songTimer); songTimer = setTimeout(() => changed({ save: false }), 150); };
  const msg = (t, err = false) => setMsg("dMsg", t, err);
  const isUser = (id) => typeof id === "string" && id.startsWith(UID);
  const entryOf = (id) => (isUser(id) ? st.byKey.get(id.slice(UID.length)) : null);

  // ---------------------------------------------------------------- pool and engine

  function beaconOf(e) {
    let b = st.beacons.get(e.key);
    if (!b) {
      b = { id: UID + e.key, pos: e.pos, label: labelOf(e), entry: e };
      st.beacons.set(e.key, b);
    }
    return b;
  }

  function labelOf(e) {
    if (e.shared) return e.kind === "plant" ? "Shared song" : `Shared grid · ${gridOffset(e)}`;
    if (e.kind === "plant") return `Planted · ${e.song().title}`;
    if (e.kind === "map") {
      const m = st.doc.maps.find((x) => x.id === e.source.id);
      return `${e.source.name} #${(m?.beacons.findIndex((b) => b.id === e.key) ?? -1) + 1}`;
    }
    return `${e.source.name} · ${gridOffset(e)}`;
  }

  function gridOffset(e) {
    const km = (n) => +((Math.abs(n) * e.spacingM) / 1000).toFixed(1);
    return [e.north ? `${km(e.north)}${e.north > 0 ? "N" : "S"}` : "", e.east ? `${km(e.east)}${e.east > 0 ? "E" : "W"}` : ""].filter(Boolean).join(" ") || "center";
  }

  const SHARED_NO = "Shared beacons belong to whoever made them, so they can't be changed here. Plant your own song instead.";

  /** Rebuilds the pool after any change, saves, and redraws. */
  /** Server ids of this device's own submissions: they play as its drafts, not twice. */
  function mySharedIds() {
    const ids = new Set();
    for (const x of [...st.doc.grids, ...st.doc.plants, ...st.doc.maps]) if (x.sharedId) ids.add(x.sharedId);
    return ids;
  }

  function changed({ save = true } = {}) {
    st.pool = D.buildPool(st.doc, { shared: { doc: st.shared.doc(), song: (id) => st.shared.song(id), mine: mySharedIds() } });
    st.byKey = new Map(st.pool.entries.map((e) => [e.key, e]));
    st.beacons.clear();
    if (save) store.save(st.doc);
    st.offerKey = "";
    engine.songRev = (engine.songRev || 0) + 1;
    ui.zoneKey = "";
    engine.refresh();
    renderList();
    ctx.renderInspector();
  }

  engine.layer = (pos, opts) => {
    if (!st.pool) return null;
    const L = D.userLayer(st.pool, pos, opts);
    st.shares = D.layerShares(L, st.pool.exclusive);
    return {
      globeShare: st.shares.globeShare,
      entries: L.active.map((a) => ({ id: UID + a.entry.key, w: a.w * L.u, d: a.d / 1000, beacon: beaconOf(a.entry), song: a.entry.song() })),
    };
  };
  engine.layerSong = (id) => entryOf(id)?.song() || null;

  // ---------------------------------------------------------------- location

  /** A location fix: the follow-me one if fresh, else a new one. Dev server: ?fakegps=lat,lon[,accuracy]. */
  async function getFix() {
    const fake = window.BEACON_DEV_LOG && new URLSearchParams(location.search).get("fakegps");
    if (fake) {
      const [lat, lon, acc] = fake.split(",").map(Number);
      return { lat, lon, accuracy: Number.isFinite(acc) ? acc : 10, at: Date.now(), fake: true };
    }
    if (st.lastFix && Date.now() - st.lastFix.at < 30000) return st.lastFix;
    if (!navigator.geolocation || !window.isSecureContext) throw new Error("This page can't read your location (it needs HTTPS or localhost), and beacons can only be made where you are.");
    msg("Finding you… (allow location if your browser asks)");
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }))
      .catch((err) => { throw new Error(err.code === 1 ? "Location is blocked for this page, and beacons can only be made where you are." : "Couldn't find your location: " + (err.message || "unavailable")); });
    st.lastFix = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() };
    return st.lastFix;
  }

  /** A fix that's allowed to make beacons, or null after saying why not. */
  async function presentFix() {
    let fix;
    try { fix = await getFix(); } catch (err) { msg(err.message, true); return null; }
    const why = D.fixProblem(fix);
    if (why) { msg(why, true); return null; }
    return fix;
  }

  // ---------------------------------------------------------------- actions

  async function generate(spacingM, center = null, half = D.DEFAULT_HALF) {
    const fix = await presentFix();
    if (!fix) return;
    const g = D.makeGrid(st.doc, fix, spacingM, { center, half });
    if (center && !D.inGrid(g, fix)) { st.doc.nextNumber--; return msg("You need to be inside the next grid to make it. Walk on a little and try again.", true); }
    const same = st.doc.grids.find((x) => x.center === g.center && x.spacingM === spacingM && D.halfOf(x) === half);
    if (same) { st.doc.nextNumber--; return msg(`${same.name} is already here, with the same size and spacing. New grids are made where you really are (your location), not where you're looking: walk on, or pick another size or spacing.`, true); }
    st.doc.grids.push(g);
    changed();
    goTo(g);
    msg(`${g.name}: ${D.gridStats(g).beacons} beacons, one every ${ctx.fmtDist(spacingM)}, ${D.gridStats(g).sideKm} km a side, centered where you are.${fix.fake ? " (test location)" : ""}`);
  }

  async function plant(song, rangeM) {
    const fix = await presentFix();
    if (!fix) return;
    try {
      const p = D.plantSong(st.doc, fix, song, rangeM);
      st.doc.prefs.plantsOn = true;
      changed();
      ctx.select(UID + p.id);
      msg(`Planted "${p.song.title}" where you are, heard within ${ctx.fmtDist(p.rangeM)}.`);
    } catch (err) { msg("Couldn't plant it: " + err.message, true); }
  }

  function goTo(item) {
    let pos;
    if (item.center) pos = D.parsePoint(item.center);
    else if (item.beacons?.length) pos = item.beacons[0];
    else if (item.point) pos = D.parsePoint(item.point);
    if (!pos) return;
    // A jump like any other: a followed flight, auto-walk and following your location stop.
    if (ctx.jumpTo) ctx.jumpTo(pos.lat, pos.lon, "Jumped to your beacons");
    else { ctx.stopFollow?.("Jumped to your beacons, so the map stopped following your location."); ctx.input.target = null; engine.setPosition({ lat: pos.lat, lon: pos.lon }); }
    ui.closeKm = item.spacingM ? Math.max(2, (D.sidePoints(item) + 3) * item.spacingM / 1000) : 3;
    ctx.setZoom("close");
  }

  function download(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "beacons";

  function exportItem(item) {
    const doc = { ...D.emptyDoc(), grids: item.center ? [item] : [], maps: item.beacons ? [item] : [], plants: item === "plants" ? st.doc.plants : [] };
    download(`${slug(item === "plants" ? "planted songs" : item.name)}.beacons.json`, doc);
  }

  async function importFile(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (err) { return msg("That file isn't JSON: " + err.message, true); }
    const errs = D.validateDoc(data);
    if (errs.length) return msg("Not imported: " + errs.slice(0, 3).join("; "), true);
    const n = D.mergeDoc(st.doc, data);
    changed();
    msg(`Imported ${n.grids} grid${n.grids === 1 ? "" : "s"}, ${n.maps} map${n.maps === 1 ? "" : "s"} and ${n.plants} planted song${n.plants === 1 ? "" : "s"}, as copies.`);
  }

  function findItem(id) {
    return st.doc.grids.find((g) => g.id === id) || st.doc.maps.find((m) => m.id === id) || (id === "plants" ? "plants" : null);
  }

  function act(action, id) {
    const item = findItem(id);
    if (!item) return;
    const name = item === "plants" ? "Planted songs" : item.name;
    switch (action) {
      case "go": {
        if (item === "plants") { const p = st.doc.plants.at(-1); if (p) goTo(p); return; }
        if (item.beacons && !item.beacons.length) return msg(`${item.name} has no beacons yet. Tap "Place beacons", then tap the map.`);
        return goTo(item);
      }
      case "toggle": if (item === "plants") st.doc.prefs.plantsOn = !st.doc.prefs.plantsOn; else item.on = !item.on; return changed();
      case "exclusive": item.exclusive = !item.exclusive; return changed();
      case "regen": D.regenerateAll(item); changed(); return msg(`New songs on all of ${item.name}'s generated beacons. Edited songs stayed.`);
      case "rename": {
        const v = prompt(`New name for ${name}:`, name);
        if (v && v.trim()) { item.name = v.trim().slice(0, 60); changed(); }
        return;
      }
      case "dup": {
        const c = D.duplicate(st.doc, item);
        (item.beacons ? st.doc.maps : st.doc.grids).push(c);
        changed();
        return msg(`Made ${c.name}.`);
      }
      case "export": return exportItem(item);
      case "share": return shareItem(item);
      case "delete": {
        const what = item === "plants" ? `all ${st.doc.plants.length} planted songs` : item.name;
        const still = item === "plants" ? st.doc.plants.some((p) => p.sharedId) : !!item.sharedId;
        if (!confirm(`Delete ${what} from this device? This can't be undone (export it first to keep a copy).${still ? " It stays on the shared map: unshare it first to take it off." : ""}`)) return;
        if (item === "plants") st.doc.plants = [];
        else if (item.beacons) st.doc.maps = st.doc.maps.filter((m) => m !== item);
        else st.doc.grids = st.doc.grids.filter((g) => g !== item);
        if (st.placing === id) st.placing = null;
        changed();
        return msg(`Deleted ${what}.`);
      }
      case "place": {
        st.placing = st.placing === id ? null : id;
        if (st.placing) { item.on = true; changed({ save: true }); ctx.stopFollow?.(); if (ui.zoom !== "close") { ui.closeKm = ui.closeKm || 3; ctx.setZoom("close"); } msg(`Tap the map to put beacons on ${item.name}. Tap "Done placing" when finished.`); }
        else { renderList(); msg(""); }
        return;
      }
    }
  }

  /** While placing: a tap on the map puts a beacon on the map being edited. Returns true when it did. */
  function placeAt(pos) {
    if (!st.placing) return false;
    const m = st.doc.maps.find((x) => x.id === st.placing);
    if (!m) { st.placing = null; return false; }
    const why = D.placeProblem(pos);
    if (why) { msg(why, true); return true; }
    const b = D.addMapBeacon(m, pos, { rangeM: +$("dRange").value || D.PLANT_RANGE_M });
    changed();
    ctx.select(UID + b.id);
    msg(`Beacon ${m.beacons.length} on ${m.name}, heard within ${ctx.fmtDist(b.rangeM)}. Tap again for another.`);
    return true;
  }

  // ---------------------------------------------------------------- songs on user beacons

  /** Puts `song` on a user beacon (an edit, a pasted song). Generated beacons become "edited". */
  function setSong(id, song) {
    const e = entryOf(id);
    if (!e) return false;
    if (e.shared) { msg(SHARED_NO, true); return true; }
    const copy = JSON.parse(JSON.stringify(song));
    if (e.kind === "plant") e.plant.song = copy;
    else if (e.kind === "map") e.mapBeacon.song = copy;
    else st.doc.grids.find((g) => g.id === e.source.id).edited[e.point] = copy;
    changed();
    return true;
  }

  /** A new generated song for a user beacon. Returns a message, or null if it isn't one. */
  function regenerate(id) {
    const e = entryOf(id);
    if (!e) return null;
    if (e.shared) return SHARED_NO.replace("so they", "so their songs");
    if (e.kind === "plant") return "A planted song is hand-made, so it has no generated song. Edit it, or remove it.";
    if (e.kind === "map") { delete e.mapBeacon.song; e.mapBeacon.variant = (e.mapBeacon.variant || 0) + 1; }
    else D.regenerateOne(st.doc.grids.find((g) => g.id === e.source.id), e.point);
    changed();
    return `New song on ${labelOf(st.byKey.get(e.key))}: ${st.byKey.get(e.key).song().title}`;
  }

  function removeBeacon(id) {
    const e = entryOf(id);
    if (!e || e.shared || (e.kind !== "plant" && e.kind !== "map")) return;
    if (!confirm(`Remove "${e.song().title}" (${labelOf(e)}) from this device?`)) return;
    if (e.kind === "plant") st.doc.plants = st.doc.plants.filter((p) => p !== e.plant);
    else { const m = st.doc.maps.find((x) => x.id === e.source.id); m.beacons = m.beacons.filter((b) => b !== e.mapBeacon); }
    ui.selected = null;
    changed();
  }

  function favorite(id) {
    const e = entryOf(id);
    if (!e) return;
    const fav = st.doc.prefs.favorites;
    const off = fav[e.point] === e.key;
    if (off) delete fav[e.point];
    else fav[e.point] = e.key;
    changed();
    // Favorites of shared beacons count for everyone (when signed in).
    if (auth.user && e.shared) {
      S.setFavorite(rest, e.point, off ? null : e).then(() => { favCounts.delete(S.sharedBeaconKey(e)); loadCounts(e); }, () => {});
    }
  }

  function setRange(id, m) {
    const e = entryOf(id);
    if (!e || e.shared) return;
    const r = D.clampRange(m);
    if (e.kind === "plant") e.plant.rangeM = r;
    else if (e.kind === "map") e.mapBeacon.rangeM = r;
    else return;
    changed();
  }

  /** Extra inspector content for a user beacon (HTML), or "" for a globe beacon. */
  function inspectorHtml(id) {
    const e = entryOf(id);
    if (!e) return "";
    const at = songsHere(e);
    const playing = st.pool.playing.find((x) => x.point === e.point);
    const favKey = st.doc.prefs.favorites[e.point];
    const isFav = favKey === e.key;
    const local = Object.values(st.doc.prefs.favorites).filter((k) => k === e.key).length;
    if (e.shared) loadCounts(e);
    const remote = e.shared ? favCounts.get(S.sharedBeaconKey(e)) : null;
    const favs = remote ?? local;
    const rows = at.length > 1 ? `<div class="dspot"><small>${at.length} songs at this spot · playing by <b>${esc(D.PLAY_MODE_LABEL[st.doc.prefs.playMode])}</b></small>${at.map((x) =>
      `<button class="etab" data-insp="${esc(UID + x.key)}" aria-pressed="${x.key === e.key}">${x.key === playing?.key ? "▶ " : ""}${esc(x.song()?.title || "loading…")}${x.shared ? " · shared" : ""}${favKey === x.key ? " ★" : ""} <small>${esc(KIND_LABEL[x.kind])}</small></button>`).join("")}</div>` : "";
    const ranged = !e.shared && (e.kind === "plant" || e.kind === "map");
    return `<div class="chips">
        <span class="chip" style="border-color:${e.tint}"><b>${esc(e.source.name)}</b></span>
        <span class="chip">${esc(KIND_LABEL[e.kind])}</span>
        <span class="chip">heard within <b>${esc(ctx.fmtDist(e.rangeM))}</b></span>
        <span class="chip" title="${e.shared ? "How many people favorited it" : "Only you, until it's shared"}">♥ favorited <b>${favs ?? "…"}</b>×</span>
        ${e.plant?.sharedId ? `<span class="chip"><b>shared</b></span>` : ""}
        ${e.key !== playing?.key ? `<span class="chip"><b>not playing</b> (another song here plays)</span>` : ""}
      </div>${rows}
      <div class="row">
        <button class="btn small" data-dact="fav">${isFav ? "★ Unfavorite" : "☆ Favorite"}</button>
        ${e.kind === "plant" && !e.shared ? `<button class="btn small" data-dact="${e.plant.sharedId ? "unshareplant" : "shareplant"}">${e.plant.sharedId ? "Unshare" : "Share this song"}</button>` : ""}
        ${e.shared ? `<label class="inline">Report <select data-dact="reason">${S.REPORT_REASONS.map((r) => `<option>${r}</option>`).join("")}</select></label><button class="btn small" data-dact="report">Report</button>` : ""}
        ${ranged ? `<label class="inline">Range <input type="number" min="${D.MIN_RANGE_M}" max="${D.MAX_RANGE_M}" step="100" value="${e.rangeM}" data-dact="range" style="width:6em"> m</label>
        <button class="btn small" data-dact="remove">Remove</button>` : ""}
      </div>`;
  }

  /** Every song at an entry's point (the playing one and the others). */
  function songsHere(e) {
    return D.songsAtPoint(st.pool.groups.get(e.point) || [e]);
  }

  $("insp").addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-insp],[data-dact]");
    if (!t) return;
    if (t.dataset.insp) return ctx.select(t.dataset.insp);
    const id = ctx.inspectedId();
    if (t.dataset.dact === "fav") favorite(id);
    else if (t.dataset.dact === "remove") removeBeacon(id);
    else if (t.dataset.dact === "shareplant" || t.dataset.dact === "unshareplant") sharePlantEntry(entryOf(id), t.dataset.dact === "shareplant");
    else if (t.dataset.dact === "report") reportEntry(entryOf(id), $("insp").querySelector("[data-dact=reason]").value);
  });
  $("insp").addEventListener("change", (ev) => {
    const t = ev.target.closest("[data-dact=range]");
    if (t) setRange(ctx.inspectedId(), +t.value);
  });

  /** Finds a beacon object by engine id, including songs at a spot that aren't playing. */
  function findBeacon(id) {
    const e = entryOf(id);
    return e ? beaconOf(e) : null;
  }

  // ---------------------------------------------------------------- sharing (step 3)

  /** Asks for the terms once, in a dialog. Resolves true when accepted. */
  function askTerms() {
    const dlg = $("dTerms");
    $("dTermsText").innerHTML = S.TERMS_TEXT.map((t) => `<p>${esc(t)}</p>`).join("");
    return new Promise((resolve) => {
      dlg.onclose = () => resolve(dlg.returnValue === "accept");
      dlg.showModal();
    });
  }

  /** Runs `fn` signed in and with the terms accepted; says why not otherwise. */
  async function asSharer(what, fn) {
    if (!auth.user) {
      msg(`Sign in (under Account, below) to ${what}.`, true);
      $("dEmail").focus();
      return false;
    }
    try {
      if (!(await S.hasConsent(rest))) {
        if (!(await askTerms())) { msg("Not shared: the terms weren't accepted."); return false; }
        await S.acceptTerms(rest);
      }
      await fn();
      return true;
    } catch (err) {
      msg(`Couldn't ${what}: ${err.message}`, true);
      return false;
    }
  }

  async function shareItem(item) {
    const table = item === "plants" ? "plants" : item.beacons ? "maps" : "grids";
    if (item === "plants") {
      const todo = st.doc.plants.filter((p) => !p.sharedId);
      if (!todo.length) return msg("All your planted songs are shared already.");
      if (await asSharer("share your planted songs", async () => { for (const p of todo) await S.sharePlant(rest, p); })) {
        changed();
        msg(`Shared ${todo.length} planted song${todo.length === 1 ? "" : "s"}. Everyone near them hears them now.`);
      }
      return;
    }
    if (item.sharedId) {
      if (!confirm(`Unshare ${item.name}? It comes off the shared map for everyone; it stays on this device.`)) return;
      if (await asSharer(`unshare ${item.name}`, () => S.unshare(rest, table, item))) { changed(); msg(`${item.name} is no longer shared.`); }
      return;
    }
    if (await asSharer(`share ${item.name}`, () => (table === "maps" ? S.shareMap(rest, item) : S.shareGrid(rest, item)))) {
      changed();
      msg(table === "maps" ? `Shared ${item.name}: it's listed for everyone to find.` : `Shared ${item.name}: everyone near it hears it now.`);
    }
  }

  async function sharePlantEntry(e, on) {
    const p = e.plant;
    if (on && !p.sharedId) { if (await asSharer("share this song", () => S.sharePlant(rest, p))) { changed(); msg(`Shared "${p.song.title}".`); } }
    else if (!on && p.sharedId) { if (await asSharer("unshare this song", () => S.unshare(rest, "plants", p))) { changed(); msg(`"${p.song.title}" is no longer shared.`); } }
  }

  async function reportEntry(e, reason) {
    if (await asSharer("report it", () => S.report(rest, e, reason))) msg("Thanks: reported. After reports from 3 people it's hidden until it's reviewed.");
  }

  async function loadCounts(e) {
    if (!e?.shared) return;
    const key = S.sharedBeaconKey(e);
    if (favCounts.has(key)) return;
    favCounts.set(key, null);
    try {
      const c = await S.favoriteCounts(publicGet, [key]);
      favCounts.set(key, c[key] || 0);
      ctx.renderInspector();
    } catch { favCounts.delete(key); }
  }

  async function findMaps() {
    try {
      const rows = await S.findMaps(publicGet, tilesAround(engine.pos));
      const have = new Set(st.doc.maps.map((m) => m.copiedFrom || m.sharedId).filter(Boolean));
      $("dMaps").innerHTML = rows.length ? rows.map((r) => `<div class="ditem" data-map="${esc(r.id)}"><span>${esc(r.name)}<small class="hint"> · ${r.beacons.length} beacon${r.beacons.length === 1 ? "" : "s"}${r.exclusive ? " · exclusive" : ""}</small></span>
        <div class="dbtns"><button class="btn small" data-addmap="${esc(r.id)}" ${have.has(r.id) ? "disabled" : ""}>${have.has(r.id) ? "Added" : "Add to my beacons"}</button></div></div>`).join("")
        : `<p class="hint">No shared maps around here yet.</p>`;
      st.foundMaps = rows;
    } catch (err) { msg("Couldn't look for shared maps: " + err.message, true); }
  }

  async function addMap(id) {
    const row = (st.foundMaps || []).find((r) => r.id === id);
    if (!row) return;
    const n = st.doc.nextNumber || 1;
    st.doc.nextNumber = n + 1;
    const m = await S.mapFromRow(row, async (sid) => { await st.shared.want(sid); return st.shared.songs.get(sid) || null; }, n, D.TINTS[(n - 1) % D.TINTS.length]);
    st.doc.maps.push(m);
    changed();
    findMaps();
    msg(`Added ${m.name} to your beacons (your own copy: turn it on or off, or make it exclusive).`);
  }

  function renderAccount() {
    const u = auth.user;
    $("dSignedOut").hidden = !!u;
    $("dSignedIn").hidden = !u;
    if (u) $("dWho").textContent = u.email || "signed in";
  }

  auth.on(renderAccount);
  $("dSendLink").addEventListener("click", async () => {
    const email = $("dEmail").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg("Type your email address first.", true);
    try {
      await auth.sendEmail(email, location.origin + location.pathname);
      $("dCodeRow").hidden = false;
      msg(`Sent: open the email and tap its link, or type its 6-digit code here.`);
    } catch (err) { msg("Couldn't send the email: " + err.message, true); }
  });
  $("dVerify").addEventListener("click", async () => {
    try { await auth.verifyCode($("dEmail").value, $("dCode").value); msg("Signed in. You can share your beacons now."); renderList(); }
    catch (err) { msg("Couldn't sign in: " + err.message, true); }
  });
  $("dSignOut").addEventListener("click", async () => { await auth.signOut(); msg("Signed out. Your beacons stay on this device."); renderList(); });
  $("dDeleteAccount").addEventListener("click", async () => {
    if (!confirm("Delete your account and everything you shared, favorited and reported? Your beacons stay on this device, unshared. This can't be undone.")) return;
    try {
      await S.deleteAccount(rest);
      for (const x of [...st.doc.grids, ...st.doc.plants, ...st.doc.maps]) delete x.sharedId;
      await auth.signOut();
      changed();
      msg("Your account and everything you shared are deleted.");
    } catch (err) { msg("Couldn't delete it: " + err.message, true); }
  });
  $("dFindMaps").addEventListener("click", findMaps);
  $("dMaps").addEventListener("click", (ev) => { const b = ev.target.closest("[data-addmap]"); if (b) addMap(b.dataset.addmap); });
  auth.fromUrl().then((u) => { if (u) msg(`Signed in as ${u.email}. You can share your beacons now.`); }, (err) => msg("The sign-in link didn't work: " + err.message, true));
  renderAccount();

  // ---------------------------------------------------------------- list

  function renderList() {
    const doc = st.doc;
    const row = (id, on, tint, name, sub, buttons, extra = "") => `<div class="ditem" data-id="${esc(id)}">
      <label class="dname"><input type="checkbox" data-act="toggle" ${on ? "checked" : ""} aria-label="Play ${esc(name)}"><i style="background:${tint}"></i><span>${esc(name)}<small>${sub}</small></span></label>
      ${extra}
      <div class="dbtns">${buttons.map(([a, l]) => `<button class="btn small" data-act="${a}"${a === "place" && st.placing === id ? ' aria-pressed="true"' : ""}>${l}</button>`).join("")}</div></div>`;
    const grids = doc.grids.map((g) => {
      const s = D.gridStats(g);
      return row(g.id, g.on, g.tint, g.name, `${s.beacons} beacons · every ${ctx.fmtDist(g.spacingM)} · ${s.sideKm} km a side${s.edited ? ` · ${s.edited} edited` : ""}${g.sharedId ? " · shared" : ""}`,
        [["go", "Go"], ["share", g.sharedId ? "Unshare" : "Share"], ["regen", "New songs"], ["rename", "Rename"], ["dup", "Duplicate"], ["export", "Export"], ["delete", "Delete"]]);
    });
    const maps = doc.maps.map((m) => row(m.id, m.on, m.tint, m.name, `${m.copiedFrom ? "shared map (a copy)" : "custom map"} · ${m.beacons.length} beacon${m.beacons.length === 1 ? "" : "s"}${m.exclusive ? " · exclusive" : ""}${m.sharedId ? " · shared" : ""}`,
      [["go", "Go"], ...(m.copiedFrom ? [] : [["share", m.sharedId ? "Unshare" : "Share"]]), ["place", st.placing === m.id ? "Done placing" : "Place beacons"], ["rename", "Rename"], ["dup", "Duplicate"], ["export", "Export"], ["delete", "Delete"]],
      `<label class="inline dex" title="Exclusive: while this map is on, only its beacons play, and there's silence away from them"><input type="checkbox" data-act="exclusive" ${m.exclusive ? "checked" : ""}> Exclusive</label>`));
    const sharedPlants = doc.plants.filter((p) => p.sharedId).length;
    const plants = doc.plants.length ? [row("plants", doc.prefs.plantsOn !== false, D.PLANT_TINT, "Planted songs", `${doc.plants.length} song${doc.plants.length === 1 ? "" : "s"} planted where you were${sharedPlants ? ` · ${sharedPlants} shared` : ""}`,
      [["go", "Go to latest"], ...(sharedPlants < doc.plants.length ? [["share", "Share all"]] : []), ["export", "Export"], ["delete", "Delete all"]])] : [];
    const all = [...grids, ...maps, ...plants];
    $("dList").innerHTML = all.length ? all.join("") : `<p class="hint">Nothing yet. Generate a grid or plant a song where you are, or start a custom map.</p>`;
    $("dWhere").textContent = store.where === "memory" ? "not saved: this browser blocks storage" : "on this device";
    $("dSharedOn").checked = st.doc.prefs.sharedOn !== false;
    renderShared();
  }

  function renderShared() {
    const s = st.shared.stats();
    const when = s.updated ? new Date(s.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    $("dShared").textContent = st.doc.prefs.sharedOn === false ? "off"
      : s.offline && !s.tiles ? "can't reach the shared map; your own beacons and the globe still play"
      : `${s.grids} grid${s.grids === 1 ? "" : "s"} and ${s.plants} song${s.plants === 1 ? "" : "s"} nearby${when ? ` · checked ${when}` : ""}${s.offline ? " · offline, playing what's saved" : ""}`;
  }

  $("dList").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b || b.tagName === "INPUT") return;
    act(b.dataset.act, b.closest(".ditem").dataset.id);
  });
  $("dList").addEventListener("change", (ev) => {
    const b = ev.target.closest("input[data-act]");
    if (b) act(b.dataset.act, b.closest(".ditem").dataset.id);
  });

  // A new grid's size and spacing, chosen apart (as the local grid), remembered.
  const pref = (k, d) => { try { return +(localStorage.getItem(k) ?? d); } catch { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not kept */ } };
  for (const km of D.SIDES_KM) {
    const o = document.createElement("option");
    o.value = km;
    o.textContent = `${km} km`;
    if (km === pref("beacon.gridSideKm", 10)) o.selected = true;
    $("dSide").append(o);
  }
  for (const sp of D.SPACINGS_M) {
    const o = document.createElement("option");
    o.value = sp;
    o.textContent = sp < 1000 ? `${sp} m` : `${sp / 1000} km`;
    if (sp === pref("beacon.gridSpacingM", 500)) o.selected = true;
    $("dSpacing").append(o);
  }
  const chosenHalf = () => D.halfFor(+$("dSide").value, +$("dSpacing").value);
  const sizeHint = () => {
    const h = chosenHalf(), n = 2 * h + 1;
    $("dSpacingHint").textContent = h ? `${n} × ${n} = ${n * n} beacons, ${(2 * h * +$("dSpacing").value) / 1000} km a side` : "Too many beacons, or spacing too wide, for that size.";
  };
  // Spacings that don't fit the size are greyed out; the choice moves to the nearest that fits.
  const fitSpacing = () => {
    const opts = [...$("dSpacing").options];
    opts.forEach((o) => { o.disabled = !D.halfFor(+$("dSide").value, +o.value); });
    const sel = $("dSpacing").selectedIndex;
    if (opts[sel]?.disabled) {
      const ok = opts.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
      if (ok.length) $("dSpacing").selectedIndex = ok.reduce((a, b) => (Math.abs(b - sel) < Math.abs(a - sel) ? b : a));
    }
    sizeHint();
  };
  fitSpacing();
  $("dSide").addEventListener("change", () => { keep("beacon.gridSideKm", $("dSide").value); fitSpacing(); });
  $("dSpacing").addEventListener("change", () => { keep("beacon.gridSpacingM", $("dSpacing").value); sizeHint(); });
  $("dGenerate").addEventListener("click", () => {
    const h = chosenHalf();
    if (!h) return msg("That spacing doesn't fit that size. Pick another.", true);
    generate(+$("dSpacing").value, null, h);
  });
  $("dNewMap").addEventListener("click", () => {
    const name = prompt("Name for the new map:", `Map ${st.doc.nextNumber || 1}`);
    if (name === null) return;
    const m = D.makeMap(st.doc, name);
    st.doc.maps.push(m);
    st.placing = m.id;
    changed();
    msg(`Tap the map to put beacons on ${m.name}. You can do this from anywhere; only you can edit it.`);
    if (ui.zoom !== "close") { ui.closeKm = 3; ctx.setZoom("close"); }
  });
  for (const mode of D.PLAY_MODES) {
    const o = document.createElement("option");
    o.value = mode;
    o.textContent = D.PLAY_MODE_LABEL[mode];
    $("dPlayMode").append(o);
  }
  $("dPlayMode").addEventListener("change", (e) => { st.doc.prefs.playMode = e.target.value; changed(); });
  $("dSharedOn").addEventListener("change", (e) => { st.doc.prefs.sharedOn = e.target.checked; changed(); });
  $("dRange").value = D.PLANT_RANGE_M;
  $("dRange").min = D.MIN_RANGE_M;
  $("dRange").max = D.MAX_RANGE_M;
  $("dExportAll").addEventListener("click", () => download("my-beacons.beacons.json", st.doc));
  $("dImport").addEventListener("click", () => $("dFile").click());
  $("dFile").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importFile(f); });
  $("plantSong").addEventListener("click", () => { const song = ctx.inspectedSong(); if (song) plant(song, +$("dRange").value || D.PLANT_RANGE_M); });
  $("dOfferGo").addEventListener("click", () => { if (st.offer) generate(st.offer.spacingM, st.offer.center, st.offer.half ?? D.DEFAULT_HALF); });
  $("dOfferNo").addEventListener("click", () => { st.offerDismissed = st.offerKey; $("dOffer").hidden = true; });

  // ---------------------------------------------------------------- per frame

  /** Called with the panels: the status line and the "generate more" offer. */
  function tick() {
    if (!st.pool || ui.mode !== "globe") return;
    // The shared map: the tiles around you, now and then, and soon after you move.
    const p = engine.pos, sp = st.sharedPos;
    if (st.doc.prefs.sharedOn !== false && (!sp || Date.now() - st.sharedAt > SHARED_EVERY_MS || Math.abs(p.lat - sp.lat) > SHARED_MOVE_DEG || Math.abs(p.lon - sp.lon) > SHARED_MOVE_DEG)) {
      st.sharedAt = Date.now();
      st.sharedPos = { ...p };
      st.shared.update(p).then((ch) => { if (ch) changed({ save: false }); else renderShared(); });
    }
    const names = st.pool.exclusive.map((x) => x.name);
    const line = D.statusLine(st.shares || { globeShare: 1, status: [], exclusive: names.length > 0 }, names);
    if ($("sources").textContent !== line) $("sources").textContent = line;
    $("sources").title = st.shares && st.shares.globeShare >= 0.995 ? "Only the global beacons: none of your beacons reach here" : "The song sources you're hearing, and how much of each";
    const offer = D.moreGridOffer(st.doc, engine.pos);
    const key = offer ? `${offer.from.id}:${offer.dir}` : "";
    if (key !== st.offerKey) {
      st.offerKey = key;
      st.offer = offer;
      const show = !!offer && st.offerDismissed !== key;
      $("dOffer").hidden = !show;
      if (show) $("dOfferText").textContent = `You've walked out of ${offer.from.name} (${offer.dir}). Generate the next grid along, every ${ctx.fmtDist(offer.spacingM)}?`;
    }
  }

  // ---------------------------------------------------------------- drawing

  /** Draws grids, maps and planted songs on the globe map. */
  function draw(g, v, d) {
    if (!st.pool || ui.mode !== "globe") return;
    const W = ctx.canvas.width, H = ctx.canvas.height, C = ui.colors;
    const close = ui.zoom === "close";
    const pxPerM = close ? v.scale / (D.M_PER_DEG * Math.cos((v.center.lat * Math.PI) / 180)) : 0;
    const on = (x, y, m = 30) => x > -m && y > -m && x < W + m && y < H + m;
    // Grid outlines (yours, then shared ones, fainter).
    for (const grid of [...st.doc.grids, ...(st.doc.prefs.sharedOn === false ? [] : st.shared.doc().grids.filter((x) => !mySharedIds().has(x.sharedId)))]) {
      const pts = D.gridOutline(grid).map((p) => v.toScreen(p));
      if (pts.some(([x], i) => i && Math.abs(x - pts[0][0]) > W * 0.75)) continue;
      g.strokeStyle = grid.tint;
      g.globalAlpha = grid.on ? 0.9 : 0.35;
      g.lineWidth = 1.5 * d;
      g.setLineDash(grid.on ? [] : [4 * d, 4 * d]);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
      const [lx, ly] = pts[0];
      if (on(lx, ly) && !grid.shared) ctx.label(grid.name, lx + 4 * d, ly - 8 * d, 10 * d, grid.tint, C.field, 1, "left");
    }
    const activeW = new Map(engine.active.filter((a) => isUser(a.id)).map((a) => [a.id, a.w]));
    const sel = ui.selected;
    // Beacons: the ones that play (one per spot). Generated grid beacons only when they'd be far enough apart to see.
    for (const e of st.pool.playing) {
      const [x, y] = v.toScreen(e.pos);
      if (!on(x, y)) continue;
      const gap = e.kind === "gen" || e.kind === "edited" ? e.spacingM * pxPerM : 999;
      const isSel = sel === UID + e.key;
      const w = activeW.get(UID + e.key) || 0;
      if (gap < 5 && !w && !isSel) continue;
      const special = e.kind !== "gen";
      const r = (special ? 4.5 : Math.max(1.8, Math.min(5, gap / 10))) * d * (1 + 0.35 * w);
      const song = e.song();
      // Driving the music: a glow by its share, about two to six spacings across.
      if (w > 0 && song) shareGlow(g, x, y, Math.max(r * 8, Math.min(gap * d * 6, W * 0.4)), ctx.moodColor(song.mood), w);
      g.fillStyle = song ? ctx.moodColor(song.mood) : C.muted;
      g.globalAlpha = w > 0 ? 1 : 0.8;
      g.beginPath();
      if (special) { g.moveTo(x, y - r * 1.25); g.lineTo(x + r * 1.25, y); g.lineTo(x, y + r * 1.25); g.lineTo(x - r * 1.25, y); g.closePath(); }
      else g.rect(x - r, y - r, 2 * r, 2 * r);
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = e.tint;
      g.lineWidth = 1.5 * d;
      g.stroke();
      if ((st.pool.groups.get(e.point)?.length || 0) > 1 && special) ctx.label(String(songsHere(e).length), x + r + 6 * d, y - r - 2 * d, 9 * d, C.fg, C.field);
      if (isSel || (close && w > 0.05) || (special && close && gap > 0)) ctx.label(beaconOf(e).label, x, y + r + 11 * d, 10 * d, C.muted, C.field);
      if (isSel) {
        g.strokeStyle = C.fg;
        g.lineWidth = 1.5 * d;
        g.setLineDash([4 * d, 3 * d]);
        g.beginPath(); g.arc(x, y, r + 9 * d, 0, Math.PI * 2); g.stroke();
        if (close) { // its range
          g.globalAlpha = 0.5;
          g.beginPath(); g.arc(x, y, e.rangeM * pxPerM, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = 1;
        }
        g.setLineDash([]);
      }
    }
    if (st.placing) ctx.label("Placing beacons: tap the map", W / 2, H - 16 * d, 12 * d, C.accent, C.field);
  }

  /** The user beacon under a screen point, if any. */
  function beaconAt(x, y, v, maxPx) {
    if (!st.pool || ui.mode !== "globe") return null;
    let best = null, bd = maxPx;
    for (const e of st.pool.playing) {
      if (e.songId && !e.song()) continue;
      const [bx, by] = v.toScreen(e.pos);
      const dd = Math.hypot(bx - x, by - y) - (e.kind === "gen" ? 0 : 3);
      if (dd < bd) { bd = dd; best = e; }
    }
    return best ? beaconOf(best) : null;
  }

  // ---------------------------------------------------------------- start

  store.load().then((doc) => {
    st.doc = doc;
    $("dPlayMode").value = doc.prefs.playMode;
    st.ready = true;
    changed({ save: false });
  });
  addEventListener("pagehide", () => store.flush());

  return {
    isUser, findBeacon, setSong, regenerate, inspectorHtml, placeAt, beaconAt, draw, tick,
    noteFix(fix) { st.lastFix = { ...fix, at: Date.now() }; },
    get store() { return store; },
    get placing() { return st.placing; },
    get state() { return st; },
  };
}
