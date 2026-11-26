// The shared map (beacon database, step 2): beacons other people submitted,
// read in 1 degree tiles as you travel and cached on the device. No DOM: the
// fetcher and the cache are passed in, so tests can use fakes and the app
// (scripts/beacon/shared_map.gd) follows the same rules.
//
// A tile is "<floor lat>_<floor lon>". Around the listener the 3 x 3 tiles
// are kept loaded (a beacon reaches at most 10 km, and every grid is listed
// in each tile it touches). A tile fetched within the last hour is fresh;
// older ones are still used while a new copy loads; offline, whatever is
// cached plays, and anything missing falls back to the global layer.
//
// What comes back is shaped like a "beacon-drafts" document (grids and
// plants), so the same pool code plays it (drafts.js buildPool).

import { gridOutline, parsePoint } from "./drafts.js";

export const FRESH_MS = 60 * 60 * 1000;
/** Most songs kept in memory; older ones are dropped (they stay in the device cache). */
const SONG_MEMORY = 400;

const wrap180 = (d) => ((((d % 360) + 540) % 360) - 180);
export const tileKey = (lat, lon) => `${Math.floor(lat)}_${Math.floor(wrap180(lon))}`;

/** The 3 x 3 tiles around a position. */
export function tilesAround(p) {
  const out = [];
  const la = Math.floor(p.lat), lo = Math.floor(wrap180(p.lon));
  for (let a = la - 1; a <= la + 1; a++) {
    if (a < -90 || a > 89) continue;
    for (let b = lo - 1; b <= lo + 1; b++) out.push(`${a}_${wrap180(b + 0.5) - 0.5}`);
  }
  return out;
}

/** Every tile a grid's outline touches (1 to 4 for grids up to 100 km, up to 9 near the poles' longitude squeeze). */
export function tilesForGrid(grid) {
  const corners = gridOutline(grid);
  const lats = corners.map((c) => c.lat), lons = corners.map((c) => wrap180(c.lon));
  const out = new Set();
  const lon0 = Math.min(...lons), lon1 = Math.max(...lons);
  const span = lon1 - lon0 > 180 ? [[lon1, 180], [-180, lon0]] : [[lon0, lon1]];
  for (let a = Math.floor(Math.min(...lats)); a <= Math.floor(Math.max(...lats)); a++) {
    for (const [l0, l1] of span) for (let b = Math.floor(l0); b <= Math.floor(Math.min(l1, 179.999999)); b++) out.add(`${a}_${b}`);
  }
  return [...out].sort();
}

/** The tile of a lattice point. */
export function tileOfPoint(pointId) {
  const p = parsePoint(pointId);
  return tileKey(p.lat, p.lon);
}

/**
 * Turns fetched rows into a beacon-drafts-shaped document. Grids and plants
 * keep their server id as `sharedId`; ids get an "s-" prefix so they never
 * clash with the device's own drafts.
 */
export function rowsToDoc(tiles) {
  const grids = new Map(), plants = new Map();
  for (const t of tiles) {
    for (const r of t.grids || []) {
      if (grids.has(r.id)) continue;
      grids.set(r.id, {
        id: `s-${r.id}`, sharedId: r.id, name: "Shared", shared: true, tint: "#9aa7b8",
        spacingM: r.spacing_m, center: r.center, variant: r.variant || 0, variants: r.variants || {},
        editedRefs: r.edited || {}, edited: {}, createdAt: Date.parse(r.created_at) || 0, on: true,
      });
    }
    for (const r of t.plants || []) {
      if (plants.has(r.id)) continue;
      plants.set(r.id, { id: `s-${r.id}`, sharedId: r.id, shared: true, point: r.point, rangeM: r.range_m, songId: r.song_id, createdAt: Date.parse(r.created_at) || 0 });
    }
  }
  return { grids: [...grids.values()], plants: [...plants.values()] };
}

/**
 * Fetches tiles and songs from the Supabase project's REST API with the
 * public (publishable) key. Only live rows are readable, and never who made them.
 */
