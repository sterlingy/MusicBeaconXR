// Sharing your beacons (beacon database, step 3): turns drafts into rows on
// the server and back. No DOM; `rest(method, path, body)` is Auth.rest (or a
// fake in tests). The server re-checks everything (owner, tiles,
// limits; see supabase/migrations/0002_submit.sql).
//
// After a grid, planted song or map is shared, its draft keeps the server id
// as `sharedId`: the device plays its own copy, and the shared map leaves
// that one out so it doesn't play twice.

import { mapSeed, parsePoint } from "./drafts.js";
import { tilesForGrid, tileOfPoint } from "./shared.js";

/** The terms people accept before their first share (stored with the consent). */
export const TERMS_VERSION = "2026-11-26 CC BY 4.0";
export const TERMS_TEXT = [
  "Songs you share are published under Creative Commons Attribution 4.0 (CC BY 4.0): anyone may play, copy and remix them, with credit.",
  "A shared beacon shows a place: generated grids and planted songs are made where you stand, so sharing one shows that you were there. The date is kept, rounded to the day; your name and account are never shown with it.",
  "Anyone can report a beacon; after reports from 3 people it's hidden until it's reviewed.",
  "You can unshare anything you shared, or delete your account and everything you shared, at any time.",
];
export const REPORT_REASONS = ["offensive", "spam", "unsafe place", "private place", "other"];

/** True once this person has accepted the terms. */
export async function hasConsent(rest) {
  const rows = await rest("GET", "consents?select=terms");
  return rows.length > 0;
}

export async function acceptTerms(rest) {
  await rest("POST", "consents", { terms: TERMS_VERSION }, { prefer: "return=minimal" });
}

async function uploadSong(rest, body) {
  const [row] = await rest("POST", "songs?select=id", { body });
  return row.id;
}

/** Shares a generated grid (its edited songs go up first). Returns the server id and sets grid.sharedId. */
export async function shareGrid(rest, grid) {
  const edited = {};
  for (const [pt, song] of Object.entries(grid.edited || {})) edited[pt] = await uploadSong(rest, song);
  const [row] = await rest("POST", "grids?select=id", {
    center: grid.center, spacing_m: grid.spacingM, variant: grid.variant || 0, variants: grid.variants || {}, edited, tiles: tilesForGrid(grid), half: grid.half ?? 10,
  });
  grid.sharedId = row.id;
  return row.id;
}

/** Shares a planted song. Returns the server id and sets plant.sharedId. */
export async function sharePlant(rest, plant) {
  const songId = await uploadSong(rest, plant.song);
  const [row] = await rest("POST", "plants?select=id", { point: plant.point, tile: tileOfPoint(plant.point), range_m: plant.rangeM, song_id: songId });
  plant.sharedId = row.id;
  return row.id;
}

/** Shares a custom map (publicly listed). Returns the server id and sets map.sharedId. */
export async function shareMap(rest, map) {
  if (!map.beacons.length) throw new Error("put at least one beacon on the map first");
  const beacons = [];
  for (const b of map.beacons) {
    const out = { id: b.id, lat: b.lat, lon: b.lon, range_m: b.rangeM };
    if (b.song) out.song_id = await uploadSong(rest, b.song);
    else out.seed = mapSeed(b);
    beacons.push(out);
  }
  const [row] = await rest("POST", "maps?select=id", { name: map.name, exclusive: !!map.exclusive, beacons });
  map.sharedId = row.id;
  return row.id;
}

/** Takes a shared grid, planted song or map off the server ("grids", "plants" or "maps"). */
export async function unshare(rest, table, item) {
  if (!item.sharedId) return;
  await rest("DELETE", `${table}?id=eq.${encodeURIComponent(item.sharedId)}`, undefined, { prefer: "return=minimal" });
  delete item.sharedId;
}

/** The server's name for a shared beacon (what favorites and reports point at). */
export function sharedBeaconKey(entry) {
  return entry.kind === "plant" ? entry.sharedId : `${entry.sharedId}/${entry.point}`;
}

export async function report(rest, entry, reason, note = "") {
  const table = entry.kind === "plant" ? "plants" : "grids";
  await rest("POST", "reports", { target_kind: table, target_id: entry.sharedId, reason, note: note.slice(0, 300) || null }, { prefer: "return=minimal" });
}

/** Saves (or clears, with entry null) this person's favorite at a spot on the server. */
export async function setFavorite(rest, point, entry) {
  if (!entry) return rest("DELETE", `favorites?point=eq.${encodeURIComponent(point)}`, undefined, { prefer: "return=minimal" });
  return rest("POST", "favorites?on_conflict=user_id,point", { point, beacon: sharedBeaconKey(entry) }, { prefer: "resolution=merge-duplicates,return=minimal" });
}

/** How many people favorited each shared beacon: {key: n}. `get(path)` reads without signing in. */
export async function favoriteCounts(get, keys) {
  if (!keys.length) return {};
  const list = keys.map((k) => `"${k.replace(/"/g, "")}"`).join(",");
  const rows = await get(`favorite_counts?select=beacon,n&beacon=in.(${encodeURIComponent(list)})`);
  return Object.fromEntries(rows.map((r) => [r.beacon, r.n]));
}

/** Public maps whose beacons are in the given tiles. `get(path)` reads without signing in. */
export async function findMaps(get, tiles) {
  const t = encodeURIComponent(`{${tiles.join(",")}}`);
  return get(`maps?select=id,name,exclusive,beacons,created_at&status=eq.live&tiles=ov.${t}&order=created_at.desc&limit=50`);
}

/**
 * A public map as a map of your own (a copy you can turn on, off or make
 * exclusive). Songs are fetched by `song(id)`.
 */
export async function mapFromRow(row, song, number, tint) {
  const beacons = [];
  for (const b of row.beacons) {
    const out = { id: `mb-${b.id}`, lat: b.lat, lon: b.lon, rangeM: b.range_m, createdAt: Date.parse(row.created_at) || 0, variant: 0 };
    if (b.song_id) { const s = await song(b.song_id); if (!s) continue; out.song = s; } else out.seed = b.seed;
    beacons.push(out);
  }
  return { id: `map-shared-${row.id}`, name: row.name, number, tint, createdAt: Date.parse(row.created_at) || 0, on: true, exclusive: !!row.exclusive, beacons, copiedFrom: row.id };
}

/** Deletes this person's account and everything they shared, favorited and reported. */
export async function deleteAccount(rest) {
  await rest("POST", "rpc/delete_my_account", {}, { prefer: "return=minimal" });
}

/** Where a draft is, for checks before sharing. */
export function itemPlace(item) {
  if (item.center) return parsePoint(item.center);
  if (item.point) return parsePoint(item.point);
  return item.beacons?.[0] || null;
}
