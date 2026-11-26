// Node tests for the pure logic (no audio, no DOM): node --test web/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGridField, makeGlobeField, makeLocalGridField, localGridShape, MAX_LOCAL_STEPS, KM_M, weigh, greatCircleKm, nearest, normalizeLatLon } from "../src/beacons.js";
import { generateSong, validateSong, degreeToMidi, chordName, romanName, chordNotes, ROLES } from "../src/song.js";
import { blend, Harmony, stepEvents, targetTempo, pickSource, foldIntoRange } from "../src/mixer.js";

const grid = makeGridField(5, 100);
const globe = makeGlobeField(10);
const sum = (ws) => ws.reduce((s, n) => s + n.w, 0);

test("grid has 25 beacons on a 100 m lattice", () => {
  assert.equal(grid.beacons.length, 25);
  const xs = new Set(grid.beacons.map((b) => b.pos.x));
  assert.deepEqual([...xs].sort((a, b) => a - b), [-200, -100, 0, 100, 200]);
});

test("globe has 614 beacons: 17 latitude rows of 36 plus two poles", () => {
  assert.equal(globe.beacons.length, 17 * 36 + 2);
  assert.equal(new Set(globe.beacons.map((b) => b.id)).size, 614);
});

test("weights: three beacons, sum to 1, never negative", () => {
  for (let i = 0; i < 2000; i++) {
    const p = { x: (Math.random() - 0.5) * 500, y: (Math.random() - 0.5) * 500 };
    const ws = weigh(grid, p);
    assert.equal(ws.length, 3);
    assert.ok(Math.abs(sum(ws) - 1) < 1e-9);
    for (const n of ws) assert.ok(n.w >= 0);
  }
});

test("standing on a beacon gives it 100%", () => {
  for (const b of grid.beacons) {
    const ws = weigh(grid, b.pos);
    assert.equal(ws[0].id, b.id);
    assert.ok(ws[0].w > 0.999, `${b.label} got ${ws[0].w}`);
  }
});

test("weights change continuously along a walk (no jumps when the active set changes)", () => {
  // Walk a long wiggly path in 5 cm steps; the full weight vector may only move a little per step.
  const asMap = (ws) => new Map(ws.map((n) => [n.id, n.w]));
  let prev = asMap(weigh(grid, { x: -230, y: -190 }));
  let maxJump = 0, swaps = 0;
  const steps = 20000;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const p = { x: -230 + 460 * t, y: -190 + 380 * t + 60 * Math.sin(t * 25) };
    const cur = asMap(weigh(grid, p));
    const ids = new Set([...prev.keys(), ...cur.keys()]);
    let jump = 0;
    for (const id of ids) jump = Math.max(jump, Math.abs((cur.get(id) || 0) - (prev.get(id) || 0)));
    if ([...cur.keys()].some((id) => !prev.has(id))) swaps++;
    maxJump = Math.max(maxJump, jump);
    prev = cur;
  }
  assert.ok(swaps > 10, `walk should cross many cell borders (crossed ${swaps})`);
  assert.ok(maxJump < 0.05, `largest weight jump per 5 cm step was ${maxJump.toFixed(4)}`);
});

test("great-circle distance: known values", () => {
  assert.ok(Math.abs(greatCircleKm({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }) - 1111.95) < 0.5);
  assert.ok(Math.abs(greatCircleKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }) - Math.PI * 6371.0088) < 0.5);
  // London -> New York ~ 5570 km
  assert.ok(Math.abs(greatCircleKm({ lat: 51.5074, lon: -0.1278 }, { lat: 40.7128, lon: -74.006 }) - 5570) < 15);
});

test("globe: longitude wraps across the date line", () => {
  const n = nearest(globe, { lat: 1, lon: 179.5 }, 3).map((x) => x.beacon.id);
  assert.ok(n.includes("l0_-180"), `nearest near the date line: ${n}`);
  assert.deepEqual(normalizeLatLon({ lat: 95, lon: 190 }), { lat: 90, lon: -170 });
});

test("globe: fast row search finds the same nearest beacons as a full scan", () => {
  const full = { ...globe, candidates: undefined };
  for (let i = 0; i < 3000; i++) {
    const p = { lat: Math.random() * 180 - 90, lon: Math.random() * 360 - 180 };
    const a = nearest(globe, p, 4).map((n) => n.beacon.id).join();
    const b = nearest(full, p, 4).map((n) => n.beacon.id).join();
    assert.equal(a, b, `at ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`);
  }
});

