// Trails and walk recordings: node --test web/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeGridField, makeGlobeField, weigh } from "../src/beacons.js";
import { generateSong } from "../src/song.js";
import * as W from "../src/walk.js";

const grid = makeGridField(5, 100);
const songs = new Map(grid.beacons.map((b) => [b.id, generateSong(`grid:${b.id}`)]));
const activeAt = (p) => weigh(grid, p).map((n) => ({ ...n, song: songs.get(n.id) }));

test("a trail keeps points a few meters apart, splits at jumps, and stays bounded", () => {
  const t = new W.Trail();
  assert.equal(t.add({ x: 0, y: 0 }, "Glow", 0), true);
  assert.equal(t.add({ x: 1, y: 0 }, "Glow", 1), false, "too close");
  assert.equal(t.add({ x: 10, y: 0 }, "Tide", 2), true);
  t.add({ x: 9000, y: 0 }, "Rush", 3);
  assert.equal(t.stretches().length, 2);
  assert.equal(Math.round(t.length()), 10, "the jump isn't counted");
  const g = new W.Trail();
  for (let i = 0; i < W.TRAIL_MAX + 50; i++) g.add({ lat: 30 + i * 0.001, lon: -97 }, "", i);
  assert.equal(g.points.length, W.TRAIL_MAX);
});

test("a recording samples the blend, snapshots songs, and replays the same blend", () => {
  const r = new W.WalkRecorder({ field: grid, wallStart: 1_800_000_000, settings: { sharpness: 1.5 } });
  const path = (t) => ({ x: -180 + t * 12, y: -150 + t * 9 });
  for (let t = 0; t <= 30; t += 0.05) r.sample(t, path(t), activeAt(path(t)));
  const rec = r.finish(30);
  assert.deepEqual(W.validateWalk(rec), []);
  assert.ok(rec.samples.length > 30 && rec.samples.length < 200, `${rec.samples.length} samples`);
  assert.ok(JSON.stringify(rec).length < 400_000);
  assert.equal(rec.duration, 30);
  // Every beacon heard has a song and a place.
  for (const s of rec.samples) for (const [id] of s.a) { assert.ok(rec.songs[id]); assert.ok(rec.beacons[id].pos); }
  // The replay's blend matches the live one closely at any moment.
  for (let t = 0.3; t < 29.7; t += 0.7) {
    const live = new Map(activeAt(path(t)).map((a) => [a.id, a.w]));
    const f = W.frameAt(rec, t);
    const sum = f.active.reduce((s, a) => s + a.w, 0);
    assert.ok(Math.abs(sum - 1) < 0.01, `weights sum to 1 at ${t}`);
    for (const a of f.active) assert.ok(Math.abs(a.w - (live.get(a.id) || 0)) < 0.12, `${a.id} at ${t.toFixed(1)}s: ${a.w} vs ${live.get(a.id)}`);
    assert.ok(Math.abs(f.pos.x - path(t).x) < 0.5);
  }
});

test("trimming moves the clock with the cut, keeping only songs still heard", () => {
  const r = new W.WalkRecorder({ field: grid, wallStart: 1000 });
  const path = (t) => ({ x: -200 + t * 20, y: 0 });
  for (let t = 0; t <= 20; t += 0.25) r.sample(t, path(t), activeAt(path(t)));
  const rec = r.finish(20);
  const cut = W.trimWalk(rec, 5, 12);
  assert.equal(cut.duration, 7);
  assert.equal(cut.wallStart, 1005);
  assert.equal(cut.samples[0].t, 0);
  assert.deepEqual(W.frameAt(cut, 3).active.map((a) => a.id), W.frameAt(rec, 8).active.map((a) => a.id));
  assert.ok(Object.keys(cut.songs).length <= Object.keys(rec.songs).length);
  assert.deepEqual(W.validateWalk(cut), []);
});

test("globe recordings interpolate across the date line, and the trail of a walk", () => {
  const globe = makeGlobeField(10);
  const r = new W.WalkRecorder({ field: globe, wallStart: 0 });
  const a = weigh(globe, { lat: 10, lon: 179.5 }).map((n) => ({ ...n, song: generateSong(`globe:${n.id}`) }));
  r.sample(0, { lat: 10, lon: 179.5 }, a);
  r.sample(5, { lat: 10, lon: -179.5 }, a.map((x) => ({ ...x, w: x.w * 0.999 })));
  const rec = r.finish(10);
  const mid = W.frameAt(rec, 2.5).pos;
  assert.ok(Math.abs(Math.abs(mid.lon) - 180) < 0.01, `crossed the date line, not the world: ${mid.lon}`);
  assert.equal(W.walkTrail(rec).points.length, rec.samples.length);
});

test("WAV: header and samples", () => {
  const L = new Float32Array([0, 0.5, -0.5, 1]), R = new Float32Array([0, -1, 1, 0]);
  const joined = W.joinChunks([[L.slice(0, 2), R.slice(0, 2)], [L.slice(2), R.slice(2)]]);
  assert.deepEqual([...joined[0]], [...L]);
  const buf = W.encodeWav(joined, 48000);
  const v = new DataView(buf);
  assert.equal(String.fromCharCode(...new Uint8Array(buf, 0, 4)), "RIFF");
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(buf.byteLength, 44 + 4 * 2 * 2);
  assert.equal(v.getInt16(44 + 2 * 2, true), 16383); // 0.5 of full scale, truncated
  assert.equal(W.clockText(187), "3:07");
});

test("a jump breaks the trail and leaves a dotted gap; GPS-sized hops don't", () => {
  const t = new W.Trail();
  t.add({ x: 0, y: 0 }, "Glow", 0, { minM: 4, jumpM: 400 });
  t.add({ x: 10, y: 0 }, "Glow", 1, { minM: 4, jumpM: 400 });
  t.add({ x: 15, y: 0 }, "Glow", 2, { minM: 4, jumpM: 400, jumped: true }); // a few meters: still walking
  t.add({ x: 200, y: 0 }, "Tide", 3, { minM: 4, jumpM: 400, jumped: true }); // a real jump
  t.add({ x: 210, y: 0 }, "Tide", 4, { minM: 4, jumpM: 400 });
  const pieces = t.pieces();
  assert.deepEqual(pieces.map((p) => [p.jump, p.pts.length]), [[false, 3], [true, 2], [false, 2]]);
  assert.deepEqual(pieces[1].pts.map((p) => p.p.x), [15, 200]);
});
