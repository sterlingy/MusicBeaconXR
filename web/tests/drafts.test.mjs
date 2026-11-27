// Beacon drafts (step 1 of docs/beacon-database-plan.md): node --test web/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeLocalGridField } from "../src/beacons.js";
import { validateSong } from "../src/song.js";
import * as D from "../src/drafts.js";

const AUSTIN = { lat: 30.2672, lon: -97.7431, accuracy: 12 };
const fresh = () => D.normalizeDoc(D.emptyDoc());

test("lattice: points are 100 m apart and ids round-trip", () => {
  const p = D.snapPoint(AUSTIN);
  assert.equal(p.I % 100, 0);
  assert.equal(Math.abs(p.J % 100), 0);
  assert.equal(p.band, 30);
  assert.ok(D.meters(p, AUSTIN) < 75, "nearest point is within half a diagonal");
  assert.deepEqual(D.parsePoint(p.id), p);
  const east = D.snapPoint({ lat: p.lat, lon: p.lon + 100 / (D.M_PER_DEG * Math.cos((30 * Math.PI) / 180)) });
  assert.ok(Math.abs(D.meters(p, east) - 100) < 0.5);
});

test("lattice option A: a point's band comes from its own row", () => {
  const a = D.snapPoint({ lat: 30.4, lon: -97 }), b = D.snapPoint({ lat: 30.6, lon: -97 });
  assert.equal(a.band, 30);
  assert.equal(b.band, 31);
});

test("draft beacons start with the local grid's song at the same point", () => {
  const f = makeLocalGridField(AUSTIN, 10, 1);
  const b = f.beacons.find((x) => D.parsePoint(x.id));
  const doc = fresh();
  const g = D.makeGrid(doc, b.pos, 1000, { center: D.snapPoint(b.pos, 1000).id });
  assert.equal(D.snapPoint(b.pos, 1000).id, b.id, "same id as the local grid");
  assert.equal(D.seedFor(g, b.id), `local:${b.id}`);
});

test("a grid is 21 x 21 beacons, spacing apart, centered near you", () => {
  for (const sp of D.SPACINGS_M) {
    const doc = fresh();
    const g = D.makeGrid(doc, AUSTIN, sp);
    const pts = D.gridPoints(g.center, sp);
    assert.equal(pts.length, 441);
    assert.equal(new Set(pts.map((p) => p.id)).size, 441, "ids unique");
    for (const p of pts) assert.equal(Math.abs(p.I % sp), 0);
    const c = D.parsePoint(g.center);
    assert.ok(D.meters(c, AUSTIN) <= sp * 0.75);
    assert.ok(Math.abs(D.meters(pts[0], pts[1]) - sp) < sp * 0.02, `${sp} m columns`);
    assert.ok(Math.abs(D.meters(pts[0], pts[21]) - sp) < 0.5, `${sp} m rows`);
    assert.ok(D.inGrid(g, AUSTIN));
    assert.equal(D.gridStats(g).sideKm, (20 * sp) / 1000);
  }
});

test("lower 48 only, with a good enough fix", () => {
  for (const [name, p] of [["Austin", AUSTIN], ["Seattle", { lat: 47.61, lon: -122.33 }], ["Miami", { lat: 25.76, lon: -80.19 }],
    ["Bangor", { lat: 44.8, lon: -68.77 }], ["Chicago", { lat: 41.88, lon: -87.63 }], ["San Diego", { lat: 32.72, lon: -117.15 }],
    ["Denver", { lat: 39.74, lon: -104.99 }], ["Duluth", { lat: 46.79, lon: -92.1 }], ["Key West", { lat: 24.56, lon: -81.78 }]]) {
    assert.ok(D.inLower48(p), name);
  }
  for (const [name, p] of [["Toronto", { lat: 43.65, lon: -79.38 }], ["Vancouver", { lat: 49.28, lon: -123.12 }], ["Monterrey", { lat: 25.69, lon: -100.32 }],
    ["Tijuana", { lat: 32.45, lon: -117.0 }], ["Anchorage", { lat: 61.2, lon: -149.9 }], ["Honolulu", { lat: 21.3, lon: -157.86 }],
    ["London", { lat: 51.5, lon: -0.13 }], ["Bermuda", { lat: 32.3, lon: -64.8 }], ["Montreal", { lat: 45.5, lon: -73.57 }]]) {
    assert.ok(!D.inLower48(p), name);
  }
  assert.equal(D.fixProblem(AUSTIN), null);
  assert.match(D.fixProblem(null), /location/);
  assert.match(D.fixProblem({ ...AUSTIN, accuracy: 900 }), /accurate/);
  assert.match(D.fixProblem({ lat: 51.5, lon: -0.13, accuracy: 5 }), /lower 48/);
});

