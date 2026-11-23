// Writes the song packs the Godot player loads (songs/grid.json, songs/globe.json)
// from the same generator the browser uses, so both play the same songs.
//
//   node web/tools/export-songs.mjs
//
// Each pack is {field, songs: {<beacon id>: song}}. The Godot player plays
// each song's verse patterns as a loop and maps the sound settings it knows
// (see scripts/beacon/param_map.gd); sections and automation are browser-only.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeGridField, makeGlobeField } from "../src/beacons.js";
import { generateSong, validateSong } from "../src/song.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "songs");

for (const field of [makeGridField(5, 100), makeGlobeField(10)]) {
  const songs = {};
  for (const b of field.beacons) {
    const s = generateSong(`${field.kind}:${b.id}`); // the seed the browser uses (engine.songFor)
    const errs = validateSong(s);
    if (errs.length) throw new Error(`${field.kind} ${b.id}: ${errs.join("; ")}`);
    songs[b.id] = s;
  }
  const file = join(out, `${field.kind}.json`);
  writeFileSync(file, JSON.stringify({ field: field.kind, songs }));
  console.log(`${file}: ${Object.keys(songs).length} songs`);
}
