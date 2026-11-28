// Writes tests/fixtures/kit_sounds.json: the website's SynthKit-sound answers
// (web/src/kitsounds.js kitParams, and the mixer's kitShares / chooseKit) that
// the app's KitSounds and BeaconMixer must reproduce. Checked by
// tests/kit_sound_check.gd.
//   node web/tools/export_kit.mjs

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { KIT_READS, kitParams, KIT_SOUNDS, KIT_TRIM } from "../src/kitsounds.js";
import { kitShares, chooseKit } from "../src/mixer.js";
import { generateSong } from "../src/song.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASES = {
  Prism: [{ "f1.cutoff": 2200, "f1.resonance": 2, "send.space": 3, "send.echo": 0, "fx1.amount": 3 }, { "f1.cutoff": 1500, "f1.resonance": 4, "send.space": 2, "send.echo": 3, "fx1.amount": 2 }],
  Undertow: [{ "filter.cutoff": 900, "filter.emphasis": 2.5 }, { "filter.cutoff": 330, "filter.emphasis": 8 }],
  Pulsar: [{ "chat.tone": 5, "ohat.tone": 5, "master.drive": 2 }, { "chat.tone": 8, "ohat.tone": 2, "master.drive": 9 }],
  Driftwood: [{ "model.brightness": 6, "reverb.mix": 2 }, { "model.brightness": 9, "reverb.mix": 5 }],
  Tangle: [{}],
};
const TUNES = [{}, { bright: 0.4, space: -0.4, grit: 0.4, width: -0.4 }, { bright: -1, space: 1, grit: -1, width: 1 }, { bright: 1, grit: 1 }, { bright: 0.13, space: 0.27, grit: -0.31, width: 0.05 }];
const params = [];
for (const [instrument, bases] of Object.entries(BASES)) {
  for (const base of bases) for (const tune of TUNES) params.push({ instrument, base, tune, out: kitParams(instrument, (id) => base[id] ?? 0, tune) });
}
// A blend of three songs: which sound each part asks for, and which it keeps.
const songs = ["kit:1", "kit:2", "kit:3"].map((s) => generateSong(s));
const active = songs.map((song, i) => ({ id: `s${i}`, w: [0.5, 0.3, 0.2][i], song }));
const shares = [];
for (const role of ["drums", "bass", "keys", "lead", "pluck", "texture"]) {
  const sources = active.map((a, i) => ({ id: a.id, share: [0.45, 0.35, 0.2][i] }));
  const kits = kitShares(active, role, sources);
  shares.push({ role, sources, kits, keep: KIT_SOUNDS[role].map(([n]) => [n, chooseKit(kits, n)?.preset ?? null]) });
}
writeFileSync(resolve(root, "tests/fixtures/kit_sounds.json"), JSON.stringify({ reads: KIT_READS, trims: KIT_TRIM, sounds: KIT_SOUNDS, params, songs, shares }));
console.log(`wrote tests/fixtures/kit_sounds.json: ${params.length} tune cases, ${shares.length} blends`);
