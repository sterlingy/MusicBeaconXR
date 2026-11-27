// Music Beacon XR UI: the map, the listener, and the readouts.

import { makeGridField, makeGlobeField, makeLocalGridField, localGridShape, MAX_LOCAL_STEPS, KM_M, weigh, normalizeLatLon } from "./beacons.js";
import { initTravelCard, describePlace } from "./travelcard.js";
import { generateSong, validateSong, chordName, keyName, ROLES, ROLE_INSTRUMENT } from "./song.js";
import { songPosition, sectionName, clock, hasForm, totalBars, lengthSeconds, SECTION_LABEL, SECTION_COLOR, sectionSpec } from "./form.js";
import { BeaconEngine } from "./engine.js";
import { SongEditor } from "./editor.js";
import { ListenerInput, planarSpace, geoSpace, localSpace, keyboardSource, pointerSource, travelSeconds } from "./input/listener.js";
import { initDrafts } from "./draftsui.js";
import { Globe3D } from "./globe3d.js";
import { initWalks, drawLines } from "./walkui.js";
import { FlightTracker, supabaseFlightLookup, supabaseFlightRandom, randomFlight, describe as describeFlight } from "./flight.js";
import { initFlightCard } from "./flightcard.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);
const MOOD_COLOR = { Drift: "#8fa7ff", Glow: "#f5c04a", Tide: "#2ec4b6", Pulse: "#ff4f9a", Rush: "#ff8a3d" };
const ROLE_COLOR = { drums: "#ff8a3d", bass: "#2ec4b6", keys: "#f5c04a", lead: "#ff4f9a", pluck: "#9ccc65", texture: "#8b6cf0" };
const ROLE_LABEL = { drums: "Drums", bass: "Bass", keys: "Keys", lead: "Lead", pluck: "Pluck", texture: "Texture" };
// Generator v2 song families (song.js FAMILIES).
const FAMILY_LABEL = { song: "Song", journey: "Journey", ambient: "Ambient", groove: "Groove" };
const FAMILY_TIP = {
  song: "A classic song: verses, choruses, a bridge",
  journey: "A drone that builds over minutes, with a rolling bass and a driving beat",
  ambient: "Long pads, little or no beat or bass",
  groove: "A steady downtempo loop: busy beat, sub-bass, a wide synth bed",
};
const CITIES = [
  ["London", 51.507, -0.128], ["New York", 40.713, -74.006], ["Tokyo", 35.68, 139.69], ["Lagos", 6.524, 3.379],
  ["São Paulo", -23.55, -46.63], ["Sydney", -33.87, 151.21], ["Reykjavík", 64.147, -21.94], ["Cairo", 30.044, 31.236],
  ["Mumbai", 19.076, 72.878], ["Honolulu", 21.307, -157.858], ["North Pole", 89.9, 0], ["Date line, equator", 0.5, 179.6],
];

const fields = { grid: makeGridField(5, 100), globe: null, local: null };
const LOCAL_SIZES = [1, 5, 10, 50, 100]; // local grid presets, km on each side
const MAX_SPACING_KM = 100;
/** Meters from the middle (east-west or north-south) at which a local grid re-centers: 40% of its side, at least 0.6 of a spacing. */
const recenterM = (f) => Math.max(0.6 * f.spacing, 0.4 * f.sideM);
function savedLocalKm() {
  try { const v = +localStorage.getItem("beacon.localKm"); return LOCAL_SIZES.includes(v) ? v : 50; } catch { return 50; }
}
const MIN_SPACING_KM = 0.01;
const cleanSpacing = (v) => Number.isFinite(v) && v > 0 ? Math.max(MIN_SPACING_KM, Math.min(MAX_SPACING_KM, Math.round(v * 1000) / 1000)) : 1;
function savedSpacingKm() {
  try { const v = localStorage.getItem("beacon.localSpacingKm"); return v === null ? 1 : cleanSpacing(+v); } catch { return 1; }
}
/** A distance in meters, as meters under 1 km, else km. */
const fmtDist = (m) => m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
const fmtKmVal = (km) => `${+km.toFixed(3)} km`;
const engine = new BeaconEngine(fields.grid);
// My beacons (src/draftsui.js), set up once the rest of the page is.
let drafts = { isUser: () => false, findBeacon: () => null, setSong: () => false, regenerate: () => null, inspectorHtml: () => "", placeAt: () => false, beaconAt: () => null, draw() {}, tick() {}, noteFix() {}, placing: null };
const canvas = $("field");
const g = canvas.getContext("2d");

const ui = {
  mode: "grid",
  zoom: "local",
  speed: 1,
  zones: true,
  zoneImg: null,
  zoneKey: "",
  selected: null,
  flashes: new Map(), // beacon id -> {t, color}
  harmonyFlash: 0,
  colors: {},
  lastPanel: 0,
  follow: false, // local grid: the listener follows the device's location
  localKm: savedLocalKm(), // local grid length of each side, km
  spacingKm: savedSpacingKm(), // local grid: km between neighbouring beacons
  watchId: null,
  closeKm: 30, // Globe tab, Close zoom: km from the top of the map to the bottom
  view3d: (() => { try { return localStorage.getItem("beacon.globe3d") !== "0"; } catch { return true; } })(), // Globe tab: the 3D globe (default) or the flat map
};
const is3d = () => ui.mode === "globe" && ui.view3d;
let globe3d = null, lastDraw = performance.now();
// Walks (src/walkui.js): trail, recordings, replay, audio export. Set up once the page is.
let walk = { frame: () => false, lines: () => [], setSong: () => false, findBeacon: () => null, replaying: false };
// Following a flight (src/flight.js): a real aircraft drives the listener on the Globe tab.
const flight = new FlightTracker({ lookup: supabaseFlightLookup({ url: SUPABASE_URL, key: SUPABASE_KEY }) });

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

/**
 * The map's view. Dragging pans it away from the listener (ui.pan, canvas
 * pixels); any move of the listener brings it back.
 */
function view() {
  const v = baseView();
  const o = ui.pan;
  if (!o) return v;
  return { ...v, toScreen: (p) => { const [x, y] = v.toScreen(p); return [x + o.x, y + o.y]; }, toWorld: (x, y) => v.toWorld(x - o.x, y - o.y) };
}

