// Writes tests/fixtures/walk.json: a walk recorded by the website and its
// replay frames, which the app's BeaconWalks.frame_at must reproduce
// (tests/walk_check.gd).
//   node web/tools/export_walk.mjs

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGridField, makeGlobeField, weigh } from "../src/beacons.js";
import { generateSong } from "../src/song.js";
import { WalkRecorder, frameAt } from "../src/walk.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = [];
for (const [field, path] of [
  [makeGridField(5, 100), (t) => ({ x: -180 + t * 11, y: Math.sin(t / 4) * 140 })],
  [makeGlobeField(10), (t) => ({ lat: 20 + t * 0.9, lon: 175 + t * 0.4 })],
]) {
  const r = new WalkRecorder({ field, wallStart: 1_800_000_000 });
  for (let t = 0; t <= 30; t += 0.1) {
    const p = path(t);
    r.sample(t, p, weigh(field, p).map((n) => ({ ...n, song: generateSong(`${field.kind}:${n.id}`) })));
  }
  const rec = r.finish(30);
  // Songs are bulky and not needed for the maths: keep titles only.
  for (const k of Object.keys(rec.songs)) rec.songs[k] = { title: rec.songs[k].title };
  const frames = [];
  for (let t = -1; t <= 31; t += 0.37) frames.push({ t, ...frameAt(rec, t) });
  out.push({ rec, frames });
}
writeFileSync(resolve(root, "tests/fixtures/walk.json"), JSON.stringify(out));
console.log(`walk fixture: ${out.length} walks`);
