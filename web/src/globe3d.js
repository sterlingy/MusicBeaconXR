// The 3D globe: the Globe tab's beacons on a spinning, sunlit Earth you can
// turn and zoom, from the whole planet down to about a kilometre.
//
// Drawn on the page's 2D canvas with an orthographic projection (no WebGL,
// no libraries): a dark sphere lit by the real sun (the day/night line is
// where it is right now), a soft atmosphere, a starfield, the graticule, the
// lower 48 outline (where beacons can be made for now), the 614 global
// beacons glowing in their mood colours and pulsing as they sound, your own
// beacons (grouped by grid when far away), and arcs lifting off the surface
// from you to the beacons you're hearing.
//
// Drag to turn (it keeps turning a little when you let go); tap a beacon, or
// long-press / right-click anywhere, to Jump or Move there; wheel or pinch
// to zoom, tap a beacon to inspect it, double-tap anywhere to fly there. Left
// alone it spins slowly; walking, jumping or following your location brings
// the camera back to you.

import { LOWER_48 } from "./drafts.js";
import { drawLines } from "./walkui.js";

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const EARTH_KM = 6371.0088;
const MIN_ZOOM = 0.8, MAX_ZOOM = 2500;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap180 = (d) => ((((d % 360) + 540) % 360) - 180);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** A point `deg` degrees of arc from p on a bearing (for drawing directions). */
function destinationLite(p, bearing, deg) {
  const d = deg * D2R, b = bearing * D2R, la = p.lat * D2R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = p.lon * D2R + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: la2 * R2D, lon: wrap180(lo2 * R2D) };
}

