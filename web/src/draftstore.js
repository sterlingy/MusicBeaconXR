// Keeps the user's beacon drafts (src/drafts.js) on this device: IndexedDB,
// with localStorage as a fallback (and memory when neither is allowed, as in
// some private windows). One document, saved whole; it's small (a grid is a
// few hundred bytes, a hand-made song about 15 KB).

import { emptyDoc, normalizeDoc, validateDoc } from "./drafts.js";

const DB = "music-beacon-xr", STORE = "drafts", KEY = "doc", LS_KEY = "beacon.drafts";
// Version 2 adds the shared map's cache: tiles and songs (src/shared.js).
const TILES = "tiles", SONGS = "songs";

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const name of [STORE, TILES, SONGS]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(db, mode, fn, store = STORE) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class DraftStore {
  constructor() {
    this.db = null;
    this.where = "memory"; // "indexeddb", "localstorage" or "memory": where saves go
    this._timer = null;
    this._pending = null;
  }

  /** Loads the saved document (or a new one). Never throws. */
  async load() {
    let raw = null;
    try {
      this.db = await openDb();
      raw = await idb(this.db, "readonly", (s) => s.get(KEY));
      this.where = "indexeddb";
    } catch {
      this.db = null;
      try { raw = JSON.parse(localStorage.getItem(LS_KEY) || "null"); this.where = "localstorage"; } catch { this.where = "memory"; }
    }
    if (raw && validateDoc(raw).length === 0) return normalizeDoc(raw);
    if (raw) console.warn("Saved beacon drafts couldn't be read:", validateDoc(raw));
    return normalizeDoc(emptyDoc());
  }

  /** Saves soon (changes in a burst are written once). */
  save(doc) {
    this._pending = doc;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }

  /** Writes now. Resolves to true when it reached storage that lasts. */
  async flush() {
    clearTimeout(this._timer);
    const doc = this._pending;
    this._pending = null;
    if (!doc) return true;
    const copy = JSON.parse(JSON.stringify(doc));
    if (this.db) {
      try { await idb(this.db, "readwrite", (s) => s.put(copy, KEY)); return true; } catch { /* fall through */ }
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(copy)); this.where = "localstorage"; return true; } catch { this.where = "memory"; return false; }
  }

  /**
   * The shared map's device cache (src/shared.js expects getTile, putTile,
   * getSong, putSong). Without IndexedDB it keeps nothing between visits.
   */
  tileCache() {
    const mem = { t: new Map(), s: new Map() };
    const get = (store, k, m) => this.db ? idb(this.db, "readonly", (s) => s.get(k), store).then((v) => v ?? null) : Promise.resolve(m.get(k) ?? null);
    const put = (store, k, v, m) => this.db ? idb(this.db, "readwrite", (s) => s.put(v, k), store) : Promise.resolve(void m.set(k, v));
    return {
      getTile: (k) => get(TILES, k, mem.t), putTile: (k, v) => put(TILES, k, v, mem.t),
      getSong: (id) => get(SONGS, id, mem.s), putSong: (id, v) => put(SONGS, id, v, mem.s),
    };
  }
}
