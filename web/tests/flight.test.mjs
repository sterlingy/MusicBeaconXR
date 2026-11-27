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

// ---------------------------------------------------------------- random flights and the card

import { flightSummary, randomFlight } from "../src/flight.js";

const KAL = { flight: "KAL251", reg: "HL7782", type: "B77W", lat: 33, lon: -78, alt_ft: 37000, gs_kt: 480, track: 30, vrate: 0, mach: 0.84, oat: -52, squawk: "2242" };
const KAL_D = { route: { callsign_iata: "KE251", airline: { name: "Korean Air" },
  origin: { municipality: "Miami", iata_code: "MIA", latitude: 25.7932, longitude: -80.2906 },
  destination: { municipality: "New York", iata_code: "JFK", latitude: 40.6398, longitude: -73.7789 } },
  aircraft: { manufacturer: "Boeing", type: "777 300ER", registered_owner: "Korean Air", registered_owner_country_name: "South Korea" } };

test("the flight card: route, progress, estimated times, numbers, aircraft (same as the app)", () => {
  const s = flightSummary(KAL, KAL_D, 1.8e9);
  assert.equal(s.code, "KE251");
  assert.equal(s.airline, "Korean Air");
  assert.deepEqual([s.oCode, s.dCode, s.flown, s.left, s.toGo, s.airborne], ["MIA", "JFK", "831 km", "929 km", "1 h 3 min", "1 h 22 min"]);
  assert.equal(s.alt, "37,000 ft");
  assert.equal(s.speedAlt, "552 mph · 889 km/h");
  assert.equal(s.heading, "NNE 30°");
  assert.equal(s.aircraft, "Boeing 777 300ER");
  assert.equal(s.owner, "HL7782 · Korean Air · South Korea");
});

test("a schedule route the plane isn't flying is unconfirmed, and its airline isn't named", () => {
  const s = flightSummary({ ...KAL, lat: 51, lon: 10 }, KAL_D, 1.8e9);
  assert.equal(s.plausible, false);
  assert.equal(s.airline, "");
  assert.equal(s.code, "KAL251");
  assert.equal(s.progress, undefined);
});

test("a plane flying away from the listed destination: route unconfirmed", () => {
  assert.equal(flightSummary({ ...KAL, track: 210 }, KAL_D, 1.8e9).plausible, false);
  assert.equal(flightSummary(KAL, KAL_D, 1.8e9).plausible, true);
});

test("a random flight: quiet hubs retry, then a plane", async () => {
  const answers = [{ found: false, retry: true }, { found: false, retry: true }, { found: true, hex: "abc123", flight: "DAL1" }];
  const f = await randomFlight(async () => answers.shift(), { wait: async () => {} });
  assert.equal(f.hex, "abc123");
  await assert.rejects(randomFlight(async () => ({ found: false, retry: false, reason: "daily limit" }), { wait: async () => {} }), /daily limit/);
});
