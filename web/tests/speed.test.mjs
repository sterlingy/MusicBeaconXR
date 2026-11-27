// Travel speed: the same rules as the app's SpeedUi (tests/speed_check.gd).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/speed.js";
import { travelSeconds, planarSpace } from "../src/input/listener.js";

test("a log slider from 1 to 250 m/s that snaps to the marks", () => {
  assert.ok(Math.abs(S.fromT(0) - 1) < 1e-9 && Math.abs(S.fromT(1) - 250) < 1e-6);
  assert.ok(Math.abs(S.fromT(0.5) - Math.sqrt(250)) < 1e-6);
  for (const m of S.MARKS) assert.equal(S.snappedSpeed(S.toT(m) + 0.01), m, `${m} m/s snaps`);
  assert.equal(S.snappedSpeed(S.toT(70)), 70);
  assert.equal(S.snappedSpeed(S.toT(3.3)), 3.5);
});

test("named ranges, as the app", () => {
  for (const [v, name] of [[1.4, "Walk"], [3, "Jog"], [6, "Run"], [10, "Bike"], [25, "Drive"], [45, "Train"], [83, "Bullet train"], [140, "Prop plane"], [250, "Jet"]]) {
    assert.equal(S.bandOf(v), name, `${v} m/s`);
  }
  assert.equal(S.describe(25), "25 m/s · Drive · 90 km/h");
  assert.equal(S.label(1.5), "1.5 m/s");
});

test("Move on a grid takes as long as the travel speed would", () => {
  const sp = planarSpace({ half: 1000 });
  assert.equal(travelSeconds(sp, { x: 0, y: 0 }, { x: 100, y: 0 }, 500, 10), 10);
  assert.equal(travelSeconds(sp, { x: 0, y: 0 }, { x: 1, y: 0 }, 500, 10), 0.3);
});