test("globe: near the pole, the pole beacon wins", () => {
  const ws = weigh(globe, { lat: 89.5, lon: 33 });
  assert.equal(ws[0].id, "pN");
  assert.ok(Math.abs(sum(ws) - 1) < 1e-9);
});

test("songs are deterministic per beacon and valid", () => {
  for (const b of grid.beacons) {
    const a = generateSong("grid:" + b.id), c = generateSong("grid:" + b.id);
    assert.deepEqual(a, c);
    assert.deepEqual(validateSong(a), [], `${b.id}: ${validateSong(a)}`);
    assert.deepEqual(validateSong(JSON.parse(JSON.stringify(a))), []);
  }
  const titles = new Set(grid.beacons.map((b) => generateSong("grid:" + b.id).title));
  assert.ok(titles.size > 15, "songs should differ");
});

test("validateSong catches broken songs", () => {
  assert.ok(validateSong({}).length > 0);
  const s = generateSong("x");
  s.key.mode = "nope";
  assert.ok(validateSong(s).some((e) => e.includes("mode")));
});

test("music theory basics", () => {
  const C = { root: 0, mode: "major" };
  assert.equal(degreeToMidi(C, 0, 4), 60);
  assert.equal(degreeToMidi(C, 7, 4), 72);
  assert.equal(degreeToMidi(C, -1, 4), 59);
  assert.equal(chordName(C, 0), "C");
  assert.equal(chordName(C, 1), "Dm");
  assert.equal(chordName(C, 6), "Bdim");
  assert.equal(chordName({ root: 9, mode: "minor" }, 0), "Am");
});

test("blend: at a beacon it is exactly that song", () => {
  const b = grid.beacons[7];
  const song = generateSong("grid:" + b.id);
  const mix = blend([{ id: b.id, w: 1, song }]);
  for (const role of ROLES) {
    assert.ok(Math.abs(mix.roles[role].gain - song.tracks[role].level) < 1e-9);
    for (const [k, v] of Object.entries(song.tracks[role].params)) {
      if (typeof v === "number") assert.ok(Math.abs(mix.roles[role].params[k] - v) < 1e-6 * Math.max(1, Math.abs(v)), `${role}.${k}`);
      else assert.equal(mix.roles[role].params[k], v);
    }
  }
});

test("blend: cutoff halfway between two songs is the geometric mean", () => {
  const a = generateSong("a"), b = generateSong("b");
  a.tracks.bass.params["filter.cutoff"] = 200;
  b.tracks.bass.params["filter.cutoff"] = 800;
  a.tracks.bass.level = b.tracks.bass.level = 0.8;
  const mix = blend([{ id: "a", w: 0.5, song: a }, { id: "b", w: 0.5, song: b }]);
  assert.ok(Math.abs(mix.roles.bass.params["filter.cutoff"] - 400) < 1);
});

test("harmony switches only on clear wins and keeps position", () => {
  const a = generateSong("a"), b = generateSong("b");
  const h = new Harmony({ hysteresis: 0.08 });
  h.update([{ id: "a", w: 0.6, song: a }, { id: "b", w: 0.4, song: b }], 0);
  assert.equal(h.id, "a");
  assert.equal(h.update([{ id: "a", w: 0.48, song: a }, { id: "b", w: 0.52, song: b }], 1), false, "small lead: no switch");
  assert.equal(h.update([{ id: "a", w: 0.4, song: a }, { id: "b", w: 0.6, song: b }], 2), true);
  assert.equal(h.id, "b");
  assert.equal(h.chordDegree(2), b.progression[2 % b.progression.length]);
});

test("step events: notes stay in the harmony's key", () => {
  const ws = weigh(grid, { x: 37, y: -61 });
  const active = ws.map((n) => ({ id: n.id, w: n.w, song: generateSong("grid:" + n.id) }));
  const mix = blend(active);
  const h = new Harmony();
  h.update(active, 0);
  const scale = new Set([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1].slice(0, 0));
  const { key } = h.song;
  const allowed = new Set();
  for (let d = -20; d < 40; d++) allowed.add(((degree(key, d)) % 12 + 12) % 12);
  let count = 0;
  for (let bar = 0; bar < 8; bar++) {
    for (let s = 0; s < 16; s++) {
      for (const ev of stepEvents(active, mix, h, bar, s)) {
        count++;
        for (const n of ev.notes) assert.ok(allowed.has(n % 12), `note ${n} outside ${key.root} ${key.mode}`);
        assert.ok(ev.vel > 0 && ev.vel <= 1.5);
      }
    }
  }
  assert.ok(count > 40, `expected a busy 8 bars, got ${count} events`);
  void scale;
});

