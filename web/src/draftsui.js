// The Globe tab's "My beacons": the user's own grids, custom maps and planted
// songs (src/drafts.js), kept on this device (src/draftstore.js), drawn on
// the map and blended into the music as the user layer. No server yet: this
// is step 1 of docs/beacon-database-plan.md.

import * as D from "./drafts.js";
import { DraftStore } from "./draftstore.js";

const KIND_LABEL = { gen: "generated", edited: "edited", plant: "planted song", map: "map beacon" };
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
  };
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
    if (e.kind === "plant") return `Planted · ${e.song().title}`;
    if (e.kind === "map") {
      const m = st.doc.maps.find((x) => x.id === e.source.id);
      return `${e.source.name} #${(m?.beacons.findIndex((b) => b.id === e.key) ?? -1) + 1}`;
    }
    const km = (n) => +((Math.abs(n) * e.spacingM) / 1000).toFixed(1);
    const off = [e.north ? `${km(e.north)}${e.north > 0 ? "N" : "S"}` : "", e.east ? `${km(e.east)}${e.east > 0 ? "E" : "W"}` : ""].filter(Boolean).join(" ");
    return `${e.source.name} · ${off || "center"}`;
  }

  /** Rebuilds the pool after any change, saves, and redraws. */
  function changed({ save = true } = {}) {
    st.pool = D.buildPool(st.doc);
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

  async function generate(spacingM, center = null) {
    const fix = await presentFix();
    if (!fix) return;
    const g = D.makeGrid(st.doc, fix, spacingM, { center });
    if (center && !D.inGrid(g, fix)) { st.doc.nextNumber--; return msg("You need to be inside the next grid to make it. Walk on a little and try again.", true); }
    const same = st.doc.grids.find((x) => x.center === g.center && x.spacingM === spacingM);
    if (same) { st.doc.nextNumber--; return msg(`${same.name} is already here, with the same spacing.`, true); }
    st.doc.grids.push(g);
    changed();
    goTo(g);
    msg(`${g.name}: ${D.GRID_POINTS * D.GRID_POINTS} beacons, one every ${ctx.fmtDist(spacingM)}, ${D.gridStats(g).sideKm} km a side, centered where you are.${fix.fake ? " (test location)" : ""}`);
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
    ctx.stopFollow?.("Jumped to your beacons, so the map stopped following your location.");
    ctx.input.target = null;
    engine.setPosition({ lat: pos.lat, lon: pos.lon });
    ui.closeKm = item.spacingM ? Math.max(2, (D.GRID_POINTS + 3) * item.spacingM / 1000) : 3;
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
      case "delete": {
        const what = item === "plants" ? `all ${st.doc.plants.length} planted songs` : item.name;
        if (!confirm(`Delete ${what} from this device? This can't be undone (export it first to keep a copy).`)) return;
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
    if (e.kind === "plant") return "A planted song is hand-made, so it has no generated song. Edit it, or remove it.";
    if (e.kind === "map") { delete e.mapBeacon.song; e.mapBeacon.variant = (e.mapBeacon.variant || 0) + 1; }
    else D.regenerateOne(st.doc.grids.find((g) => g.id === e.source.id), e.point);
    changed();
    return `New song on ${labelOf(st.byKey.get(e.key))}: ${st.byKey.get(e.key).song().title}`;
  }

  function removeBeacon(id) {
    const e = entryOf(id);
    if (!e || (e.kind !== "plant" && e.kind !== "map")) return;
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
    if (fav[e.point] === e.key) delete fav[e.point];
    else fav[e.point] = e.key;
    changed();
  }

  function setRange(id, m) {
    const e = entryOf(id);
    if (!e) return;
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
    const favs = Object.values(st.doc.prefs.favorites).filter((k) => k === e.key).length;
    const rows = at.length > 1 ? `<div class="dspot"><small>${at.length} songs at this spot · playing by <b>${esc(D.PLAY_MODE_LABEL[st.doc.prefs.playMode])}</b></small>${at.map((x) =>
      `<button class="etab" data-insp="${esc(UID + x.key)}" aria-pressed="${x.key === e.key}">${x.key === playing?.key ? "▶ " : ""}${esc(x.song().title)}${favKey === x.key ? " ★" : ""} <small>${esc(KIND_LABEL[x.kind])}</small></button>`).join("")}</div>` : "";
    const ranged = e.kind === "plant" || e.kind === "map";
    return `<div class="chips">
        <span class="chip" style="border-color:${e.tint}"><b>${esc(e.source.name)}</b></span>
        <span class="chip">${esc(KIND_LABEL[e.kind])}</span>
        <span class="chip">heard within <b>${esc(ctx.fmtDist(e.rangeM))}</b></span>
        <span class="chip" title="On this device, favorites are yours alone; counts from everyone come when beacons are shared">♥ favorited <b>${favs}</b>×</span>
        ${e.key !== playing?.key ? `<span class="chip"><b>not playing</b> (another song here plays)</span>` : ""}
      </div>${rows}
      <div class="row">
        <button class="btn small" data-dact="fav">${isFav ? "★ Unfavorite" : "☆ Favorite"}</button>
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

  // ---------------------------------------------------------------- list

  function renderList() {
    const doc = st.doc;
    const row = (id, on, tint, name, sub, buttons, extra = "") => `<div class="ditem" data-id="${esc(id)}">
      <label class="dname"><input type="checkbox" data-act="toggle" ${on ? "checked" : ""} aria-label="Play ${esc(name)}"><i style="background:${tint}"></i><span>${esc(name)}<small>${sub}</small></span></label>
      ${extra}
      <div class="dbtns">${buttons.map(([a, l]) => `<button class="btn small" data-act="${a}"${a === "place" && st.placing === id ? ' aria-pressed="true"' : ""}>${l}</button>`).join("")}</div></div>`;
    const grids = doc.grids.map((g) => {
      const s = D.gridStats(g);
      return row(g.id, g.on, g.tint, g.name, `${s.beacons} beacons · every ${ctx.fmtDist(g.spacingM)} · ${s.sideKm} km a side${s.edited ? ` · ${s.edited} edited` : ""}`,
        [["go", "Go"], ["regen", "New songs"], ["rename", "Rename"], ["dup", "Duplicate"], ["export", "Export"], ["delete", "Delete"]]);
    });
    const maps = doc.maps.map((m) => row(m.id, m.on, m.tint, m.name, `custom map · ${m.beacons.length} beacon${m.beacons.length === 1 ? "" : "s"}${m.exclusive ? " · exclusive" : ""}`,
      [["go", "Go"], ["place", st.placing === m.id ? "Done placing" : "Place beacons"], ["rename", "Rename"], ["dup", "Duplicate"], ["export", "Export"], ["delete", "Delete"]],
      `<label class="inline dex" title="Exclusive: while this map is on, only its beacons play, and there's silence away from them"><input type="checkbox" data-act="exclusive" ${m.exclusive ? "checked" : ""}> Exclusive</label>`));
    const plants = doc.plants.length ? [row("plants", doc.prefs.plantsOn !== false, D.PLANT_TINT, "Planted songs", `${doc.plants.length} song${doc.plants.length === 1 ? "" : "s"} planted where you were`,
      [["go", "Go to latest"], ["export", "Export"], ["delete", "Delete all"]])] : [];
    const all = [...grids, ...maps, ...plants];
    $("dList").innerHTML = all.length ? all.join("") : `<p class="hint">Nothing yet. Generate a grid or plant a song where you are, or start a custom map.</p>`;
    $("dWhere").textContent = store.where === "memory" ? "not saved: this browser blocks storage" : "on this device";
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

  for (const sp of D.SPACINGS_M) {
    const o = document.createElement("option");
    o.value = sp;
    o.textContent = sp < 1000 ? `${sp} m` : `${sp / 1000} km`;
    if (sp === 1000) o.selected = true;
    $("dSpacing").append(o);
  }
  const sideFor = () => `${D.GRID_POINTS} × ${D.GRID_POINTS} beacons, ${(20 * +$("dSpacing").value) / 1000} km a side`;
  $("dSpacingHint").textContent = sideFor();
  $("dSpacing").addEventListener("change", () => { $("dSpacingHint").textContent = sideFor(); });
  $("dGenerate").addEventListener("click", () => generate(+$("dSpacing").value));
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
  $("dRange").value = D.PLANT_RANGE_M;
  $("dRange").min = D.MIN_RANGE_M;
  $("dRange").max = D.MAX_RANGE_M;
  $("dExportAll").addEventListener("click", () => download("my-beacons.beacons.json", st.doc));
  $("dImport").addEventListener("click", () => $("dFile").click());
  $("dFile").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importFile(f); });
  $("plantSong").addEventListener("click", () => { const song = ctx.inspectedSong(); if (song) plant(song, +$("dRange").value || D.PLANT_RANGE_M); });
  $("dOfferGo").addEventListener("click", () => { if (st.offer) generate(st.offer.spacingM, st.offer.center); });
  $("dOfferNo").addEventListener("click", () => { st.offerDismissed = st.offerKey; $("dOffer").hidden = true; });

  // ---------------------------------------------------------------- per frame

  /** Called with the panels: the status line and the "generate more" offer. */
  function tick() {
    if (!st.pool || ui.mode !== "globe") return;
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
    // Grid outlines.
    for (const grid of st.doc.grids) {
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
      if (on(lx, ly)) ctx.label(grid.name, lx + 4 * d, ly - 8 * d, 10 * d, grid.tint, C.field, 1, "left");
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
      g.fillStyle = ctx.moodColor(e.song().mood);
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
    get placing() { return st.placing; },
    get state() { return st; },
  };
}
