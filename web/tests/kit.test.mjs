// The browser's SynthKit mode: the song -> SynthKit translation must match the
// Godot app's exactly, and every part of every grid song, played through
// SynthKit's web engine the way the browser plays it, must stay mellow (the
// same limits as tools/tone_check.gd in the app).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toSynth } from "../src/kit/parammap.js";
import { changedParams, padLevel, padGain, isPhone, PAD_MIX, KIT_GAIN_DB, INSTRUMENT, BASE_PRESET, PARTS, DRUM_NOTE } from "../src/kit/kitplayer.js";
import { blend, Harmony, stepEvents, chooseKit, kitShares } from "../src/mixer.js";
import { chordNotes, generateSong, validateSong } from "../src/song.js";
import { KIT_SOUNDS, KIT_INSTRUMENT, kitParams, checkKit, TUNE_MAX } from "../src/kitsounds.js";

const root = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf-8");
const KIT = new URL("addons/synthkit/", root);
const hasKit = existsSync(fileURLToPath(new URL("web/synthkit.wasm", KIT)));

test("song params translate to SynthKit exactly as in the Godot app", () => {
  const { cases } = JSON.parse(read("tests/fixtures/param_map.json"));
  assert.ok(cases.length > 500);
  let checked = 0;
  for (const c of cases) {
    const got = toSynth(c.role, c.params);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(c.synth).sort(), `${c.song} ${c.role}: same params`);
    for (const [id, v] of Object.entries(c.synth)) {
      assert.ok(Math.abs(got[id] - v) <= 1e-4 * Math.max(1, Math.abs(v)), `${c.song} ${c.role} ${id}: ${got[id]} vs app ${v}`);
      checked++;
    }
  }
  assert.ok(checked > 2000);
});

test("pad level follows the app: calm songs lean on the pad", () => {
  // BeaconPlayer.pad_level: clamp(0.75 - energy * 0.6, 0.12, 0.7) * mood * PAD_MIX.
  assert.equal(padLevel({ energy: 0.2, mood: "Drift" }).toFixed(4), (0.63 * PAD_MIX).toFixed(4));
  assert.equal(padLevel({ energy: 0.9, mood: "Pulse" }).toFixed(4), (0.126 * PAD_MIX).toFixed(4));
  assert.equal(padGain([{ w: 0.5, song: { energy: 0.5, mood: "Glow" } }, { w: 0.5, song: { energy: 0.5, mood: "Glow" } }]).toFixed(4), (0.45 * PAD_MIX).toFixed(4));
});

test("only moved params are re-sent", () => {
  const done = {};
  assert.deepEqual(changedParams(done, { a: 1, b: 1000 }), { a: 1, b: 1000 });
  assert.deepEqual(changedParams(done, { a: 1.001, b: 1001 }), {});
  assert.deepEqual(changedParams(done, { a: 1.01, b: 1000 }), { a: 1.01 });
});