function degree(key, d) { return degreeToMidi(key, d, 4); }

test("pickSource follows shares and is stable", () => {
  const src = [{ id: "a", share: 0.7 }, { id: "b", share: 0.3 }, { id: "c", share: 0 }];
  const counts = { a: 0, b: 0, c: 0 };
  for (let bar = 0; bar < 4; bar++) for (let s = 0; s < 16; s++) for (let salt = 0; salt < 40; salt++) counts[pickSource(src, bar, s, salt)]++;
  const total = counts.a + counts.b;
  assert.equal(counts.c, 0);
  assert.ok(Math.abs(counts.a / total - 0.7) < 0.05, JSON.stringify(counts));
  assert.equal(pickSource(src, 1, 5, 2), pickSource(src, 5, 5, 2), "same bar-in-phrase gives the same pick");
});

test("tempo target is the weighted average", () => {
  const a = generateSong("a"), b = generateSong("b");
  a.bpm = 80; b.bpm = 120;
  assert.equal(targetTempo([{ w: 0.25, song: a }, { w: 0.75, song: b }]), 110);
});

// ------------------------------------------------------------------ local grid

const here = { lat: 37.7793, lon: -122.4193 };
const local = makeLocalGridField(here);

test("local grid is 51 x 51 beacons 1 km apart, centered within half a km of you", () => {
  assert.equal(local.beacons.length, 51 * 51);
  assert.equal(new Set(local.beacons.map((b) => b.id)).size, 2601);
  const c = local.beacons[25 * 51 + 25];
  assert.equal(c.label, "Center");
  const off = local.toXY(here);
  assert.ok(Math.abs(off.x) <= KM_M / 2 + 1e-6 && Math.abs(off.y) <= KM_M / 2 + 1e-6);
  // East and north neighbours are 1 km away, on the flat map and on the real globe.
  const east = local.beacons[25 * 51 + 26], north = local.beacons[24 * 51 + 25];
  assert.equal(east.label, "1E");
  assert.equal(north.label, "1N");
  assert.ok(Math.abs(local.distance(c.pos, east.pos) - KM_M) < 1e-6);
  assert.ok(Math.abs(local.distance(c.pos, north.pos) - KM_M) < 1e-6);
  assert.ok(Math.abs(greatCircleKm(c.pos, east.pos) * 1000 - KM_M) < KM_M * 0.01);
  // The corners are 25 km out each way.
  const corner = local.toXY(local.beacons[0].pos);
  assert.ok(Math.abs(corner.x + 25 * KM_M) < 1e-3 && Math.abs(corner.y - 25 * KM_M) < 1e-3);
});

test("local grids share one lattice: moving the center keeps beacon ids and places", () => {
  const moved = makeLocalGridField({ lat: here.lat + 0.1, lon: here.lon - 0.12 }); // ~11 km away
  const before = new Map(local.beacons.map((b) => [b.id, b.pos]));
  let shared = 0;
  for (const b of moved.beacons) {
    const p = before.get(b.id);
    if (!p) continue;
    shared++;
    assert.ok(Math.abs(p.lat - b.pos.lat) < 1e-9 && Math.abs(p.lon - b.pos.lon) < 1e-9);
  }
  assert.ok(shared > 1500, `only ${shared} beacons shared`);
});

test("local grid: indexed nearest search matches a full scan, and weights sum to 1", () => {
  const full = { ...local, candidates: undefined };
  const r = mulberry(7);
  for (let t = 0; t < 300; t++) {
    const p = local.fromXY({ x: (r() - 0.5) * 52 * KM_M, y: (r() - 0.5) * 52 * KM_M });
    const a = nearest(local, p, 4).map((n) => n.beacon.id);
    const b = nearest(full, p, 4).map((n) => n.beacon.id);
    assert.deepEqual(a, b);
    assert.ok(Math.abs(sum(weigh(local, p)) - 1) < 1e-9);
  }
  assert.equal(weigh(local, local.beacons[1000].pos)[0].w, 1);
});

