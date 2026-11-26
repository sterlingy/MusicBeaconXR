// Beacon drafts (beacon database, step 1): the user's own grids, custom maps
// and planted songs, kept on this device. No DOM, no audio, no server, so the
// app can share the format and the tests can check the rules.
// The design is docs/beacon-database-plan.md.
//
// - The lattice: one beacon point every 100 m worldwide ("option A"). A
//   point's row is its latitude in meters (a multiple of 100); its column is
//   its longitude in meters measured at the whole degree of latitude the point
//   itself is in (its "band"). So every 100 m point has one global id, with a
//   slight column seam at each whole degree of latitude. The id has the same
//   shape as the local grid's (`g<band>_<I>_<J>`), so a draft beacon starts
//   with the same song the local grid plays there.
// - A draft grid: 21 x 21 points, `spacingM` apart (100 m to 5 km, a multiple
//   of 100 m), so 2 km to 100 km a side. Generated beacons store only their
//   seed variant; edited and planted songs store the full song JSON.
// - Planted songs: one beacon on the lattice point where you stand, with a range.
// - Custom maps: named, beacons at exact spots (no lattice), edited from anywhere.
// - Playback: the user layer blends nearest-3 among the beacons whose range
//   reaches the listener, and crossfades with the globe layer, which always
//   reaches (see userLayer and layerShares).
//
// The stored document ("beacon-drafts" version 1) is the format the app reads
// and writes too (IndexedDB here, a user:// JSON file there).

import { EARTH_RADIUS_KM } from "./beacons.js";
import { generateSong, hash01, validateSong } from "./song.js";

export const M_PER_DEG = (EARTH_RADIUS_KM * 1000 * Math.PI) / 180;
export const LATTICE_M = 100;
/** Points along each side of a draft grid (20 spacings). */
export const GRID_POINTS = 21;
/** Spacings a grid can be generated with, in meters. */
export const SPACINGS_M = [100, 200, 500, 1000, 2000, 5000];
/** Planted songs and map beacons: default, smallest and largest range, in meters. */
export const PLANT_RANGE_M = 500;
export const MIN_RANGE_M = 100;
export const MAX_RANGE_M = 10000;
/** Most songs one 100 m point can hold. */
export const MAX_SONGS_PER_POINT = 20;
/** Location fixes less accurate than this can't create beacons. */
export const MAX_FIX_ACCURACY_M = 250;
/** A beacon plays at full strength out to this share of its range, then eases to 0 at the edge. */
export const FULL_REACH = 0.75;
export const PLAY_MODES = ["random", "favorite", "owned", "original", "latest"];
export const PLAY_MODE_LABEL = { random: "Random (changes daily)", favorite: "My favorite", owned: "Mine", original: "Original (first planted)", latest: "Latest" };
/** One tint per grid or map, in creation order. */
export const TINTS = ["#5ad1ff", "#c18cff", "#7ee081", "#ff9f6e", "#ffd166", "#ff7aa8", "#4fd1b5", "#a3b5ff"];
export const PLANT_TINT = "#ffb547";
export const FORMAT = "beacon-drafts";
export const VERSION = 1;

const clampBand = (v) => Math.max(-85, Math.min(85, v));
const cosBand = (band) => Math.cos((band * Math.PI) / 180);
const roundTo = (v, m) => Math.round(v / m) * m;
const wrap180 = (d) => ((((d % 360) + 540) % 360) - 180);

// ------------------------------------------------------------------ lattice

/** The lattice point (100 m) nearest p, or the nearest point on a coarser `stepM` lattice. */
export function snapPoint(p, stepM = LATTICE_M) {
  const I = roundTo(p.lat * M_PER_DEG, stepM);
  const band = clampBand(Math.round(I / M_PER_DEG));
  const J = roundTo(wrap180(p.lon) * cosBand(band) * M_PER_DEG, stepM);
  return pointAt(I, J, band);
}

function pointAt(I, J, band) {
  return { id: `g${band}_${I}_${J}`, I, J, band, lat: I / M_PER_DEG, lon: J / (cosBand(band) * M_PER_DEG) };
}

