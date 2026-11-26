// Writes tests/fixtures/drafts.json: the website's answers for the beacon
// drafts rules (web/src/drafts.js), which the app's BeaconDrafts
// (scripts/beacon/beacon_drafts.gd) must reproduce. Checked by
// tests/drafts_check.gd.
//   node web/tools/export_drafts.mjs

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as D from "../src/drafts.js";
import { generateSong } from "../src/song.js";
import { rowsToDoc, tileKey, tilesAround, tilesForGrid } from "../src/shared.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Lattice snaps, band seams included.
const snaps = [];
for (const [lat, lon, step] of [[30.2672, -97.7431, 100], [30.4999, -97.0, 100], [30.5001, -97.0, 100], [47.61, -122.33, 5000],
  [40.7128, -74.006, 1000], [-33.87, 151.21, 200], [0.04, 179.999, 500], [25.76, -80.19, 2000], [48.99, -95.2, 100]]) {
  snaps.push({ lat, lon, step, id: D.snapPoint({ lat, lon }, step).id });
}
const lower48 = [[30.27, -97.74], [47.61, -122.33], [43.65, -79.38], [49.28, -123.12], [24.56, -81.78], [32.45, -117.0], [45.5, -73.57], [41.88, -87.63], [61.2, -149.9]]
  .map(([lat, lon]) => ({ lat, lon, inside: D.inLower48({ lat, lon }) }));

// A fixed document: two grids (one regenerated), two songs planted at one
// spot, and a custom map. Ids and times are fixed so both sides agree.
const AUSTIN = { lat: 30.2672, lon: -97.7431 };
const doc = D.normalizeDoc(D.emptyDoc());
doc.grids.push({ id: "grid-a", name: "Grid 1", number: 1, tint: D.TINTS[0], spacingM: 1000, center: D.gridCenterFor(AUSTIN, 1000), createdAt: 1000, on: true, variant: 0, variants: {}, edited: {} });
const b = D.gridPoints(doc.grids[0].center, 1000);
doc.grids.push({ id: "grid-b", name: "Grid 2", number: 2, tint: D.TINTS[1], spacingM: 200, center: D.gridCenterFor({ lat: 30.29, lon: -97.70 }, 200), createdAt: 2000, on: true, variant: 2, variants: { [D.gridPoints(D.gridCenterFor({ lat: 30.29, lon: -97.70 }, 200), 200)[5].id]: 1 }, edited: {} });
const spot = b[220].id; // the center of grid A: two planted songs there too
doc.plants.push({ id: "plant-1", point: spot, rangeM: 500, song: generateSong("fixture:one"), createdAt: 3000 });
doc.plants.push({ id: "plant-2", point: spot, rangeM: 1500, song: generateSong("fixture:two"), createdAt: 4000 });
doc.maps.push({ id: "map-1", name: "Lakeside walk", number: 3, tint: D.TINTS[2], createdAt: 5000, on: true, exclusive: false,
  beacons: [{ id: "mb-1", lat: 30.31, lon: -97.76, rangeM: 800, createdAt: 5000, variant: 0 }, { id: "mb-2", lat: 30.3123, lon: -97.7577, rangeM: 2500, createdAt: 5001, variant: 1 }] });
doc.prefs.favorites[spot] = "plant-1";
doc.nextNumber = 4;

// The shared map (step 2): rows as the server returns them, one grid that
// overlaps grid A, a shared song at the shared spot, one far away.
const sharedRows = {
  grids: [{ id: "srv-grid-1", center: D.gridCenterFor({ lat: 30.25, lon: -97.72 }, 500), spacing_m: 500, variant: 1, variants: {}, edited: { [D.gridPoints(D.gridCenterFor({ lat: 30.25, lon: -97.72 }, 500), 500)[100].id]: "song-b" }, created_at: "2026-11-20T10:00:00Z" }],
  plants: [
    { id: "srv-plant-1", point: spot, range_m: 900, song_id: "song-a", created_at: "2026-11-21T10:00:00Z" },
    { id: "srv-plant-2", point: D.snapPoint({ lat: 30.33, lon: -97.80 }).id, range_m: 2000, song_id: "song-missing", created_at: "2026-11-22T10:00:00Z" },
  ],
};
const sharedSongs = { "song-a": generateSong("fixture:shared-a"), "song-b": generateSong("fixture:shared-b") };
const sharedDoc = rowsToDoc([sharedRows]);