function baseView() {
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
  if (ui.mode === "local") {
    const f = engine.field;
    const whole = ui.zoom === "world";
    const c = whole ? { x: 0, y: 0 } : f.toXY(engine.pos);
    const spanM = whole ? f.sideM + 2 * f.spacing : Math.min(8 * f.spacing, f.sideM + 2 * f.spacing);
    const s = Math.min(W, H) / spanM;
    return {
      center: c, spanM,
      toScreen: (p) => { const q = f.toXY(p); return [W / 2 + (q.x - c.x) * s, H / 2 - (q.y - c.y) * s]; },
      toWorld: (x, y) => f.fromXY({ x: c.x + (x - W / 2) / s, y: c.y - (y - H / 2) / s }),
      scale: s,
    };
  }
  if (ui.zoom === "close") {
    // Close (Globe tab): a few km across, east-west scaled to match north-south, for your own beacons.
    const latSpan = ui.closeKm / 111.2;
    const c = { lat: Math.max(-85, Math.min(85, engine.pos.lat)), lon: engine.pos.lon };
    const sy = H / latSpan, sx = sy * Math.cos((c.lat * Math.PI) / 180);
    const wrap = (d) => ((d + 540) % 360) - 180;
    return {
      center: c, span: { lat: latSpan, lon: W / sx },
      toScreen: (p) => [W / 2 + wrap(p.lon - c.lon) * sx, H / 2 - (p.lat - c.lat) * sy],
      toWorld: (x, y) => normalizeLatLon({ lon: c.lon + (x - W / 2) / sx, lat: c.lat - (y - H / 2) / sy }),
      scale: sx,
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
  const big = Math.max(canvas.width, canvas.height) || 1;
  const res = ui.mode === "globe" ? [140, 70] : ui.mode === "local" ? [Math.round(120 * canvas.width / big), Math.round(120 * canvas.height / big)] : [110, 110];
  const key = [ui.mode, ui.zoom, engine.opts.sharpness, canvas.width, canvas.height, engine.overrides.size, engine.songRev || 0,
    ui.pan ? `${Math.round(ui.pan.x / 3)},${Math.round(ui.pan.y / 3)}` : "",
    ui.mode === "globe" && ui.zoom === "local" ? `${Math.round(v.center.lat / 3)},${Math.round(v.center.lon / 3)}` : "",
    ui.mode === "local" ? `${engine.field.center.lat},${engine.field.center.lon},${Math.round(v.center.x / (v.spanM / 80))},${Math.round(v.center.y / (v.spanM / 80))}` : ""].join("|");
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
  const dtDraw = Math.min(0.1, (now - lastDraw) / 1000);
  lastDraw = now;
  if (is3d() && globe3d) { globe3d.draw(g, now, dtDraw); return; }
  const W = canvas.width, H = canvas.height, d = ui.dpr || 1;
  const v = view();
  const C = ui.colors;
  g.fillStyle = C.field;
  g.fillRect(0, 0, W, H);
  if (ui.zones && ui.zoom !== "close") {
    g.imageSmoothingEnabled = true;
    g.drawImage(zoneImage(v), 0, 0, W, H);
  }
  drawGraticule(v, d);
  // Your trail (and a replaying walk's path), under the beacons.
  drawLines(g, walk.lines(), (p) => {
    const s = v.toScreen(p);
    return s[0] < -W || s[0] > 2 * W || s[1] < -H || s[1] > 2 * H ? null : s;
  }, (m) => MOOD_COLOR[m] || "#888888", d);

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
  const isLocal = ui.mode === "local";
  const local = isGrid || ui.zoom === "local";
  // Beacon spacing on screen, in CSS pixels (labels and sizes shrink to fit).
  const gap = isGrid || isLocal ? engine.field.spacing * v.scale / d : 999;
  const baseR = (isGrid ? 11 : isLocal ? Math.max(1.6, Math.min(7, gap / 9)) : local ? 6 : 2.6) * d;
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
    g.globalAlpha = w > 0 ? 1 : isGrid || (isLocal && gap > 40) ? 0.75 : 0.55;
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
    if (isGrid || (isLocal && (gap > 50 || w > 0 || b.label === "Center")) || (!isLocal && local && w > 0)) {
      // Drop song titles when they would collide.
      label(b.label, x, y + r + 12 * d, Math.min(11, Math.max(9, gap / 7)) * d, C.muted, isLocal ? C.field : null);
      if ((isGrid || isLocal) && gap > 120) label(song.title, x, y + r + 25 * d, 10 * d, C.muted, null, 0.75);
    }
  }

  drafts.draw(g, v, d);

  // Target and listener.
  if (input.target) {
    const [tx, ty] = v.toScreen(input.target);
    g.strokeStyle = C.accent; g.lineWidth = 1.5 * d;
    g.beginPath(); g.moveTo(tx - 6 * d, ty - 6 * d); g.lineTo(tx + 6 * d, ty + 6 * d); g.moveTo(tx + 6 * d, ty - 6 * d); g.lineTo(tx - 6 * d, ty + 6 * d); g.stroke();
  }
  if (flight.active && ui.mode === "globe") drawPlane(g, px, py, flight.fix.track, d, C.accent);
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
  if (ui.mode === "local") {
    const f = engine.field, m = f.sideM / 2, sp = f.spacing;
    const fine = v.spanM < 20 * sp;
    const strong = [];
    for (let e = 0; e <= f.steps; e++) {
      const k = (e - f.steps / 2) * sp; // meters from the middle; every 5th line from the west and south edges is drawn stronger
      if (!fine && e % 5 !== 0) continue;
      const segs = [[{ x: k, y: -m }, { x: k, y: m }], [{ x: -m, y: k }, { x: m, y: k }]];
      if (e % 5 === 0) { strong.push(...segs); continue; }
      for (const [a, b] of segs) {
        const [x1, y1] = v.toScreen(f.fromXY(a)), [x2, y2] = v.toScreen(f.fromXY(b));
        g.moveTo(x1, y1); g.lineTo(x2, y2);
      }
    }
    g.stroke();
    g.strokeStyle = C.line;
    g.beginPath();
    for (const [a, b] of strong) {
      const [x1, y1] = v.toScreen(f.fromXY(a)), [x2, y2] = v.toScreen(f.fromXY(b));
      g.moveTo(x1, y1); g.lineTo(x2, y2);
    }
    g.stroke();
    const len = sp * v.scale * (fine ? 1 : 5);
    const x0 = canvas.width - 20 * d - len, y0 = canvas.height - 14 * d;
    g.strokeStyle = C.muted;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + len, y0); g.stroke();
    label(fmtDist(sp * (fine ? 1 : 5)), x0 + len / 2, y0 - 9 * d, 10 * d, C.muted, null);
    return;
  }
  if (ui.zoom === "close") {
    const km = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].find((k) => k >= ui.closeKm / 6) || 100;
    const len = (km / ui.closeKm) * canvas.height;
    const x0 = canvas.width - 20 * d - len, y0 = canvas.height - 14 * d;
    g.strokeStyle = C.muted;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + len, y0); g.stroke();
    label(fmtDist(km * 1000), x0 + len / 2, y0 - 9 * d, 10 * d, C.muted, null);
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

