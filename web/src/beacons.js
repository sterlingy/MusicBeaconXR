// Beacon fields and listener weighting.
//
// A field is { kind, beacons: [{id, label, pos}], distance(a, b), spacing }.
// Positions are field-specific: {x, y} in meters for the flat grid,
// {lat, lon} in degrees for the globe. Everything above this module (songs,
// blending, UI) only uses ids, distances and weights, so swapping the grid
// for the globe changes nothing else.

export const EARTH_RADIUS_KM = 6371.0088;

/** Flat test field: n x n beacons, `spacing` meters apart, centered on 0,0. */
export function makeGridField(n = 5, spacing = 100) {
  const beacons = [];
  const half = (n - 1) / 2;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      beacons.push({
        id: `g${row}${col}`,
        label: `${String.fromCharCode(65 + row)}${col + 1}`,
        pos: { x: (col - half) * spacing, y: (row - half) * spacing },
        row, col,
      });
    }
  }
  return {
    kind: "grid",
    n,
    spacing,
    size: (n - 1) * spacing,
    beacons,
    distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    clamp: (p) => {
      const m = half * spacing + spacing * 0.5;
      return { x: Math.max(-m, Math.min(m, p.x)), y: Math.max(-m, Math.min(m, p.y)) };
    },
  };
}