test("phones get the light Prism tier", () => {
  assert.equal(isPhone({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) Mobile" }), true);
  assert.equal(isPhone({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }), false);
});

// ---------------------------------------------------------------- tone check

const SR = 48000;
const LIMIT = { drums: -8, bass: -30, keys: -22, lead: -22, pluck: -15, texture: -22, pad: -25 };

/** Energy above 2.5 kHz relative to all energy, in dB (as tools/tone_check.gd). */
function hfDb(l, r) {
  const a = Math.exp((-2 * Math.PI * 2500) / SR);
  const lp = [0, 0, 0, 0];
  let all = 0, hi = 0;
  for (let i = 0; i < l.length; i++) {
    let x = (l[i] + r[i]) * 0.5;
    all += x * x;
    for (let k = 0; k < 4; k++) { lp[k] = x + a * (lp[k] - x); x -= lp[k]; }
    hi += x * x;
  }
  return (10 * Math.log10(Math.max(hi, 1e-15) / Math.max(all, 1e-12)));
}

test("every grid song (and every family) stays mellow on SynthKit's web engine", { skip: !hasKit && "addons/synthkit not checked out" }, async () => {
  const { SynthKitCore } = await import(new URL("web/synthkit-worklet.js", KIT).href);
  const module = await WebAssembly.compile(readFileSync(fileURLToPath(new URL("web/synthkit.wasm", KIT))));
  const index = JSON.parse(readFileSync(fileURLToPath(new URL("presets/factory/index.json", KIT)), "utf-8"));
  const preset = (role) => {
    const e = index[INSTRUMENT[role]].find((p) => p.name === BASE_PRESET[role]);
    return JSON.parse(readFileSync(fileURLToPath(new URL(`presets/factory/${e.file}`, KIT)), "utf-8"));
  };
  const presets = Object.fromEntries(PARTS.map((r) => [r, preset(r)]));
  const named = (instrument, name) => {
    const e = index[instrument].find((p) => p.name === name);
    return JSON.parse(readFileSync(fileURLToPath(new URL(`presets/factory/${e.file}`, KIT)), "utf-8"));
  };
  const worst = {};
  const over = [];
  // Every test-grid song, plus five of each generator family (v2), so every kind of song is checked.
  const cases = [];
  for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++) cases.push([`g${gx}${gy}`, () => generateSong(`grid:g${gx}${gy}`)]);
  for (const family of ["song", "journey", "ambient", "groove"]) for (let i = 0; i < 5; i++) cases.push([`${family}${i}`, () => generateSong(`family:${family}:${i}`, { family })]);
  for (const [id, make] of cases) {
    const song = make();
    const active = [{ id, w: 1, song }];
    const mix = blend(active);
    const harmony = new Harmony();
    harmony.update(active, 0);
    const stepFrames = Math.round((SR * 60) / song.bpm / 4);
    for (const role of PARTS) {
      if (role !== "pad" && mix.roles[role].gain <= 0.001) continue;
      const s = new SynthKitCore(module, SR, { log: () => {}, isolated: true });
      s.setInstrument(INSTRUMENT[role]);
      // The SynthKit sound the part plays: the song's kit (as kitplayer.js), else the base preset and parammap.
      const kit = role === "pad" ? (song.pad?.kit ? { ...song.pad.kit, share: 1 } : null) : chooseKit(mix.roles[role].kits, "");
      s.applyPreset(kit?.preset ? named(INSTRUMENT[role], kit.preset) : presets[role]);
      if (INSTRUMENT[role] === "Prism") s.setParam("voice.quality", 0);
      const target = kit?.preset ? kitParams(INSTRUMENT[role], (k) => s.getParam(k), kit.tune || {}, role === "pad" ? 1 : mix.roles[role].bright) : toSynth(role, role === "pad" ? {} : mix.roles[role].params);
      for (const [k, v] of Object.entries(target)) s.setParam(k, v);
      for (const k of ["send.space", "send.echo", "reverb.mix"]) s.setParam(k, 0); // the dry part
      const ons = []; // [frame, note, vel, offFrame]
      for (let bar = 0; bar < 2; bar++) {
        if (role === "pad") {
          const f = bar * 16 * stepFrames;
          for (const n of chordNotes(song.key, harmony.chordDegree(bar), 3, 4)) ons.push([f, n, 0.7, f + 16 * stepFrames - 1]);
          continue;
        }
        for (let step = 0; step < 16; step++) {
          const f = (bar * 16 + step) * stepFrames;
          for (const ev of stepEvents(active, mix, harmony, bar, step)) {
            if (ev.role !== role) continue;
            if (role === "drums") ons.push([f, DRUM_NOTE[ev.voice], ev.vel, f + Math.round(0.1 * SR)]);
            else for (const n of ev.notes) ons.push([f, n, ev.vel, f + Math.round(ev.gate * stepFrames * 0.95)]);
          }
        }
      }
      const total = 32 * stepFrames;
      const L = new Float32Array(total), R = new Float32Array(total);
      const BLOCK = 512;
      for (let f = 0; f < total; f += BLOCK) {
        const n = Math.min(BLOCK, total - f);
        for (const [on, note, vel, off] of ons) {
          if (off >= f && off < f + n) s.noteOff(note, off - f);
          if (on >= f && on < f + n) s.noteOn(note, vel, on - f);
        }
        const [l, r] = s.render(n);
        L.set(l, f);
        R.set(r, f);
      }
      s.destroy();
      if (!ons.length) continue;
      const db = hfDb(L, R);
      if (!(role in worst) || db > worst[role][0]) worst[role] = [db, id];
      if (db > LIMIT[role]) over.push(`${id} ${role} ${db.toFixed(1)} dB (limit ${LIMIT[role]})`);
    }
  }
  console.log("  worst above 2.5 kHz: " + Object.entries(worst).map(([r, [db, id]]) => `${r} ${db.toFixed(1)} (${id})`).join(", "));
  assert.deepEqual(over, [], "shrill parts");
});

test("songs choose SynthKit sounds from their part's list, with small tunes", () => {
  const seen = {};
  for (let i = 0; i < 300; i++) {
    const song = generateSong(`kits:${i}`);
    assert.deepEqual(validateSong(song), []);
    for (const role of [...Object.keys(song.tracks), "pad"]) {
      const kit = role === "pad" ? song.pad?.kit : song.tracks[role].kit;
      assert.equal(checkKit(role, kit), null, `${role}: ${JSON.stringify(kit)}`);
      for (const v of Object.values(kit.tune)) assert.ok(Math.abs(v) <= TUNE_MAX + 1e-9);
      (seen[role] ||= new Set()).add(kit.preset);
    }
  }
  // Every listed sound is used by some song.
  for (const [role, list] of Object.entries(KIT_SOUNDS)) for (const [name] of list) assert.ok(seen[role].has(name), `${role} ${name} never chosen`);
  assert.ok(checkKit("bass", { preset: "Growler" }), "unlisted presets are refused");
  assert.ok(checkKit("keys", { preset: "Glass EP", tune: { bright: 2 } }), "tunes stay -1..1");
});

test("kits don't change a song's notes", () => {
  // The kits come from their own random stream: the song without them is the generator's v2 song.
  const a = generateSong("grid:g00"), b = JSON.parse(readFileSync(fileURLToPath(new URL("tests/fixtures/song_gen.json", root)), "utf-8"))[0];
  assert.ok(a.tracks.bass.kit);
  assert.deepEqual(a.tracks.bass.pattern, generateSong("grid:g00").tracks.bass.pattern);
  assert.ok(b.song.tracks.bass.kit, "the app's fixture songs carry kits too");
});

test("a part keeps its sound until another is clearly louder", () => {
  const kits = [{ preset: "A", share: 0.55 }, { preset: "B", share: 0.45 }];
  assert.equal(chooseKit(kits, "B").preset, "B");
  assert.equal(chooseKit(kits, "").preset, "A");
  assert.equal(chooseKit([{ preset: "A", share: 0.7 }, { preset: "B", share: 0.3 }], "B").preset, "A");
  assert.equal(chooseKit([], "A"), null);
  const x = generateSong("x:1"), y = generateSong("x:2");
  delete y.tracks.bass.kit;
  const k = kitShares([{ song: x }, { song: y }], "bass", [{ share: 0.4 }, { share: 0.6 }]);
  assert.deepEqual(k.map((e) => [e.preset, e.share]), [["", 0.6], [x.tracks.bass.kit.preset, 0.4]]);
});

test("the tune can darken a part more than brighten it", () => {
  const base = (id) => ({ "f1.cutoff": 2000, "filter.cutoff": 800 })[id] ?? 2;
  assert.equal(kitParams("Prism", base, { bright: 1 })["f1.cutoff"], Math.round(2000 * Math.SQRT2 * 1e4) / 1e4);
  assert.equal(kitParams("Prism", (id) => (id === "f1.cutoff" ? 3600 : 2), { bright: 1 })["f1.cutoff"], 3600, "bright presets don't get brighter");
  assert.equal(kitParams("Prism", base, { bright: -1 })["f1.cutoff"], 1000);
  assert.equal(kitParams("Undertow", base, {}, 2)["filter.cutoff"], 1600);
  assert.deepEqual(kitParams("Tangle", base, { bright: 1 }), {});
  assert.equal(KIT_INSTRUMENT.pad, INSTRUMENT.pad);
});

test("the app and the website mix SynthKit the same way", () => {
  const gd = read("scripts/beacon/beacon_player.gd");
  assert.equal(Number(gd.match(/const KIT_GAIN_DB := ([\d.]+)/)[1]), KIT_GAIN_DB);
  assert.equal(Number(gd.match(/const PAD_MIX := ([\d.]+)/)[1]), PAD_MIX);
});