/** A small plane pointing along `track` (degrees from north), for following a flight. */
export function drawPlane(g, x, y, track, d, color) {
  g.save();
  g.translate(x, y);
  g.rotate(((track || 0) * Math.PI) / 180);
  g.scale(d, d);
  g.fillStyle = color;
  g.strokeStyle = "#04070d";
  g.lineWidth = 1.5;
  g.beginPath();
  // Nose up: fuselage, wings, tail.
  g.moveTo(0, -22); g.lineTo(3, -12); g.lineTo(3, -4); g.lineTo(18, 4); g.lineTo(18, 8); g.lineTo(3, 4);
  g.lineTo(2.5, 14); g.lineTo(8, 19); g.lineTo(8, 22); g.lineTo(0, 19); g.lineTo(-8, 22); g.lineTo(-8, 19);
  g.lineTo(-2.5, 14); g.lineTo(-3, 4); g.lineTo(-18, 8); g.lineTo(-18, 4); g.lineTo(-3, -4); g.lineTo(-3, -12); g.closePath();
  g.fill(); g.stroke();
  g.restore();
}

function label(text, x, y, size, color, halo, alpha = 1, align = "center") {
  g.font = `500 ${size}px "IBM Plex Mono", Consolas, monospace`;
  g.textAlign = align;
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
  if (ui.mode === "local") { // meters per second: half a spacing nearby, a 25th of the grid on the whole-grid view
    const f = engine.field;
    return (ui.zoom === "world" ? Math.max(0.5 * f.spacing, f.sideM / 25) : 0.5 * f.spacing) * ui.speed;
  }
  if (ui.zoom === "close") return (ui.closeKm / 111.2 / 12) * ui.speed; // a 12th of the map per second
  return (ui.zoom === "world" ? 18 : 5) * ui.speed; // degrees per second
}

// Walking comes from ListenerKit (src/input/listener.js): keyboard and gamepad,
// press / drag / tap on the map, auto-walk. This page only reacts to it.
const localNow = () => localSpace(engine.field);
const spaces = {
  grid: planarSpace({ half: 250, margin: 20 }),
  globe: geoSpace({ maxLat: 84 }),
  // The local grid is rebuilt as you travel, so always ask the current one.
  local: { kind: "local", clamp: (p) => localNow().clamp(p), step: (...a) => localNow().step(...a), toward: (...a) => localNow().toward(...a), bounce: (...a) => localNow().bounce(...a),
    interp: (...a) => localNow().interp(...a), distance: (...a) => localNow().distance(...a) },
};
const input = new ListenerInput({ space: spaces.grid, position: { x: -38, y: 27 }, speed: speedPerSec });
input.add(keyboardSource(window));
const travel = initTravelCard({
  wrap: $("fieldwrap"), card: $("travelcard"), title: $("tcTitle"), detail: $("tcDetail"), back: $("backtome"),
  onBack: () => { ui.pan = null; ui.panVel = null; if (is3d() && globe3d) globe3d.follow(); },
});
// One finger (or the mouse) pans the map; a tap on a beacon or a long press
// (right-click) offers to Jump or Move there.
const pointer = input.add(pointerSource(canvas, (x, y) => view().toWorld(x, y), {
  mode: "explore",
  onOrbit: (dx, dy) => { ui.pan = { x: (ui.pan?.x || 0) + dx, y: (ui.pan?.y || 0) + dy }; ui.panVel = null; travel.close(); },
  onOrbitEnd: (vx, vy) => { ui.panVel = Math.hypot(vx, vy) > 60 ? { x: vx, y: vy } : null; },
}));
input.on("moved", (p) => { engine.setPosition(p); ui.pan = null; ui.panVel = null; });
input.on("jumped", () => walk.markJump?.());
input.on("manual", () => stopFlight("Walking by hand, so you stopped following the flight."));
input.on("manual", (kind) => stopFollow(kind === "pointer" ? "Moved by hand, so the map stopped following your location." : "Walking by hand, so the map stopped following your location."));
input.on("wander", (on) => { $("wander").checked = on; if (on) stopFollow("Auto-walk is on, so the map stopped following your location."); });
input.on("action", (name, arg) => {
  if (name === "toggle_play") togglePlay();
  else if (name === "select") {
    if (drafts.placing && drafts.placeAt(view().toWorld(arg.x, arg.y))) return;
    if (tappedPlane(arg.x, arg.y)) { flightCard.open(); return; }
    if (input.traveling) { input.stopTravel(); setMsg("fieldMsg", "Stopped here."); return; } // a tap while moving stops there
    const b = beaconAt(arg.x, arg.y);
    if (b) { select(b.id); offerPlace(b.pos, b, arg); }
  } else if (name === "point") {
    const b = beaconAt(arg.x, arg.y);
    offerPlace(b ? b.pos : arg.pos, b, arg);
  }
});

/** The Jump / Move card for a place (and the beacon there, if any), next to where it was asked for. */
function offerPlace(pos, beacon, at, songOverride = null) {
  if (!pos) return;
  const sp = spaces[ui.mode]; // this view's own space (step() only switches the listener's on the next frame)
  input.space = sp;
  const span = ui.mode === "local" ? engine.field.sideM : 500;
  const d = sp.distance(engine.pos, pos);
  const meters = sp.kind === "geo" ? d * 1000 : d;
  let clientX = at.clientX, clientY = at.clientY;
  if (clientX == null) {
    const r = canvas.getBoundingClientRect();
    clientX = r.left + (at.x * r.width) / canvas.width;
    clientY = r.top + (at.y * r.height) / canvas.height;
  }
  let song = songOverride;
  try { if (!song && beacon?.id) song = engine.songFor(beacon); } catch { /* a beacon without a song yet */ }
  travel.open(clientX, clientY, describePlace({ beacon, song, pos, kind: ui.mode, meters, seconds: travelSeconds(sp, engine.pos, pos, span) }),
    (kind) => goTo(kind, pos, span));
}

/** Jump there at once, or Move: glide there, hearing the music change on the way. */
function goTo(kind, pos, span) {
  stopFollow("Went somewhere else, so the map stopped following your location.");
  stopFlight("Went somewhere else, so you stopped following the flight.");
  ui.pan = null;
  input.space = spaces[ui.mode];
  input.setPosition(engine.pos, false);
  if (kind === "jump") input.jumpTo(pos);
  else { input.travelTo(pos, travelSeconds(input.space, engine.pos, pos, span)); setMsg("fieldMsg", "Moving… tap the map to stop."); }
  globe3d?.follow?.();
}

function step(dt) {
  input.space = spaces[ui.mode];
  input.setPosition(engine.pos, false); // other code moves the listener too (jumps, re-centering)
  input.tick(dt);
}

function beaconAt(x, y) {
  const v = view();
  const mine = drafts.beaconAt(x, y, v, 14 * (ui.dpr || 1));
  if (mine) return mine;
  let best = null, bd = (ui.mode === "grid" ? 24 : 14) * (ui.dpr || 1);
  for (const b of engine.field.beacons) {
    const [bx, by] = v.toScreen(b.pos);
    const dd = Math.hypot(bx - x, by - y);
    if (dd < bd) { bd = dd; best = b; }
  }
  return best;
}

// ------------------------------------------------------------------ controls

