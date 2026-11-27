// Writes tests/fixtures/remix.json: the website's Remix answers (web/src/remix.js)
// for a few songs and settings, which the app's Remix (scripts/beacon/remix.gd)
// must reproduce. Checked by tests/remix_check.gd.
//   node web/tools/export_remix.mjs

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as R from "../src/remix.js";
import { generateSong } from "../src/song.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const set = (o) => { const s = R.defaults(); s.on = true; Object.assign(s, o); return s; };
const withParts = (o, parts) => { const s = set(o); for (const [p, v] of Object.entries(parts)) Object.assign(s.parts[p], v); return s; };
const settings = [
  set({}),
  set({ energy: -1 }),
  set({ energy: 0.8 }),
  set({ brightness: 1, space: 1 }),
  set({ brightness: -0.7, space: -1, character: 1, width: 1 }),
  set({ mood: -1, key: 5, tempo: 0.6 }),
  set({ mood: 1, key: -6, tempo: -1, character: -1, width: -1 }),
  withParts({ energy: 0.3 }, { lead: { swap: 6 }, pluck: { swap: 3, level: 1.4 }, drums: { swap: 2, level: 0.5 }, bass: { swap: 4 }, keys: { swap: 4 }, pad: { swap: 2, level: 0.4 } }),
];
const songs = ["fix:1", "fix:2"].map((seed) => generateSong(seed));
const cases = [];
for (const song of songs) for (const s of settings) cases.push({ song, settings: s, out: R.remixSong(song, s) });
const moods = [];
for (const m of [...R.MOOD_LADDER, "harmonicMinor"]) for (const v of [-1, -0.5, 0, 0.5, 1]) moods.push({ mode: m, mood: v, out: R.moodMode(m, v) });
writeFileSync(resolve(root, "tests/fixtures/remix.json"), JSON.stringify({ cases, moods, bake: R.bake(songs[0], settings[3]) }));
console.log(`wrote tests/fixtures/remix.json: ${cases.length} cases`);
