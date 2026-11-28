// Sampled instruments: which parts of a song ask for one, and how the blend picks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { generateSong, SAMPLE_CHOICES, SAMPLE_IDS, validateSong } from "../src/song.js";
import { blend } from "../src/mixer.js";

test("sample choices are deterministic and only from the list", () => {
  let parts = 0;
  for (let i = 0; i < 200; i++) {
    const a = generateSong(`globe:s${i}`), b = generateSong(`globe:s${i}`);
    assert.deepEqual(a, b);
    assert.deepEqual(validateSong(a), []);
    for (const [role, t] of Object.entries(a.tracks)) if (t.sample) { parts++; assert.ok(SAMPLE_CHOICES[role].includes(t.sample), `${role}: ${t.sample}`); }
    if (a.pad?.sample) assert.ok(SAMPLE_CHOICES.pad.includes(a.pad.sample));
  }
  assert.ok(parts > 150 && parts < 700, `sampled parts in 200 songs: ${parts}`);
});

test("samples don't change the song's notes or synth sounds", () => {
  for (let i = 0; i < 20; i++) {
    const s = generateSong(`grid:${i}`);
    for (const t of Object.values(s.tracks)) {
      assert.ok(t.pattern && t.params);
      if (t.sample) assert.equal(typeof t.sample, "string");
    }
  }
});

test("the loudest song in a part picks its sound", () => {
  const a = generateSong("x:1"), b = generateSong("x:2");
  a.tracks.keys.sample = "piano";
  delete b.tracks.keys.sample;
  assert.equal(blend([{ id: "a", w: 0.7, song: a }, { id: "b", w: 0.3, song: b }]).roles.keys.sample, "piano");
  assert.equal(blend([{ id: "a", w: 0.2, song: a }, { id: "b", w: 0.8, song: b }]).roles.keys.sample, null);
});

test("every sample id is in the web pack when it's built", { skip: !existsSync(new URL("../samples/web/index.json", import.meta.url)) }, () => {
  const idx = JSON.parse(readFileSync(new URL("../samples/web/index.json", import.meta.url), "utf-8"));
  const have = new Set(idx.programs.map((p) => p.id));
  for (const id of SAMPLE_IDS) assert.ok(have.has(id), `missing ${id}`);
});