/** Parses a point id back into its lattice position. */
export function parsePoint(id) {
  const m = /^g(-?\d+)_(-?\d+)_(-?\d+)$/.exec(id);
  return m ? pointAt(+m[2], +m[3], +m[1]) : null;
}

/** Distance in meters between {lat, lon} points (haversine). */
export function meters(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = wrap180(b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * 1000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ------------------------------------------------------------------ where beacons may be made

// The lower 48 United States, as a coarse outline (lon, lat), within about
// 20 km of the real borders and coasts. Creating beacons is limited to it for
// now; the globe layer still plays everywhere.
export const LOWER_48 = [
  [-124.8, 48.4], [-123.0, 48.3], [-123.3, 49.0], [-95.15, 49.0], [-95.15, 49.38], [-94.8, 49.3], [-94.6, 48.7],
  [-93.0, 48.6], [-91.0, 48.2], [-89.5, 48.0], [-88.0, 48.3], [-84.6, 46.7], [-84.4, 46.5], [-83.5, 46.0],
  [-82.4, 43.0], [-83.1, 42.3], [-82.7, 41.7], [-79.0, 42.8], [-79.0, 43.3], [-76.3, 44.2], [-74.7, 45.0],
  [-71.5, 45.0], [-71.1, 45.3], [-70.3, 45.9], [-70.0, 46.7], [-69.2, 47.45], [-68.2, 47.35], [-67.8, 47.07],
  [-67.8, 45.7], [-67.4, 45.2], [-67.0, 44.8], [-69.0, 43.8], [-70.7, 43.0], [-70.8, 42.2], [-69.9, 42.0],
  [-69.9, 41.3], [-71.5, 41.2], [-71.9, 41.0], [-73.9, 40.5], [-74.0, 39.6], [-74.9, 38.9], [-75.1, 38.3],
  [-75.7, 37.0], [-75.5, 35.2], [-76.5, 34.6], [-78.0, 33.8], [-79.2, 33.1], [-80.8, 32.0], [-81.4, 30.7],
  [-80.6, 28.4], [-80.0, 26.7], [-80.1, 25.3], [-80.3, 24.9], [-81.2, 24.5], [-82.0, 24.45], [-81.9, 24.75], [-81.3, 25.8], [-82.8, 27.8],
  [-82.7, 29.0], [-83.7, 29.9], [-84.4, 29.9], [-85.4, 29.7], [-86.5, 30.4], [-88.0, 30.2], [-89.4, 30.1],
  [-89.2, 29.1], [-90.5, 29.0], [-92.0, 29.5], [-93.8, 29.7], [-94.8, 29.3], [-96.4, 28.3], [-97.2, 27.6],
  [-97.4, 26.0], [-97.2, 25.9], [-98.2, 26.1], [-99.1, 26.5], [-99.5, 27.5], [-100.3, 28.3], [-100.8, 29.3],
  [-101.4, 29.8], [-102.4, 29.8], [-103.0, 29.0], [-103.3, 29.0], [-104.5, 29.6], [-104.9, 30.6], [-106.5, 31.8],
  [-108.2, 31.8], [-108.2, 31.33], [-111.1, 31.33], [-114.8, 32.5], [-114.7, 32.72], [-117.1, 32.53], [-117.3, 33.2],
  [-118.4, 33.7], [-119.5, 34.4], [-120.6, 34.5], [-121.9, 36.3], [-122.5, 37.5], [-123.0, 38.0], [-123.8, 39.8],
  [-124.4, 40.4], [-124.2, 42.0], [-124.6, 42.8], [-123.9, 46.2], [-124.1, 47.0], [-124.7, 48.0],
];

/** True inside the lower 48 states (coarse outline). */
export function inLower48(p) {
  let inside = false;
  for (let i = 0, j = LOWER_48.length - 1; i < LOWER_48.length; j = i++) {
    const [xi, yi] = LOWER_48[i], [xj, yj] = LOWER_48[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Whether a location fix {lat, lon, accuracy} allows making beacons there:
 * inside the lower 48 and accurate enough. Returns null when it does, else why not.
 */
export function fixProblem(fix) {
  if (!fix) return "Making beacons needs your location (GPS): beacons can only be made where you are.";
  if (!inLower48(fix)) return "For now, beacons can only be made in the lower 48 United States. The globe still plays everywhere.";
  if (!(fix.accuracy <= MAX_FIX_ACCURACY_M)) return `Your location is only accurate to ${Math.round(fix.accuracy)} m; making beacons needs ${MAX_FIX_ACCURACY_M} m or better. Try outdoors, or with GPS on.`;
  return null;
}

/** Map beacons are placed from anywhere, but still only in the lower 48 for now. */
export function placeProblem(pos) {
  return inLower48(pos) ? null : "For now, map beacons can only go in the lower 48 United States.";
}

// ------------------------------------------------------------------ the document

export function emptyDoc() {
  return { format: FORMAT, version: VERSION, grids: [], maps: [], plants: [], prefs: { playMode: "latest", favorites: {}, plantsOn: true }, nextNumber: 1 };
}

/** Checks a stored or imported document; returns a list of problems (empty when fine). */
export function validateDoc(doc) {
  if (!doc || doc.format !== FORMAT) return ["not a beacon-drafts document"];
  const errs = [];
  if (doc.version !== VERSION) errs.push(`version ${doc.version} isn't supported (expected ${VERSION})`);
  for (const g of doc.grids || []) {
    if (!g.id || !SPACINGS_M.includes(g.spacingM) || !parsePoint(g.center || "")) errs.push(`grid ${g.name || g.id || "?"} is malformed`);
    for (const [pt, s] of Object.entries(g.edited || {})) if (validateSong(s).length) errs.push(`grid ${g.name || g.id}: the edited song at ${pt} is invalid`);
  }
  for (const p of doc.plants || []) {
    if (!parsePoint(p.point || "")) errs.push(`planted song ${p.id || "?"} has no lattice point`);
    const se = validateSong(p.song);
    if (se.length) errs.push(`planted song ${p.id || "?"}: ${se[0]}`);
  }
  for (const m of doc.maps || []) {
    if (!m.id || !Array.isArray(m.beacons)) { errs.push(`map ${m.name || m.id || "?"} is malformed`); continue; }
    for (const b of m.beacons) {
      if (!Number.isFinite(b.lat) || !Number.isFinite(b.lon)) errs.push(`map ${m.name || m.id}: a beacon has no position`);
      if (b.song && validateSong(b.song).length) errs.push(`map ${m.name || m.id}: a song is invalid`);
    }
  }
  return errs;
}

/** Fills in anything an older or hand-made document left out. */
export function normalizeDoc(doc) {
  const e = emptyDoc();
  const d = { ...e, ...doc, prefs: { ...e.prefs, ...(doc.prefs || {}) } };
  d.prefs.favorites = { ...(d.prefs.favorites || {}) };
  d.grids = (doc.grids || []).map((g) => ({ on: true, variant: 0, variants: {}, edited: {}, ...g }));
  d.maps = (doc.maps || []).map((m) => ({ on: true, exclusive: false, ...m, beacons: [...(m.beacons || [])] }));
  d.plants = [...(doc.plants || [])];
  if (!PLAY_MODES.includes(d.prefs.playMode)) d.prefs.playMode = "latest";
  return d;
}

let uid = 0;
const newId = (prefix, now) => `${prefix}${now.toString(36)}${(uid++ % 1296).toString(36).padStart(2, "0")}`;
const nextNumber = (doc) => { const n = doc.nextNumber || 1; doc.nextNumber = n + 1; return n; };

// ------------------------------------------------------------------ grids

/**
 * The 21 x 21 lattice points of a grid centered on `centerId`: rows
 * `spacingM` apart in latitude, columns `spacingM` apart at the center's
 * band, each snapped to its own band's lattice (so ids are global).
 */
export function gridPoints(centerId, spacingM) {
  const c = parsePoint(centerId);
  const half = (GRID_POINTS - 1) / 2;
  const out = [];
  for (let r = -half; r <= half; r++) {
    const I = c.I + r * spacingM;
    const band = clampBand(Math.round(I / M_PER_DEG));
    for (let k = -half; k <= half; k++) {
      const lon = (c.J + k * spacingM) / (cosBand(c.band) * M_PER_DEG);
      out.push(pointAt(I, roundTo(lon * cosBand(band) * M_PER_DEG, spacingM), band));
    }
  }
  return out;
}

/** The grid's center point for someone standing at `p`: the nearest point on the spacing's lattice. */
export function gridCenterFor(p, spacingM) {
  return snapPoint(p, spacingM).id;
}

const halfSide = (grid) => ((GRID_POINTS - 1) / 2 + 0.5) * grid.spacingM;
/** Meters north (dy) and east (dx) of the grid's center. */
function offset(grid, p) {
  const c = parsePoint(grid.center);
  return { dy: p.lat * M_PER_DEG - c.I, dx: wrap180(p.lon - c.lon) * cosBand(c.band) * M_PER_DEG };
}

/** Corners of a grid (NW, NE, SE, SW), half a spacing outside its outer beacons. */
export function gridOutline(grid) {
  const c = parsePoint(grid.center);
  const h = halfSide(grid);
  const at = (dy, dx) => ({ lat: (c.I + dy) / M_PER_DEG, lon: (c.J + dx) / (cosBand(c.band) * M_PER_DEG) });
  return [at(h, -h), at(h, h), at(-h, h), at(-h, -h)];
}

/** True when p is inside the grid's outline (half a spacing around its outer beacons). */
export function inGrid(grid, p) {
  const { dy, dx } = offset(grid, p), h = halfSide(grid);
  return Math.abs(dy) <= h && Math.abs(dx) <= h;
}

/** Which way p is outside `grid` (e.g. "NE"), or null while inside it. */
export function exitDirection(grid, p) {
  const { dy, dx } = offset(grid, p), h = halfSide(grid);
  const dir = (dy > h ? "N" : dy < -h ? "S" : "") + (dx > h ? "E" : dx < -h ? "W" : "");
  return dir || null;
}

/** A new grid centered on the lattice point nearest `fix` (or on `center`). Doesn't add it to the doc. */
export function makeGrid(doc, fix, spacingM, { now = Date.now(), center = null } = {}) {
  if (!SPACINGS_M.includes(spacingM)) throw new Error(`spacing must be one of ${SPACINGS_M.join(", ")} m`);
  const n = nextNumber(doc);
  return {
    id: newId("grid-", now), name: `Grid ${n}`, number: n, tint: TINTS[(n - 1) % TINTS.length],
    spacingM, center: center || gridCenterFor(fix, spacingM), createdAt: now,
    on: true, variant: 0, variants: {}, edited: {},
  };
}

/** Directions for "generate more": the grid next to this one, on the same lattice and spacing. */
export const DIRS = { N: [1, 0], S: [-1, 0], E: [0, 1], W: [0, -1], NE: [1, 1], NW: [1, -1], SE: [-1, 1], SW: [-1, -1] };

/** The center of the grid next to `grid` in direction `dir`: touching it, not overlapping (within one band). */
export function adjacentCenter(grid, dir) {
  const c = parsePoint(grid.center);
  const [dy, dx] = DIRS[dir];
  const step = GRID_POINTS * grid.spacingM;
  return snapPoint({ lat: (c.I + dy * step) / M_PER_DEG, lon: (c.J + dx * step) / (cosBand(c.band) * M_PER_DEG) }, grid.spacingM).id;
}

/**
 * "Generate more": for a listener at `fix` who has walked out of their own
 * grids, the grid to offer: next to the grid they left, toward them, on the
 * same lattice and spacing. Null while they're inside one of their grids that's on.
 */
export function moreGridOffer(doc, fix) {
  const on = doc.grids.filter((g) => g.on);
  if (!on.length || on.some((g) => inGrid(g, fix))) return null;
  // The grid they're nearest to (by how far outside it they are).
  let best = null, bestOut = Infinity;
  for (const g of on) {
    const { dy, dx } = offset(g, fix), h = halfSide(g);
    const out = Math.max(Math.abs(dy) - h, Math.abs(dx) - h);
    if (out < bestOut) { bestOut = out; best = g; }
  }
  // Only once they're within one grid's width of it.
  if (bestOut > 2 * halfSide(best)) return null;
  const dir = exitDirection(best, fix);
  const center = adjacentCenter(best, dir);
  if (doc.grids.some((g) => g.center === center && g.spacingM === best.spacingM)) return null;
  return { from: best, dir, center, spacingM: best.spacingM };
}

/** Seed for a generated beacon: the local grid's seed at first, a new one after each regenerate. */
export function seedFor(grid, pointId) {
  const v = grid.variant || 0, pv = grid.variants?.[pointId] || 0;
  return v === 0 && pv === 0 ? `local:${pointId}` : `local:${pointId}:${v}.${pv}`;
}

/** New songs for every generated beacon on the grid (edited songs stay). */
export function regenerateAll(grid) {
  grid.variant = (grid.variant || 0) + 1;
  grid.variants = {};
}

/** A new generated song for one of the grid's beacons (an edited one goes back to generated). */
export function regenerateOne(grid, pointId) {
  grid.variants = { ...(grid.variants || {}), [pointId]: (grid.variants?.[pointId] || 0) + 1 };
  if (grid.edited) delete grid.edited[pointId];
}

// ------------------------------------------------------------------ planted songs

export const clampRange = (m) => Math.max(MIN_RANGE_M, Math.min(MAX_RANGE_M, Math.round(+m || PLANT_RANGE_M)));

/** Plants a hand-made song at the lattice point nearest `fix`. Returns the planted beacon. */
export function plantSong(doc, fix, song, rangeM = PLANT_RANGE_M, now = Date.now()) {
  const errs = validateSong(song);
  if (errs.length) throw new Error("the song isn't valid: " + errs[0]);
  const pt = snapPoint(fix);
  const here = doc.plants.filter((x) => x.point === pt.id).length + 1; // +1: a generated beacon may be there too
  if (here >= MAX_SONGS_PER_POINT) throw new Error(`this spot already holds ${MAX_SONGS_PER_POINT} songs, the most one 100 m point can hold`);
  const plant = { id: newId("plant-", now), point: pt.id, rangeM: clampRange(rangeM), song: JSON.parse(JSON.stringify(song)), createdAt: now };
  doc.plants.push(plant);
  return plant;
}

// ------------------------------------------------------------------ custom maps

/** A new, empty custom map. Doesn't add it to the doc. */
export function makeMap(doc, name, now = Date.now()) {
  const n = nextNumber(doc);
  return { id: newId("map-", now), name: (name || "").trim() || `Map ${n}`, number: n, tint: TINTS[(n - 1) % TINTS.length], createdAt: now, on: true, exclusive: false, beacons: [] };
}

/**
 * Puts a beacon on a custom map at an exact spot (no lattice). It starts with
 * a generated song unless `song` gives it a hand-made one. The owner places
 * beacons from anywhere, so this needs no location fix.
 */
export function addMapBeacon(map, pos, { song = null, rangeM = PLANT_RANGE_M, now = Date.now() } = {}) {
  const b = { id: newId("mb-", now), lat: +pos.lat, lon: +pos.lon, rangeM: clampRange(rangeM), createdAt: now, variant: 0 };
  if (song) b.song = JSON.parse(JSON.stringify(song));
  map.beacons.push(b);
  return b;
}

/** A map beacon's generated song seed (`seed` is kept when a beacon was copied). */
export const mapSeed = (b) => (b.variant ? `${b.seed || `map:${b.id}`}:${b.variant}` : b.seed || `map:${b.id}`);

// ------------------------------------------------------------------ copies, import

/** A deep copy of a grid or map under a new id and name. */
export function duplicate(doc, item, now = Date.now()) {
  const copy = JSON.parse(JSON.stringify(item));
  const isMap = Array.isArray(item.beacons);
  const n = nextNumber(doc);
  copy.id = newId(isMap ? "map-" : "grid-", now);
  copy.number = n;
  copy.name = `${item.name} copy`;
  copy.tint = TINTS[(n - 1) % TINTS.length];
  copy.createdAt = now;
  if (isMap) for (const b of copy.beacons) { if (!b.song && !b.seed) b.seed = `map:${b.id}`; b.id = newId("mb-", now); }
  return copy;
}

/**
 * Adds another document's grids, maps and planted songs to `doc` (an import).
 * Everything gets new ids, so importing twice makes copies and never
 * overwrites. Returns how many of each came in.
 */
export function mergeDoc(doc, other, now = Date.now()) {
  const src = normalizeDoc(other);
  const count = { grids: 0, maps: 0, plants: 0 };
  for (const g of src.grids) { const c = duplicate(doc, g, now); c.name = g.name; c.createdAt = g.createdAt; doc.grids.push(c); count.grids++; }
  for (const m of src.maps) { const c = duplicate(doc, m, now); c.name = m.name; c.createdAt = m.createdAt; doc.maps.push(c); count.maps++; }
  for (const p of src.plants) { doc.plants.push({ ...p, id: newId("plant-", now) }); count.plants++; }
  return count;
}

// ------------------------------------------------------------------ the pool

/**
 * Every beacon that's on, as entries {key, source, point, pos, rangeM, kind,
 * createdAt, tint, seed, song()}. `kind` is "gen", "edited", "plant" or "map".
 * `key` is unique and stable: `<gridId>/<point>` for a grid's beacon, the
 * planted song's or map beacon's own id otherwise. `source` is
 * {id, name, kind: "grid" | "plants" | "map", exclusive}. Map beacons aren't
 * on the lattice, so their `point` is their own key.
 */
export function poolEntries(doc) {
  const out = [];
  for (const g of doc.grids) {
    if (!g.on) continue;
    const source = { id: g.id, name: g.name, kind: "grid" };
    const half = (GRID_POINTS - 1) / 2;
    gridPoints(g.center, g.spacingM).forEach((pt, i) => {
      const edited = g.edited?.[pt.id];
      const seed = edited ? null : seedFor(g, pt.id);
      out.push({
        key: `${g.id}/${pt.id}`, source, point: pt.id, pos: { lat: pt.lat, lon: pt.lon }, rangeM: g.spacingM,
        kind: edited ? "edited" : "gen", createdAt: g.createdAt, tint: g.tint, seed,
        // Spacings north and east of the grid's center, for labels.
        north: half - Math.floor(i / GRID_POINTS), east: (i % GRID_POINTS) - half, spacingM: g.spacingM,
        song: edited ? () => g.edited[pt.id] : cachedSong(seed),
      });
    });
  }
  if (doc.prefs?.plantsOn !== false) {
    const source = { id: "plants", name: "Planted songs", kind: "plants" };
    for (const p of doc.plants || []) {
      const pt = parsePoint(p.point);
      out.push({ key: p.id, source, point: p.point, pos: { lat: pt.lat, lon: pt.lon }, rangeM: p.rangeM, kind: "plant", createdAt: p.createdAt, tint: PLANT_TINT, seed: null, plant: p, song: () => p.song });
    }
  }
  for (const m of doc.maps || []) {
    if (!m.on) continue;
    const source = { id: m.id, name: m.name, kind: "map", exclusive: !!m.exclusive };
    for (const b of m.beacons) {
      const seed = b.song ? null : mapSeed(b);
      out.push({
        key: b.id, source, point: b.id, pos: { lat: b.lat, lon: b.lon }, rangeM: b.rangeM, kind: "map", createdAt: b.createdAt,
        tint: m.tint, seed, mapBeacon: b, song: b.song ? () => b.song : cachedSong(seed),
      });
    }
  }
  return out;
}

const songMemo = new Map();
function cachedSong(seed) {
  return () => {
    let s = songMemo.get(seed);
    if (!s) {
      s = generateSong(seed);
      songMemo.set(seed, s);
      if (songMemo.size > 4000) songMemo.delete(songMemo.keys().next().value);
    }
    return s;
  };
}

/** Days since 1970 (UTC): "random" rotates once a day, the same for everyone at a spot. */
export const dayNumber = (t = Date.now()) => Math.floor(t / 86400000);

function strHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h | 0;
}

/** The songs at one point, oldest first; generated beacons with the same seed count once. */
export function songsAtPoint(entries) {
  const seen = new Set(), out = [];
  for (const e of entries) {
    const k = e.seed ? `seed:${e.seed}` : e.key;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.key < b.key ? -1 : 1));
}

/**
 * Which of the songs at one point plays, by the listener's play mode:
 * random (rotates daily, the same for everyone there), favorite (the
 * listener's own; with none set, the latest), owned (the listener's own; on
 * this device that's all of them, so the latest), original (the first one),
 * latest (the newest).
 */
export function pickAtPoint(entries, mode, favorites = {}, day = dayNumber()) {
  const list = songsAtPoint(entries);
  if (list.length === 1) return list[0];
  if (mode === "original") return list[0];
  if (mode === "random") return list[Math.floor(hash01(strHash(list[0].point), day, list.length) * list.length)];
  if (mode === "favorite") {
    const fav = list.find((e) => e.key === favorites[list[0].point]);
    if (fav) return fav;
  }
  return list[list.length - 1];
}

/** All entries grouped by point. */
export function byPoint(entries) {
  const m = new Map();
  for (const e of entries) {
    let l = m.get(e.point);
    if (!l) m.set(e.point, (l = []));
    l.push(e);
  }
  return m;
}

// ------------------------------------------------------------------ the user layer

/** Strength of a beacon at distance d with range r: 1 out to FULL_REACH of the range, easing to 0 at the edge. */
export function reach(d, r) {
  const x = d / r;
  if (x <= FULL_REACH) return 1;
  if (x >= 1) return 0;
  const t = (1 - x) / (1 - FULL_REACH);
  return t * t * (3 - 2 * t);
}

/**
 * The playing pool: one beacon per point (picked by play mode), with a
 * spatial index for fast nearest search. Rebuild it when the drafts, the play
 * mode or the favorites change. With an exclusive map on, only exclusive
 * maps' beacons are in it.
 */
export function buildPool(doc, { day = dayNumber() } = {}) {
  let entries = poolEntries(doc);
  const exclusive = [...new Map(entries.filter((e) => e.source.exclusive).map((e) => [e.source.id, e.source])).values()];
  // An exclusive map with no beacons yet still silences everything else.
  for (const m of doc.maps || []) if (m.on && m.exclusive && !exclusive.some((s) => s.id === m.id)) exclusive.push({ id: m.id, name: m.name, kind: "map", exclusive: true });
  if (exclusive.length) entries = entries.filter((e) => e.source.exclusive);
  const groups = byPoint(entries);
  const playing = [];
  for (const list of groups.values()) playing.push(pickAtPoint(list, doc.prefs.playMode, doc.prefs.favorites, day));
  // Buckets of 10 km (the largest range): a beacon can reach the listener
  // only from the listener's bucket or a neighbouring one.
  const cell = MAX_RANGE_M / M_PER_DEG;
  const colW = (row) => cell / Math.max(0.05, Math.cos(((row + 0.5) * cell * Math.PI) / 180));
  const buckets = new Map();
  for (const e of playing) {
    const row = Math.floor(e.pos.lat / cell);
    for (const r of [row - 1, row, row + 1]) {
      // Filed under its neighbours' rows too: columns are narrower or wider there.
      const k = `${r},${Math.floor(wrap180(e.pos.lon) / colW(r))}`;
      let l = buckets.get(k);
      if (!l) buckets.set(k, (l = []));
      if (r === row || !l.includes(e)) l.push(e);
    }
  }
  return {
    entries, groups, playing, exclusive,
    near(p) {
      const row = Math.floor(p.lat / cell);
      const col = Math.floor(wrap180(p.lon) / colW(row));
      const seen = new Set();
      for (let b = col - 1; b <= col + 1; b++) for (const e of buckets.get(`${row},${b}`) || []) seen.add(e);
      return [...seen];
    },
  };
}

/**
 * The user layer at the listener's position.
 *
 * Beacons whose range reaches the listener compete by "closeness"
 * e = reach(d, range) / d. The 3 closest share the layer, each weighted
 * (e - e4)^sharpness against the 4th, so a beacon fades to exactly 0 both as
 * it swaps with the 4th and as the listener leaves its range: no jumps.
 * Standing on a beacon gives it 100%.
 *
 * `u` is the layer's share of the music: the strongest reach among those
 * beacons (1 well inside a grid, easing to 0 at the edge of the range).
 *
 * Returns {u, active: [{entry, d, w}]} with w summing to 1 (empty when u = 0).
 */
export function userLayer(pool, pos, { active = 3, sharpness = 1.5 } = {}) {
  const cand = [];
  let u = 0;
  for (const e of pool.near(pos)) {
    const d = meters(pos, e.pos);
    const f = reach(d, e.rangeM);
    if (f <= 0) continue;
    if (f > u) u = f;
    cand.push({ entry: e, d, e: d < 0.01 ? Infinity : f / d });
  }
  if (!cand.length) return { u: 0, active: [] };
  cand.sort((a, b) => b.e - a.e || (a.entry.key < b.entry.key ? -1 : 1));
  const top = cand.slice(0, active);
  if (top[0].e === Infinity) return { u, active: top.map((c, i) => ({ entry: c.entry, d: c.d, w: i === 0 ? 1 : 0 })) };
  const ref = cand.length > active ? cand[active].e : 0;
  let raw = top.map((c) => Math.pow(Math.max(0, c.e - ref), sharpness));
  let sum = raw.reduce((s, x) => s + x, 0);
  if (sum <= 1e-12) { raw = top.map(() => 1); sum = top.length; }
  return { u, active: top.map((c, i) => ({ entry: c.entry, d: c.d, w: raw[i] / sum })) };
}

/**
 * How the two layers share the music. The globe gets 1 - u and the user
 * beacons u; with an exclusive map on, the globe gets nothing, so off the
 * map's beacons there's silence.
 *
 * Returns {globeShare, userShare, exclusive, status: [{name, share}]}, the
 * status by source, largest first: maps by name, everything else as "User".
 */
export function layerShares(user, exclusive = []) {
  const ex = exclusive.length > 0;
  const globeShare = ex ? 0 : 1 - user.u;
  const bySource = new Map();
  for (const a of user.active) {
    const s = a.entry.source;
    const name = s.kind === "map" ? s.name : "User";
    bySource.set(name, (bySource.get(name) || 0) + a.w * user.u);
  }
  const status = [...bySource].map(([name, share]) => ({ name, share })).filter((x) => x.share >= 0.005);
  if (globeShare >= 0.005) status.push({ name: "Global", share: globeShare });
  status.sort((a, b) => b.share - a.share);
  return { globeShare, userShare: ex ? user.u : user.u, exclusive: ex, status };
}

/** The status line: "Global 100%", "User 70% · Global 30%", "Lakeside walk (exclusive) · outside". */
export function statusLine(shares, exclusiveNames = []) {
  if (shares.exclusive) {
    const inside = shares.status.filter((x) => x.share >= 0.005);
    return inside.length ? `${inside.map((x) => `${x.name} ${Math.round(x.share * 100)}%`).join(" · ")} (exclusive)` : `${exclusiveNames.join(", ")} (exclusive) · outside`;
  }
  return shares.status.map((x) => `${x.name} ${Math.round(x.share * 100)}%`).join(" · ") || "Global 100%";
}

/** Side length and counts for a grid, for the list. */
export function gridStats(grid) {
  return { beacons: GRID_POINTS * GRID_POINTS, edited: Object.keys(grid.edited || {}).length, sideKm: ((GRID_POINTS - 1) * grid.spacingM) / 1000 };
}
