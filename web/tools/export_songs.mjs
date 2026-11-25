// Exports the browser's generated beacon songs, plus weight fixtures, for the
// Godot player:  node web/tools/export_songs.mjs
// Writes songs/grid.json, songs/globe.json and tests/fixtures/weights.json
// at the Godot project root, and for the app's own song generator
// (scripts/beacon/song_gen.gd, used on the local grid): the preset and
// control tables (songs/gen_tables.json) and fixtures it must match exactly
// (tests/fixtures/song_gen.json, tests/fixtures/local_grid.json).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGridField, makeGlobeField, makeLocalGridField, weigh } from "../src/beacons.js";
import { generateSong } from "../src/song.js";
import { PRESETS } from "../src/presets.js";
import { INSTRUMENTS, controls } from "../src/params.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
mkdirSync(resolve(root, "songs"), { recursive: true });
mkdirSync(resolve(root, "tests/fixtures"), { recursive: true });

for (const field of [makeGridField(5, 100), makeGlobeField(10)]) {
  const songs = {};
  for (const b of field.beacons) songs[b.id] = generateSong(`${field.kind}:${b.id}`);
  const path = resolve(root, `songs/${field.kind}.json`);
  writeFileSync(path, JSON.stringify({ field: field.kind, songs }));
  console.log(`${path}: ${Object.keys(songs).length} songs`);
}

// Weight fixtures, so the GDScript port can be checked against this one.
const grid = makeGridField(5, 100), globe = makeGlobeField(10);
const pts = [];
const r = (s) => { let x = Math.sin(s) * 10000; return x - Math.floor(x); };
for (let i = 0; i < 40; i++) {
  const p = { x: (r(i) - 0.5) * 480, y: (r(i + 100) - 0.5) * 480 };
  pts.push({ field: "grid", pos: p, w: weigh(grid, p).map((n) => [n.id, n.w]) });
  const q = { lat: (r(i + 200) - 0.5) * 178, lon: (r(i + 300) - 0.5) * 358 };
  pts.push({ field: "globe", pos: q, w: weigh(globe, q).map((n) => [n.id, n.w]) });
}
writeFileSync(resolve(root, "tests/fixtures/weights.json"), JSON.stringify(pts));
console.log(`weights fixture: ${pts.length} points`);

// The song generator's tables, so the app generates the same songs (local grid).
const tables = { controls: Object.fromEntries(INSTRUMENTS.map((n) => [n, controls(n)])), presets: PRESETS };
writeFileSync(resolve(root, "songs/gen_tables.json"), JSON.stringify(tables));
console.log("generator tables: songs/gen_tables.json");

// Songs the app's generator must reproduce exactly: local-grid ids (as the
// browser seeds them), plus grid and globe ones.
const locals = [];
for (const [lat, lon, km, sp] of [[51.5074, -0.1278, 10, 1], [37.7749, -122.4194, 5, 0.5], [-33.8688, 151.2093, 50, 1], [35.6762, 139.6503, 1, 0.1], [64.1466, -21.9426, 100, 5]]) {
  const f = makeLocalGridField({ lat, lon }, km, sp);
  for (let i = 0; i < 6; i++) locals.push(f.beacons[Math.floor((i * 7919) % f.beacons.length)].id);
}
const seeds = [...locals.map((id) => `local:${id}`), "grid:g00", "grid:g34", "globe:pS", "globe:l40_-10", "globe:l-20_50"];
writeFileSync(resolve(root, "tests/fixtures/song_gen.json"), JSON.stringify(seeds.map((seed) => ({ seed, song: generateSong(seed) }))));
console.log(`song generator fixture: ${seeds.length} songs`);

// Local grids the app's BeaconField must reproduce: shape, ids, positions, weights.
const lg = [];
for (const [lat, lon, km, sp] of [[51.5074, -0.1278, 50, 1], [37.7749, -122.4194, 5, 0.5], [-33.8688, 151.2093, 10, 0.25], [0.3, 179.9, 3, 1], [78.2, 15.6, 100, 2]]) {
  const f = makeLocalGridField({ lat, lon }, km, sp);
  const pick = [0, f.beacons.length - 1, Math.floor(f.beacons.length / 2), 17 % f.beacons.length];
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const q = f.fromXY({ x: (r(i + 400) - 0.5) * f.sideM, y: (r(i + 500) - 0.5) * f.sideM });
    pts.push({ pos: q, w: weigh(f, q).map((n) => [n.id, n.w]) });
  }
  lg.push({ center: { lat, lon }, km, sp, n: f.n, steps: f.steps, band: f.band, spacing: f.spacing, middle: f.center,
    beacons: pick.map((k) => ({ ...f.beacons[k], index: k })), pts });
}
writeFileSync(resolve(root, "tests/fixtures/local_grid.json"), JSON.stringify(lg));
console.log(`local grid fixture: ${lg.length} grids`);
