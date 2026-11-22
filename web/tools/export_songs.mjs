// Exports the browser's generated beacon songs, plus weight fixtures, for the
// Godot player:  node web/tools/export_songs.mjs
// Writes songs/grid.json, songs/globe.json and tests/fixtures/weights.json
// at the Godot project root.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGridField, makeGlobeField, weigh } from "../src/beacons.js";
import { generateSong } from "../src/song.js";

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