/** Great-circle distance in km between {lat, lon} points (haversine). */
export function greatCircleKm(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Wraps longitude into [-180, 180) and clamps latitude to [-90, 90]. */
export function normalizeLatLon(p) {
  let lon = ((p.lon + 180) % 360 + 360) % 360 - 180;
  return { lat: Math.max(-90, Math.min(90, p.lat)), lon };
}

/**
 * Globe field: a beacon at every `step` degrees of latitude and longitude.
 * The poles collapse to one beacon each (every longitude meets there), so a
 * 10 degree grid has 17 * 36 + 2 = 614 beacons.
 */
export function makeGlobeField(step = 10) {
  const beacons = [];
  const rows = Math.round(180 / step);
  const cols = Math.round(360 / step);
  beacons.push({ id: "pS", label: "90°S", pos: { lat: -90, lon: 0 } });
  for (let i = 1; i < rows; i++) {
    const lat = -90 + i * step;
    for (let j = 0; j < cols; j++) {
      const lon = -180 + j * step;
      beacons.push({ id: `l${lat}_${lon}`, label: `${fmtLat(lat)} ${fmtLon(lon)}`, pos: { lat, lon } });
    }
  }
  beacons.push({ id: "pN", label: "90°N", pos: { lat: 90, lon: 0 } });
  // Rows of beacons by latitude index, poles included, for fast nearest search.
  const rowsByIndex = [];
  for (const b of beacons) {
    const r = Math.round((b.pos.lat + 90) / step);
    (rowsByIndex[r] ||= []).push(b);
  }
  return {
    // The 4 nearest beacons are always within 2 rows of latitude (every row
    // has a beacon within step/2 along the meridian), so only scan those.
    candidates: (p) => {
      const r = Math.round((p.lat + 90) / step);
      const out = [];
      for (let k = Math.max(0, r - 2); k <= Math.min(rows, r + 2); k++) out.push(...rowsByIndex[k]);
      return out;
    },
    kind: "globe",
    step,
    spacing: (step * Math.PI / 180) * EARTH_RADIUS_KM, // km between rows
    beacons,
    distance: greatCircleKm,
    clamp: normalizeLatLon,
  };
}

export const MILE_M = 1609.344;
export const KM_M = 1000;
/** Most spacings along one side of a local grid (so at most 151 x 151 beacons). */
export const MAX_LOCAL_STEPS = 150;
const M_PER_DEG = (EARTH_RADIUS_KM * 1000 * Math.PI) / 180;

/**
 * The shape a local grid takes for a requested side and spacing: spacing
 * rounded to the meter (at least 10 m), the side rounded to a whole number of
 * spacings (at least one, at most MAX_LOCAL_STEPS).
 */
export function localGridShape(sizeKm, spacingKm) {
  const unit = Math.max(10, Math.round((+spacingKm || 1) * KM_M)); // meters between beacons
  const want = Math.max(1, Math.round((sizeKm * KM_M) / unit));
  const steps = Math.min(MAX_LOCAL_STEPS, want);
  return { unit, spacingKm: unit / KM_M, steps, sizeKm: (steps * unit) / KM_M, capped: want > steps };
}

/**
 * Local grid: `sizeKm` x `sizeKm` around `center`, with a beacon every
 * `spacingKm` (any distance, rounded to the meter, at least 10 m). Defaults:
 * 50 km a side, a beacon every km, so 51 x 51 = 2,601 beacons. See
 * localGridShape for how the side is rounded and capped.
 *
 * All local grids sit on one worldwide 1 m lattice: rows are a meter of
 * latitude apart, and columns a meter of longitude apart as measured at the
 * whole degree of latitude nearest the center (the "band"). A grid uses every
 * spacing-th lattice point, so beacons keep the same ids across spacings
 * that line up (every 2 km beacon is also a 1 km beacon). The grid is the block of lattice squares best
 * centered on `center`, so the same place always has the same beacon ids (and
 * so the same songs, generated or shared), whatever the size or spacing, and
 * re-centering as someone travels keeps every beacon they're near. With an
 * even number of spacings the middle is a lattice point; with an odd number,
 * it's the middle of a lattice square.
 *
 * Positions are {lat, lon}; distances are meters on a flat map of the band,
 * where neighbouring beacons are exactly `spacingKm` apart. Over 40 km the
 * flat-map error is well under 1%.
 */
export function makeLocalGridField(center, sizeKm = 50, spacingKm = 1) {
  const shape = localGridShape(sizeKm, spacingKm);
  const { unit, steps } = shape; // unit: meters between beacons; steps: spacings per side
  const half = steps / 2;
  const n = steps + 1;
  const sp = unit;
  const band = Math.max(-85, Math.min(85, Math.round(center.lat)));
  const cosB = Math.cos((band * Math.PI) / 180);
  const mLat = 1 / M_PER_DEG, mLon = mLat / cosB; // one meter, in degrees
  const dLat = unit * mLat;
  const dLon = unit * mLon;
  // Lowest row and column of the block (in spacings), chosen so the block is centered on `center`.
  const iLo = Math.round(center.lat / dLat - half);
  const jLo = Math.round(center.lon / dLon - half);
  const iHi = iLo + steps;
  // Labels count kilometers from the lattice point nearest the grid's middle.
  const i0 = iLo + Math.floor(half), j0 = jLo + Math.floor(half);
  const c = { lat: (iLo + half) * unit * mLat, lon: (jLo + half) * unit * mLon };
  const km = (v) => +(Math.abs(v) / KM_M).toFixed(3);
  const beacons = [];
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) {
      const i = iHi - r, j = jLo + k; // rows run north to south, columns west to east
      const di = (i - i0) * unit, dj = (j - j0) * unit; // meters from the middle
      const I = i * unit, J = j * unit; // index on the 1 m lattice
      beacons.push({
        id: `g${band}_${I}_${J}`,
        label: di === 0 && dj === 0 ? "Center" : [di ? `${km(di)}${di > 0 ? "N" : "S"}` : "", dj ? `${km(dj)}${dj > 0 ? "E" : "W"}` : ""].filter(Boolean).join(" "),
        pos: { lat: I * mLat, lon: J * mLon },
        row: r, col: k,
      });
    }
  }
  const wrapLon = (lon) => c.lon + ((((lon - c.lon) % 360) + 540) % 360) - 180;
  /** Meters east (x) and north (y) of the grid's middle. */
  const toXY = (p) => ({ x: (wrapLon(p.lon) - c.lon) * cosB * M_PER_DEG, y: (p.lat - c.lat) * M_PER_DEG });
  const fromXY = (q) => normalizeLatLon({ lat: c.lat + q.y / M_PER_DEG, lon: c.lon + q.x / (cosB * M_PER_DEG) });
  const edge = (half + 0.5) * sp;
  return {
    kind: "local",
    n, steps, band, center: c,
    spacing: sp, spacingKm: shape.spacingKm,
    sideM: steps * sp, sizeKm: shape.sizeKm, capped: shape.capped,
    beacons,
    toXY, fromXY,
    distance: (a, b) => {
      const p = toXY(a), q = toXY(b);
      return Math.hypot(p.x - q.x, p.y - q.y);
    },
    /** Keeps the listener within half a spacing of the grid's edge. */
    clamp: (p) => {
      const q = toXY(p);
      return fromXY({ x: Math.max(-edge, Math.min(edge, q.x)), y: Math.max(-edge, Math.min(edge, q.y)) });
    },
    // The 4 nearest beacons on a square lattice are within 2 rows and columns.
    candidates: (p) => {
      const q = toXY(p);
      const r = Math.max(0, Math.min(n - 1, Math.round(half - q.y / sp)));
      const k = Math.max(0, Math.min(n - 1, Math.round(half + q.x / sp)));
      const out = [];
      for (let a = Math.max(0, r - 2); a <= Math.min(n - 1, r + 2); a++)
        for (let b = Math.max(0, k - 2); b <= Math.min(n - 1, k + 2); b++) out.push(beacons[a * n + b]);
      return out;
    },
  };
}