async function togglePlay() {
  if (engine.running) engine.stop();
  else {
    try { await engine.start(); } catch (err) { setMsg("fieldMsg", "Audio couldn't start: " + err.message, true); return; }
  }
  $("startcard").hidden = true;
  $("play").textContent = engine.running ? "■ Stop" : "▶ Start";
  if (engine.running) keepAwake(); else letSleep();
}

// ------------------------------------------------------------------ keep playing on phones

// Phones pause web audio when the screen turns off, so while music plays the
// page asks to keep the screen on (Screen Wake Lock: Chrome on Android, Safari
// on iOS 16.4+, HTTPS or localhost only). The lock drops whenever the page is
// hidden, so it's asked for again each time the page comes back.
// Only phones and tablets get the warning: a computer's screen saver doesn't stop the music.
let wakeLock = null, wakeWarned = !matchMedia("(pointer: coarse)").matches;
async function keepAwake() {
  if (!engine.running || document.visibilityState !== "visible" || wakeLock) return;
  if (!("wakeLock" in navigator)) {
    if (!wakeWarned) setMsg("fieldMsg", "This browser can't keep the screen on, so the music may stop when the screen turns off. Turn up the screen timeout in the phone's settings to keep it going.");
    wakeWarned = true;
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
    devLog("wake-lock", { ok: true });
  } catch (err) {
    devLog("wake-lock", { ok: false, message: err.message });
    if (!wakeWarned) setMsg("fieldMsg", "Couldn't keep the screen on (" + err.message + "), so the music may stop when the screen turns off.");
    wakeWarned = true;
  }
}
function letSleep() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  const hidden = document.visibilityState !== "visible";
  engine.setBackground(hidden);
  if (!hidden) { engine.resume(); keepAwake(); }
});
// iOS can pause audio without hiding the page (a call, Siri, another app's sound).
window.addEventListener("pageshow", () => engine.resume());
window.addEventListener("focus", () => engine.resume());
$("play").addEventListener("click", togglePlay);
$("play2").addEventListener("click", togglePlay);
$("vol").addEventListener("input", (e) => engine.setVolume(+e.target.value));

// Sound: SynthKit's instruments, as in the app (default; the songs are mixed for
// them), or the old browser synths for comparing. ?synth=kit or ?synth=web in
// the address picks one; the choice is remembered.
{
  const url = new URLSearchParams(location.search).get("synth");
  let saved = null;
  try { saved = localStorage.getItem("beacon.sound"); } catch {}
  const pick = ["web", "kit"].includes(url) ? url : saved === "web" ? "web" : "kit";
  engine.synthMode = pick;
  $("synthMode").value = pick;
  $("synthMode").addEventListener("change", async (e) => {
    const want = e.target.value;
    e.target.disabled = true;
    try {
      const got = await engine.setSynthMode(want);
      e.target.value = got;
      try { localStorage.setItem("beacon.sound", got); } catch {}
    } catch (err) {
      setMsg("fieldMsg", "Couldn't switch the sound: " + err.message, true);
    }
    e.target.disabled = false;
  });
}
$("wander").addEventListener("change", (e) => { input.wander = e.target.checked; });
$("speed").addEventListener("input", (e) => { ui.speed = +e.target.value; });
$("zones").addEventListener("change", (e) => { ui.zones = e.target.checked; });

const MODE_HINT = {
  grid: "25 beacons, 100 m apart. Drag, tap or use WASD to walk.",
  globe: "614 beacons, one every 10° of latitude and longitude. Starting in London.",
  local: () => {
    const s = localGridShape(ui.localKm, ui.spacingKm), n = (s.steps + 1) ** 2, side = fmtKmVal(s.sizeKm);
    return `${n.toLocaleString()} beacons, one every ${fmtDist(s.unit)} over ${side} × ${side}, centered on you.`;
  },
};

function setMode(mode) {
  if (mode === ui.mode) return;
  const from = ui.mode !== "grid" ? { ...engine.pos } : null;
  ui.mode = mode;
  if (mode === "grid") stopFollow();
  if (mode !== "globe") stopFlight();
  if (mode !== "globe" && ui.zoom === "close") setZoom("local");
  if (mode === "globe" && !fields.globe) fields.globe = makeGlobeField(10);
  if (mode === "local" && !fields.local) fields.local = makeLocalGridField(from || { lat: 51.507, lon: -0.128 }, ui.localKm, ui.spacingKm);
  engine.setField(fields[mode]);
  if (mode === "globe") engine.setPosition(from || { lat: 51.507, lon: -0.128 });
  input.target = null;
  closeEditor();
  ui.selected = null;
  ui.zoneKey = "";
  $("modeGrid").setAttribute("aria-pressed", mode === "grid");
  $("modeGlobe").setAttribute("aria-pressed", mode === "globe");
  $("modeLocal").setAttribute("aria-pressed", mode === "local");
  $("globeTools").hidden = mode === "grid";
  $("followWrap").hidden = mode === "grid";
  $("zoomClose").hidden = mode !== "globe";
  $("draftsUnit").hidden = mode !== "globe";
  $("sources").hidden = mode !== "globe";
  $("plantWrap").hidden = mode !== "globe";
  $("zoomLocal").textContent = mode === "local" ? "Nearby" : "Local";
  $("zoomWorld").textContent = mode === "local" ? "Whole grid" : "World";
  $("geo").textContent = mode === "local" ? "Center on me" : "My location";
  $("fieldwrap").classList.toggle("globe", mode === "globe");
  $("viewSeg").hidden = mode !== "globe";
  apply3d();
  $("modeHint").textContent = typeof MODE_HINT[mode] === "function" ? MODE_HINT[mode]() : MODE_HINT[mode];
  setMsg("fieldMsg", "");
  applyShared();
  if (mode === "local") startFollow();
}
$("modeGrid").addEventListener("click", () => setMode("grid"));
$("modeGlobe").addEventListener("click", () => setMode("globe"));
$("modeLocal").addEventListener("click", () => setMode("local"));
$("localSize").value = String(ui.localKm);
$("localSpacing").value = String(ui.spacingKm);
function localGridChanged() {
  if (ui.mode !== "local") return;
  // Rebuild around the listener; beacons both grids share keep their songs.
  centerLocal({ ...engine.pos });
  $("modeHint").textContent = MODE_HINT.local();
  const f = engine.field;
  setMsg("fieldMsg", `Local grid is now ${fmtKmVal(f.sizeKm)} × ${fmtKmVal(f.sizeKm)}, a beacon every ${fmtDist(f.spacing)}.` +
    (f.capped ? ` That spacing allows at most ${MAX_LOCAL_STEPS} beacons along a side, so the grid is smaller than ${ui.localKm} km.` : ""));
}
$("localSize").addEventListener("change", (e) => {
  ui.localKm = +e.target.value;
  try { localStorage.setItem("beacon.localKm", String(ui.localKm)); } catch {}
  localGridChanged();
});
$("localSpacing").addEventListener("change", (e) => {
  ui.spacingKm = cleanSpacing(parseFloat(e.target.value));
  e.target.value = String(ui.spacingKm);
  try { localStorage.setItem("beacon.localSpacingKm", String(ui.spacingKm)); } catch {}
  localGridChanged();
});