test("local grid keeps the listener within half a spacing of its edge", () => {
  const far = local.clamp({ lat: here.lat + 2, lon: here.lon + 3 });
  const q = local.toXY(far);
  assert.ok(Math.abs(q.x - 25.5 * KM_M) < 1 && Math.abs(q.y - 25.5 * KM_M) < 1);
});

test("local grid sizes and spacings: every one contains you and shares the 1 km lattice", () => {
  const big = new Map(local.beacons.map((b) => [b.id, b.pos]));
  const r = mulberry(11);
  for (const size of [1, 5, 10, 50, 100]) {
    for (const spacing of [1, 2, 3, 10, 200, 0.01, 0.25, 1.5]) {
      const f = makeLocalGridField(here, size, spacing);
      const steps = Math.min(MAX_LOCAL_STEPS, Math.max(1, Math.round(size / spacing))), sp = Math.round(spacing * KM_M);
      assert.equal(f.steps, steps);
      assert.equal(f.capped, Math.round(size / spacing) > MAX_LOCAL_STEPS);
      assert.ok(Math.abs(f.sizeKm - (steps * sp) / KM_M) < 1e-9);
      assert.equal(f.beacons.length, (steps + 1) ** 2);
      assert.equal(new Set(f.beacons.map((b) => b.id)).size, (steps + 1) ** 2);
      // You stand inside the grid, at most half a spacing from its middle.
      const off = f.toXY(here);
      assert.ok(Math.abs(off.x) <= sp / 2 + 1e-6 && Math.abs(off.y) <= sp / 2 + 1e-6);
      // Neighbours are one spacing apart; corners are half the side out each way.
      assert.ok(Math.abs(f.distance(f.beacons[0].pos, f.beacons[1].pos) - sp) < 1e-6);
      const corner = f.toXY(f.beacons[0].pos);
      assert.ok(Math.abs(corner.x + f.sideM / 2) < 1e-3 && Math.abs(corner.y - f.sideM / 2) < 1e-3);
      // Same lattice as the 50 km, 1 km grid: shared ids sit at the same places.
      for (const b of f.beacons) {
        const p = big.get(b.id);
        if (spacing === 1 && size <= 50) assert.ok(p, `${size} km beacon ${b.id} missing from the 50 km grid`);
        if (p) assert.ok(Math.abs(p.lat - b.pos.lat) < 1e-9 && Math.abs(p.lon - b.pos.lon) < 1e-9);
      }
      // Indexed nearest search still matches a full scan.
      const full = { ...f, candidates: undefined };
      for (let t = 0; t < 40; t++) {
        const p = f.clamp(f.fromXY({ x: (r() - 0.5) * (f.sideM + 2 * sp), y: (r() - 0.5) * (f.sideM + 2 * sp) }));
        assert.deepEqual(nearest(f, p, 4).map((n) => n.beacon.id), nearest(full, p, 4).map((n) => n.beacon.id));
        assert.ok(Math.abs(sum(weigh(f, p)) - 1) < 1e-9);
      }
    }
  }
  // A 2 km grid's beacons carry the 1 km grid's ids, so they keep their songs.
  const two = makeLocalGridField(here, 50, 2);
  assert.ok(two.beacons.filter((b) => big.has(b.id)).length > 600);
  assert.ok(two.beacons.some((b) => b.label === "2E"));
  // Decimal spacings: 10 m apart, labelled in km, and lined up with the 1 km lattice.
  const fine = makeLocalGridField(here, 1, 0.01);
  assert.equal(fine.spacing, 10);
  assert.equal(fine.beacons.length, 101 * 101);
  assert.ok(fine.beacons.some((b) => b.label === "0.01E") && fine.beacons.some((b) => b.label === "0.5N 0.5E"));
  assert.ok(fine.beacons.filter((b) => big.has(b.id)).length >= 1);
  assert.deepEqual(localGridShape(100, 0.01), { unit: 10, spacingKm: 0.01, steps: MAX_LOCAL_STEPS, sizeKm: 1.5, capped: true });
  assert.equal(localGridShape(5, 0.001).unit, 10); // at least 10 m
});

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- song form

import { songPosition, totalBars, lengthSeconds, secondsPerBar, parseForm, formToText, sectionName } from "../src/form.js";
import { drumHit } from "../src/mixer.js";

