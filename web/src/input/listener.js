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
  };
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
    this._handlers = { moved: [], action: [], wander: [], manual: [] };
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
  jumpTo(p) { this.target = null; this.setPosition(p); }
  setTarget(p) { this.target = p ? this.space.clamp(p) : null; }
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
        this.manual("walk");
        this.setPosition(this.space.step(this.position, [x, y], dist * Math.min(1, l)));
        return;
      }
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
 */
export function pointerSource(el, toWorld, { tapPx = 8 } = {}) {
  let li = null, downAt = null;
  const pt = (e) => {
    const r = el.getBoundingClientRect();
    const sx = (el.width || r.width) / r.width, sy = (el.height || r.height) / r.height;
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy];
  };
  const down = (e) => {
    el.setPointerCapture?.(e.pointerId);
    const [x, y] = pt(e);
    downAt = [x, y];
    li.holdTarget = true;
    li.manual("pointer");
    li.setTarget(toWorld(x, y));
  };
  const move = (e) => { if (!downAt) return; const [x, y] = pt(e); li.setTarget(toWorld(x, y)); };
  const up = (e) => {
    if (!downAt) return;
    const [x, y] = pt(e);
    li.holdTarget = false;
    const scale = (el.width || 1) / (el.getBoundingClientRect().width || 1);
    if (Math.hypot(x - downAt[0], y - downAt[1]) < tapPx * scale) li.action("select", { x, y, pos: toWorld(x, y) });
    downAt = null;
  };
  const cancel = () => { downAt = null; if (li) li.holdTarget = false; };
  return {
    name: "pointer",
    get dragging() { return !!downAt; },
    attach(l) { li = l; el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", cancel); },
    detach() { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", cancel); },
  };
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
