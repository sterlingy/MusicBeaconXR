// ListenerKit for the browser: where the listener is, and every way to move
// them. No audio, no DOM needed for the core (sources attach to the DOM), so it
// works in any web app, with or without the beacon music.
//
// Same names and rules as the Godot kit in addons/listener_kit:
//   spaces    planarSpace / localSpace / geoSpace   what a position means
//   listener  ListenerInput                          position, target, wander
//   sources   keyboardSource, pointerSource, geolocationSource, poseSource
//
// A move direction is always (right, forward): x = east / screen-right,
// y = north / away from the viewer. Each space turns that into its own units.

const D2R = Math.PI / 180;
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const norm = (x, y) => { const l = Math.hypot(x, y); return l > 0 ? [x / l, y / l, l] : [0, 0, 0]; };

/** Flat floor, positions {x, y} in meters, +y down the screen (south). `half` is the walkable half-width. */
export function planarSpace({ half = 250, margin = half * 0.08 } = {}) {
  const clamp = (p) => ({ x: clampN(p.x, -half, half), y: clampN(p.y, -half, half) });
  return {
    kind: "planar",
    clamp,
    step: (p, [dx, dy], dist) => clamp({ x: p.x + dx * dist, y: p.y - dy * dist }),
    toward: (a, b) => { const [x, y, l] = norm(b.x - a.x, -(b.y - a.y)); return { dir: [x, y], dist: l }; },
    bounce: (p, h) => bounceXY(p.x, -p.y, h, half - margin),
    interp: (a, b, t) => clamp({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
    distance: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
  };
}

/**
 * A local grid's flat map: positions {lat, lon}, distances in meters through
 * the field's toXY / fromXY (meters east and north of its middle).
 */
export function localSpace(field, { half = () => (field.steps / 2 + 0.5) * field.spacing, margin = () => 0.2 * field.spacing } = {}) {
  const h = () => (typeof half === "function" ? half() : half);
  const m = () => (typeof margin === "function" ? margin() : margin);
  const clamp = (p) => { const q = field.toXY(p); return field.fromXY({ x: clampN(q.x, -h(), h()), y: clampN(q.y, -h(), h()) }); };
  return {
    kind: "local",
    clamp,
    step: (p, [dx, dy], dist) => { const q = field.toXY(p); return clamp(field.fromXY({ x: q.x + dx * dist, y: q.y + dy * dist })); },
    toward: (a, b) => { const p = field.toXY(a), q = field.toXY(b); const [x, y, l] = norm(q.x - p.x, q.y - p.y); return { dir: [x, y], dist: l }; },
    bounce: (p, hd) => { const q = field.toXY(p); return bounceXY(q.x, q.y, hd, h() - m()); },
    interp: (a, b, t) => { const p = field.toXY(a), q = field.toXY(b); return clamp(field.fromXY({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })); },
    distance: (a, b) => { const p = field.toXY(a), q = field.toXY(b); return Math.hypot(q.x - p.x, q.y - p.y); },
  };
}

/** The whole globe: positions {lat, lon} in degrees; walk speed in degrees per second. */
export function geoSpace({ maxLat = 84 } = {}) {
  const k = (lat) => Math.min(4, 1 / Math.max(0.15, Math.cos(lat * D2R))); // longitude stretch toward the poles
  const clamp = (p) => ({ lat: clampN(p.lat, -90, 90), lon: wrapLon(p.lon) });
  return {
    kind: "geo",
    clamp,
    step: (p, [dx, dy], dist) => clamp({ lat: p.lat + dy * dist, lon: p.lon + dx * dist * k(p.lat) }),
    toward: (a, b) => { const [x, y, l] = norm(wrapLon(b.lon - a.lon) / k(a.lat), b.lat - a.lat); return { dir: [x, y], dist: l }; },
    bounce: (p, h) => (Math.abs(p.lat) > maxLat && Math.sign(Math.sin(h)) === Math.sign(p.lat) ? -h : h),
    // Along the great circle (the way a plane flies); distance in km.
    interp: (a, b, t) => {
      const va = unit(a), vb = unit(b);
      const ang = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
      if (ang < 1e-9) return clamp(b);
      const ka = Math.sin((1 - t) * ang) / Math.sin(ang), kb = Math.sin(t * ang) / Math.sin(ang);
      const v = [va[0] * ka + vb[0] * kb, va[1] * ka + vb[1] * kb, va[2] * ka + vb[2] * kb];
      const l = Math.hypot(...v);
      return clamp({ lat: Math.asin(Math.max(-1, Math.min(1, v[1] / l))) / D2R, lon: Math.atan2(v[0], v[2]) / D2R });
    },
    distance: (a, b) => { const va = unit(a), vb = unit(b); return Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))) * 6371.0; },
  };
}

