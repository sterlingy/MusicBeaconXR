// Node tests for the pure logic (no audio, no DOM): node --test web/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGridField, makeGlobeField, weigh, greatCircleKm, nearest, normalizeLatLon } from "../src/beacons.js";
import { generateSong, validateSong, degreeToMidi, chordName, ROLES } from "../src/song.js";
import { blend, Harmony, stepEvents, targetTempo, pickSource } from "../src/mixer.js";

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
