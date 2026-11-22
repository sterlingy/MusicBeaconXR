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