/** A wall-clock time at which `song` is at bar `bar` of its form. */
function timeAtBar(song, bar) {
  const spb = secondsPerBar(song);
  const exact0 = songPosition(song, 0).seconds / spb; // where the song is at t = 0, in bars
  return (bar + 0.5 - exact0) * spb;
}

test("generated songs have a real form, 2 to 5 minutes long", () => {
  for (let i = 0; i < 400; i++) {
    const s = generateSong("form:" + i);
    assert.deepEqual(validateSong(s), []);
    const sec = lengthSeconds(s);
    assert.ok(sec >= 120 && sec <= 300, `${s.title}: ${sec.toFixed(0)} s`);
    const types = s.form.map((f) => f.section);
    // Ambient pieces have no chorus; every other family has at least two.
    if (s.family !== "ambient") assert.ok(types.filter((t) => t === "chorus").length >= 2, `${s.family}: at least two choruses`);
    assert.ok(types.includes("verse"));
    assert.equal(types[0], "intro");
    for (const f of s.form) assert.ok(f.bars % 4 === 0);
    for (const role of ROLES) assert.ok(s.tracks[role].patternB, `${role} has chorus material`);
    if (s.family !== "ambient") assert.notDeepEqual(s.sections.chorus.progression, s.progression, "chorus has its own chords");
  }
});

test("song position walks through the form on the shared clock", () => {
  const s = generateSong("grid:b1_3");
  const spb = secondsPerBar(s);
  let start = 0;
  s.form.forEach((f, i) => {
    const first = songPosition(s, timeAtBar(s, start));
    assert.equal(first.index, i);
    assert.equal(first.type, f.section);
    assert.equal(first.barInSection, 0);
    const last = songPosition(s, timeAtBar(s, start + f.bars - 1));
    assert.equal(last.barInSection, f.bars - 1);
    start += f.bars;
  });
  // The same time gives the same place, and the song wraps around.
  const t = 1795400000.3;
  assert.deepEqual(songPosition(s, t), songPosition(s, t));
  assert.equal(songPosition(s, t + lengthSeconds(s)).bar, songPosition(s, t).bar);
  assert.equal(songPosition(s, t + spb).bar, (songPosition(s, t).bar + 1) % totalBars(s));
});

test("sections shape the arrangement: layers, brightness, chords", () => {
  const s = generateSong("grid:b2_2", { family: "song" });
  s.form[0].layers = { ...s.form[0].layers, bass: 0, drums: 0 };
  delete s.form[0].enter;
  for (const f of s.form) if (f.section === "verse") { f.layers = { ...f.layers, bass: 1 }; delete f.enter; }
  s.tracks.bass.level = 0.8;
  const at = (type, k = 0) => {
    let b = 0;
    for (const f of s.form) { if (f.section === type && k-- === 0) break; b += f.bars; }
    return songPosition(s, timeAtBar(s, b));
  };
  const one = (pos) => blend([{ id: "x", w: 1, song: s, pos }]);
  const intro = one(at("intro")), verse = one(at("verse")), chorus = one(at("chorus"));
  assert.equal(intro.roles.bass.gain, 0);
  assert.equal(intro.roles.drums.gain, 0);
  assert.ok(verse.roles.bass.gain > 0);
  assert.ok(chorus.roles.keys.params["filter.cutoff"] > verse.roles.keys.params["filter.cutoff"], "chorus is brighter");
  assert.equal(at("verse").material, "A");
  assert.equal(at("chorus").material, "B");
  // Harmony follows the section's chords.
  const h = new Harmony();
  h.update([{ id: "x", w: 1, song: s, pos: at("chorus") }], 0);
  assert.equal(h.chordDegree(0), s.sections.chorus.progression[0]);
  assert.match(h.describe(0).section, /^Chorus/);
});