function fmtLat(v) { return `${Math.abs(v)}°${v < 0 ? "S" : v > 0 ? "N" : ""}`; }
function fmtLon(v) { return `${Math.abs(v)}°${v < 0 ? "W" : v > 0 ? "E" : ""}`; }

/**
 * The `count` nearest beacons plus the next one, sorted by distance.
 * Plain scan: 614 beacons is a few microseconds, no index needed.
 */
export function nearest(field, pos, count = 4) {
  const best = [];
  const list = field.candidates ? field.candidates(pos) : field.beacons;
  for (const b of list) {
    const d = field.distance(pos, b.pos);
    if (best.length === count && !closer(d, b, best[count - 1])) continue;
    // Insertion into a short sorted list (ties broken by id, so results are stable).
    let i = best.length;
    while (i > 0 && closer(d, b, best[i - 1])) i--;
    best.splice(i, 0, { beacon: b, d });
    if (best.length > count) best.pop();
  }
  return best;
}

function closer(d, b, other) {
  return d < other.d || (d === other.d && b.id < other.beacon.id);
}

/**
 * Weights for the `active` closest beacons (default 3), summing to 1.
 *
 * Each weight is measured against the distance of the first beacon that is
 * NOT active (the 4th closest): w = (1/d - 1/d4)^sharpness. So a beacon's
 * weight reaches exactly 0 at the moment it swaps places with the 4th, and the
 * music never jumps when the active set changes. Standing on a beacon
 * (d -> 0) always gives it 100%, wherever its neighbours are.
 */
export function weigh(field, pos, { active = 3, sharpness = 1.5 } = {}) {
  const near = nearest(field, pos, active + 1);
  const ref = near.length > active ? near[active].d : near[near.length - 1].d * 1.5 + 1e-9;
  const eps = (field.spacing || 1) * 1e-6;
  if (near[0].d <= eps) return [{ id: near[0].beacon.id, beacon: near[0].beacon, d: near[0].d, w: 1 }, ...near.slice(1, active).map((n) => ({ id: n.beacon.id, beacon: n.beacon, d: n.d, w: 0 }))];
  const top = near.slice(0, active).map((n) => ({ ...n, raw: Math.pow(Math.max(0, 1 / n.d - 1 / ref), sharpness) }));
  let sum = top.reduce((s, n) => s + n.raw, 0);
  if (sum <= 1e-12) {
    // Exactly equidistant from all four (e.g. the center of a grid cell): share equally.
    top.forEach((n) => (n.raw = 1));
    sum = top.length;
  }
  return top.map((n) => ({ id: n.beacon.id, beacon: n.beacon, d: n.d, w: n.raw / sum }));
}

/** Weights as a map id -> w over every beacon (0 for inactive ones). */
export function weightMap(field, pos, opts) {
  const m = new Map();
  for (const n of weigh(field, pos, opts)) m.set(n.id, n.w);
  return m;
}
