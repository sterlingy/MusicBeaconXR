// Trails and walk recordings, with no DOM and no audio.
//
// - Trail: where the listener has been, as a light polyline (kept on this
//   device only: a trail shows where you went). Each point remembers the
//   mood of the loudest song there, so the line is coloured by what you heard.
// - Walk recording ("beacon-walk" version 1): everything needed to play a
//   walk again with the same music, a few kilobytes a minute:
//     * the path, with times (seconds from the start),
//     * the blend at each moment (which beacons, at what weight),
//     * a snapshot of every song heard, and each beacon's label and place,
//     * the music clock: when the walk started (every song runs on a shared
//       clock, so a replay sets the clock back to then),
//     * the blend settings.
//   Replaying uses the recorded blend, so it sounds the same whatever has
//   changed on the map since; editing a song in the recording changes the
//   replay. The instruments are whatever the player has at replay time.
//
// Plus a WAV encoder for exporting captured audio.

export const WALK_FORMAT = "beacon-walk";
export const WALK_VERSION = 1;
/** A new sample at least this often while the blend is changing, and at most every SAMPLE_MAX_S when it isn't. */
export const SAMPLE_MIN_S = 0.25, SAMPLE_MAX_S = 2;
/** Most points a trail keeps (older ones drop off). */
export const TRAIL_MAX = 6000;

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r7 = (v) => Math.round(v * 1e7) / 1e7;
const posOf = (p) => ("lat" in p ? { lat: r7(p.lat), lon: r7(p.lon) } : { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });

/** Distance between two positions in meters (flat {x, y} or {lat, lon}). */
export function moved(a, b) {
  if (!a || !b) return Infinity;
  if ("x" in a) return Math.hypot(a.x - b.x, a.y - b.y);
  const dLat = (b.lat - a.lat) * 111195, dLon = ((((b.lon - a.lon) % 360) + 540) % 360 - 180) * 111195 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

// ---------------------------------------------------------------- trail

export class Trail {
  constructor(points = []) { this.points = points; }

  /**
   * Adds the listener's position if it moved far enough: `minM` meters
   * (a jump further than `jumpM` starts a new stretch, so no line is drawn
   * across it). `mood` is the loudest song's mood there.
   */
  add(pos, mood, t, { minM = 3, jumpM = 5000, jumped = false } = {}) {
    const last = this.points[this.points.length - 1];
    const d = moved(last?.p, pos);
    if (last && d < minM) return false;
    // A jump (beyond a GPS fix's few meters) or a leap too long to walk breaks the line.
    this.points.push({ p: posOf(pos), m: mood || "", t: Math.round(t), b: !!last && (d > jumpM || (jumped && d > 4 * minM)) });
    if (this.points.length > TRAIL_MAX) this.points.splice(0, this.points.length - TRAIL_MAX);
    return true;
  }

  clear() { this.points = []; }

  /** Stretches of points to draw, split at jumps: [[point, ...], ...]. */
  stretches() {
    const out = [];
    let cur = [];
    for (const pt of this.points) {
      if (pt.b && cur.length) { out.push(cur); cur = []; }
      cur.push(pt);
    }
    if (cur.length) out.push(cur);
    return out;
  }

  /**
   * What to draw: walked stretches and, between them, the gaps jumps left
   * ({pts: [from, to], jump: true}, drawn dotted).
   */
  pieces() {
    const out = [];
    let cur = [];
    for (const pt of this.points) {
      if (pt.b && cur.length) { out.push({ pts: cur, jump: false }, { pts: [cur[cur.length - 1], pt], jump: true }); cur = []; }
      cur.push(pt);
    }
    if (cur.length) out.push({ pts: cur, jump: false });
    return out;
  }

  /** Total length in meters. */
  length() {
    let m = 0;
    for (let i = 1; i < this.points.length; i++) if (!this.points[i].b) m += moved(this.points[i - 1].p, this.points[i].p);
    return m;
  }
}

// ---------------------------------------------------------------- recording

/** The field a recording was made on, enough to describe it (not to rebuild it). */
function fieldInfo(field) {
  if (field.kind === "local") return { kind: "local", center: field.center, sizeKm: field.sizeKm, spacingKm: field.spacingKm };
  if (field.kind === "globe") return { kind: "globe", step: field.step };
  return { kind: field.kind, n: field.n, spacing: field.spacing };
}

export class WalkRecorder {
  /** `wallStart`: the music clock (seconds since 1970) when recording starts. */
  constructor({ field, wallStart, settings = {}, name = "" }) {
    this.rec = {
      format: WALK_FORMAT, version: WALK_VERSION, name, createdAt: Math.round(wallStart * 1000),
      field: fieldInfo(field), wallStart, settings, duration: 0,
      samples: [], songs: {}, beacons: {},
    };
    this._lastSample = null;
  }

  /**
   * Records the moment `t` seconds into the walk: the listener's position
   * and the blend (engine.active: [{id, w, d, beacon, song}]). Skips
   * moments that add nothing.
   */
  sample(t, pos, active) {
    const rec = this.rec;
    const blend = active.filter((a) => a.w > 1e-4).map((a) => [a.id, r4(a.w)]);
    const last = this._lastSample;
    if (last) {
      const dt = t - last.t;
      const same = blend.length === last.a.length && blend.every(([id, w], i) => last.a[i][0] === id && Math.abs(last.a[i][1] - w) < 0.002);
      if (dt < SAMPLE_MIN_S || (same && dt < SAMPLE_MAX_S)) { rec.duration = Math.max(rec.duration, t); return false; }
    }
    for (const a of active) {
      if (a.w <= 1e-4) continue;
      if (!rec.songs[a.id]) rec.songs[a.id] = JSON.parse(JSON.stringify(a.song));
      if (!rec.beacons[a.id]) rec.beacons[a.id] = { label: a.beacon.label, pos: posOf(a.beacon.pos) };
    }
    const s = { t: Math.round(t * 1000) / 1000, p: posOf(pos), a: blend };
    rec.samples.push(s);
    rec.duration = Math.max(rec.duration, s.t);
    this._lastSample = s;
    return true;
  }

  /** Ends the recording at `t` seconds; returns it. */
  finish(t) {
    this.rec.duration = Math.max(this.rec.duration, Math.round(t * 1000) / 1000);
    const last = this.rec.samples[this.rec.samples.length - 1];
    if (last && last.t < this.rec.duration) this.rec.samples.push({ ...last, t: this.rec.duration });
    return this.rec;
  }
}

/** Checks a recording (stored or imported); returns a list of problems. */
export function validateWalk(rec) {
  if (!rec || rec.format !== WALK_FORMAT) return ["not a walk recording"];
  const errs = [];
  if (rec.version !== WALK_VERSION) errs.push(`version ${rec.version} isn't supported`);
  if (!Array.isArray(rec.samples) || rec.samples.length < 1) errs.push("no samples");
  if (!Number.isFinite(rec.wallStart)) errs.push("no clock");
  for (const s of rec.samples || []) for (const [id] of s.a || []) if (!rec.songs?.[id]) { errs.push(`no song for ${id}`); return errs; }
  return errs;
}

/**
 * The walk at `t` seconds: the listener's position and the blend, both
 * interpolated between samples (so the music glides as it did).
 * Returns {pos, active: [{id, w}]}.
 */
export function frameAt(rec, t) {
  const S = rec.samples;
  if (!S.length) return { pos: null, active: [] };
  if (t <= S[0].t) return { pos: S[0].p, active: S[0].a.map(([id, w]) => ({ id, w })) };
  if (t >= S[S.length - 1].t) { const l = S[S.length - 1]; return { pos: l.p, active: l.a.map(([id, w]) => ({ id, w })) }; }
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S[mid].t <= t) lo = mid; else hi = mid; }
  const a = S[lo], b = S[hi], k = (t - a.t) / Math.max(1e-9, b.t - a.t);
  const ws = new Map();
  for (const [id, w] of a.a) ws.set(id, w * (1 - k));
  for (const [id, w] of b.a) ws.set(id, (ws.get(id) || 0) + w * k);
  let pos;
  if ("x" in a.p) pos = { x: a.p.x + (b.p.x - a.p.x) * k, y: a.p.y + (b.p.y - a.p.y) * k };
  else pos = { lat: a.p.lat + (b.p.lat - a.p.lat) * k, lon: a.p.lon + ((((b.p.lon - a.p.lon) % 360) + 540) % 360 - 180) * k };
  const active = [...ws].filter(([, w]) => w > 1e-5).map(([id, w]) => ({ id, w })).sort((x, y) => y.w - x.w);
  return { pos, active };
}