function setZoom(z) {
  if (is3d() && globe3d) {
    // On the 3D globe the zoom buttons fly the camera: Local to you, World out, Close to your beacons.
    const p = engine.pos;
    if (z === "world") { globe3d.flyTo(globe3d.lat0, globe3d.lon0, 1); globe3d.spin(); }
    else globe3d.flyTo(p.lat, p.lon, z === "close" ? globe3d.zoomForKm(ui.closeKm) : 5), globe3d.mode = "follow";
  }
  ui.zoom = z;
  ui.zoneKey = "";
  $("zoomLocal").setAttribute("aria-pressed", z === "local");
  $("zoomWorld").setAttribute("aria-pressed", z === "world");
  $("zoomClose").setAttribute("aria-pressed", z === "close");
}
$("zoomLocal").addEventListener("click", () => setZoom("local"));
$("zoomWorld").addEventListener("click", () => setZoom("world"));
$("zoomClose").addEventListener("click", () => setZoom("close"));
// Close zoom: the wheel (or a pinch on a trackpad) zooms from 1 km to 400 km.
canvas.addEventListener("wheel", (e) => {
  if (ui.mode !== "globe" || ui.zoom !== "close" || ui.view3d) return;
  e.preventDefault();
  ui.closeKm = Math.max(1, Math.min(400, ui.closeKm * Math.pow(1.0015, e.deltaY)));
}, { passive: false });

function jumpTo(lat, lon, how) {
  input.target = null;
  if (ui.mode === "local") {
    stopFollow();
    centerLocal({ lat, lon });
    setMsg("fieldMsg", `Grid centered on ${how === "Moved to" ? `${lat.toFixed(3)}, ${lon.toFixed(3)}` : how}.`);
    return;
  }
  engine.setPosition({ lat, lon });
  setMsg("fieldMsg", `${how}: ${lat.toFixed(2)}, ${lon.toFixed(2)}`);
}

// ------------------------------------------------------------------ local grid and location

/**
 * Re-centers the local grid on `p` (snapped to the lattice) and puts the
 * listener there. With `keepIfClose`, only re-centers once `p` is far from the
 * current center; beacon ids are shared between grids, so the music carries on.
 */
function centerLocal(p, { keepIfClose = false } = {}) {
  const f = engine.field;
  if (keepIfClose && f.kind === "local") {
    const q = f.toXY(p), lim = recenterM(f);
    if (Math.abs(q.x) < lim && Math.abs(q.y) < lim) { engine.setPosition(p); return; }
  }
  // Keep the music going only when the new grid overlaps the old one; a jump
  // to somewhere else entirely starts fresh, like switching fields.
  const overlaps = f.kind === "local" && Math.hypot(f.toXY(p).x, f.toXY(p).y) < f.sideM;
  fields.local = makeLocalGridField(p, ui.localKm, ui.spacingKm);
  engine.pos = { ...p };
  engine.setField(fields.local, { keep: overlaps });
  engine.setPosition(p);
  ui.zoneKey = "";
  applyShared();
}

const NO_GPS = "Your location isn't available here, so the grid is centered on London. Pick a city or type coordinates to move it.";

/**
 * When the page comes from web/serve.py, location results are reported back
 * to that server's console (never the coordinates), so problems on a phone
 * can be read on the PC.
 */
function devLog(event, extra = {}) {
  if (!window.BEACON_DEV_LOG) return;
  const body = JSON.stringify({ event, secure: window.isSecureContext, geo: !!navigator.geolocation, ua: navigator.userAgent, ...extra });
  fetch("/__log", { method: "POST", body, headers: { "Content-Type": "application/json" } }).catch(() => {});
}

const GEO_BLOCKED = "Location is blocked for this page. On iPhone or iPad: Settings › Privacy & Security › Location Services must be on, with Safari Websites set to Ask or While Using; then in Safari tap aA › Website Settings › Location › Ask, and reload. Or pick a city or type coordinates.";

function startFollow() {
  if (ui.watchId !== null) return;
  if (!navigator.geolocation || !window.isSecureContext) {
    devLog("no-geolocation");
    return setMsg("fieldMsg", window.isSecureContext ? NO_GPS : "This page isn't secure (HTTPS), so the browser won't share your location. " + NO_GPS, true);
  }
  setMsg("fieldMsg", "Finding you… (allow location if your browser asks)");
  navigator.permissions?.query({ name: "geolocation" }).then((s) => devLog("permission-state", { state: s.state }), () => devLog("permission-state", { state: "query failed" }));
  devLog("watch-start");
  let first = true;
  ui.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (ui.mode === "grid") return;
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const acc = Math.round(pos.coords.accuracy || 0);
      drafts.noteFix({ ...p, accuracy: pos.coords.accuracy });
      if (ui.mode === "globe") engine.setPosition(p);
      else centerLocal(p, { keepIfClose: !first });
      input.target = null;
      if (first) {
        setMsg("fieldMsg", `${ui.mode === "globe" ? "Found you" : "Centered on you"} (accurate to ${acc < 1000 ? acc + " m" : (acc / KM_M).toFixed(1) + " km"}). Following your location.`);
        devLog("position", { accuracy: acc });
      }
      first = false;
    },
    (err) => {
      devLog("error", { code: err.code, message: err.message });
      if (err.code !== 1) {
        // Timeout (3) or a momentary "position unavailable" (2, e.g. iOS kCLErrorLocationUnknown):
        // keep listening, the device usually finds a fix again within seconds.
        if (first) setMsg("fieldMsg", "Still looking for your location…");
        return;
      }
      stopFollow();
      setMsg("fieldMsg", err.code === 1 ? GEO_BLOCKED : `${NO_GPS} (${err.message || "position unavailable"})`, true);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  );
  ui.follow = true;
  $("follow").checked = true;
}

function stopFollow(why) {
  if (ui.watchId === null) return;
  navigator.geolocation.clearWatch(ui.watchId);
  ui.watchId = null;
  ui.follow = false;
  $("follow").checked = false;
  if (why) setMsg("fieldMsg", why);
}
$("follow").addEventListener("change", (e) => {
  if (e.target.checked) { input.wander = false; startFollow(); }
  else stopFollow("Stopped following your location.");
});
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
  if (ui.mode === "local") { stopFollow(); return startFollow(); }
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