export function supabaseFetcher({ url, key, fetchFn = globalThis.fetch }) {
  const get = async (path) => {
    const res = await fetchFn(`${url}/rest/v1/${path}`, { headers: { apikey: key, Accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`.trim());
    return res.json();
  };
  return {
    async tile(k) {
      const enc = encodeURIComponent;
      const [grids, plants] = await Promise.all([
        get(`grids?select=id,center,spacing_m,variant,variants,edited,created_at&status=eq.live&tiles=cs.${enc(`{${k}}`)}`),
        get(`plants?select=id,point,range_m,song_id,created_at&status=eq.live&tile=eq.${enc(k)}`),
      ]);
      return { grids, plants };
    },
    async song(id) {
      const rows = await get(`songs?select=body&status=eq.live&id=eq.${encodeURIComponent(id)}`);
      return rows[0]?.body || null;
    },
  };
}

/** A cache that forgets everything (tests, or when the device won't store). */
export function memoryCache() {
  const t = new Map(), s = new Map();
  return {
    async getTile(k) { return t.get(k) || null; },
    async putTile(k, v) { t.set(k, v); },
    async getSong(id) { return s.get(id) || null; },
    async putSong(id, v) { s.set(id, v); },
  };
}

export class SharedMap {
  /** `fetcher`: {tile(key), song(id)}; `cache`: {getTile, putTile, getSong, putSong}. */
  constructor({ fetcher, cache = memoryCache(), now = () => Date.now() }) {
    this.fetcher = fetcher;
    this.cache = cache;
    this.now = now;
    this.tiles = new Map(); // key -> {at, grids, plants}
    this.songs = new Map(); // song id -> body
    this.loading = new Set();
    this.songLoading = new Set();
    this.offline = false;
    this.lastError = "";
    this.rev = 0; // goes up whenever what's playable changes
    this._doc = null;
    this._wanted = [];
  }

  /**
   * Makes sure the tiles around `pos` are loaded (cache first, then the
   * server if stale). Resolves to true when anything changed.
   */
  async update(pos) {
    const keys = tilesAround(pos);
    this._wanted = keys;
    let changed = false;
    await Promise.all(keys.map(async (k) => {
      if (!this.tiles.has(k)) {
        const c = await this.cache.getTile(k).catch(() => null);
        if (c && !this.tiles.has(k)) { this.tiles.set(k, c); changed = true; }
      }
      const t = this.tiles.get(k);
      if ((t && this.now() - t.at < FRESH_MS) || this.loading.has(k)) return;
      this.loading.add(k);
      try {
        const rows = await this.fetcher.tile(k);
        const v = { at: this.now(), grids: rows.grids || [], plants: rows.plants || [] };
        this.tiles.set(k, v);
        this.cache.putTile(k, v).catch(() => {});
        this.offline = false;
        changed = true;
      } catch (err) {
        this.offline = true;
        this.lastError = String(err.message || err);
      } finally { this.loading.delete(k); }
    }));
    // Tiles far behind are dropped from memory (they stay in the cache).
    for (const k of [...this.tiles.keys()]) if (!keys.includes(k) && this.tiles.size > 36) { this.tiles.delete(k); changed = true; }
    if (changed) { this._doc = null; this.rev++; }
    return changed;
  }

  /** The loaded tiles as a beacon-drafts-shaped document {grids, plants}. */
  doc() {
    if (!this._doc) this._doc = rowsToDoc(this._wanted.map((k) => this.tiles.get(k)).filter(Boolean));
    return this._doc;
  }

  /** A song body if it's here, else null (and starts loading it). */
  song(id) {
    const s = this.songs.get(id);
    if (s) return s;
    this.want(id);
    return null;
  }

  has(id) { return this.songs.has(id); }

  async want(id) {
    if (!id || this.songs.has(id) || this.songLoading.has(id)) return;
    this.songLoading.add(id);
    try {
      let body = await this.cache.getSong(id).catch(() => null);
      if (!body) {
        body = await this.fetcher.song(id);
        if (body) this.cache.putSong(id, body).catch(() => {});
      }
      if (body) {
        this.songs.set(id, body);
        if (this.songs.size > SONG_MEMORY) this.songs.delete(this.songs.keys().next().value);
        this.rev++;
        this.onSong?.(id);
      }
    } catch (err) {
      this.offline = true;
      this.lastError = String(err.message || err);
    } finally { this.songLoading.delete(id); }
  }

  /** Counts for the panel. */
  stats() {
    const d = this.doc();
    const fresh = [...this.tiles.values()].reduce((m, t) => Math.max(m, t.at), 0);
    return { tiles: this.tiles.size, grids: d.grids.length, plants: d.plants.length, updated: fresh, offline: this.offline };
  }
}
