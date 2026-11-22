// Beacon Field UI: the map, the listener, and the readouts.

import { makeGridField, makeGlobeField, weigh, normalizeLatLon } from "./beacons.js";
import { generateSong, validateSong, chordName, keyName, ROLES, ROLE_INSTRUMENT } from "./song.js";
import { BeaconEngine } from "./engine.js";
import { SongEditor } from "./editor.js";

const $ = (id) => document.getElementById(id);
const MOOD_COLOR = { Drift: "#8fa7ff", Glow: "#f5c04a", Tide: "#2ec4b6", Pulse: "#ff4f9a", Rush: "#ff8a3d" };
const ROLE_COLOR = { drums: "#ff8a3d", bass: "#2ec4b6", keys: "#f5c04a", lead: "#ff4f9a", pluck: "#9ccc65", texture: "#8b6cf0" };
const ROLE_LABEL = { drums: "Drums", bass: "Bass", keys: "Keys", lead: "Lead", pluck: "Pluck", texture: "Texture" };
const CITIES = [
  ["London", 51.507, -0.128], ["New York", 40.713, -74.006], ["Tokyo", 35.68, 139.69], ["Lagos", 6.524, 3.379],
  ["São Paulo", -23.55, -46.63], ["Sydney", -33.87, 151.21], ["Reykjavík", 64.147, -21.94], ["Cairo", 30.044, 31.236],
  ["Mumbai", 19.076, 72.878], ["Honolulu", 21.307, -157.858], ["North Pole", 89.9, 0], ["Date line, equator", 0.5, 179.6],
];

const fields = { grid: makeGridField(5, 100), globe: null };
const engine = new BeaconEngine(fields.grid);
const canvas = $("field");
const g = canvas.getContext("2d");

const ui = {
  mode: "grid",
  zoom: "local",
  target: null,
  dragging: false,
  downAt: null,
  keys: new Set(),
  wander: false,
  heading: Math.random() * Math.PI * 2,
  speed: 1,
  zones: true,
  zoneImg: null,
  zoneKey: "",
  selected: null,
  flashes: new Map(), // beacon id -> {t, color}
  harmonyFlash: 0,
  colors: {},
  lastPanel: 0,
};