/** Where the sun is overhead right now (degrees): declination and the longitude where it's noon. */
export function subsolar(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date - start) / 86400000;
  const lat = -23.44 * Math.cos((2 * Math.PI / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  return { lat, lon: wrap180(-15 * (hours - 12)) };
}

export class Globe3D {
  /**
   * `hooks`: {canvas, engine, ui, drafts() (the My beacons state or null),
   * moodColor(mood), label(text, x, y, size, color, halo, alpha, align),
   * select(id), offer({pos, label, song}, clientX, clientY) (the Jump / Move
   * card), stopTravel() -> bool (a tap while moving stops), active() -> bool}
   */
  constructor(hooks) {
    this.h = hooks;
    this.lat0 = 30;
    this.lon0 = -40;
    this.zoom = 1;
    this.mode = "spin"; // "spin" (idle), "follow" (the camera stays on you) or "free" (you turned it)
    this.vel = { lat: 0, lon: 0 };
    this.idleAt = performance.now();
    this.fly = null;
    this.pointers = new Map();
    this.drag = null;
    this.lastTap = 0;
    this.hover = null;
    this.shade = { key: "", img: null };
    this.stars = [];
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) this.stars.push({ x: rnd(), y: rnd(), r: rnd() ** 3 * 1.4 + 0.3, a: 0.25 + rnd() * 0.6, tw: rnd() * 6.28 });
    this._lastPos = null;
    this._onDown = (e) => this.down(e);
    this._onMove = (e) => this.move(e);
    this._onUp = (e) => this.up(e);
    this._onWheel = (e) => this.wheel(e);
    this._onContext = (e) => this.context(e);
    this._onLeave = () => { this.hover = null; };
  }

  // ---------------------------------------------------------------- projection

  get W() { return this.h.canvas.width; }
  get H() { return this.h.canvas.height; }
  /** Sphere radius on screen, in canvas pixels. */
  get R() { return Math.min(this.W, this.H) * 0.42 * this.zoom; }
  get cx() { return this.W / 2; }
  get cy() { return this.H / 2; }

  /** A lat/lon (and height as a share of the radius) in view space: x east, y north, z toward you. */
  toView(lat, lon, r = 1) {
    const la = lat * D2R, dl = (lon - this.lon0) * D2R, l0 = this.lat0 * D2R;
    const cl = Math.cos(la);
    return {
      x: r * cl * Math.sin(dl),
      y: r * (Math.cos(l0) * Math.sin(la) - Math.sin(l0) * cl * Math.cos(dl)),
      z: r * (Math.sin(l0) * Math.sin(la) + Math.cos(l0) * cl * Math.cos(dl)),
    };
  }

  /** Screen point for a lat/lon, or null when it's on the far side. */
  toScreen(p, r = 1) {
    const v = this.toView(p.lat, p.lon, r);
    if (v.z < 0 && (r <= 1 || v.x * v.x + v.y * v.y < 1)) return null;
    return [this.cx + this.R * v.x, this.cy - this.R * v.y];
  }

  /** The lat/lon under a screen point, or null off the globe. */
  toWorld(x, y) {
    const px = (x - this.cx) / this.R, py = (this.cy - y) / this.R;
    const rho = Math.hypot(px, py);
    if (rho > 1) return null;
    if (rho < 1e-12) return { lat: this.lat0, lon: this.lon0 };
    const c = Math.asin(rho), l0 = this.lat0 * D2R;
    const lat = Math.asin(Math.cos(c) * Math.sin(l0) + (py * Math.sin(c) * Math.cos(l0)) / rho);
    const lon = this.lon0 * D2R + Math.atan2(px * Math.sin(c), rho * Math.cos(c) * Math.cos(l0) - py * Math.sin(c) * Math.sin(l0));
    return { lat: lat * R2D, lon: wrap180(lon * R2D) };
  }

  /** Kilometres per canvas pixel at the middle of the view. */
  kmPerPx() { return EARTH_KM / this.R; }

  /** Zooms so the view is about `km` from top to bottom. */
  zoomForKm(km) { return clamp((this.H * EARTH_KM) / km / (Math.min(this.W, this.H) * 0.42), MIN_ZOOM, MAX_ZOOM); }

  // ---------------------------------------------------------------- camera

  /** Flies the camera to lat/lon (and a zoom), pulling back on long trips. */
  flyTo(lat, lon, zoom = this.zoom, ms = 1400) {
    const from = { lat: this.lat0, lon: this.lon0, zoom: this.zoom };
    const dist = Math.acos(clamp(Math.sin(from.lat * D2R) * Math.sin(lat * D2R) + Math.cos(from.lat * D2R) * Math.cos(lat * D2R) * Math.cos((lon - from.lon) * D2R), -1, 1)) * R2D;
    this.fly = { from, to: { lat, lon, zoom }, t0: performance.now(), ms: ms * (0.6 + Math.min(1, dist / 90) * 0.6), pull: Math.min(from.zoom, zoom) > 2 ? Math.min(1, dist / 20) : 0 };
    this.vel = { lat: 0, lon: 0 };
  }

  /** The listener moved by walking, a jump or GPS: the camera follows. */
  follow() { if (this.mode !== "follow") this.mode = "follow"; this.idleAt = performance.now(); }
  spin() { this.mode = "spin"; this.fly = null; }

  _step(now, dt) {
    const pos = this.h.engine.pos;
    // Keyboard walking, jumps and GPS move the listener: follow them.
    // You moved (walking, Jump, Move): the camera comes back to you. Not while a
    // followed plane carries you along, so the globe can still be turned then.
    if (this._lastPos && (Math.abs(pos.lat - this._lastPos.lat) > 1e-7 || Math.abs(pos.lon - this._lastPos.lon) > 1e-7) && !this.drag && !(this.h.flight?.() && this.mode === "free")) this.follow();
    this._lastPos = { ...pos };
    if (this.fly) {
      const t = clamp((now - this.fly.t0) / this.fly.ms, 0, 1), k = ease(t);
      const { from, to } = this.fly;
      this.lat0 = from.lat + (to.lat - from.lat) * k;
      this.lon0 = from.lon + wrap180(to.lon - from.lon) * k;
      const lz = Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * k - this.fly.pull * Math.sin(Math.PI * k) * Math.log(Math.max(2, Math.min(from.zoom, to.zoom)));
      this.zoom = clamp(Math.exp(lz), MIN_ZOOM, MAX_ZOOM);
      if (t >= 1) this.fly = null;
      return;
    }
    if (this.drag) return;
    // A flick keeps turning, slowing down.
    if (Math.abs(this.vel.lat) + Math.abs(this.vel.lon) > 1e-4) {
      this.lat0 = clamp(this.lat0 + this.vel.lat * dt, -88, 88);
      this.lon0 = wrap180(this.lon0 + this.vel.lon * dt);
      const f = Math.exp(-dt * 2.6);
      this.vel.lat *= f; this.vel.lon *= f;
      return;
    }
    if (this.mode === "free" && now - this.idleAt > 15000) this.mode = "spin";
    if (this.mode === "spin") {
      this.lon0 = wrap180(this.lon0 + (dt * 4) / Math.max(1, this.zoom));
      this.lat0 += (clamp(pos.lat, -60, 60) * 0.5 - this.lat0) * Math.min(1, dt * 0.3);
    } else if (this.mode === "follow") {
      const k = Math.min(1, dt * 3);
      this.lat0 += (clamp(pos.lat, -88, 88) - this.lat0) * k;
      this.lon0 = wrap180(this.lon0 + wrap180(pos.lon - this.lon0) * k);
    }
  }

  // ---------------------------------------------------------------- input

  attach() {
    const c = this.h.canvas;
    c.addEventListener("pointerdown", this._onDown);
    c.addEventListener("pointermove", this._onMove);
    c.addEventListener("pointerup", this._onUp);
    c.addEventListener("pointercancel", this._onUp);
    c.addEventListener("pointerleave", this._onLeave);
    c.addEventListener("wheel", this._onWheel, { passive: false });
    c.addEventListener("contextmenu", this._onContext);
    this._lastPos = null;
  }

  detach() {
    const c = this.h.canvas;
    c.removeEventListener("pointerdown", this._onDown);
    c.removeEventListener("pointermove", this._onMove);
    c.removeEventListener("pointerup", this._onUp);
    c.removeEventListener("pointercancel", this._onUp);
    c.removeEventListener("pointerleave", this._onLeave);
    c.removeEventListener("wheel", this._onWheel);
    c.removeEventListener("contextmenu", this._onContext);
    this.pointers.clear();
    this.drag = null;
  }

  _pt(e) {
    const c = this.h.canvas, r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  }

  down(e) {
    try { this.h.canvas.setPointerCapture?.(e.pointerId); } catch { /* not a live pointer */ }
    const p = this._pt(e);
    this.pointers.set(e.pointerId, p);
    this.fly = null;
    this.vel = { lat: 0, lon: 0 };
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: this.zoom, moved: true };
    } else {
      this.drag = { start: p, last: p, t: performance.now(), moved: false };
      // Holding still: the Jump / Move card for that spot.
      clearTimeout(this._hold);
      const cx = e.clientX, cy = e.clientY;
      this._hold = setTimeout(() => {
        const d = this.drag;
        if (d && !d.moved && this.pointers.size === 1) { d.pointed = true; this._offerAt(d.start, cx, cy); }
      }, 500);
    }
  }

  /** Asks the page to offer Jump / Move for the spot (or beacon) at canvas point p. */
  _offerAt(p, clientX, clientY) {
    const hit = this.pick(p[0], p[1]);
    const w = this.toWorld(hit ? hit.x : p[0], hit ? hit.y : p[1]);
    if (w) this.h.offer?.({ pos: { lat: w.lat, lon: w.lon }, label: hit?.label || null, song: hit?.song || null }, clientX, clientY);
  }

  move(e) {
    const p = this._pt(e);
    if (!this.pointers.has(e.pointerId)) { this.hover = p; return; }
    this.pointers.set(e.pointerId, p);
    const d = this.drag;
    if (!d) return;
    if (d.pinch !== undefined && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.zoom = clamp((d.zoom * Math.hypot(a[0] - b[0], a[1] - b[1])) / Math.max(1, d.pinch), MIN_ZOOM, MAX_ZOOM);
      return;
    }
    const dx = p[0] - d.last[0], dy = p[1] - d.last[1];
    if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) > 6 * (this.h.ui.dpr || 1)) { d.moved = true; clearTimeout(this._hold); }
    if (!d.moved) return;
    this.mode = "free";
    const k = R2D / this.R;
    const dLat = dy * k, dLon = (-dx * k) / Math.max(0.15, Math.cos(this.lat0 * D2R));
    this.lat0 = clamp(this.lat0 + dLat, -88, 88);
    this.lon0 = wrap180(this.lon0 + dLon);
    const now = performance.now(), dt = Math.max(0.008, (now - d.t) / 1000);
    this.vel = { lat: dLat / dt, lon: dLon / dt };
    d.last = p;
    d.t = now;
  }

  up(e) {
    const d = this.drag;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size > 0) return;
    this.drag = null;
    this.idleAt = performance.now();
    if (!d || d.moved || e.type === "pointercancel") {
      if (d && performance.now() - d.t > 120) this.vel = { lat: 0, lon: 0 }; // held still before letting go
      return;
    }
    clearTimeout(this._hold);
    if (d.pointed) return; // the long press already opened the card
    const [x, y] = d.start;
    const now = performance.now();
    if (now - this.lastTap < 320) {
      // Double tap: zoom in toward that spot.
      this.lastTap = 0;
      const w = this.toWorld(x, y);
      if (w) { this.flyTo(w.lat, w.lon, clamp(this.zoom * 2.5, MIN_ZOOM, MAX_ZOOM)); this.mode = "free"; }
      return;
    }
    this.lastTap = now;
    // Placing beacons on a custom map: a tap puts one there.
    const at = this.toWorld(x, y);
    if (at && this.h.place?.(at.lat, at.lon)) return;
    // A tap on the plane shows its flight; a tap while moving stops there; a tap on a beacon offers to go there.
    if (this._planeAt && Math.hypot(this._planeAt[0] - x, this._planeAt[1] - y) < 34 * (this.h.ui.dpr || 1) && this.h.flightCard?.()) return;
    if (this.h.stopTravel?.()) return;
    const hit = this.pick(x, y);
    if (hit) { this.h.select(hit.id); this._offerAt([x, y], e.clientX, e.clientY); }
  }

  /** Right-click: the Jump / Move card at once. */
  context(e) {
    e.preventDefault();
    this._offerAt(this._pt(e), e.clientX, e.clientY);
  }

  wheel(e) {
    e.preventDefault();
    this.fly = null;
    const before = this.hover ? this.toWorld(...this.hover) : null;
    this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.0016), MIN_ZOOM, MAX_ZOOM);
    // Zoom toward the pointer: nudge the middle so the spot under it stays put (roughly).
    if (before && e.deltaY < 0) {
      const after = this.toWorld(...this.hover);
      if (after) {
        this.lat0 = clamp(this.lat0 + (before.lat - after.lat), -88, 88);
        this.lon0 = wrap180(this.lon0 + wrap180(before.lon - after.lon));
      }
    }
    if (this.mode === "spin") this.mode = "free";
    this.idleAt = performance.now();
  }

  /** The beacon (global or your own) nearest a screen point, within reach of a finger. */
  pick(x, y) {
    const reach = 16 * (this.h.ui.dpr || 1);
    let best = null, bd = reach;
    for (const b of this._drawn || []) {
      const dd = Math.hypot(b.x - x, b.y - y);
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }

  // ---------------------------------------------------------------- drawing

  draw(g, now, dt) {
    this._step(now, dt);
    const { W, H, cx, cy, R } = this;
    const d = this.h.ui.dpr || 1;
    const C = this.h.ui.colors;
    const light = getComputedStyle(document.documentElement).colorScheme === "light";
    this._drawn = [];

    // Space, and a few stars that drift as the globe turns.
    const sky = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, Math.max(W, H));
    sky.addColorStop(0, light ? "#dfe7f1" : "#0b1220");
    sky.addColorStop(1, light ? "#c9d4e3" : "#04070d");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    if (!light) {
      const drift = (this.lon0 / 360) * 0.25;
      for (const s of this.stars) {
        const x = (((s.x + drift) % 1) + 1) % 1 * W, y = s.y * H;
        if (Math.hypot(x - cx, y - cy) < R) continue;
        g.globalAlpha = s.a * (0.75 + 0.25 * Math.sin(now / 900 + s.tw));
        g.fillStyle = "#cfe0ff";
        g.beginPath(); g.arc(x, y, s.r * d, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }

    // Atmosphere.
    const atm = g.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
    atm.addColorStop(0, light ? "rgba(90,150,220,0.35)" : "rgba(90,170,255,0.38)");
    atm.addColorStop(1, "rgba(90,170,255,0)");
    g.fillStyle = atm;
    g.beginPath(); g.arc(cx, cy, R * 1.12, 0, Math.PI * 2); g.fill();

    // The sphere, lit by the sun.
    this._drawShade(g, light);

    g.save();
    g.beginPath(); g.arc(cx, cy, Math.max(0, R - 0.5), 0, Math.PI * 2); g.clip();
    this._drawGraticule(g, d, light);
    // Brighter and a little heavier where it's night over the US, so it never gets lost in the dark.
    const night = this._nightAt(39, -98);
    this._drawOutline(g, LOWER_48, d * (1 + 0.6 * night), light ? `rgba(180,110,20,${0.6 + 0.25 * night})` : `rgba(255,181,71,${0.6 + 0.35 * night})`, night);
    // Your trail, and a replaying walk's path.
    const lines = this.h.lines?.() || [];
    if (lines.length) drawLines(g, lines, (p) => this.toScreen(p), this.h.moodColor, d);
    g.restore();

    this._drawGlobeBeacons(g, now, d);
    this._drawMine(g, d);
    this._drawArcs(g, d);
    this._drawListener(g, now, d, C);
    this._drawHover(g, d, C);
    this._drawCaption(g, d, C, light);
  }

  _drawShade(g, light) {
    const { W, H, cx, cy, R } = this;
    const sun = subsolar();
    const key = [W, H, this.lat0.toFixed(2), this.lon0.toFixed(2), this.zoom.toFixed(3), sun.lat.toFixed(1), sun.lon.toFixed(1), light].join("|");
    if (key !== this.shade.key) {
      // The part of the screen the disc covers, at about 220 pixels a side.
      const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R));
      const x1 = Math.min(W, Math.ceil(cx + R)), y1 = Math.min(H, Math.ceil(cy + R));
      const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
      const k = 220 / Math.max(bw, bh);
      const w = Math.max(2, Math.round(bw * k)), h = Math.max(2, Math.round(bh * k));
      const off = this.shade.canvas || (this.shade.canvas = document.createElement("canvas"));
      off.width = w; off.height = h;
      const ctx = off.getContext("2d");
      const img = ctx.createImageData(w, h);
      const s = this.toView(sun.lat, sun.lon);
      const day = light ? [205, 222, 240] : [30, 56, 84], night = light ? [150, 166, 190] : [7, 13, 26];
      for (let j = 0; j < h; j++) {
        const py = (cy - (y0 + ((j + 0.5) / h) * bh)) / R;
        for (let i = 0; i < w; i++) {
          const px = (x0 + ((i + 0.5) / w) * bw - cx) / R;
          const rr = px * px + py * py;
          const o = (j * w + i) * 4;
          if (rr > 1) { img.data[o + 3] = 0; continue; }
          const pz = Math.sqrt(1 - rr);
          const lit = px * s.x + py * s.y + pz * s.z; // sun angle: 1 overhead, 0 at the day/night line
          const t = clamp((lit + 0.08) / 0.3, 0, 1);
          const dusk = Math.exp(-((lit + 0.02) ** 2) / 0.003) * 0.18; // a warm band along the line
          const limb = 0.72 + 0.28 * pz;
          img.data[o] = (night[0] + (day[0] - night[0]) * t + 90 * dusk) * limb;
          img.data[o + 1] = (night[1] + (day[1] - night[1]) * t + 40 * dusk) * limb;
          img.data[o + 2] = (night[2] + (day[2] - night[2]) * t + 10 * dusk) * limb;
          img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      this.shade = { key, canvas: off, x: x0, y: y0, w: bw, h: bh };
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(this.shade.canvas, this.shade.x, this.shade.y, this.shade.w, this.shade.h);
  }

  /** A polyline of lat/lon points, broken where it goes round the back. */
  _path(g, pts) {
    let pen = false;
    for (const p of pts) {
      const s = this.toScreen(p);
      if (!s) { pen = false; continue; }
      if (pen) g.lineTo(s[0], s[1]); else { g.moveTo(s[0], s[1]); pen = true; }
    }
  }

  _drawGraticule(g, d, light) {
    const steps = [[30, 0.32], [10, 0.16]];
    if (this.zoom > 6) steps.push([1, 0.12]);
    if (this.zoom > 60) steps.push([0.1, 0.1]);
    // Only lines near the view are worth drawing when zoomed in.
    const span = this.zoom > 3 ? clamp(200 / this.zoom, 0.5, 180) : 180;
    for (const [step, a] of steps) {
      if (step < 1 && span > 3) continue;
      g.strokeStyle = light ? `rgba(40,70,110,${a * 0.9})` : `rgba(140,180,230,${a})`;
      g.lineWidth = d * (step >= 30 ? 1.1 : 0.8);
      g.beginPath();
      const la0 = Math.max(-90, Math.floor((this.lat0 - span) / step) * step), la1 = Math.min(90, this.lat0 + span);
      const res = Math.max(step / 6, Math.min(3, span / 60));
      for (let lat = la0; lat <= la1 + 1e-9; lat += step) {
        if (lat <= -90 || lat >= 90) continue;
        const pts = [];
        for (let lon = this.lon0 - Math.min(180, span * 2.2); lon <= this.lon0 + Math.min(180, span * 2.2); lon += res) pts.push({ lat, lon });
        this._path(g, pts);
      }
      const lonSpan = Math.min(180, span * 2.2);
      for (let lon = Math.floor((this.lon0 - lonSpan) / step) * step; lon <= this.lon0 + lonSpan; lon += step) {
        const pts = [];
        for (let lat = Math.max(-90, la0 - step); lat <= Math.min(90, la1 + step); lat += res) pts.push({ lat, lon });
        this._path(g, pts);
      }
      g.stroke();
    }
    // The equator, a little stronger.
    g.strokeStyle = light ? "rgba(40,70,110,0.45)" : "rgba(160,200,250,0.42)";
    g.lineWidth = 1.3 * d;
    g.beginPath();
    const eq = [];
    for (let lon = -180; lon <= 180; lon += 2) eq.push({ lat: 0, lon });
    this._path(g, eq);
    g.stroke();
  }

  _drawOutline(g, ring, d, color, glow = 0) {
    g.strokeStyle = color;
    g.lineWidth = 2 * d;
    g.setLineDash([6 * d, 4 * d]);
    if (glow > 0) { g.shadowColor = color; g.shadowBlur = 6 * d * glow; }
    g.beginPath();
    this._path(g, [...ring, ring[0]].map(([lon, lat]) => ({ lat, lon })));
    g.stroke();
    g.setLineDash([]);
    g.shadowBlur = 0;
  }

  /** 0 in daylight, rising to 1 a little past dusk, at a lat/lon right now. */
  _nightAt(lat, lon) {
    const sun = subsolar(), D = Math.PI / 180;
    const lit = Math.sin(lat * D) * Math.sin(sun.lat * D) + Math.cos(lat * D) * Math.cos(sun.lat * D) * Math.cos((lon - sun.lon) * D);
    return Math.max(0, Math.min(1, 0.5 - lit * 2.5));
  }

  _glow(g, x, y, r, color, alpha) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 3.2);
    gr.addColorStop(0, color);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = alpha * 0.55;
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r * 3.2, 0, Math.PI * 2); g.fill();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }

  _drawGlobeBeacons(g, now, d) {
    const { engine, ui } = this.h;
    const active = new Map(engine.active.map((a) => [a.id, a.w]));
    const size = clamp(2 + Math.log2(this.zoom + 1) * 1.6, 2.2, 9) * d;
    for (const b of engine.field.beacons) {
      const s = this.toScreen(b.pos);
      if (!s) continue;
      const v = this.toView(b.pos.lat, b.pos.lon);
      const col = this.h.moodColor(engine.songFor(b).mood);
      const w = active.get(b.id) || 0;
      const fl = ui.flashes.get(b.id);
      const pulse = fl ? Math.max(0, 1 - (now - fl) / 300) : 0;
      const r = size * (1 + 0.6 * w + 0.5 * pulse);
      this._glow(g, s[0], s[1], r, col, (0.35 + 0.65 * v.z) * (w > 0 ? 1 : 0.8));
      if (b.id === ui.selected) this._ring(g, s[0], s[1], r + 7 * d, "#fff", d);
      if (b.id === engine.harmony.id) this._ring(g, s[0], s[1], r + 4 * d, ui.colors.accent, d, 2);
      this._drawn.push({ id: b.id, x: s[0], y: s[1], label: b.label, song: engine.songFor(b) });
      if (w > 0.04 || b.id === ui.selected) this.h.label(`${b.label} · ${engine.songFor(b).title}${w > 0.04 ? ` ${Math.round(w * 100)}%` : ""}`, s[0], s[1] - r - 10 * d, 11 * d, "#e6ebf1", "rgba(4,7,13,0.85)");
    }
  }

  _ring(g, x, y, r, color, d, w = 1.4) {
    g.strokeStyle = color;
    g.lineWidth = w * d;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  }

  /** Your beacons (and shared ones): one marker per grid when far away, every beacon up close. */
  _drawMine(g, d) {
    const st = this.h.drafts();
    if (!st?.pool) return;
    const kmpp = this.kmPerPx();
    const active = new Map(this.h.engine.active.map((a) => [a.id, a.w]));
    const sel = this.h.ui.selected;
    const grids = [...st.doc.grids.filter((x) => x.on), ...(st.doc.prefs.sharedOn === false ? [] : st.shared?.doc().grids || [])];
    const grouped = new Set();
    for (const gr of grids) {
      if ((gr.spacingM / 1000) / kmpp >= 5) continue; // close enough to see each beacon
      grouped.add(gr.id);
      const c = st.pool.entries.find((e) => e.key.startsWith(`${gr.id}/`) && e.north === 0 && e.east === 0);
      if (!c) continue;
      const s = this.toScreen(c.pos);
      if (!s) continue;
      const side = Math.max(5 * d, ((gr.spacingM * 20) / 1000) / kmpp);
      g.strokeStyle = gr.tint;
      g.lineWidth = 1.5 * d;
      g.globalAlpha = 0.9;
      g.strokeRect(s[0] - side / 2, s[1] - side / 2, side, side);
      this._glow(g, s[0], s[1], 3.2 * d, gr.tint, 0.95);
      g.globalAlpha = 1;
      this._drawn.push({ id: `u:${c.key}`, x: s[0], y: s[1], label: gr.name, song: c.song() });
      if (this.zoom > 2.5) this.h.label(gr.shared ? "shared grid" : gr.name, s[0], s[1] + side / 2 + 10 * d, 10 * d, gr.tint, "rgba(4,7,13,0.8)");
    }
    for (const e of st.pool.playing) {
      const gridId = e.key.includes("/") ? e.key.split("/")[0] : null;
      if (gridId && grouped.has(gridId)) continue;
      const s = this.toScreen(e.pos);
      if (!s || s[0] < -20 || s[1] < -20 || s[0] > this.W + 20 || s[1] > this.H + 20) continue;
      const song = e.song();
      if (!song) continue;
      const id = `u:${e.key}`;
      const w = active.get(id) || 0;
      const special = e.kind !== "gen";
      const r = (special ? 4.2 : 3) * d * (1 + 0.5 * w);
      if (special) {
        g.fillStyle = this.h.moodColor(song.mood);
        g.beginPath(); g.moveTo(s[0], s[1] - r * 1.3); g.lineTo(s[0] + r * 1.3, s[1]); g.lineTo(s[0], s[1] + r * 1.3); g.lineTo(s[0] - r * 1.3, s[1]); g.closePath(); g.fill();
        g.strokeStyle = e.tint; g.lineWidth = 1.4 * d; g.stroke();
        // Its reach, faintly.
        const rr = (e.rangeM / 1000) / kmpp;
        if (rr > 8 * d && rr < this.W * 2) { g.globalAlpha = 0.25; this._ring(g, s[0], s[1], rr, e.tint, d); g.globalAlpha = 1; }
      } else {
        this._glow(g, s[0], s[1], r, this.h.moodColor(song.mood), 0.9);
        g.strokeStyle = e.tint; g.lineWidth = 1 * d; g.strokeRect(s[0] - r - 1.5 * d, s[1] - r - 1.5 * d, 2 * r + 3 * d, 2 * r + 3 * d);
      }
      if (id === sel) this._ring(g, s[0], s[1], r + 8 * d, "#fff", d);
      this._drawn.push({ id, x: s[0], y: s[1], label: e.source.name, song });
    }
  }

  /** Arcs from the listener to the beacons you're hearing, lifted off the surface. */
  _drawArcs(g, d) {
    const { engine } = this.h;
    const p = engine.pos;
    const a0 = this.toView(p.lat, p.lon);
    for (const a of engine.active) {
      if (a.w < 0.01) continue;
      const b = this.toView(a.beacon.pos.lat, a.beacon.pos.lon);
      const ang = Math.acos(clamp(a0.x * b.x + a0.y * b.y + a0.z * b.z, -1, 1));
      const lift = Math.min(0.25, ang * 0.35) + 0.002;
      g.strokeStyle = this.h.moodColor(a.song.mood);
      g.lineWidth = (1 + 4 * a.w) * d;
      g.globalAlpha = 0.35 + 0.6 * a.w;
      g.beginPath();
      let pen = false;
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        // Slerp between the two points, lifted in the middle.
        const so = Math.sin(ang) || 1e-9;
        const k0 = ang < 1e-6 ? 1 - t : Math.sin((1 - t) * ang) / so, k1 = ang < 1e-6 ? t : Math.sin(t * ang) / so;
        const r = 1 + lift * Math.sin(Math.PI * t);
        const v = { x: (a0.x * k0 + b.x * k1) * r, y: (a0.y * k0 + b.y * k1) * r, z: (a0.z * k0 + b.z * k1) * r };
        const hidden = v.z < 0 && v.x * v.x + v.y * v.y < 1;
        if (hidden) { pen = false; continue; }
        const x = this.cx + this.R * v.x, y = this.cy - this.R * v.y;
        if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; }
      }
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  _drawListener(g, now, d, C) {
    const s = this.toScreen(this.h.engine.pos);
    if (!s) return;
    const fl = this.h.flight?.();
    this._planeAt = fl ? [s[0], s[1]] : null;
    if (fl) {
      // Following a flight: a plane along its track (screen-north is the view's north near the middle).
      const ahead = this.toScreen(destinationLite(this.h.engine.pos, fl.track, 0.05));
      const ang = ahead ? Math.atan2(ahead[0] - s[0], s[1] - ahead[1]) : (fl.track * Math.PI) / 180;
      g.save();
      g.translate(s[0], s[1]);
      g.rotate(ang);
      g.scale(d * 1.1, d * 1.1);
      g.fillStyle = fl.tracked === false ? "#ff4d4d" : C.accent; g.strokeStyle = "#04070d"; g.lineWidth = 1.5; // red: out of sight, gliding on
      g.beginPath();
      g.moveTo(0, -22); g.lineTo(3, -12); g.lineTo(3, -4); g.lineTo(18, 4); g.lineTo(18, 8); g.lineTo(3, 4);
      g.lineTo(2.5, 14); g.lineTo(8, 19); g.lineTo(8, 22); g.lineTo(0, 19); g.lineTo(-8, 22); g.lineTo(-8, 19);
      g.lineTo(-2.5, 14); g.lineTo(-3, 4); g.lineTo(-18, 8); g.lineTo(-18, 4); g.lineTo(-3, -4); g.lineTo(-3, -12); g.closePath();
      g.fill(); g.stroke();
      g.restore();
      this.h.label(`✈ ${fl.label || ""}${fl.tracked === false ? " · signal lost" : ""}`, s[0], s[1] + 34 * d, 11 * d, fl.tracked === false ? "#ff6b6b" : C.accent, "rgba(4,7,13,0.85)");
      return;
    }
    const ph = (now / 1600) % 1;
    g.strokeStyle = C.accent;
    g.globalAlpha = 1 - ph;
    g.lineWidth = 2 * d;
    g.beginPath(); g.arc(s[0], s[1], (8 + 26 * ph) * d, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    this._glow(g, s[0], s[1], 6.5 * d, C.accent, 1);
    g.strokeStyle = "#04070d"; g.lineWidth = 2 * d;
    g.beginPath(); g.arc(s[0], s[1], 6.5 * d, 0, Math.PI * 2); g.stroke();
  }

  _drawHover(g, d, C) {
    if (!this.hover || this.drag) return;
    const hit = this.pick(...this.hover);
    this.h.canvas.style.cursor = hit ? "pointer" : "grab";
    if (!hit || !hit.song) return;
    const text = `${hit.song.title} · ${hit.song.mood || "custom"} · ${hit.label}`;
    this.h.label(text, hit.x, hit.y + 18 * d, 11.5 * d, C.accent, "rgba(4,7,13,0.9)");
  }

  _drawCaption(g, d, C, light) {
    const km = this.H * this.kmPerPx();
    const view = km > 3000 ? `${Math.round(km / 100) * 100} km across` : km > 30 ? `${Math.round(km)} km across` : `${km.toFixed(km < 3 ? 1 : 0)} km across`;
    const mode = this.mode === "spin" ? "spinning" : this.mode === "follow" ? "following you" : "turned by hand";
    this.h.label(`${view} · ${mode} · drag to turn, wheel or pinch to zoom, tap a beacon or long-press to go there`, 14 * d, this.H - 14 * d, 10.5 * d, light ? "#3b4a5c" : "#8d9aab", null, 1, "left");
  }
}