test("generate more: the next grid along, touching, same lattice", () => {
  const doc = fresh();
  const g = D.makeGrid(doc, AUSTIN, 5000);
  doc.grids.push(g);
  assert.equal(D.moreGridOffer(doc, AUSTIN), null, "inside: nothing offered");
  const c = D.parsePoint(g.center);
  const east = { lat: c.lat, lon: c.lon + (60000 / (D.M_PER_DEG * Math.cos((c.band * Math.PI) / 180))) };
  const offer = D.moreGridOffer(doc, east);
  assert.equal(offer.dir, "E");
  const next = D.makeGrid(doc, east, 5000, { center: offer.center });
  assert.ok(D.inGrid(next, east));
  const a = new Set(D.gridPoints(g.center, 5000).map((p) => p.id));
  const b = D.gridPoints(next.center, 5000);
  assert.equal(b.filter((p) => a.has(p.id)).length, 0, "no shared beacons");
  assert.ok(Math.abs(D.meters(D.parsePoint(g.center), D.parsePoint(next.center)) - 21 * 5000) < 300, "touching");
  doc.grids.push(next);
  assert.equal(D.moreGridOffer(doc, east), null);
  const far = { lat: c.lat + 5, lon: c.lon };
  assert.equal(D.moreGridOffer(doc, far), null, "too far away: no offer");
});

test("regenerate all and one beacon", () => {
  const doc = fresh();
  const g = D.makeGrid(doc, AUSTIN, 1000);
  const pt = D.gridPoints(g.center, 1000)[7].id;
  const s0 = D.seedFor(g, pt);
  D.regenerateOne(g, pt);
  const s1 = D.seedFor(g, pt);
  assert.notEqual(s0, s1);
  assert.equal(D.seedFor(g, D.gridPoints(g.center, 1000)[8].id).startsWith("local:"), true);
  D.regenerateAll(g);
  assert.notEqual(D.seedFor(g, pt), s1);
  assert.notEqual(D.seedFor(g, pt), s0);
});

/** A pool with one grid, for weighting tests. */
function poolWith(doc) { return D.buildPool(doc, { day: 20000 }); }

test("user layer: weights sum to 1, the layer reaches across a grid, and fades out past its edge", () => {
  const doc = fresh();
  const g = D.makeGrid(doc, AUSTIN, 1000);
  doc.grids.push(g);
  const pool = poolWith(doc);
  const c = D.parsePoint(g.center);
  const at = (dyM, dxM) => ({ lat: c.lat + dyM / D.M_PER_DEG, lon: c.lon + dxM / (D.M_PER_DEG * Math.cos((c.lat * Math.PI) / 180)) });
  for (let i = 0; i < 400; i++) {
    const p = at((Math.random() - 0.5) * 20000, (Math.random() - 0.5) * 20000);
    const L = D.userLayer(pool, p);
    assert.ok(Math.abs(L.active.reduce((s, a) => s + a.w, 0) - 1) < 1e-9);
    assert.equal(L.u, 1, "inside the grid the user layer is all there is");
  }
  // Walking east out of the grid: u falls smoothly from 1 to 0 within one spacing.
  let prev = 1;
  for (let x = 10000; x <= 11200; x += 10) {
    const L = D.userLayer(pool, at(300, x));
    assert.ok(L.u <= prev + 1e-9, "never rises walking out");
    assert.ok(prev - L.u < 0.07, `no jump at ${x} m`);
    prev = L.u;
  }
  assert.equal(prev, 0);
});

