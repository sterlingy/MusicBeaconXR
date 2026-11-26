// Following a flight: node --test web/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { destination, project, describe, FlightTracker, POLL_S, MAX_AHEAD_S } from "../src/flight.js";
import { greatCircleKm } from "../src/beacons.js";

test("dead reckoning carries the plane along its speed and track", () => {
  const p = destination(40, -74, 90, 100000);
  assert.ok(Math.abs(greatCircleKm({ lat: 40, lon: -74 }, p) - 100) < 0.01);
  assert.ok(p.lon > -74 && Math.abs(p.lat - 40) < 0.2, "east");
  const fix = { lat: 40, lon: -74, gs_kt: 400, track: 0, at: 1000, seen_pos: 2 };
  const a = project(fix, 1000);
  assert.ok(Math.abs(greatCircleKm(fix, a) * 1000 - 400 * 0.514444 * 2) < 1, "accounts for how old the fix was");
  const far = project(fix, 100000);
  assert.ok(Math.abs(greatCircleKm(fix, far) * 1000 - 400 * 0.514444 * MAX_AHEAD_S) < 1, "stops guessing after a while");
  assert.deepEqual(project({ ...fix, gs_kt: 0 }, 2000), { lat: 40, lon: -74 });
  const dl = destination(10, 179.9, 90, 50000);
  assert.ok(dl.lon < -179, "across the date line");
  assert.equal(describe({ reg: "N733YX", flight: "RPA3457", type: "E75L", alt_ft: 2300, gs_kt: 196.8 }), "N733YX · RPA3457 · E75L · 2,300 ft · 197 kt");
});

test("the tracker polls, keeps gliding through failures, and eases new fixes in", async () => {
  let t = 1000;
  const fixes = [
    { found: true, lat: 40, lon: -74, gs_kt: 300, track: 90, at: 1000, seen_pos: 0 },
    { found: false, reason: "Busy" },
    { found: true, lat: 40.02, lon: -73.9, gs_kt: 300, track: 90, at: 1040, seen_pos: 0 },
  ];
  let calls = 0;
  const tr = new FlightTracker({ lookup: async () => fixes[Math.min(calls++, fixes.length - 1)], now: () => t });
  await assert.rejects(new FlightTracker({ lookup: async () => ({ found: false, reason: "nope" }) }).start("X1"), /nope/);
  await tr.start("N733YX");
  assert.equal(await tr.poll(), false, "not yet");
  t += POLL_S;
  assert.equal(await tr.poll(), false);
  assert.equal(tr.lost, "Busy");
  assert.ok(tr.position().lon > -74, "keeps gliding on the old fix");
  t = 1040;
  const before = tr.position();
  assert.equal(await tr.poll(), true);
  const just = tr.position();
  assert.ok(greatCircleKm(before, just) < 0.05, "no jump when the new fix lands");
  t += 5;
  const settled = tr.position();
  assert.ok(greatCircleKm(settled, project(fixes[2], t)) < 1e-6, "settles on the new fix");
  tr.stop();
  assert.equal(tr.position(), null);
});