test("drums: fill into the chorus, crash on it, half time in the bridge", () => {
  const s = generateSong("grid:b0_4", { family: "song" });
  const d = s.tracks.drums;
  const i = s.form.findIndex((f, k) => k > 0 && f.section === "chorus" && s.form[k - 1].section !== "chorus");
  const startOf = (k) => s.form.slice(0, k).reduce((n, f) => n + f.bars, 0);
  const before = songPosition(s, timeAtBar(s, startOf(i) - 1));
  assert.ok(before.fill, `${before.type} -> chorus should have a fill`);
  assert.ok(drumHit(d, before, "snare", 15) > drumHit(d, before, "snare", 12));
  assert.equal(drumHit(d, before, "hat", 14), 0);
  const top = songPosition(s, timeAtBar(s, startOf(i)));
  assert.equal(drumHit(d, top, "open", 0), 0.95);
  const pos = { ...top, type: "bridge", feel: "half", barInSection: 1, fill: false, material: "A" };
  assert.equal(drumHit(d, pos, "snare", 4), 0);
  assert.equal(drumHit(d, pos, "snare", 8), 0.85);
});

test("a song with no form is one loop, played as before", () => {
  const s = generateSong("loop");
  delete s.form; delete s.sections; s.version = 1;
  for (const r of ROLES) delete s.tracks[r].patternB;
  assert.deepEqual(validateSong(s), []);
  const pos = songPosition(s, 12345.6);
  assert.equal(pos.type, "loop");
  assert.equal(totalBars(s), 4);
  const a = blend([{ id: "x", w: 1, song: s }]), b = blend([{ id: "x", w: 1, song: s, pos }]);
  assert.deepEqual(a, b);
});

test("form text round-trips and rejects nonsense", () => {
  const f = parseForm("intro 8, verse 16, pre-chorus 4, chorus, breakdown 4, outro 8");
  assert.deepEqual(f.map((x) => x.section), ["intro", "verse", "pre", "chorus", "break", "outro"]);
  assert.equal(f[3].bars, 8);
  assert.deepEqual(parseForm(formToText(f)), f);
  assert.throws(() => parseForm("verse 16, solo 8"), /unknown section/);
  assert.throws(() => parseForm("verse 100"), /1 to 64/);
  const s = generateSong("x");
  assert.match(sectionName(songPosition(s, 0)), /^(Intro|Verse|Pre-chorus|Chorus|Bridge|Breakdown|Outro)( \d)?$/);
});

// ---------------------------------------------------------------- params, presets, automation

import { INSTRUMENT_OF, INSTRUMENTS, controls, control, isChoice, defaults, automatable, automate, wave, checkAutomation, SHAPES } from "../src/params.js";
import { PRESETS, presetSound } from "../src/presets.js";

test("every control has a sane range and default", () => {
  for (const n of INSTRUMENTS) {
    const ids = new Set();
    for (const c of controls(n)) {
      assert.ok(!ids.has(c[0]), `${n} ${c[0]} listed twice`);
      ids.add(c[0]);
      if (isChoice(c)) assert.ok(c[2].includes(c[3]), `${n} ${c[0]} default`);
      else assert.ok(c[2] < c[3] && c[5] >= c[2] && c[5] <= c[3] && c[4] > 0, `${n} ${c[0]} range`);
    }
    assert.ok(automatable(n).includes("reverb.send"));
  }
  // Glide on the instruments where it makes sense.
  for (const [n, id] of [["Undertow", "glide"], ["Comet", "portamento"], ["Lumen", "glide"], ["Tangle", "glide"]]) assert.ok(control(n, id), `${n} has glide`);
  assert.ok(!automatable("Comet").includes("osc2.semis"), "semitone steps aren't animated");
});

test("20 factory presets per synth plus matched ones, all valid and all different", () => {
  for (const n of INSTRUMENTS) {
    assert.ok(PRESETS[n].length >= 20, n);
    assert.equal(new Set(PRESETS[n].map((p) => p.name)).size, PRESETS[n].length, `${n} names`);
    const sounds = new Set();
    for (const pr of PRESETS[n]) {
      assert.ok(pr.energy >= 0 && pr.energy <= 1);
      for (const [k, v] of Object.entries(pr.params)) {
        const c = control(n, k);
        assert.ok(c, `${n} ${pr.name}: unknown ${k}`);
        if (isChoice(c)) assert.ok(c[2].includes(v), `${n} ${pr.name} ${k}`);
        else assert.ok(v >= c[2] && v <= c[3], `${n} ${pr.name} ${k}=${v}`);
      }
      assert.deepEqual(checkAutomation(n, pr.automation), [], `${n} ${pr.name}`);
      const s = presetSound(n, pr);
      assert.equal(Object.keys(s.params).length, controls(n).length);
      sounds.add(JSON.stringify(s.params));
    }
    assert.equal(sounds.size, PRESETS[n].length, `${n} presets are distinct sounds`);
  }
});