test("user layer weights never jump as the listener walks", () => {
  const doc = fresh();
  const g = D.makeGrid(doc, AUSTIN, 500);
  doc.grids.push(g);
  doc.plants.push({ id: "plant-x", point: D.snapPoint(AUSTIN).id, rangeM: 2000, song: D.buildPool(doc).playing[0].song(), createdAt: 5 });
  const pool = poolWith(doc);
  const c = D.parsePoint(g.center);
  const path = (t) => ({ lat: c.lat + (t * 7000 - 3500) / D.M_PER_DEG, lon: c.lon + (t * 5300 - 6000) / (D.M_PER_DEG * 0.864) });
  let last = null;
  for (let t = 0; t <= 1; t += 0.00005) {
    const L = D.userLayer(pool, path(t));
    const m = new Map(L.active.map((a) => [a.entry.key, a.w * L.u]));
    if (last) {
      for (const k of new Set([...m.keys(), ...last.keys()])) assert.ok(Math.abs((m.get(k) || 0) - (last.get(k) || 0)) < 0.08, `jump at t=${t.toFixed(4)}`);
    }
    last = m;
  }
});

test("a lone planted song is heard only within its range", () => {
  const doc = fresh();
  const songs = D.buildPool({ ...doc, grids: [D.makeGrid(fresh(), AUSTIN, 100)] }).playing;
  D.plantSong(doc, AUSTIN, songs[0].song(), 500);
  const pool = poolWith(doc);
  const pt = D.parsePoint(doc.plants[0].point);
  assert.equal(D.userLayer(pool, pt).u, 1);
  assert.equal(D.userLayer(pool, { lat: pt.lat + 300 / D.M_PER_DEG, lon: pt.lon }).u, 1);
  assert.ok(D.userLayer(pool, { lat: pt.lat + 450 / D.M_PER_DEG, lon: pt.lon }).u < 0.5);
  assert.equal(D.userLayer(pool, { lat: pt.lat + 600 / D.M_PER_DEG, lon: pt.lon }).u, 0);
  assert.equal(D.statusLine(D.layerShares(D.userLayer(pool, pt))), "User 100%");
  assert.equal(D.statusLine(D.layerShares(D.userLayer(pool, { lat: pt.lat + 1, lon: pt.lon }))), "Global 100%");
});

test("several songs at one spot: play modes choose one", () => {
  const doc = fresh();
  const g = D.makeGrid(doc, AUSTIN, 100);
  doc.grids.push(g);
  const song = D.buildPool(doc).playing[0].song();
  const a = D.plantSong(doc, AUSTIN, { ...song, title: "First" }, 500, Date.now() + 1000);
  const b = D.plantSong(doc, AUSTIN, { ...song, title: "Second" }, 500, Date.now() + 2000);
  const pt = a.point;
  const pick = (mode, day = 20000) => { doc.prefs.playMode = mode; return D.buildPool(doc, { day }).playing.find((e) => e.point === pt); };
  assert.equal(pick("latest").key, b.id);
  assert.equal(pick("owned").key, b.id);
  assert.equal(pick("original").kind, "gen", "the grid's own beacon came first");
  doc.prefs.favorites[pt] = a.id;
  assert.equal(pick("favorite").key, a.id);
  doc.prefs.favorites = {};
  assert.equal(pick("favorite").key, b.id, "no favorite: the latest");
  const days = new Set();
  for (let d = 20000; d < 20030; d++) days.add(pick("random", d).key);
  assert.ok(days.size >= 2, "random rotates by day");
  assert.equal(pick("random", 20001).key, pick("random", 20001).key, "same day, same song");
  assert.throws(() => { for (let i = 0; i < 30; i++) D.plantSong(doc, AUSTIN, song); }, /20 songs/);
});