// ------------------------------------------------------------------ setup

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["fg", "muted", "accent", "field", "grid", "line", "panel"]) ui.colors[k] = cs.getPropertyValue("--" + k).trim();
}
readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readColors(); ui.zoneKey = ""; });
new MutationObserver(() => { readColors(); ui.zoneKey = ""; }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

for (const [name, lat, lon] of CITIES) {
  const o = document.createElement("option");
  o.value = `${lat},${lon}`;
  o.textContent = name;
  $("city").append(o);
}
for (let i = 0; i < 16; i++) {
  const c = document.createElement("i");
  if (i % 4 === 0) c.className = "bar";
  $("beat").append(c);
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ui.dpr = dpr;
  ui.zoneKey = "";
}
new ResizeObserver(resize).observe(canvas);

// ------------------------------------------------------------------ view transform

function view() {
  const W = canvas.width, H = canvas.height;
  if (ui.mode === "grid") {
    const f = engine.field, m = ((f.n - 1) / 2) * f.spacing + f.spacing * 0.5;
    const s = Math.min(W, H) / (2 * m);
    return {
      toScreen: (p) => [W / 2 + p.x * s, H / 2 + p.y * s],
      toWorld: (x, y) => ({ x: (x - W / 2) / s, y: (y - H / 2) / s }),
      scale: s,
    };
  }
  const span = ui.zoom === "world" ? { lon: 360, lat: 180 } : { lon: 90, lat: 45 };
  const c = ui.zoom === "world" ? { lat: 0, lon: 0 } : { lat: Math.max(-90 + span.lat / 2, Math.min(90 - span.lat / 2, engine.pos.lat)), lon: engine.pos.lon };
  const sx = W / span.lon, sy = H / span.lat;
  const wrap = (d) => ((d + 540) % 360) - 180;
  return {
    center: c, span,
    toScreen: (p) => [W / 2 + wrap(p.lon - c.lon) * sx, H / 2 - (p.lat - c.lat) * sy],
    toWorld: (x, y) => normalizeLatLon({ lon: c.lon + (x - W / 2) / sx, lat: c.lat - (y - H / 2) / sy }),
    scale: sx,
  };
}

// ------------------------------------------------------------------ zones

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function zoneImage(v) {
  const res = ui.mode === "grid" ? [110, 110] : [140, 70];
  const key = [ui.mode, ui.zoom, engine.opts.sharpness, canvas.width, canvas.height, engine.overrides.size, engine.songRev || 0,
    ui.mode === "globe" && ui.zoom === "local" ? `${Math.round(v.center.lat / 3)},${Math.round(v.center.lon / 3)}` : ""].join("|");
  if (key === ui.zoneKey && ui.zoneImg) return ui.zoneImg;
  const [w, h] = res;
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const ctx = off.getContext("2d");
  const img = ctx.createImageData(w, h);
  const field = engine.field;
  const bg = hexToRgb(ui.colors.field || "#111820");
  const colorOf = new Map();
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const p = v.toWorld((i + 0.5) / w * canvas.width, (j + 0.5) / h * canvas.height);
      const ws = weigh(field, p, engine.opts);
      let r = 0, gg = 0, b = 0;
      for (const n of ws) {
        let c = colorOf.get(n.id);
        if (!c) { c = hexToRgb(MOOD_COLOR[engine.songFor(n.beacon).mood] || "#888888"); colorOf.set(n.id, c); }
        r += c[0] * n.w; gg += c[1] * n.w; b += c[2] * n.w;
      }
      const a = 0.16, k = (j * w + i) * 4;
      img.data[k] = bg[0] + (r - bg[0]) * a;
      img.data[k + 1] = bg[1] + (gg - bg[1]) * a;
      img.data[k + 2] = bg[2] + (b - bg[2]) * a;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ui.zoneImg = off;
  ui.zoneKey = key;
  return off;
}

// ------------------------------------------------------------------ drawing

function draw(now) {
  const W = canvas.width, H = canvas.height, d = ui.dpr || 1;
  const v = view();
  const C = ui.colors;
  g.fillStyle = C.field;
  g.fillRect(0, 0, W, H);
  if (ui.zones) {
    g.imageSmoothingEnabled = true;
    g.drawImage(zoneImage(v), 0, 0, W, H);
  }
  drawGraticule(v, d);

  const active = engine.active;
  const activeIds = new Map(active.map((a) => [a.id, a.w]));
  const harmonyId = engine.harmony.id;
  const [px, py] = v.toScreen(engine.pos);

  // Lines to the three active beacons, thickness by weight.
  for (const a of active) {
    const [bx, by] = v.toScreen(a.beacon.pos);
    if (Math.abs(bx - px) > W * 0.75) continue; // wrapped across the map edge
    const col = MOOD_COLOR[a.song.mood];
    g.strokeStyle = col;
    g.globalAlpha = 0.25 + 0.65 * a.w;
    g.lineWidth = (1 + 7 * a.w) * d;
    g.beginPath(); g.moveTo(px, py); g.lineTo(bx, by); g.stroke();
    g.globalAlpha = 1;
    if (a.w > 0.02) {
      const mx = px + (bx - px) * 0.6, my = py + (by - py) * 0.6 - 9 * d;
      label(`${Math.round(a.w * 100)}%`, mx, my, 12 * d, C.fg, C.field);
    }
  }

  // Beacons.
  const isGrid = ui.mode === "grid";
  const local = isGrid || ui.zoom === "local";
  const baseR = (isGrid ? 11 : local ? 6 : 2.6) * d;
  for (const b of engine.field.beacons) {
    const [x, y] = v.toScreen(b.pos);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const song = engine.songFor(b);
    const col = MOOD_COLOR[song.mood];
    const w = activeIds.get(b.id) || 0;
    const fl = ui.flashes.get(b.id);
    const pulse = fl ? Math.max(0, 1 - (now - fl) / 260) : 0;
    const r = baseR * (1 + 0.35 * w) + pulse * 6 * d;
    if (pulse > 0) {
      g.globalAlpha = 0.35 * pulse;
      g.fillStyle = col;
      g.beginPath(); g.arc(x, y, r + 8 * d * pulse, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = col;
    g.globalAlpha = w > 0 ? 1 : isGrid ? 0.75 : 0.55;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    if (b.id === harmonyId) {
      g.strokeStyle = C.accent; g.lineWidth = 2.5 * d;
      g.beginPath(); g.arc(x, y, r + 5 * d, 0, Math.PI * 2); g.stroke();
    }
    if (ui.selected === b.id) {
      g.strokeStyle = C.fg; g.lineWidth = 1.5 * d; g.setLineDash([4 * d, 3 * d]);
      g.beginPath(); g.arc(x, y, r + 10 * d, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    if (isGrid || (local && w > 0)) {
      // Beacon spacing on screen, in CSS pixels: drop song titles when they would collide.
      const gap = isGrid ? engine.field.spacing * v.scale / d : 999;
      label(b.label, x, y + r + 12 * d, Math.min(11, gap / 7) * d, C.muted, null);
      if (isGrid && gap > 120) label(song.title, x, y + r + 25 * d, 10 * d, C.muted, null, 0.75);
    }
  }

  // Target and listener.
  if (ui.target) {
    const [tx, ty] = v.toScreen(ui.target);
    g.strokeStyle = C.accent; g.lineWidth = 1.5 * d;
    g.beginPath(); g.moveTo(tx - 6 * d, ty - 6 * d); g.lineTo(tx + 6 * d, ty + 6 * d); g.moveTo(tx + 6 * d, ty - 6 * d); g.lineTo(tx - 6 * d, ty + 6 * d); g.stroke();
  }
  g.fillStyle = C.accent;
  g.beginPath(); g.arc(px, py, 8 * d, 0, Math.PI * 2); g.fill();
  g.strokeStyle = C.field; g.lineWidth = 2.5 * d;
  g.beginPath(); g.arc(px, py, 8 * d, 0, Math.PI * 2); g.stroke();
  const hf = Math.max(0, 1 - (now - ui.harmonyFlash) / 1200);
  if (hf > 0) {
    g.strokeStyle = C.accent; g.globalAlpha = hf; g.lineWidth = 2 * d;
    g.beginPath(); g.arc(px, py, (14 + 40 * (1 - hf)) * d, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }
}

function drawGraticule(v, d) {
  const C = ui.colors;
  g.strokeStyle = C.grid;
  g.lineWidth = 1 * d;
  g.beginPath();
  if (ui.mode === "grid") {
    const f = engine.field, m = ((f.n - 1) / 2) * f.spacing;
    for (let k = -m; k <= m + 1e-6; k += f.spacing) {
      let [x1, y1] = v.toScreen({ x: k, y: -m }), [x2, y2] = v.toScreen({ x: k, y: m });
      g.moveTo(x1, y1); g.lineTo(x2, y2);
      [x1, y1] = v.toScreen({ x: -m, y: k }); [x2, y2] = v.toScreen({ x: m, y: k });
      g.moveTo(x1, y1); g.lineTo(x2, y2);
    }
    g.stroke();
    const [sx] = v.toScreen({ x: 0, y: 0 }), [sx2] = v.toScreen({ x: 100, y: 0 });
    label("100 m", (sx + sx2) / 2, canvas.height - 12 * d, 10 * d, C.muted, null);
    return;
  }
  const step = 10;
  for (let lat = -90; lat <= 90; lat += step) {
    const [, y] = v.toScreen({ lat, lon: v.center.lon });
    g.moveTo(0, y); g.lineTo(canvas.width, y);
  }
  for (let lon = -180; lon < 180; lon += step) {
    const [x] = v.toScreen({ lat: 0, lon });
    g.moveTo(x, 0); g.lineTo(x, canvas.height);
  }
  g.stroke();
  // Equator and prime meridian a little stronger.
  g.strokeStyle = C.line;
  g.beginPath();
  const [, ey] = v.toScreen({ lat: 0, lon: v.center.lon });
  g.moveTo(0, ey); g.lineTo(canvas.width, ey);
  const [mx] = v.toScreen({ lat: 0, lon: 0 });
  g.moveTo(mx, 0); g.lineTo(mx, canvas.height);
  g.stroke();
  if (ui.zoom === "local") {
    for (let lat = -80; lat <= 80; lat += 10) {
      const [, y] = v.toScreen({ lat, lon: v.center.lon });
      if (y > 34 * d && y < canvas.height - 6 * d) label(`${Math.abs(lat)}°${lat < 0 ? "S" : lat > 0 ? "N" : ""}`, 22 * d, y - 4 * d, 10 * d, C.muted, null);
    }
  }
}

function label(text, x, y, size, color, halo, alpha = 1) {
  g.font = `500 ${size}px "IBM Plex Mono", Consolas, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.globalAlpha = alpha;
  if (halo) {
    g.lineWidth = 4 * (ui.dpr || 1);
    g.strokeStyle = halo;
    g.strokeText(text, x, y);
  }
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.globalAlpha = 1;
}

// ------------------------------------------------------------------ movement

function speedPerSec() {
  if (ui.mode === "grid") return 55 * ui.speed; // meters per second
  return (ui.zoom === "world" ? 18 : 5) * ui.speed; // degrees per second
}

function step(dt) {
  const p = engine.pos;
  const sp = speedPerSec() * dt;
  let dx = 0, dy = 0;
  if (ui.keys.has("left")) dx -= 1;
  if (ui.keys.has("right")) dx += 1;
  if (ui.keys.has("up")) dy -= 1;
  if (ui.keys.has("down")) dy += 1;
  let next = null;
  if (dx || dy) {
    ui.target = null;
    const n = Math.hypot(dx, dy);
    next = move(p, (dx / n) * sp, (dy / n) * sp);
  } else if (ui.target) {
    const [ex, ey] = delta(p, ui.target);
    const dist = Math.hypot(ex, ey);
    if (dist <= sp) { next = { ...ui.target }; if (!ui.dragging) ui.target = null; }
    else next = move(p, (ex / dist) * sp, (ey / dist) * sp);
  } else if (ui.wander) {
    ui.heading += (Math.random() - 0.5) * 2.2 * dt;
    next = move(p, Math.cos(ui.heading) * sp * 0.6, Math.sin(ui.heading) * sp * 0.6);
    if (ui.mode === "grid") {
      const lim = ((engine.field.n - 1) / 2) * engine.field.spacing + 30;
      if (Math.abs(next.x) > lim) ui.heading = Math.PI - ui.heading;
      if (Math.abs(next.y) > lim) ui.heading = -ui.heading;
    } else if (Math.abs(next.lat) > 84) ui.heading = -ui.heading;
  }
  if (next) engine.setPosition(next);
}

/** Screen-direction offset between two positions (x right, y down). */
function delta(a, b) {
  if (ui.mode === "grid") return [b.x - a.x, b.y - a.y];
  return [((b.lon - a.lon + 540) % 360) - 180, -(b.lat - a.lat)];
}

function move(p, dx, dy) {
  if (ui.mode === "grid") return { x: p.x + dx, y: p.y + dy };
  // Degrees of longitude get shorter toward the poles; keep walking speed even.
  const k = 1 / Math.max(0.15, Math.cos(p.lat * Math.PI / 180));
  return normalizeLatLon({ lat: p.lat - dy, lon: p.lon + dx * Math.min(k, 4) });
}

// ------------------------------------------------------------------ input

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
}

function beaconAt(x, y) {
  const v = view();
  let best = null, bd = (ui.mode === "grid" ? 24 : 14) * (ui.dpr || 1);
  for (const b of engine.field.beacons) {
    const [bx, by] = v.toScreen(b.pos);
    const dd = Math.hypot(bx - x, by - y);
    if (dd < bd) { bd = dd; best = b; }
  }
  return best;
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = canvasPoint(e);
  ui.dragging = true;
  ui.downAt = [x, y];
  ui.target = view().toWorld(x, y);
});
canvas.addEventListener("pointermove", (e) => {
  if (!ui.dragging) return;
  const [x, y] = canvasPoint(e);
  ui.target = view().toWorld(x, y);
});
canvas.addEventListener("pointerup", (e) => {
  const [x, y] = canvasPoint(e);
  ui.dragging = false;
  if (ui.downAt && Math.hypot(x - ui.downAt[0], y - ui.downAt[1]) < 8 * (ui.dpr || 1)) {
    const b = beaconAt(x, y);
    if (b) { select(b.id); ui.target = { ...b.pos }; }
  }
});
canvas.addEventListener("pointercancel", () => { ui.dragging = false; });

const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down" };
window.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, select")) return;
  const k = KEYMAP[e.code];
  if (k) { ui.keys.add(k); e.preventDefault(); }
  if (e.code === "Space" && !e.target.closest("button")) { e.preventDefault(); togglePlay(); }
});
window.addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) ui.keys.delete(k); });
window.addEventListener("blur", () => ui.keys.clear());

// ------------------------------------------------------------------ controls

async function togglePlay() {
  if (engine.running) engine.stop();
  else {
    try { await engine.start(); } catch (err) { setMsg("fieldMsg", "Audio couldn't start: " + err.message, true); return; }
  }
  $("startcard").hidden = true;
  $("play").textContent = engine.running ? "■ Stop" : "▶ Start";
}
$("play").addEventListener("click", togglePlay);
$("play2").addEventListener("click", togglePlay);
$("vol").addEventListener("input", (e) => engine.setVolume(+e.target.value));
$("wander").addEventListener("change", (e) => { ui.wander = e.target.checked; });
$("speed").addEventListener("input", (e) => { ui.speed = +e.target.value; });
$("zones").addEventListener("change", (e) => { ui.zones = e.target.checked; });

function setMode(mode) {
  if (mode === ui.mode) return;
  ui.mode = mode;
  if (mode === "globe" && !fields.globe) fields.globe = makeGlobeField(10);
  engine.setField(fields[mode]);
  if (mode === "globe") engine.setPosition({ lat: 51.507, lon: -0.128 });
  ui.target = null;
  closeEditor();
  ui.selected = null;
  ui.zoneKey = "";
  $("modeGrid").setAttribute("aria-pressed", mode === "grid");
  $("modeGlobe").setAttribute("aria-pressed", mode === "globe");
  $("globeTools").hidden = mode !== "globe";
  $("fieldwrap").classList.toggle("globe", mode === "globe");
  $("modeHint").textContent = mode === "grid"
    ? "25 beacons, 100 m apart. Drag, tap or use WASD to walk."
    : "614 beacons, one every 10° of latitude and longitude. Starting in London.";
  applyShared();
}
$("modeGrid").addEventListener("click", () => setMode("grid"));
$("modeGlobe").addEventListener("click", () => setMode("globe"));

function setZoom(z) {
  ui.zoom = z;
  $("zoomLocal").setAttribute("aria-pressed", z === "local");
  $("zoomWorld").setAttribute("aria-pressed", z === "world");
}
$("zoomLocal").addEventListener("click", () => setZoom("local"));
$("zoomWorld").addEventListener("click", () => setZoom("world"));

function jumpTo(lat, lon, how) {
  ui.target = null;
  engine.setPosition({ lat, lon });
  setMsg("fieldMsg", `${how}: ${lat.toFixed(2)}, ${lon.toFixed(2)}`);
}
$("city").addEventListener("change", (e) => {
  if (!e.target.value) return;
  const [lat, lon] = e.target.value.split(",").map(Number);
  jumpTo(lat, lon, e.target.selectedOptions[0].textContent);
  e.target.value = "";
});
$("goLatLon").addEventListener("click", () => {
  const m = $("latlon").value.match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/);
  if (!m) return setMsg("fieldMsg", "Type latitude and longitude, like 48.85, 2.35", true);
  jumpTo(+m[1], +m[2], "Moved to");
});
$("geo").addEventListener("click", () => {
  if (!navigator.geolocation) return setMsg("fieldMsg", "Location isn't available here. Pick a city or type coordinates.", true);
  setMsg("fieldMsg", "Finding you…");
  navigator.geolocation.getCurrentPosition(
    (p) => jumpTo(p.coords.latitude, p.coords.longitude, "Your location"),
    () => setMsg("fieldMsg", "Location isn't available here. Pick a city or type coordinates.", true),
    { enableHighAccuracy: false, timeout: 8000 },
  );
});

$("sharp").addEventListener("input", (e) => { engine.opts.sharpness = +e.target.value; $("sharpV").textContent = e.target.value; engine.refresh(); });
$("hyst").addEventListener("input", (e) => { engine.harmony.hysteresis = +e.target.value; $("hystV").textContent = Math.round(e.target.value * 100) + "%"; });
$("phrase").addEventListener("change", (e) => { engine.harmony.phraseBars = +e.target.value; });
$("glide").addEventListener("input", (e) => { engine.tempoGlide = +e.target.value; $("glideV").textContent = Math.round(e.target.value * 100) + "%"; });

engine.on((type, data) => {
  if (type === "harmony") {
    ui.harmonyFlash = performance.now();
    $("songline").innerHTML = `Harmony from <b>${esc(data.title)}</b> (${esc(beaconLabel(data.id))})`;
  }
});

// ------------------------------------------------------------------ inspector

function beaconLabel(id) { return engine.field.beacons.find((b) => b.id === id)?.label ?? id; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function setMsg(id, text, err = false) { const el = $(id); el.textContent = text; el.classList.toggle("err", err); }

function select(id) {
  if (editorId && id !== editorId) closeEditor();
  ui.selected = id;
  $("jsonBox").hidden = true;
  setMsg("inspMsg", "");
  renderInspector();
}

function inspectedId() { return ui.selected ?? engine.active[0]?.id; }

function renderInspector() {
  const id = inspectedId();
  if (!id) return;
  const b = engine.field.beacons.find((x) => x.id === id);
  const s = engine.songFor(b);
  const chords = s.progression.map((d) => chordName(s.key, d)).join(" – ");
  const tracks = ROLES.filter((r) => s.tracks[r]?.level > 0).map((r) => `<span class="chip">${ROLE_LABEL[r]} <b>${Math.round(s.tracks[r].level * 100)}</b></span>`).join("");
  const own = engine.overrides.has(id) ? `<span class="chip"><b>edited</b></span>` : "";
  $("insp").innerHTML = `
    <div class="title"><strong>${esc(s.title)}</strong><span class="hint">${esc(b.label)} · ${ui.selected ? "selected" : "closest"}</span></div>
    <div class="chips">
      <span class="chip" style="border-color:${MOOD_COLOR[s.mood] || "var(--line)"}">${esc(s.mood || "Custom")}</span>
      <span class="chip">Key <b>${esc(keyName(s.key))}</b></span>
      <span class="chip"><b>${s.bpm}</b> BPM</span>
      <span class="chip">${esc(chords)}</span>${own}
    </div>
    <div class="chips">${tracks}</div>`;
  ui.inspectedShown = id + "|" + (engine.overrides.has(id) ? s.title : "");
  updateShareButtons();
}

let editorId = null;
const editor = new SongEditor($("editor"), {
  onChange: (song) => {
    engine.setSong(editorId, song);
    engine.songRev = (engine.songRev || 0) + 1;
    $("editorTitle").textContent = `Editing ${song.title} (${beaconLabel(editorId)})`;
  },
});
function openEditor(id) {
  editorId = id;
  ui.selected = id; // keep the inspector on the beacon being edited
  editor.open(engine.songFor(id));
  $("editorTitle").textContent = `Editing ${engine.songFor(id).title} (${beaconLabel(id)})`;
  $("editorWrap").hidden = false;
  $("jsonBox").hidden = true;
  renderInspector();
}
function closeEditor() { editorId = null; editor.close(); $("editorWrap").hidden = true; }
$("editSong").addEventListener("click", () => openEditor(inspectedId()));
$("closeEditor").addEventListener("click", closeEditor);

$("goBeacon").addEventListener("click", () => { const id = inspectedId(); const b = engine.field.beacons.find((x) => x.id === id); if (b) ui.target = { ...b.pos }; });
$("regen").addEventListener("click", () => {
  const id = inspectedId();
  const s = generateSong(`${engine.field.kind}:${id}:${Date.now()}`);
  engine.setSong(id, s);
  engine.songRev = (engine.songRev || 0) + 1;
  if (editorId === id) openEditor(id);
  renderInspector();
  setMsg("inspMsg", `New song on ${beaconLabel(id)}: ${s.title}`);
});
$("copyJson").addEventListener("click", async () => {
  const id = inspectedId();
  const text = JSON.stringify(engine.songFor(id), null, 1);
  try {
    await navigator.clipboard.writeText(text);
    setMsg("inspMsg", "Song JSON copied.");
  } catch {
    $("songJson").value = text;
    $("jsonBox").hidden = false;
    $("songJson").select();
    setMsg("inspMsg", "Copying isn't allowed here, so the JSON is selected below.");
  }
});
$("editJson").addEventListener("click", () => {
  $("songJson").value = JSON.stringify(engine.songFor(inspectedId()), null, 1);
  $("jsonBox").hidden = false;
});
$("closeJson").addEventListener("click", () => { $("jsonBox").hidden = true; });
$("loadJson").addEventListener("click", () => {
  let s;
  try { s = JSON.parse($("songJson").value); } catch (err) { return setMsg("inspMsg", "That isn't valid JSON: " + err.message, true); }
  const errs = validateSong(s);
  if (errs.length) return setMsg("inspMsg", "Song not loaded: " + errs.join("; "), true);
  const id = inspectedId();
  engine.setSong(id, s);
  engine.songRev = (engine.songRev || 0) + 1;
  if (editorId === id) openEditor(id);
  $("jsonBox").hidden = true;
  renderInspector();
  setMsg("inspMsg", `Loaded "${s.title}" onto ${beaconLabel(id)}.`);
});

// ------------------------------------------------------------------ shared songs
// On the published page, songs can be shared through the artifact's store:
// one document per beacon at songs/<field>-<beacon id>. Locally there is no
// store and these buttons stay hidden.

const shared = { db: null, docs: new Map(), loaded: false };
const sharedKey = (id) => `${engine.field.kind}-${id}`;

function applyShared() {
  for (const [key, d] of shared.docs) {
    if (d.field !== engine.field.kind || d.beacon === editorId) continue;
    if (validateSong(d.song).length === 0 && engine.overrides.get(d.beacon) !== d.song) engine.setSong(d.beacon, d.song);
  }
  engine.songRev = (engine.songRev || 0) + 1;
  updateShareButtons();
  renderInspector();
}

function updateShareButtons() {
  const on = !!shared.db;
  $("shareSong").hidden = !on;
  $("unshareSong").hidden = !on || !shared.docs.has(sharedKey(inspectedId()));
}

async function connectShared() {
  const use = window.claude?.use;
  if (!use) return;
  const db = await use("db").catch(() => null);
  if (!db) return;
  shared.db = db;
  updateShareButtons();
  const timer = setTimeout(() => { if (!shared.loaded) setMsg("inspMsg", "Shared songs can't be reached yet."); }, 10000);
  db.collection("songs").onSnapshot((snap) => {
    if (!snap.metadata.fromCache) { shared.loaded = true; clearTimeout(timer); }
    for (const ch of snap.docChanges()) {
      const body = ch.doc.data();
      if (ch.type === "removed") {
        shared.docs.delete(ch.doc.id);
        if (body?.field === engine.field.kind && body.beacon !== editorId) { engine.overrides.delete(body.beacon); engine.refresh(); }
      } else if (body && body.song) shared.docs.set(ch.doc.id, body);
    }
    applyShared();
  }, (err) => { clearTimeout(timer); setMsg("inspMsg", "Shared songs stopped updating (" + err.code + ").", true); });
}

$("shareSong").addEventListener("click", async () => {
  const id = inspectedId();
  const song = engine.songFor(id);
  const errs = validateSong(song);
  if (errs.length) return setMsg("inspMsg", "This song can't be shared: " + errs.join("; "), true);
  $("shareSong").disabled = true;
  try {
    await shared.db.collection("songs").doc(sharedKey(id)).set({ field: engine.field.kind, beacon: id, song: JSON.parse(JSON.stringify(song)), updatedAt: new Date().toISOString() });
    setMsg("inspMsg", `Shared "${song.title}" on ${beaconLabel(id)}. Everyone who opens this page hears it there.`);
  } catch (err) {
    setMsg("inspMsg", err.code === "invalid_argument" ? "You can listen here, but your access doesn't allow sharing songs." : "Sharing failed (" + (err.code || err.message) + "). Try again.", true);
  } finally { $("shareSong").disabled = false; }
});
$("unshareSong").addEventListener("click", async () => {
  const id = inspectedId();
  try {
    await shared.db.collection("songs").doc(sharedKey(id)).delete();
    setMsg("inspMsg", `Removed the shared song from ${beaconLabel(id)}.`);
  } catch (err) { setMsg("inspMsg", "Couldn't remove it (" + (err.code || err.message) + ").", true); }
});

// ------------------------------------------------------------------ panels

function renderPanels() {
  const st = engine.state();
  const h = st.harmony;
  const heard = engine.heardStep();
  $("nKey").textContent = h ? h.key : "–";
  $("nChord").textContent = h ? `${h.chord}` : "–";
  $("nChord").title = h ? h.roman : "";
  $("nBpm").textContent = st.running ? `${Math.round(st.bpm)}` : `${Math.round(st.targetBpm)}`;
  $("nBar").textContent = heard ? `${heard.bar + 1}.${Math.floor(heard.step / 4) + 1}` : "–";
  [...$("beat").children].forEach((c, i) => c.classList.toggle("on", !!heard && heard.step === i));
  if (h && !$("songline").innerHTML.includes(esc(h.title))) $("songline").innerHTML = `Harmony from <b>${esc(h.title)}</b> (${esc(beaconLabel(h.id))})`;

  // Blend rows.
  $("blend").innerHTML = st.active.map((a) => {
    const col = MOOD_COLOR[a.song.mood] || "#888";
    const dist = ui.mode === "grid" ? `${Math.round(a.d)} m` : `${Math.round(a.d).toLocaleString()} km`;
    return `<div class="brow${a.id === engine.harmony.id ? " harm" : ""}" data-id="${a.id}">
      <span class="tag" style="background:${col}">${esc(a.beacon.label.split(" ")[0])}</span>
      <div class="name"><div>${esc(a.song.title)}</div><small>${esc(keyName(a.song.key))} · ${a.song.bpm} BPM · ${dist}</small>
        <div class="wbar"><i style="width:${(a.w * 100).toFixed(1)}%;background:${col}"></i></div></div>
      <span class="pct">${Math.round(a.w * 100)}%</span></div>`;
  }).join("");

  // Instrument rows.
  const rows = ROLES.map((r) => {
    const m = st.mix.roles[r];
    const pk = engine.running && engine.inst ? Math.min(1, engine.inst.channels[r].peak() * 1.6) : 0;
    const src = m.sources.map((s) => {
      const a = st.active.find((x) => x.id === s.id);
      return `<i style="width:${(s.share * 100).toFixed(1)}%;background:${MOOD_COLOR[a?.song.mood] || "#888"}"></i>`;
    }).join("");
    return `<div class="trow"><div class="inst">${ROLE_LABEL[r]}<small>${ROLE_INSTRUMENT[r]}</small></div>
      <div class="meter" title="Level ${Math.round(m.gain * 100)}%; the strip under it shows which beacons this part comes from">
        <i class="lvl" style="width:${(m.gain * 100).toFixed(1)}%;background:${ROLE_COLOR[r]}"></i>
        <i class="pk" style="width:${(pk * 100).toFixed(1)}%;background:${ROLE_COLOR[r]}"></i>
        <span class="src">${src}</span></div>
      <span class="val">${Math.round(m.gain * 100)}</span></div>`;
  }).join("");
  $("tracks").innerHTML = rows;
  const P = (r, k, fmt) => { const v = st.mix.roles[r].params[k]; return v === undefined ? "" : `<span>${ROLE_LABEL[r]} ${k.replace(/\./, " ")} <b>${fmt(v)}</b></span>`; };
  const hz = (v) => v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "";
  $("params").innerHTML = [
    P("bass", "filter.cutoff", hz), P("bass", "filter.emphasis", (v) => v.toFixed(1)), P("keys", "filter.cutoff", hz),
    P("keys", "aenv.attack", (v) => v.toFixed(2) + "s"), P("lead", "filter.cutoff", hz), P("lead", "delay.send", (v) => v.toFixed(2)),
    P("pluck", "brightness", (v) => v.toFixed(2)), P("texture", "fm.index", (v) => v.toFixed(1)), P("drums", "kick.tune", (v) => Math.round(v) + "Hz"),
  ].join("");

  // Overlay.
  const p = engine.pos;
  const where = ui.mode === "grid" ? `x <b>${p.x.toFixed(0)}</b> m · y <b>${(-p.y).toFixed(0)}</b> m`
    : `<b>${Math.abs(p.lat).toFixed(2)}°${p.lat < 0 ? "S" : "N"}</b> <b>${Math.abs(p.lon).toFixed(2)}°${p.lon < 0 ? "W" : "E"}</b>`;
  $("overlay").innerHTML = `<span>${where}</span>`;

  const shown = inspectedId() + "|" + (engine.overrides.has(inspectedId()) ? engine.songFor(inspectedId()).title : "");
  if (shown !== ui.inspectedShown) renderInspector();
}

$("blend").addEventListener("click", (e) => {
  const row = e.target.closest(".brow");
  if (row) select(row.dataset.id);
});

// ------------------------------------------------------------------ loop

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  step(dt);
  for (const ev of engine.takeSounding()) ui.flashes.set(ev.id, now);
  draw(now);
  if (now - ui.lastPanel > 120) { ui.lastPanel = now; renderPanels(); }
  requestAnimationFrame(frame);
}

// Start somewhere between beacons so the blend shows right away.
engine.setPosition({ x: -38, y: 27 });
resize();
renderInspector();
renderPanels();
requestAnimationFrame(frame);
connectShared();

// For debugging and automated checks.
window.beaconField = { engine, ui, setMode, select };