test("automation swings around the set value, stays in range and repeats", () => {
  for (const shape of SHAPES) {
    for (let x = -2; x < 2; x += 0.013) {
      const w = wave(shape, x);
      assert.ok(w >= -1 - 1e-9 && w <= 1 + 1e-9, `${shape} at ${x}`);
      assert.ok(Math.abs(wave(shape, x + 1) - w) < 1e-9 || shape === "random" || shape === "drift", `${shape} is periodic`);
    }
  }
  const a = { shape: "sine", bars: 2, depth: 0.5, phase: 0 };
  const c = control("Undertow", "filter.cutoff");
  let lo = Infinity, hi = -Infinity;
  for (let beat = 0; beat < 8; beat += 0.05) {
    const v = automate("Undertow", "filter.cutoff", 500, a, beat);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    assert.ok(v >= c[2] && v <= c[3]);
  }
  assert.ok(lo < 300 && hi > 800, `cutoff swings ${lo.toFixed(0)}..${hi.toFixed(0)}`);
  assert.ok(Math.abs(Math.sqrt(lo * hi) - 500) < 5, "log controls swing evenly in octaves");
  assert.equal(automate("Undertow", "filter.cutoff", 500, a, 0), 500);
  assert.ok(Math.abs(automate("Undertow", "filter.cutoff", 500, a, 2) - hi) < 5, "a quarter of a 2-bar cycle is the top");
  assert.equal(automate("Undertow", "osc.wave", "square", a, 1), "square"); // choices never move
  assert.ok(checkAutomation("Comet", { "osc2.semis": a }).length > 0);
  assert.ok(checkAutomation("Comet", { "filter.cutoff": { ...a, shape: "wobble" } }).length > 0);
});

test("songs use presets, vary them, and blend automation from the loudest song", () => {
  const presetsSeen = new Set();
  let animated = 0;
  for (let i = 0; i < 60; i++) {
    const s = generateSong("sound:" + i);
    assert.deepEqual(validateSong(s), []);
    for (const role of ROLES) {
      const t = s.tracks[role];
      presetsSeen.add(role + t.preset);
      if (t.automation) animated++;
      for (const [k, v] of Object.entries(t.params)) {
        const c = control(INSTRUMENT_OF[role], k);
        if (c && !isChoice(c)) assert.ok(v >= c[2] && v <= c[3], `${role} ${k}=${v}`);
      }
    }
  }
  assert.ok(presetsSeen.size > 60, `only ${presetsSeen.size} different presets`);
  assert.ok(animated > 120, `only ${animated} animated tracks`);
  const a = generateSong("a"), b = generateSong("b");
  a.tracks.bass.level = b.tracks.bass.level = 0.8;
  a.tracks.bass.automation = { "filter.cutoff": { shape: "sine", bars: 4, depth: 0.4, phase: 0 } };
  b.tracks.bass.automation = { "filter.emphasis": { shape: "square", bars: 1, depth: 0.2, phase: 0 } };
  const m = blend([{ id: "a", w: 0.7, song: a }, { id: "b", w: 0.3, song: b }]);
  assert.deepEqual(m.roles.bass.automation, a.tracks.bass.automation);
});

test("arrangements are free: any number of parts can open a song, and each section has its own lineup", () => {
  const introSizes = new Set(), paletteSizes = new Set();
  let echoedWithChange = 0, builds = 0;
  for (let i = 0; i < 300; i++) {
    const s = generateSong("arr:" + i);
    const used = ROLES.filter((r) => s.tracks[r].level > 0);
    paletteSizes.add(used.length);
    assert.ok(used.length >= 2);
    for (const f of s.form) {
      const on = ROLES.filter((r) => f.layers[r] > 0);
      assert.ok(on.length >= 1, "every section has something playing");
      assert.ok(on.every((r) => used.includes(r)), "sections only use the song's own instruments");
      if (f.enter) builds++;
    }
    introSizes.add(ROLES.filter((r) => s.form[0].layers[r] > 0).length);
    const verses = s.form.filter((f) => f.section === "verse").map((f) => ROLES.filter((r) => f.layers[r] > 0).join());
    if (verses.length > 1 && verses[0] !== verses[1]) echoedWithChange++;
  }
  assert.deepEqual([...introSizes].sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...paletteSizes].sort(), [2, 3, 4, 5, 6]);
  assert.ok(echoedWithChange > 100, "later verses usually differ from the first");
  assert.ok(builds > 100, "parts sometimes enter partway through a section");
});

