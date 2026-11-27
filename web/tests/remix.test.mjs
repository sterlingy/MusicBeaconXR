// Remix (src/remix.js): the listener's own settings over whatever plays.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/remix.js";
import { generateSong, validateSong } from "../src/song.js";

const on = (o = {}) => Object.assign(R.defaults(), { on: true }, o);

test("at rest it changes nothing", () => {
  const song = generateSong("rx:a");
  assert.deepEqual(R.remixSong(song, on()), song);
  assert.ok(R.isNeutral(on()) && !R.isNeutral(on({ space: 0.1 })));
});

test("key, mode and tempo", () => {
  const song = generateSong("rx:b");
  const out = R.remixSong(song, on({ key: 3, tempo: 0.2 }));
  assert.equal(out.key.root, (song.key.root + 3) % 12);
  assert.ok(Math.abs(out.bpm - song.bpm * 1.03) < 0.11);
  assert.equal(R.moodMode("major", 0.5), "lydian");
  assert.equal(R.moodMode("major", -1), "dorian");
  assert.equal(R.moodMode("harmonicMinor", 1), "mixolydian");
  assert.equal(R.moodMode("phrygian", -1), "phrygian");
});

test("energy thins or fills, keeping the main hits", () => {
  const song = generateSong("rx:c");
  const count = (s) => Object.values(s.tracks.drums.pattern).flat().filter((v) => v > 0).length;
  const calm = R.remixSong(song, on({ energy: -1 })), busy = R.remixSong(song, on({ energy: 1 }));
  assert.ok(count(calm) <= count(song) && count(busy) >= count(song));
  song.tracks.drums.pattern.kick.forEach((v, i) => { if (v && i % 4 === 0) assert.ok(calm.tracks.drums.pattern.kick[i] > 0, "kicks on the beat stay"); });
});

test("sound dials stay in safe ranges", () => {
  const song = generateSong("rx:d");
  const hot = R.remixSong(song, on({ brightness: 1, space: 1, character: 1, width: 1 }));
  assert.ok(hot.tracks.lead.params["filter.cutoff"] <= 12000 && hot.tracks.lead.params["reverb.send"] <= 0.7);
  assert.ok(hot.tracks.lead.params["filter.cutoff"] >= song.tracks.lead.params["filter.cutoff"]);
  assert.deepEqual(validateSong(hot), []);
});

test("parts: level and swap sound", () => {
  const song = generateSong("rx:e");
  const s = on(); s.parts.lead.swap = R.SWAPS.lead.indexOf("sample:flute"); s.parts.bass.level = 0; s.parts.pluck.swap = R.SWAPS.pluck.indexOf("model:bell"); s.parts.pad.swap = 1;
  const out = R.remixSong(song, s);
  assert.equal(out.tracks.lead.sample, "flute");
  assert.equal(out.tracks.bass.level, 0);
  assert.equal(out.tracks.pluck.params.model, "bell");
  assert.ok(!out.tracks.pluck.sample && !out.pad);
});

test("bake names it a remix; dice and normalize stay in range", () => {
  const song = generateSong("rx:f");
  const b = R.bake(song, on({ key: 2 }));
  assert.ok(b.title.endsWith("(remix)") && b.remixOf === song.title);
  assert.deepEqual(validateSong(b), []);
  let i = 0;
  const d = R.dice(on(), () => (i++ % 10) / 10);
  for (const [id, , lo, hi] of R.DIALS) assert.ok(d[id] >= lo && d[id] <= hi, id);
  const n = R.normalize({ on: 1, key: 99, energy: "x", parts: { lead: { swap: 999, level: -3 } } });
  assert.equal(n.key, 6); assert.equal(n.energy, 0); assert.equal(n.parts.lead.swap, R.SWAPS.lead.length - 1); assert.equal(n.parts.lead.level, 0);
});
