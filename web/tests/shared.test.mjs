// The shared map (step 2 of docs/beacon-database-plan.md): node --test web/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/drafts.js";
import { generateSong } from "../src/song.js";
import { SharedMap, tileKey, tilesAround, tilesForGrid, tileOfPoint, rowsToDoc, memoryCache, supabaseFetcher, FRESH_MS } from "../src/shared.js";

const AUSTIN = { lat: 30.2672, lon: -97.7431 };

test("tiles: keys, the 3 x 3 around you, wrapping the date line", () => {
  assert.equal(tileKey(30.27, -97.74), "30_-98");
  assert.equal(tileKey(-0.5, 0.5), "-1_0");
  assert.deepEqual(tilesAround(AUSTIN).sort(), ["29_-97", "29_-98", "29_-99", "30_-97", "30_-98", "30_-99", "31_-97", "31_-98", "31_-99"].sort());
  const dl = tilesAround({ lat: 10.5, lon: 179.7 });
  assert.ok(dl.includes("10_-180") && dl.includes("10_179") && dl.includes("10_178"));
  assert.equal(tileOfPoint(D.snapPoint(AUSTIN).id), "30_-98");
});

test("a grid is listed in every tile it touches", () => {
  const doc = D.normalizeDoc(D.emptyDoc());
  const small = D.makeGrid(doc, AUSTIN, 100);
  assert.deepEqual(tilesForGrid(small), ["30_-98"]);
  const big = D.makeGrid(doc, { lat: 30.02, lon: -97.03 }, 5000);
  const t = tilesForGrid(big);
  assert.ok(t.length >= 2 && t.length <= 4, t.join());
  assert.ok(t.includes("29_-98") && t.includes("30_-97"));
  for (const p of D.gridPoints(big.center, 5000)) assert.ok(t.includes(tileKey(p.lat, p.lon)), `beacon ${p.id} in a listed tile`);
});

function fakeServer(rows) {
  const calls = { tile: 0, song: 0 };
  let up = true;
  return {
    calls, setUp(v) { up = v; },
    fetcher: {
      async tile(k) { calls.tile++; if (!up) throw new Error("offline"); return rows.tiles[k] || { grids: [], plants: [] }; },
      async song(id) { calls.song++; if (!up) throw new Error("offline"); return rows.songs[id] || null; },
    },
  };
}

const gridRow = (center, spacing = 1000) => ({ id: "11111111-aaaa", center, spacing_m: spacing, variant: 0, variants: {}, edited: {}, created_at: "2026-11-20T10:00:00Z" });

test("SharedMap: loads, caches, uses stale tiles offline, refreshes after an hour", async () => {
  let now = 1_000_000;
  const center = D.gridCenterFor(AUSTIN, 1000);
  const srv = fakeServer({ tiles: { "30_-98": { grids: [gridRow(center)], plants: [] } }, songs: {} });
  const cache = memoryCache();
  const m = new SharedMap({ fetcher: srv.fetcher, cache, now: () => now });
  assert.equal(await m.update(AUSTIN), true);
  assert.equal(srv.calls.tile, 9);
  assert.equal(m.doc().grids.length, 1);
  assert.equal(m.doc().grids[0].id, "s-11111111-aaaa");
  assert.equal(await m.update(AUSTIN), false, "fresh: no refetch");
  assert.equal(srv.calls.tile, 9);
  // A new session on the same device, offline: the cache plays.
  srv.setUp(false);
  const m2 = new SharedMap({ fetcher: srv.fetcher, cache, now: () => now + FRESH_MS + 1 });
  await m2.update(AUSTIN);
  assert.equal(m2.offline, true);
  assert.equal(m2.doc().grids.length, 1, "stale cache still plays");
  // Back online after an hour: refetched.
  srv.setUp(true);
  now += FRESH_MS + 1;
  await m.update(AUSTIN);
  assert.equal(srv.calls.tile > 9, true);
});

test("shared beacons blend with your own, songs load only when near, owned mode prefers yours", async () => {
  const pt = D.snapPoint(AUSTIN).id;
  const song = generateSong("shared:test");
  const srv = fakeServer({
    tiles: { "30_-98": { grids: [gridRow(D.gridCenterFor(AUSTIN, 1000))], plants: [{ id: "22222222-bbbb", point: pt, range_m: 800, song_id: "song-1", created_at: "2026-11-21T10:00:00Z" }] } },
    songs: { "song-1": song },
  });
  const m = new SharedMap({ fetcher: srv.fetcher });
  await m.update(AUSTIN);
  const doc = D.normalizeDoc(D.emptyDoc());
  const shared = { doc: m.doc(), song: (id) => m.song(id), mine: new Set() };
  let pool = D.buildPool(doc, { shared, day: 20000 });
  assert.ok(pool.entries.length >= 442);
  const p = D.parsePoint(pt);
  let L = D.userLayer(pool, p);
  assert.equal(L.u, 1, "the shared grid plays here");
  assert.ok(!L.active.some((a) => a.entry.kind === "plant"), "the planted song isn't here yet");
  assert.equal(D.statusLine(D.layerShares(L)), "User 100%");
  await new Promise((r) => setTimeout(r, 0));
  await m.want("song-1");
  assert.equal(srv.calls.song, 1, "fetched once, when near");
  pool = D.buildPool(doc, { shared, day: 20000 });
  L = D.userLayer(pool, p);
  assert.equal(L.active[0].entry.kind, "plant");
  assert.equal(L.active[0].w, 1, "standing on it");
  // Your own song at the same spot: "owned" plays yours, "latest" the newest.
  D.plantSong(doc, AUSTIN, generateSong("mine"), 500, Date.parse("2026-11-01T00:00:00Z"));
  doc.prefs.playMode = "owned";
  assert.equal(D.buildPool(doc, { shared }).playing.find((e) => e.point === pt).own, true);
  doc.prefs.playMode = "latest";
  assert.equal(D.buildPool(doc, { shared }).playing.find((e) => e.point === pt).shared, true);
  // Your own submissions play as your drafts, not twice.
  const mine = { ...shared, mine: new Set(["22222222-bbbb", "11111111-aaaa"]) };
  assert.equal(D.buildPool(doc, { shared: mine }).entries.filter((e) => e.shared).length, 0);
  // Turning the shared map off.
  doc.prefs.sharedOn = false;
  assert.equal(D.buildPool(doc, { shared }).entries.filter((e) => e.shared).length, 0);
});

test("the Supabase fetcher asks for live rows by tile, without owners", async () => {
  const urls = [];
  const f = supabaseFetcher({ url: "https://x.supabase.co", key: "pk", fetchFn: async (u, o) => { urls.push([u, o.headers.apikey]); return { ok: true, json: async () => [] }; } });
  await f.tile("30_-98");
  await f.song("abc");
  assert.equal(urls.length, 3);
  for (const [u, k] of urls) { assert.equal(k, "pk"); assert.match(u, /status=eq\.live/); assert.doesNotMatch(u, /owner/); }
  assert.match(urls[0][0], /grids\?.*tiles=cs\.%7B30_-98%7D/);
  assert.match(urls[1][0], /plants\?.*tile=eq\.30_-98/);
  assert.equal(rowsToDoc([{ grids: [gridRow("g30_3366000_-9412000")] }, { grids: [gridRow("g30_3366000_-9412000")] }]).grids.length, 1, "a grid in two tiles counts once");
});
