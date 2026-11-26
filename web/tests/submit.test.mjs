// Sharing (step 3 of docs/beacon-database-plan.md): node --test web/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import * as D from "../src/drafts.js";
import { generateSong } from "../src/song.js";
import { Auth, friendly } from "../src/auth.js";
import * as S from "../src/submit.js";

const AUSTIN = { lat: 30.2672, lon: -97.7431 };

/** A fake REST API that records calls and hands out ids. */
function fakeRest() {
  const calls = [];
  let n = 0;
  const rest = async (method, path, body, opts) => {
    calls.push({ method, path, body, opts });
    if (method === "GET" && path.startsWith("consents")) return calls.some((c) => c.path === "consents" && c.method === "POST") ? [{ terms: S.TERMS_VERSION }] : [];
    if (method === "POST" && /\?select=id/.test(path)) return [{ id: `id-${++n}` }];
    return null;
  };
  return { rest, calls };
}

test("sharing a grid uploads its edited songs first, then the grid with its tiles", async () => {
  const { rest, calls } = fakeRest();
  const doc = D.normalizeDoc(D.emptyDoc());
  const g = D.makeGrid(doc, AUSTIN, 1000);
  const pt = D.gridPoints(g.center, 1000)[3].id;
  g.edited[pt] = generateSong("edited");
  D.regenerateOne(g, D.gridPoints(g.center, 1000)[4].id);
  assert.equal(await S.hasConsent(rest), false);
  await S.acceptTerms(rest);
  assert.equal(await S.hasConsent(rest), true);
  const id = await S.shareGrid(rest, g);
  assert.equal(g.sharedId, id);
  const [song, grid] = calls.filter((c) => c.method === "POST" && c.path !== "consents");
  assert.match(song.path, /^songs/);
  assert.match(grid.path, /^grids/);
  assert.deepEqual(grid.body.edited, { [pt]: "id-1" });
  assert.equal(grid.body.spacing_m, 1000);
  assert.deepEqual(grid.body.tiles, ["30_-98"]);
  assert.equal(Object.keys(grid.body.variants).length, 1);
  assert.equal("owner" in grid.body, false, "the server sets the owner");
  await S.unshare(rest, "grids", g);
  assert.equal(g.sharedId, undefined);
  assert.match(calls.at(-1).path, /^grids\?id=eq\.id-2$/);
});

test("planted songs and maps: songs go up as songs, generated map beacons as seeds", async () => {
  const { rest, calls } = fakeRest();
  const doc = D.normalizeDoc(D.emptyDoc());
  const p = D.plantSong(doc, AUSTIN, generateSong("plant"), 700);
  await S.sharePlant(rest, p);
  const plantCall = calls.find((c) => c.path.startsWith("plants"));
  assert.equal(plantCall.body.tile, "30_-98");
  assert.equal(plantCall.body.range_m, 700);
  assert.equal(plantCall.body.song_id, "id-1");
  const m = D.makeMap(doc, "Lakeside walk");
  await assert.rejects(S.shareMap(rest, m), /at least one beacon/);
  const b1 = D.addMapBeacon(m, { lat: 30.31, lon: -97.76 });
  D.addMapBeacon(m, { lat: 30.32, lon: -97.75 }, { song: generateSong("map song") });
  await S.shareMap(rest, m);
  const mapCall = calls.find((c) => c.path.startsWith("maps"));
  assert.equal(mapCall.body.beacons[0].seed, D.mapSeed(b1));
  assert.ok(mapCall.body.beacons[1].song_id);
  // Someone else adds the public map: same songs.
  const copy = await S.mapFromRow({ id: "m1", name: "Lakeside walk", exclusive: false, created_at: "2026-11-26T00:00:00Z", beacons: mapCall.body.beacons }, async () => generateSong("map song"), 7, "#fff");
  const a = D.buildPool({ ...D.normalizeDoc(D.emptyDoc()), maps: [m] }).playing.map((e) => e.song().title).sort();
  const b = D.buildPool({ ...D.normalizeDoc(D.emptyDoc()), maps: [copy] }).playing.map((e) => e.song().title).sort();
  assert.deepEqual(a, b);
});