function findBeacon(id) { return walk.findBeacon(id) || drafts.findBeacon(id) || engine.field.beacons.find((b) => b.id === id); }
function beaconLabel(id) { return findBeacon(id)?.label ?? id; }
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
  const b = findBeacon(id);
  if (!b) { ui.selected = null; return; }
  const s = engine.songFor(b);
  const chordsOf = (p) => p.map((d) => chordName(s.key, d)).join(" – ");
  const chords = chordsOf(s.progression);
  const used = hasForm(s) ? [...new Set(s.form.map((f) => f.section))] : [];
  const sectionChords = used.filter((t) => sectionSpec(s, t).progression && JSON.stringify(sectionSpec(s, t).progression) !== JSON.stringify(s.progression))
    .map((t) => `<span class="chip">${SECTION_LABEL[t]} <b>${esc(chordsOf(sectionSpec(s, t).progression))}</b></span>`).join("");
  const tracks = ROLES.filter((r) => s.tracks[r]?.level > 0).map((r) => {
    const t = s.tracks[r], moving = Object.keys(t.automation || {});
    const tip = moving.length ? ` title="Animated: ${esc(moving.join(", "))}"` : "";
    return `<span class="chip"${tip}>${ROLE_LABEL[r]} <b>${Math.round(t.level * 100)}</b>${t.preset ? ` · ${esc(t.preset)}` : ""}${moving.length ? ` <b>∿${moving.length}</b>` : ""}</span>`;
  }).join("");
  const own = engine.overrides.has(id) ? `<span class="chip"><b>edited</b></span>` : "";
  $("insp").innerHTML = `
    <div class="title"><strong>${esc(s.title)}</strong><span class="hint">${esc(b.label)} · ${ui.selected ? "selected" : "closest"}</span></div>
    <div class="chips">
      <span class="chip" style="border-color:${MOOD_COLOR[s.mood] || "var(--line)"}">${esc(s.mood || "Custom")}</span>${s.family ? `<span class="chip" title="${esc(FAMILY_TIP[s.family] || "")}">${esc(FAMILY_LABEL[s.family] || s.family)}</span>` : ""}
      <span class="chip">Key <b>${esc(keyName(s.key))}</b></span>
      <span class="chip"><b>${s.bpm}</b> BPM</span>
      <span class="chip">${hasForm(s) ? "Verse " : ""}<b>${esc(chords)}</b></span>${sectionChords}${own}
    </div>
    <div class="chips">
      <span class="chip">Length <b>${clock(lengthSeconds(s))}</b></span>
      <span class="chip"><b>${totalBars(s)}</b> bars</span>
      <span class="chip">${hasForm(s) ? `<b>${s.form.length}</b> sections` : "<b>one loop</b> (no form)"}</span>
    </div>
    <div class="formview" id="inspForm" data-id="${esc(id)}"></div>
    <div class="chips">${tracks}</div>${drafts.inspectorHtml(id)}`;
  ui.inspectedShown = inspectorKey(id);
  updateShareButtons();
}

