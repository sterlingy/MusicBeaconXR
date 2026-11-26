// The 3D globe's projection and camera maths: node --test web/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { Globe3D, subsolar } from "../src/globe3d.js";

const fake = () => new Globe3D({ canvas: { width: 800, height: 600 }, engine: { pos: { lat: 30, lon: -97 }, active: [], field: { beacons: [] } }, ui: { dpr: 1 }, drafts: () => null });

test("screen and world round-trip; the far side is hidden", () => {
  const g = fake();
  for (const [lat0, lon0, zoom] of [[0, 0, 1], [30, -97, 40], [-60, 170, 3], [89, 10, 500]]) {
    g.lat0 = lat0; g.lon0 = lon0; g.zoom = zoom;
    const middle = g.toWorld(400, 300);
    assert.ok(Math.abs(middle.lat - lat0) < 1e-9 && Math.abs(((middle.lon - lon0 + 540) % 360) - 180) < 1e-9);
    for (let i = 0; i < 200; i++) {
      const x = 400 + (Math.random() - 0.5) * 700, y = 300 + (Math.random() - 0.5) * 500;
      const w = g.toWorld(x, y);
      if (!w) continue;
      const s = g.toScreen(w);
      assert.ok(s && Math.abs(s[0] - x) < 1e-6 && Math.abs(s[1] - y) < 1e-6, `round trip at ${x},${y}`);
    }
  }
  g.lat0 = 0; g.lon0 = 0; g.zoom = 1;
  assert.equal(g.toScreen({ lat: 0, lon: 180 }), null, "the far side");
  assert.ok(g.toScreen({ lat: 0, lon: 100 }, 1.5), "high enough to see over the edge");
  assert.equal(g.toScreen({ lat: 0, lon: 180 }, 1.5), null, "straight behind stays hidden");
  assert.equal(g.toWorld(0, 0), null, "off the globe");
});

test("zooming to a distance, and the sun", () => {
  const g = fake();
  g.zoom = g.zoomForKm(40);
  assert.ok(Math.abs(600 * g.kmPerPx() - 40) < 1e-6);
  const june = subsolar(new Date(Date.UTC(2026, 5, 21, 12, 0)));
  assert.ok(Math.abs(june.lat - 23.4) < 0.3 && Math.abs(june.lon) < 0.5, `June noon: ${june.lat}, ${june.lon}`);
  const dec = subsolar(new Date(Date.UTC(2026, 11, 21, 18, 0)));
  assert.ok(Math.abs(dec.lat + 23.4) < 0.3 && Math.abs(dec.lon + 90) < 0.5, `December evening: ${dec.lat}, ${dec.lon}`);
});