test("favorites and reports name the shared beacon, never the person", async () => {
  const { rest, calls } = fakeRest();
  const plant = { kind: "plant", sharedId: "p1", point: "g30_1_2" };
  const gen = { kind: "gen", sharedId: "g1", point: "g30_1_2" };
  assert.equal(S.sharedBeaconKey(plant), "p1");
  assert.equal(S.sharedBeaconKey(gen), "g1/g30_1_2");
  await S.setFavorite(rest, "g30_1_2", gen);
  assert.deepEqual(calls.at(-1).body, { point: "g30_1_2", beacon: "g1/g30_1_2" });
  assert.match(calls.at(-1).opts.prefer, /merge-duplicates/);
  await S.setFavorite(rest, "g30_1_2", null);
  assert.equal(calls.at(-1).method, "DELETE");
  await S.report(rest, plant, "spam");
  assert.deepEqual(calls.at(-1).body, { target_kind: "plants", target_id: "p1", reason: "spam", note: null });
  const counts = await S.favoriteCounts(async (path) => { assert.match(path, /beacon=in\./); return [{ beacon: "p1", n: 4 }]; }, ["p1", "g1/g30_1_2"]);
  assert.deepEqual(counts, { p1: 4 });
});

test("sign-in: code, link, refresh, sign-out; tokens go with REST calls", async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const seen = [];
  const fetchFn = async (url, o = {}) => {
    seen.push([url, o]);
    const json = (d, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => d, text: async () => JSON.stringify(d) });
    if (url.endsWith("/auth/v1/verify")) return JSON.parse(o.body).token === "123456" ? json({ access_token: "A1", refresh_token: "R1", expires_in: 3600, user: { id: "u1", email: "a@b.c" } }) : json({ msg: "Token has expired or is invalid" }, false);
    if (url.includes("/auth/v1/otp")) return json({});
    if (url.includes("grant_type=refresh_token")) return json({ access_token: "A2", refresh_token: "R2", expires_in: 3600, user: { id: "u1", email: "a@b.c" } });
    if (url.endsWith("/auth/v1/user")) return json({ id: "u9", email: "link@b.c" });
    if (url.includes("/rest/v1/")) return json([{ id: "x" }]);
    return json({});
  };
  const auth = new Auth({ url: "https://x", key: "pk", fetchFn, storage });
  await auth.sendEmail(" a@b.c ", "http://127.0.0.1:8765/");
  assert.match(seen[0][0], /otp\?redirect_to=http%3A%2F%2F127\.0\.0\.1%3A8765%2F/);
  await assert.rejects(auth.verifyCode("a@b.c", "000000"), /invalid/);
  await auth.verifyCode("a@b.c", "123 456");
  assert.equal(auth.user.id, "u1");
  await auth.rest("GET", "consents?select=terms");
  assert.equal(seen.at(-1)[1].headers.Authorization, "Bearer A1");
  auth.session.expires_at = Date.now(); // about to run out
  await auth.rest("GET", "consents?select=terms");
  assert.equal(seen.at(-1)[1].headers.Authorization, "Bearer A2");
  const again = new Auth({ url: "https://x", key: "pk", fetchFn, storage });
  assert.equal(again.user.email, "a@b.c", "remembered in this browser");
  await again.signOut();
  assert.equal(new Auth({ url: "https://x", key: "pk", fetchFn, storage }).user, null);
  // The email's link.
  const replaced = [];
  const user = await again.fromUrl({ hash: "#access_token=L1&refresh_token=LR&expires_in=3600&type=magiclink", pathname: "/", search: "" }, { replaceState: (...a) => replaced.push(a) });
  assert.equal(user.email, "link@b.c");
  assert.equal(replaced.length, 1, "tokens cleared from the address");
  assert.match(friendly("daily limit reached: 5 grids a day"), /today's limit/);
});