const DAY = 20500;
const c = D.parsePoint(doc.grids[0].center);
const pts = [];
for (let i = 0; i < 40; i++) {
  const a = (i * 137.5 * Math.PI) / 180, r = 400 + i * 420;
  pts.push({ lat: c.lat + (r * Math.sin(a)) / D.M_PER_DEG, lon: c.lon + (r * Math.cos(a)) / (D.M_PER_DEG * Math.cos((c.lat * Math.PI) / 180)) });
}
pts.push({ lat: c.lat, lon: c.lon }, { lat: 30.31, lon: -97.76 }, { lat: 30.3115, lon: -97.759 });

function answers(mode, exclusive = false, withShared = false) {
  const d = JSON.parse(JSON.stringify(doc));
  d.prefs.playMode = mode;
  d.maps[0].exclusive = exclusive;
  const shared = withShared ? { doc: sharedDoc, song: (id) => sharedSongs[id] || null, mine: new Set() } : null;
  const pool = D.buildPool(D.normalizeDoc(d), { day: DAY, shared });
  return {
    mode, exclusive, withShared,
    playing: pool.playing.map((e) => e.key).sort(),
    atSpot: pool.playing.find((e) => e.point === spot)?.key ?? null,
    layers: pts.map((p) => {
      const L = D.userLayer(pool, p);
      const sh = D.layerShares(L, pool.exclusive);
      return { u: L.u, active: L.active.map((x) => [x.entry.key, x.w]), status: D.statusLine(sh, pool.exclusive.map((x) => x.name)) };
    }),
  };
}

const offers = [[c.lat, c.lon + 0.12], [c.lat + 0.1, c.lon], [c.lat - 0.11, c.lon - 0.12], [c.lat, c.lon], [c.lat + 3, c.lon]].map(([lat, lon]) => {
  const o = D.moreGridOffer(doc, { lat, lon });
  return { lat, lon, offer: o ? { from: o.from.id, dir: o.dir, center: o.center } : null };
});

const out = {
  snaps, lower48, doc, spot, day: DAY, pts,
  gridPoints: doc.grids.map((g) => ({ id: g.id, points: D.gridPoints(g.center, g.spacingM).filter((_, i) => i % 37 === 0 || i === 440).map((p) => p.id) })),
  seeds: [[0, b[0].id], [1, D.gridPoints(doc.grids[1].center, 200)[5].id], [1, D.gridPoints(doc.grids[1].center, 200)[6].id]].map(([gi, pt]) => ({ grid: doc.grids[gi].id, point: pt, seed: D.seedFor(doc.grids[gi], pt) })),
  mapSeeds: doc.maps[0].beacons.map((x) => D.mapSeed(x)),
  modes: [...D.PLAY_MODES.map((m) => answers(m)), answers("latest", true), ...["owned", "latest", "random"].map((m) => answers(m, false, true))],
  sharedRows, sharedSongs,
  tiles: {
    keys: [[30.27, -97.74], [-0.5, 0.5], [10.5, 179.7], [-33.9, 151.2]].map(([lat, lon]) => ({ lat, lon, key: tileKey(lat, lon), around: tilesAround({ lat, lon }) })),
    grids: doc.grids.map((g) => ({ id: g.id, tiles: tilesForGrid(g) })),
  },
  offers,
  reach: [0, 100, 740, 750, 800, 900, 999, 1000, 1200].map((d) => [d, D.reach(d, 1000)]),
};
writeFileSync(resolve(root, "tests/fixtures/drafts.json"), JSON.stringify(out));
console.log(`drafts fixture: ${pts.length} points x ${out.modes.length} cases`);