let editorId = null;
const editor = new SongEditor($("editor"), {
  onChange: (song) => {
    if (!walk.setSong(editorId, song) && !drafts.setSong(editorId, song)) engine.setSong(editorId, song);
    engine.songRev = (engine.songRev || 0) + 1;
    $("editorTitle").textContent = `Editing ${song.title} (${beaconLabel(editorId)})`;
    renderInspector();
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
$("editSong").addEventListener("click", () => { const id = needBeacon(); if (id) openEditor(id); });
$("closeEditor").addEventListener("click", closeEditor);

$("goBeacon").addEventListener("click", () => { const b = findBeacon(inspectedId()); if (b) input.target = { ...b.pos }; });
/** The inspected beacon's id, or null after saying there's none (an exclusive map's silence). */
function needBeacon() {
  const id = inspectedId();
  if (!id) setMsg("inspMsg", "No beacon is playing here. Tap one on the map first.", true);
  return id || null;
}
$("regen").addEventListener("click", () => {
  const id = needBeacon();
  if (!id) return;
  if (drafts.isUser(id)) {
    const m = drafts.regenerate(id);
    if (editorId === id) openEditor(id);
    renderInspector();
    return setMsg("inspMsg", m, /hand-made/.test(m));
  }
  const s = generateSong(`${engine.field.kind}:${id}:${Date.now()}`);
  engine.setSong(id, s);
  engine.songRev = (engine.songRev || 0) + 1;
  if (editorId === id) openEditor(id);
  renderInspector();
  setMsg("inspMsg", `New song on ${beaconLabel(id)}: ${s.title}`);
});
$("copyJson").addEventListener("click", async () => {
  const id = needBeacon();
  if (!id) return;
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
  if (!needBeacon()) return;
  $("songJson").value = JSON.stringify(engine.songFor(inspectedId()), null, 1);
  $("jsonBox").hidden = false;
});
$("closeJson").addEventListener("click", () => { $("jsonBox").hidden = true; });
$("loadJson").addEventListener("click", () => {
  let s;
  try { s = JSON.parse($("songJson").value); } catch (err) { return setMsg("inspMsg", "That isn't valid JSON: " + err.message, true); }
  const errs = validateSong(s);
  if (errs.length) return setMsg("inspMsg", "Song not loaded: " + errs.join("; "), true);
  const id = needBeacon();
  if (!id) return;
  if (!walk.setSong(id, s) && !drafts.setSong(id, s)) engine.setSong(id, s);
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
  const now = engine.musicNow(); // the songs' clock (shifted while replaying a walk)
  const hp = h ? songPosition(engine.harmony.song, now) : null;
  $("nBar").textContent = hp ? sectionName(hp) : "–";
  $("nBar").title = hp ? `Bar ${hp.barInSection + 1} of ${hp.bars}` : "";
  $("nBarSub").textContent = hp ? `bar ${hp.barInSection + 1}/${hp.bars}` : "";
  [...$("beat").children].forEach((c, i) => c.classList.toggle("on", !!heard && heard.step === i));
  if (h) {
    const line = `Harmony from <b>${esc(h.title)}</b> (${esc(beaconLabel(h.id))}) · ${clock(hp.seconds)} / ${clock(hp.totalSeconds)}${hp.shaped ? ` · next: ${esc(SECTION_LABEL[hp.next] || hp.next)}` : ""}`;
    if ($("songline").innerHTML !== line) $("songline").innerHTML = line;
  }

  // Blend rows.
  $("blend").innerHTML = st.active.map((a) => {
    const col = MOOD_COLOR[a.song.mood] || "#888";
    const dist = ui.mode === "grid" ? `${Math.round(a.d)} m` : ui.mode === "local" ? fmtDist(a.d) : drafts.isUser(a.id) || a.d < 10 ? fmtDist(a.d * 1000) : `${Math.round(a.d).toLocaleString()} km`;
    return `<div class="brow${a.id === engine.harmony.id ? " harm" : ""}" data-id="${a.id}">
      <span class="tag" style="background:${col}">${esc(ui.mode === "globe" && !drafts.isUser(a.id) ? a.beacon.label.split(" ")[0] : a.beacon.label)}</span>
      <div class="name"><div>${esc(a.song.title)}</div><small>${esc(keyName(a.song.key))} · ${a.song.bpm} BPM · ${dist}</small>
        <small class="sec">${sectionLine(a.song, now)}</small>
        <div class="wbar"><i style="width:${(a.w * 100).toFixed(1)}%;background:${col}"></i></div>
        ${formStrip(a.song, now, false)}</div>
      <span class="pct">${Math.round(a.w * 100)}%</span></div>`;
  }).join("");

  // Inspector's form view (live playhead).
  const fv = $("inspForm");
  if (fv) fv.innerHTML = formStrip(engine.songFor(fv.dataset.id), now, true);

  // Instrument rows.
  const rows = ROLES.map((r) => {
    const m = st.mix.roles[r];
    const pk = engine.running && engine.inst ? Math.min(1, engine.inst.channels[r].peak() * 1.6) : 0;
    const src = m.sources.map((s) => {
      const a = st.active.find((x) => x.id === s.id);
      return `<i style="width:${(s.share * 100).toFixed(1)}%;background:${MOOD_COLOR[a?.song.mood] || "#888"}"></i>`;
    }).join("");
    return `<div class="trow"><div class="inst" data-role="${r}" role="link" tabindex="0" title="Open ${ROLE_INSTRUMENT[r]} on the Synths page with this sound">${ROLE_LABEL[r]}<small>${ROLE_INSTRUMENT[r]} ↗</small></div>
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
  const off = ui.mode === "local" ? engine.field.toXY(p) : null;
  const where = ui.mode === "grid" ? `x <b>${p.x.toFixed(0)}</b> m · y <b>${(-p.y).toFixed(0)}</b> m`
    : ui.mode === "local" ? `<b>${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}</b> · ${fmtDist(Math.abs(off.y))} ${off.y >= 0 ? "N" : "S"}, ${fmtDist(Math.abs(off.x))} ${off.x >= 0 ? "E" : "W"} of center${ui.follow ? " · following you" : ""}`
    : `<b>${Math.abs(p.lat).toFixed(2)}°${p.lat < 0 ? "S" : "N"}</b> <b>${Math.abs(p.lon).toFixed(2)}°${p.lon < 0 ? "W" : "E"}</b>`;
  $("overlay").innerHTML = `<span>${where}</span>`;

  drafts.tick();
  if (inspectorKey(inspectedId()) !== ui.inspectedShown) renderInspector();
}

$("blend").addEventListener("click", (e) => {
  const row = e.target.closest(".brow");
  if (row) select(row.dataset.id);
});

// ------------------------------------------------------------------ loop

let last = performance.now();
// Local dev server only (web/serve.py sets BEACON_DEV_LOG): a handle for poking at the page from devtools.
if (window.BEACON_DEV_LOG) window.__beacon = { engine, input, ui, step, setMode };

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // A replaying walk drives the listener; otherwise walking does, and the trail and any recording follow.
  if (walk.replaying) walk.frame();
  else {
    if (flight.active && ui.mode === "globe") flyAlong();
    else step(dt);
    walk.frame();
  }
  for (const ev of engine.takeSounding()) ui.flashes.set(ev.id, now);
  // A flicked map keeps gliding a moment.
  if (ui.panVel && ui.pan) {
    ui.pan = { x: ui.pan.x + ui.panVel.x * dt, y: ui.pan.y + ui.panVel.y * dt };
    const k = Math.exp(-3 * dt);
    ui.panVel = Math.hypot(ui.panVel.x, ui.panVel.y) > 20 ? { x: ui.panVel.x * k, y: ui.panVel.y * k } : null;
  }
  travel.setBack(is3d() && globe3d ? globe3d.mode === "free" : !!ui.pan);
  draw(now);
  if (now - ui.lastPanel > 120) { ui.lastPanel = now; renderPanels(); }
  requestAnimationFrame(frame);
}

// Start somewhere between beacons so the blend shows right away.
// ------------------------------------------------------------------ following a flight

/** Each frame while following: put the listener where the plane is, and fetch a new fix now and then. */
function flyAlong() {
  const p = flight.position();
  if (p) { input.target = null; engine.setPosition(p); }
  flight.poll().then((got) => { if (got || flight.lost) renderFlight(); });
}

function renderFlight() {
  const on = flight.active;
  $("flightStop").hidden = !on;
  $("flightGo").hidden = on;
  $("flightQ").disabled = on;
  if (on) setMsg("fieldMsg", `✈ Following ${describeFlight(flight.fix)}${flight.lost ? ` · last update failed (${flight.lost}); gliding on` : ""}. Data: adsb.lol (ODbL).`);
}

async function startFlight() {
  const q = $("flightQ").value.trim();
  if (!q) return setMsg("fieldMsg", "Type a tail number (like N733YX) or a flight number (like DL934 or DAL934).", true);
  if (ui.mode !== "globe") setMode("globe");
  stopFollow();
  input.wander = false;
  $("flightGo").disabled = true;
  setMsg("fieldMsg", `Looking for ${q}…`);
  try {
    const f = await flight.start(q);
    engine.setPosition({ lat: f.lat, lon: f.lon });
    if (globe3d && is3d()) { globe3d.flyTo(f.lat, f.lon, Math.max(globe3d.zoom, 6)); globe3d.mode = "follow"; }
    renderFlight();
  } catch (err) {
    setMsg("fieldMsg", err.message, true);
  } finally { $("flightGo").disabled = false; }
}

function stopFlight(why) {
  if (!flight.active) return;
  const was = flight.fix;
  flight.stop();
  renderFlight();
  setMsg("fieldMsg", why || `Stopped following ${was.reg || was.flight || "the flight"}.`);
}
$("flightGo").addEventListener("click", startFlight);
$("flightQ").addEventListener("keydown", (e) => { if (e.key === "Enter") startFlight(); });
$("flightStop").addEventListener("click", () => stopFlight());

// A random flight in the air somewhere in the world (the database picks it; daytime hubs first).
const flightRandom = supabaseFlightRandom({ url: SUPABASE_URL, key: SUPABASE_KEY });
async function startRandomFlight() {
  if (ui.mode !== "globe") setMode("globe");
  stopFollow();
  input.wander = false;
  $("flightRandom").disabled = true;
  setMsg("fieldMsg", "Finding a flight in the air…");
  try {
    const got = await randomFlight(flightRandom);
    const f = flight.startWith(got, got.hex); // followed by its transponder code from here on
    $("flightQ").value = f.flight || f.reg || "";
    engine.setPosition({ lat: f.lat, lon: f.lon });
    if (globe3d && is3d()) { globe3d.flyTo(f.lat, f.lon, Math.max(globe3d.zoom, 6)); globe3d.mode = "follow"; }
    renderFlight();
    setMsg("fieldMsg", `✈ Following ${describeFlight(f)}. Tap the plane for its details. Data: adsb.lol (ODbL).`);
  } catch (err) {
    setMsg("fieldMsg", err.message, true);
  } finally { $("flightRandom").disabled = false; }
}
$("flightRandom").addEventListener("click", startRandomFlight);
const flightCard = initFlightCard({ el: $("flightcard"), flight, onStop: () => stopFlight() });

/** A tap on the plane (flat map) opens its card. */
function tappedPlane(x, y) {
  if (!flight.active || ui.mode !== "globe") return false;
  const s = view().toScreen(engine.pos);
  return !!s && Math.hypot(s[0] - x, s[1] - y) < 36 * (ui.dpr || 1);
}

/** Globe tab: the 3D globe or the flat map. The globe takes the pointer (drag turns it) while it shows. */
function apply3d() {
  const on = is3d();
  $("fieldwrap").classList.toggle("g3d", on);
  $("view2d").setAttribute("aria-pressed", String(!ui.view3d));
  $("view3d").setAttribute("aria-pressed", String(ui.view3d));
  if (!globe3d) return;
  if (on && !globe3d.attached) { pointer.detach(); globe3d.attach(); globe3d.attached = true; globe3d.lat0 = engine.pos.lat * 0.5; globe3d.lon0 = engine.pos.lon - 25; }
  else if (!on && globe3d.attached) { globe3d.detach(); globe3d.attached = false; pointer.attach(input); canvas.style.cursor = ""; }
  ui.zoneKey = "";
}
function setView3d(on) {
  ui.view3d = on;
  try { localStorage.setItem("beacon.globe3d", on ? "1" : "0"); } catch {}
  apply3d();
}
$("view2d").addEventListener("click", () => setView3d(false));
$("view3d").addEventListener("click", () => setView3d(true));

drafts = initDrafts({
  engine, input, ui, $, esc, setMsg, fmtDist, label, canvas, view, setZoom, select, inspectedId, stopFollow,
  moodColor: (m) => MOOD_COLOR[m] || "#888888",
  renderInspector: () => renderInspector(),
  inspectedSong: () => { const id = needBeacon(); return id ? engine.songFor(id) : null; },
});
globe3d = new Globe3D({
  canvas, engine, ui,
  drafts: () => drafts.state || null,
  moodColor: (m) => MOOD_COLOR[m] || "#888888",
  label,
  select,
  place: (lat, lon) => !!drafts.placing && drafts.placeAt({ lat, lon }),
  lines: () => walk.lines(),
  flight: () => (flight.active ? { track: flight.fix.track, label: flight.fix.reg || flight.fix.flight } : null),
  offer: ({ pos, label, song }, clientX, clientY) => offerPlace(pos, label ? { label } : null, { clientX, clientY }, song),
  flightCard: () => { if (!flight.active) return false; flightCard.open(); return true; },
  stopTravel: () => { if (!input.traveling) return false; input.stopTravel(); setMsg("fieldMsg", "Stopped here."); return true; },
});
walk = initWalks({
  engine, ui, $, esc, setMsg, setMode, centerLocal, select, stopFollow, togglePlay,
  store: () => drafts.store,
  moodColor: (m) => MOOD_COLOR[m] || "#888888",
});
engine.setPosition({ x: -38, y: 27 });
resize();
renderInspector();
renderPanels();
requestAnimationFrame(frame);
connectShared();

// For debugging and automated checks.
window.beaconField = { flight, engine, ui, input, setMode, select, centerLocal, setZoom, setView3d, get walk() { return walk; }, get drafts() { return drafts; }, get globe3d() { return globe3d; } };

// ------------------------------------------------------------------ synths page

/**
 * Opens an instrument on the Synths page with the sound it's playing now.
 * The panel re-renders several times a second, so the press is caught on
 * pointerdown (the row can be replaced before a click would arrive).
 */
function openSynth(role) {
  const st = engine.state();
  const params = {};
  for (const [k, v] of Object.entries(st.mix.roles[role]?.params || {})) params[k] = typeof v === "number" ? +v.toPrecision(4) : v;
  const lead = st.active[0];
  try {
    localStorage.setItem("beacon.synthHandoff", JSON.stringify({
      instrument: ROLE_INSTRUMENT[role], params, automation: st.mix.roles[role]?.automation || {}, at: Date.now(),
      from: lead ? `the blend nearest ${lead.beacon.label}` : "",
    }));
  } catch {}
  window.open(`synths.html#${ROLE_INSTRUMENT[role]}`, "_blank", "noopener");
}
$("tracks").addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".inst[data-role]");
  if (el && e.button === 0) { e.preventDefault(); openSynth(el.dataset.role); }
});
$("tracks").addEventListener("keydown", (e) => {
  const el = e.target.closest(".inst[data-role]");
  if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openSynth(el.dataset.role); }
});

// ------------------------------------------------------------------ song form readouts

/** "Chorus 2 · bar 5/8 · 1:42 / 3:36 · energy 82%" */
function sectionLine(song, t) {
  const p = songPosition(song, t);
  const e = p.shaped ? ` · energy ${Math.round(p.energy * 100)}%` : "";
  return `<b>${esc(sectionName(p))}</b> · bar ${p.barInSection + 1}/${p.bars} · ${clock(p.seconds)} / ${clock(p.totalSeconds)}${e}`;
}

/** The song's sections as a strip, widths by length, with a playhead. */
function formStrip(song, t, labels) {
  if (!song) return "";
  const p = songPosition(song, t);
  const form = hasForm(song) ? song.form : [{ section: "loop", bars: totalBars(song) }];
  const L = totalBars(song);
  const counts = {}, seen = {};
  for (const f of form) counts[f.section] = (counts[f.section] || 0) + 1;
  const cells = form.map((f, i) => {
    seen[f.section] = (seen[f.section] || 0) + 1;
    const name = (SECTION_LABEL[f.section] || f.section) + (counts[f.section] > 1 ? ` ${seen[f.section]}` : "");
    const short = { intro: "In", verse: "V", pre: "Pre", chorus: "C", bridge: "Br", break: "Bk", outro: "Out", loop: "Loop" }[f.section] || f.section;
    return `<i class="${i === p.index ? "cur" : ""}" style="flex:${f.bars};background:${SECTION_COLOR[f.section] || "#888"}" title="${esc(name)} · ${f.bars} bars">${labels ? `<span>${esc(short)}${counts[f.section] > 1 ? seen[f.section] : ""}</span>` : ""}</i>`;
  }).join("");
  return `<div class="fstrip${labels ? " big" : ""}" role="img" aria-label="Song form; now in ${esc(sectionName(p))}">${cells}<b class="head" style="left:${((p.seconds / p.totalSeconds) * 100).toFixed(2)}%"></b></div>`
    + (labels ? `<div class="fnow">${sectionLine(song, t)}${p.shaped ? ` · playing: ${playing(song, p)}` : ""}</div>` : "");
}

/** Changes whenever the inspector should redraw: another beacon, or an edit to its song. */
function inspectorKey(id) { return `${id}|${engine.overrides.has(id) || drafts.isUser(id) ? `${engine.songFor(id).title}|${engine.songRev || 0}` : ""}`; }

/** The parts sounding in a song's current section, e.g. "drums, keys, texture". */
function playing(song, p) {
  const on = ROLES.filter((r) => (song.tracks[r]?.level || 0) * (p.layers[r] ?? 1) > 0.01);
  return on.length ? on.map((r) => ROLE_LABEL[r].toLowerCase()).join(", ") : "nothing yet";
}