/** The recording's path as trail points (for drawing it). */
export function walkTrail(rec) {
  const pts = [];
  for (const s of rec.samples) {
    const top = s.a[0]?.[0];
    pts.push({ p: s.p, m: top ? rec.songs[top]?.mood || "" : "", t: rec.createdAt + s.t * 1000, b: false });
  }
  return new Trail(pts);
}

/** A copy cut down to the part from `from` to `to` seconds (times start again at 0, and the clock moves with them). */
export function trimWalk(rec, from, to) {
  const out = JSON.parse(JSON.stringify(rec));
  const first = frameAt(rec, from), last = frameAt(rec, to);
  const mid = rec.samples.filter((s) => s.t > from && s.t < to);
  const toS = (t, f) => ({ t: Math.round((t - from) * 1000) / 1000, p: f.pos, a: f.active.map((x) => [x.id, r4(x.w)]) });
  out.samples = [toS(from, first), ...mid.map((s) => ({ ...s, t: Math.round((s.t - from) * 1000) / 1000 })), toS(to, last)];
  out.wallStart = rec.wallStart + from;
  out.duration = Math.round((to - from) * 1000) / 1000;
  const used = new Set(out.samples.flatMap((s) => s.a.map(([id]) => id)));
  for (const k of Object.keys(out.songs)) if (!used.has(k)) { delete out.songs[k]; delete out.beacons[k]; }
  return out;
}

// ---------------------------------------------------------------- audio files

/** 16-bit PCM WAV from channel data ([Float32Array per channel]). */
export function encodeWav(channels, sampleRate) {
  const n = channels[0].length, ch = channels.length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + n * ch * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return buf;
}

/** Joins captured chunks ([[Float32Array per channel], ...]) into one array per channel. */
export function joinChunks(chunks, channels = 2) {
  const n = chunks.reduce((s, c) => s + c[0].length, 0);
  const out = Array.from({ length: channels }, () => new Float32Array(n));
  let o = 0;
  for (const c of chunks) {
    for (let k = 0; k < channels; k++) out[k].set(c[Math.min(k, c.length - 1)], o);
    o += c[0].length;
  }
  return out;
}

/** "3:07" */
export const clockText = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