test("custom maps: free placement, blend by name, exclusive silences the rest", () => {
  const doc = fresh();
  const g = D.makeGrid(doc, AUSTIN, 1000);
  doc.grids.push(g);
  const m = D.makeMap(doc, "Lakeside walk");
  doc.maps.push(m);
  const spot = { lat: AUSTIN.lat + 0.00123, lon: AUSTIN.lon - 0.00071 };
  const b = D.addMapBeacon(m, spot, { rangeM: 800 });
  assert.equal(b.lat, spot.lat, "no lattice");
  let L = D.userLayer(poolWith(doc), spot);
  let sh = D.layerShares(L);
  assert.equal(sh.status[0].name, "Lakeside walk");
  assert.match(D.statusLine(sh), /^Lakeside walk 100%$/);
  const between = { lat: spot.lat + 400 / D.M_PER_DEG, lon: spot.lon };
  sh = D.layerShares(D.userLayer(poolWith(doc), between));
  assert.deepEqual(sh.status.map((x) => x.name).sort(), ["Lakeside walk", "User"]);
  m.exclusive = true;
  const pool = poolWith(doc);
  assert.equal(pool.exclusive.length, 1);
  assert.ok(pool.playing.every((e) => e.source.id === m.id));
  const away = { lat: spot.lat + 0.1, lon: spot.lon };
  L = D.userLayer(pool, away);
  sh = D.layerShares(L, pool.exclusive);
  assert.equal(sh.globeShare, 0);
  assert.equal(D.statusLine(sh, pool.exclusive.map((x) => x.name)), "Lakeside walk (exclusive) · outside");
  assert.equal(D.placeProblem({ lat: 51.5, lon: 0 }) !== null, true);
});

test("format: validate, normalize, duplicate, merge (import) without overwriting", () => {
  const doc = fresh();
  const g = D.makeGrid(doc, AUSTIN, 2000);
  doc.grids.push(g);
  const m = D.makeMap(doc, "Route");
  D.addMapBeacon(m, AUSTIN);
  doc.maps.push(m);
  const song = D.buildPool(doc).playing[0].song();
  D.plantSong(doc, AUSTIN, song);
  const text = JSON.stringify(doc);
  const back = JSON.parse(text);
  assert.deepEqual(D.validateDoc(back), []);
  assert.equal(D.validateDoc({ format: "nope" }).length, 1);
  const before = D.buildPool(doc).playing.map((e) => e.song().title);
  const copy = D.duplicate(doc, m);
  assert.notEqual(copy.id, m.id);
  assert.equal(D.buildPool({ ...doc, maps: [copy], grids: [], plants: [] }).playing[0].song().title, D.buildPool({ ...doc, grids: [], plants: [] }).playing[0].song().title, "a copied map keeps its songs");
  const target = fresh();
  const n = D.mergeDoc(target, back);
  assert.deepEqual(n, { grids: 1, maps: 1, plants: 1 });
  D.mergeDoc(target, back);
  assert.equal(target.grids.length, 2);
  assert.equal(new Set(target.grids.map((x) => x.id)).size, 2);
  assert.deepEqual(D.buildPool(D.normalizeDoc(back)).playing.map((e) => e.song().title), before);
  for (const e of D.buildPool(target).playing.slice(0, 20)) assert.deepEqual(validateSong(e.song()), []);
});

test("grid size is chosen apart from spacing", () => {
  assert.equal(D.halfFor(10, 500), 10); // 21 x 21, the old size
  assert.equal(D.halfFor(1, 100), 5);
  assert.equal(D.halfFor(100, 5000), 10);
  assert.equal(D.halfFor(1, 2000), 0); // spacing wider than the grid
  assert.equal(D.halfFor(100, 100), 0); // too many beacons
  const doc = fresh();
  const g = D.makeGrid(doc, AUSTIN, 200, { half: 25 });
  assert.equal(D.gridPoints(g.center, 200, D.halfOf(g)).length, 51 * 51);
  assert.equal(D.gridStats(g).beacons, 2601);
  assert.equal(D.gridStats(g).sideKm, 10);
  assert.ok(D.inGrid(g, { lat: AUSTIN.lat + 0.04, lon: AUSTIN.lon }));
  assert.ok(!D.inGrid(g, { lat: AUSTIN.lat + 0.06, lon: AUSTIN.lon }));
  doc.grids.push(g);
  const e = D.poolEntries(doc).filter((x) => x.source.id === g.id);
  assert.equal(e.length, 2601);
  assert.deepEqual([e[0].north, e[0].east, e[2600].north, e[2600].east], [25, -25, -25, 25]);
  // Grids from before sizes keep 21 x 21.
  const old = { ...g };
  delete old.half;
  assert.equal(D.gridStats(old).beacons, 441);
});