test("a part that enters partway is silent until then", () => {
  const s = generateSong("enter");
  const i = s.form.findIndex((f) => f.bars >= 8);
  s.form[i].layers = Object.fromEntries(ROLES.map((r) => [r, 1]));
  s.form[i].enter = { bass: 0.5 };
  const start = s.form.slice(0, i).reduce((n, f) => n + f.bars, 0);
  const early = songPosition(s, timeAtBar(s, start + 1)), late = songPosition(s, timeAtBar(s, start + s.form[i].bars / 2));
  assert.equal(early.layers.bass, 0);
  assert.ok(late.layers.bass > 0);
  assert.ok(early.layers.keys > 0);
});

test("bass notes fold into a real bass range (E1-G3)", () => {
  assert.equal(foldIntoRange("bass", 67), 55);
  assert.equal(foldIntoRange("bass", 80), 56 - 12);
  assert.equal(foldIntoRange("bass", 24), 36);
  assert.equal(foldIntoRange("bass", 40), 40);
  assert.equal(foldIntoRange("lead", 84), 84);
  assert.equal(foldIntoRange("lead", 100), 76); // the lead stops at D6 (86): never shrill
  assert.equal(foldIntoRange("lead", 90), 78);
});

test("generator v2: families, borrowed chords, and each family's shape", () => {
  const seen = {};
  let borrowed = 0;
  for (let i = 0; i < 400; i++) {
    const s = generateSong("v2:" + i);
    seen[s.family] = (seen[s.family] || 0) + 1;
    if (s.progression.some((c) => typeof c === "object")) borrowed++;
    const on = (role) => s.tracks[role].level > 0;
    if (s.family === "journey") {
      assert.ok(s.bpm >= 120 && s.bpm <= 132, "journeys drive");
      assert.ok(s.form.some((f) => f.section === "pre" && f.enter?.drums), "the beat comes in partway through the build");
      assert.ok(s.sections.chorus.energy > s.sections.intro.energy * 3, "a big build");
    }
    if (s.family === "ambient") {
      assert.ok(s.bpm <= 92);
      const d = s.tracks.drums.pattern;
      assert.ok(!on("drums") || (d.snare.every((v) => v === 0) && d.hat.filter((v) => v > 0).length <= 2), "at most a soft heartbeat");
      assert.ok(s.tracks.drums.params["hat.tone"] <= 4500, "dark hats");
    }
    if (s.family === "groove") {
      assert.ok(on("drums") && on("bass"), "a groove keeps its beat and bass");
      assert.ok(s.tracks.bass.pattern[0][0].g >= 6, "sub-bass holds");
    }
  }
  for (const f of ["song", "journey", "ambient", "groove"]) assert.ok(seen[f] > 30, `${f}: ${seen[f]}`);
  assert.ok(borrowed > 40, `borrowed-chord verses: ${borrowed}`);
});

test("borrowed chords: names, notes and melodies use the borrowed scale", () => {
  const C = { root: 0, mode: "major" };
  const bVII = { d: 6, m: "mixolydian" }, bIII = { d: 2, m: "minor" }, iv = { d: 3, m: "minor" };
  assert.equal(chordName(C, bVII), "Bb");
  assert.equal(chordName(C, bIII), "Eb");
  assert.equal(chordName(C, iv), "Fm");
  assert.equal(romanName(C, bVII), "bVII");
  assert.equal(romanName(C, iv), "iv");
  assert.deepEqual(chordNotes(C, bVII, 4), [70, 74, 77]);
  // A melody note two steps above a bIII root lands on G (Eb minor-scale steps: Eb F G).
  const s = generateSong("borrow", { family: "song" });
  s.progression = [bIII, bIII, bIII, bIII];
  s.key = C;
  delete s.form; delete s.sections;
  const h = new Harmony();
  h.update([{ id: "x", w: 1, song: s }], 0);
  assert.deepEqual(h.chordDegree(0), bIII);
  assert.equal(h.describe(0).chord, "Eb");
  assert.deepEqual(validateSong({ ...s, progression: [0, { d: 9, m: "nope" }] }).slice(0, 1), ["progression entries must be scale degrees or {d, m} borrowed chords"]);
});