function unit(p) {
  const lat = p.lat * D2R, lon = p.lon * D2R;
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

/**
 * How long a Move should take: about 3 s for a short hop and up to 12 s across
 * the world (geo spaces, km), or 1.5 to 6 s across a floor `span` units wide.
 * Same as ListenerInput.travel_seconds in the Godot ListenerKit.
 */
export function travelSeconds(space, a, b, span = 500, mps = 0) {
  const d = space.distance(a, b);
  // On a grid at a set travel speed, Move takes as long as that speed would (as the app).
  if (space.kind !== "geo" && mps > 0) return Math.max(0.3, d / mps);
  if (space.kind === "geo") return 3 + 9 * Math.max(0, Math.min(1, (Math.log10(1 + d) - 1) / 3.3));
  return 1.5 + 4.5 * Math.max(0, Math.min(1, d / Math.max(1, span)));
}

// Heading h is radians in (right, forward); x, y are right and forward coordinates.
function bounceXY(x, y, h, lim) {
  const dx = Math.cos(h), dy = Math.sin(h);
  if ((x > lim && dx > 0) || (x < -lim && dx < 0)) h = Math.PI - h;
  if ((y > lim && dy > 0) || (y < -lim && dy < 0)) h = -h;
  return h;
}

/**
 * The listener. Sources push intents; `tick(dt)` moves.
 *
 *   const li = new ListenerInput({ space: planarSpace(), position: { x: 0, y: 0 }, speed: 55 });
 *   li.on("moved", (p) => engine.setPosition(p));
 *   li.on("action", (name, arg) => ...);   // "toggle_play", "toggle_wander", "select", ...
 *   li.add(keyboardSource(window));
 *   requestAnimationFrame loop: li.tick(dt)
 *
 * Priority each tick: a source that drives the position (XR pose, GPS follow),
 * then the first source with a move intent (cancels the target), then the
 * target, then wander.
 */
export class ListenerInput {
  constructor({ space = planarSpace(), position = { x: 0, y: 0 }, speed = 55, wanderPace = 0.6 } = {}) {
    this.space = space;
    this.position = space.clamp(position);
    /** Walking speed in space units per second, or a function returning it. */
    this.speed = speed;
    this.wanderPace = wanderPace;
    this.target = null;
    /** While true the target stays after it's reached (a finger still dragging). */
    this.holdTarget = false;
    this._wander = false;
    this.heading = Math.random() * Math.PI * 2;
    this.enabled = true;
    this.sources = [];
    this.travel = null;
    this._handlers = { moved: [], action: [], wander: [], manual: [], arrived: [], jumped: [] };
  }

  on(ev, fn) { this._handlers[ev].push(fn); return () => { this._handlers[ev] = this._handlers[ev].filter((f) => f !== fn); }; }
  emit(ev, ...a) { for (const f of this._handlers[ev]) f(...a); }

  get wander() { return this._wander; }
  set wander(v) { v = !!v; if (v !== this._wander) { this._wander = v; this.emit("wander", v); } }

  /** Adds a source ({moveIntent?(li, dt), drivenPosition?(li, dt), attach?(li), detach?()}). Returns it. */
  add(src) { this.sources.push(src); src.attach?.(this); return src; }
  remove(src) { this.sources = this.sources.filter((s) => s !== src); src.detach?.(); }

  setPosition(p, emit = true) {
    this.position = this.space.clamp(p);
    if (emit) this.emit("moved", this.position);
  }
  jumpTo(p) { this.target = null; this.travel = null; const from = this.position; this.setPosition(p); this.emit("jumped", from, this.position); }
  setTarget(p) { this.travel = null; this.target = p ? this.space.clamp(p) : null; }
  /**
   * Glides to `p` over `seconds`, easing in and out, along the space's own path
   * (great circles on the globe). Walking or a jump cancels it.
   */
  travelTo(p, seconds) { this.target = null; this.travel = { from: this.position, to: this.space.clamp(p), t: 0, dur: Math.max(0.05, seconds) }; }
  get traveling() { return !!this.travel; }
  stopTravel() { this.travel = null; }
  /** Sends a command; "toggle_wander" also flips `wander`. */
  action(name, arg) { if (name === "toggle_wander") this.wander = !this.wander; this.emit("action", name, arg); }
  /** Sources call this when the person moves by hand (so e.g. GPS follow can stop). */
  manual(kind) { this.emit("manual", kind); }

  tick(dt) {
    if (!this.enabled) return;
    const live = this.sources.filter((s) => s.enabled !== false);
    for (const s of live) {
      const p = s.drivenPosition?.(this, dt);
      if (p) { this.setPosition(p); return; }
    }
    const dist = (typeof this.speed === "function" ? this.speed() : this.speed) * dt;
    for (const s of live) {
      const d = s.moveIntent?.(this, dt);
      if (d && (d[0] || d[1])) {
        const [x, y, l] = norm(d[0], d[1]);
        this.target = null;
        this.travel = null;
        this.manual("walk");
        this.setPosition(this.space.step(this.position, [x, y], dist * Math.min(1, l)));
        return;
      }
    }
    if (this.travel) {
      const tr = this.travel;
      tr.t += dt;
      const u = Math.min(1, tr.t / tr.dur);
      this.setPosition(this.space.interp(tr.from, tr.to, u * u * (3 - 2 * u)));
      if (u >= 1) { this.travel = null; this.emit("arrived", tr.to); }
      return;
    }
    if (this.target) {
      const t = this.space.toward(this.position, this.target);
      if (t.dist <= dist) { this.setPosition(this.target); if (!this.holdTarget) this.target = null; }
      else this.setPosition(this.space.step(this.position, t.dir, dist));
      return;
    }
    if (this._wander) {
      this.heading += (Math.random() - 0.5) * 2.2 * dt;
      this.heading = this.space.bounce(this.position, this.heading);
      this.setPosition(this.space.step(this.position, [Math.cos(this.heading), Math.sin(this.heading)], dist * this.wanderPace));
    }
  }
}

// ------------------------------------------------------------------ sources

const KEYMAP = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down" };
const isField = (t) => t && t.closest && t.closest("input, textarea, select, [contenteditable]");

/**
 * Keyboard and gamepad. WASD / arrows / left stick / d-pad walk; Space or pad A
 * sends "toggle_play", T or pad Y "toggle_wander", digits 1-9 "jump".
 * Keys typed into form fields are ignored.
 */
export function keyboardSource(target = globalThis.window, { jumpKeys = false, wanderKey = false, gamepad = true } = {}) {
  const keys = new Set();
  const padPrev = {};
  let li = null;
  const down = (e) => {
    if (isField(e.target)) return;
    const k = KEYMAP[e.code];
    if (k) { keys.add(k); e.preventDefault(); return; }
    if (e.repeat) return;
    if (e.code === "Space" && !(e.target.closest && e.target.closest("button"))) { e.preventDefault(); li?.action("toggle_play"); }
    else if (wanderKey && e.code === "KeyT") li?.action("toggle_wander");
    else if (jumpKeys && /^Digit[1-9]$/.test(e.code)) li?.action("jump", +e.code.slice(5) - 1);
  };
  const up = (e) => { const k = KEYMAP[e.code]; if (k) keys.delete(k); };
  const blur = () => keys.clear();
  const pads = () => (gamepad && globalThis.navigator?.getGamepads ? [...globalThis.navigator.getGamepads()].filter(Boolean) : []);
  return {
    name: "keyboard",
    keys,
    attach(l) { li = l; target?.addEventListener?.("keydown", down); target?.addEventListener?.("keyup", up); target?.addEventListener?.("blur", blur); },
    detach() { target?.removeEventListener?.("keydown", down); target?.removeEventListener?.("keyup", up); target?.removeEventListener?.("blur", blur); },
    moveIntent() {
      let x = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
      let y = (keys.has("up") ? 1 : 0) - (keys.has("down") ? 1 : 0);
      for (const p of pads()) {
        const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
        if (Math.hypot(ax, ay) > 0.2) { x += ax; y -= ay; }
        const b = (i) => p.buttons[i]?.pressed;
        if (b(12)) y += 1; if (b(13)) y -= 1; if (b(14)) x -= 1; if (b(15)) x += 1;
        for (const [i, name] of [[0, "toggle_play"], [3, "toggle_wander"]]) {
          const id = p.index + ":" + i;
          if (b(i) && !padPrev[id]) li?.action(name);
          padPrev[id] = b(i);
        }
      }
      const l = Math.hypot(x, y);
      return l > 1 ? [x / l, y / l] : [x, y];
    },
  };
}

/**
 * Pointer (mouse, touch, pen) on an element: press to walk there, drag to
 * steer, a tap sends "select" with the screen point and world position.
 * `toWorld(x, y)` maps element pixels (scaled to the canvas size) to a position.
 *
 * `mode: "explore"` leaves the listener alone instead: dragging calls
 * `onOrbit(dx, dy)` (element pixels, so the host pans or turns the view) and
 * `onOrbitEnd(vx, vy)` (px/s, for a flick); a tap sends "select"; a long press
 * (`longPressMs`) or a right-click sends "point" ({x, y, clientX, clientY, pos})
 * so the host can offer to Jump or Move there. Same as PointerSource in Godot.
 */
export function pointerSource(el, toWorld, { tapPx = 8, mode = "walk", onOrbit = null, onOrbitEnd = null, longPressMs = 500 } = {}) {
  let li = null, downAt = null, moved = false, pointed = false, timer = 0, last = null, vel = [0, 0];
  const pt = (e) => {
    const r = el.getBoundingClientRect();
    const sx = (el.width || r.width) / r.width, sy = (el.height || r.height) / r.height;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  };
  const scale = () => (el.width || 1) / (el.getBoundingClientRect().width || 1);
  const point = (e, [x, y]) => li.action("point", { x, y, clientX: e.clientX, clientY: e.clientY, pos: toWorld(x, y) });
  const down = (e) => {
    if (src.mode === "explore" && e.button === 2) return; // right-click: contextmenu handles it
    try { el.setPointerCapture?.(e.pointerId); } catch { /* not a live pointer (synthetic events) */ }
    const p = pt(e);
    downAt = p;
    if (src.mode === "explore") {
      moved = false; pointed = false; vel = [0, 0]; last = { p, t: performance.now() };
      clearTimeout(timer);
      timer = setTimeout(() => { if (downAt && !moved) { pointed = true; point(e, downAt); } }, longPressMs);
      return;
    }
    li.holdTarget = true;
    li.manual("pointer");
    li.setTarget(toWorld(p[0], p[1]));
  };
  const move = (e) => {
    if (!downAt) return;
    const p = pt(e);
    if (src.mode === "explore") {
      if (!moved && !pointed && Math.hypot(p[0] - downAt[0], p[1] - downAt[1]) >= tapPx * scale()) { moved = true; clearTimeout(timer); }
      if (moved) {
        const now = performance.now(), dt = Math.max(0.008, (now - last.t) / 1000);
        const dx = p[0] - last.p[0], dy = p[1] - last.p[1];
        vel = [vel[0] * 0.5 + (dx / dt) * 0.5, vel[1] * 0.5 + (dy / dt) * 0.5];
        last = { p, t: now };
        onOrbit?.(dx, dy);
      }
      return;
    }
    li.setTarget(toWorld(p[0], p[1]));
  };
  const up = (e) => {
    if (!downAt) return;
    const [x, y] = pt(e);
    clearTimeout(timer);
    if (src.mode === "explore") {
      if (moved) onOrbitEnd?.(performance.now() - last.t > 120 ? 0 : vel[0], performance.now() - last.t > 120 ? 0 : vel[1]);
      else if (!pointed) li.action("select", { x, y, pos: toWorld(x, y) });
      downAt = null;
      return;
    }
    li.holdTarget = false;
    if (Math.hypot(x - downAt[0], y - downAt[1]) < tapPx * scale()) li.action("select", { x, y, pos: toWorld(x, y) });
    downAt = null;
  };
  const cancel = () => { clearTimeout(timer); downAt = null; if (li) li.holdTarget = false; };
  const context = (e) => { if (src.mode !== "explore") return; e.preventDefault(); point(e, pt(e)); };
  const src = {
    name: "pointer",
    mode,
    get dragging() { return !!downAt; },
    attach(l) { li = l; el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", cancel); el.addEventListener("contextmenu", context); },
    detach() { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", cancel); el.removeEventListener("contextmenu", context); },
  };
  return src;
}

/**
 * The device's location ({lat, lon}) through navigator.geolocation. Drives the
 * position while following. `onFix(pos, {accuracy, first})` may return a
 * different position (e.g. after re-centering a local grid) or false to skip.
 * Stops itself on a hand move when `stopOnManual` is set.
 */
export function geolocationSource({ onFix, onError, onStop, stopOnManual = true, geo = globalThis.navigator?.geolocation, options } = {}) {
  let li = null, watch = null, pending = null, first = true, off = null;
  const src = {
    name: "geolocation",
    get following() { return watch !== null; },
    attach(l) { li = l; off = l.on("manual", (kind) => { if (stopOnManual && watch !== null) src.stop(kind); }); },
    detach() { src.stop(); off?.(); },
    start() {
      if (watch !== null) return true;
      if (!geo) return false;
      first = true;
      watch = geo.watchPosition(
        (p) => {
          let pos = { lat: p.coords.latitude, lon: p.coords.longitude };
          const r = onFix ? onFix(pos, { accuracy: p.coords.accuracy || 0, first }) : undefined;
          first = false;
          if (r === false) return;
          if (r && typeof r === "object") pos = r;
          pending = pos;
        },
        (err) => onError?.(err),
        options ?? { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
      return true;
    },
    stop(why) {
      if (watch === null) return;
      geo.clearWatch(watch);
      watch = null;
      pending = null;
      onStop?.(why);
    },
    drivenPosition() {
      if (!pending) return null;
      const p = pending;
      pending = null;
      if (li) li.target = null;
      return p;
    },
  };
  return src;
}

/**
 * A tracked pose (WebXR viewer, a headset, a phone in AR) mapped to the
 * listener's space. `read()` returns the pose's floor position in meters
 * {x, z} (WebXR: x right, z toward the viewer) or null; `toPos(x, z)` maps it.
 */
export function poseSource(read, toPos) {
  return {
    name: "pose",
    drivenPosition() { const q = read(); return q ? toPos(q.x, q.z) : null; },
  };
}
