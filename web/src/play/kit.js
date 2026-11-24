// MusicInputKit for the browser: 3D objects you play (strike, pluck, slide,
// twist, tilt, spin) that send notes and knob moves to a hub. The twin of
// addons/music_input_kit in Godot: same objects, names and rules.
//
// No synth and no renderer in here. Objects describe themselves as shapes in
// their own space (boxes and lines) and the page draws them; the hub's events
// go to whatever makes sound (web/src/play/sound.js plays them on the synths).
//
// Space: meters, y up, -z away from the player. Objects sit on a table frame
// (`frame`: {x, y, z, yaw}) so AR can put the table anywhere.

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  "harmonic minor": [0, 2, 3, 5, 7, 8, 11],
  "major pentatonic": [0, 2, 4, 7, 9],
  "minor pentatonic": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (n, octave = true) => NOTE_NAMES[((n % 12) + 12) % 12] + (octave ? String(Math.floor(n / 12) - 1) : "");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mod = (a, n) => ((a % n) + n) % n;
const angleDiff = (from, to) => mod(to - from + Math.PI, Math.PI * 2) - Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;

class Emitter {
  constructor() { this._l = {}; }
  on(ev, fn) { (this._l[ev] ||= []).push(fn); return () => { this._l[ev] = this._l[ev].filter((f) => f !== fn); }; }
  emit(ev, ...a) { for (const f of this._l[ev] || []) f(...a); }
}

// ---------------------------------------------------------------- scale lock

/** Keeps notes in a key and scale, or lets every pitch through when off. */
export class ScaleLock extends Emitter {
  constructor() { super(); this._on = true; this._root = 0; this._scale = "major"; }
  get enabled() { return this._on; }
  set enabled(v) { if (v !== this._on) { this._on = !!v; this.emit("changed"); } }
  get root() { return this._root; }
  set root(v) { this._root = mod(Math.round(v), 12); this.emit("changed"); }
  get scale() { return this._scale; }
  set scale(v) { if (SCALES[v]) { this._scale = v; this.emit("changed"); } }
  intervals() { return this._on ? SCALES[this._scale] : SCALES.chromatic; }
  inScale(n) { return this.intervals().includes(mod(n - this._root, 12)); }
  /** Nearest allowed pitch (ties go down); unchanged when the lock is off. */
  quantize(p) {
    if (!this._on) return p;
    const base = Math.floor(p);
    let best = base, bd = Infinity;
    for (let k = -6; k <= 6; k++) {
      const n = base + k;
      if (this.inScale(n)) { const d = Math.abs(p - n); if (d < bd - 1e-6) { bd = d; best = n; } }
    }
    return best;
  }
  /** The i-th step above `base`: scale degrees with the lock on, semitones off. */
  step(base, i) {
    if (!this._on) return base + i;
    const iv = this.intervals(), n = this.quantize(base);
    let octave = Math.floor((n - this._root) / 12);
    let d = iv.indexOf(mod(n - this._root, 12)) + i;
    octave += Math.floor(d / iv.length);
    d = mod(d, iv.length);
    return this._root + octave * 12 + iv[d];
  }
  chord(base, i, seventh = false) {
    if (!this._on || this.intervals().length < 7) {
      const r = this._on ? this.step(base, i) : base + i;
      return seventh ? [r, r + 4, r + 7, r + 10] : [r, r + 4, r + 7];
    }
    const c = [this.step(base, i), this.step(base, i + 2), this.step(base, i + 4)];
    if (seventh) c.push(this.step(base, i + 6));
    return c;
  }
  chordName(base, i) {
    const c = this.chord(base, i);
    let q = "";
    if (c[1] - c[0] === 3) q = c[2] - c[0] === 7 ? "m" : "dim";
    else if (c[2] - c[0] === 8) q = "+";
    return noteName(c[0], false) + q;
  }
  describe() { return this._on ? `${NOTE_NAMES[this._root]} ${this._scale}` : "free (all 12 notes)"; }
  toJSON() { return { lock: this._on, root: this._root, scale: this._scale }; }
}

// ---------------------------------------------------------------- patch bay

/** Connects moving parts (sources) to knobs (part + param), lo..hi of the knob's range. */
export class PatchBay extends Emitter {
  constructor() { super(); this.patches = []; this.sources = {}; }
  register(source, label) { this.sources[source] = label; }
  setPatch(source, part, param, lo = 0, hi = 1) {
    this.patches = this.patches.filter((p) => p.source !== source);
    if (param) this.patches.push({ source, part, param, lo, hi });
    this.emit("changed");
  }
  addPatch(source, part, param, lo = 0, hi = 1) { this.patches.push({ source, part, param, lo, hi }); this.emit("changed"); }
  remove(source) { this.setPatch(source, "", ""); }
  targetsOf(source) { return this.patches.filter((p) => p.source === source); }
  route(source, v) {
    v = clamp(v, 0, 1);
    return this.patches.filter((p) => p.source === source).map((p) => ({ part: p.part, param: p.param, value: clamp(lerp(p.lo, p.hi, v), 0, 1) }));
  }
  cycle(source, options) {
    const cur = this.targetsOf(source)[0];
    let i = cur ? options.findIndex(([part, param]) => part === cur.part && param === cur.param) : -1;
    i += 1;
    if (i >= options.length) { this.remove(source); return null; }
    this.setPatch(source, options[i][0], options[i][1]);
    return this.targetsOf(source)[0];
  }
  toJSON() { return this.patches.map((p) => ({ ...p })); }
  load(arr) {
    this.patches = (arr || []).filter((p) => p && p.source && p.param).map((p) => ({ source: p.source, part: p.part || "", param: p.param, lo: +(p.lo ?? 0), hi: +(p.hi ?? 1) }));
    this.emit("changed");
  }
}

// ---------------------------------------------------------------- hub

/**
 * Events: noteOn(part, voice, note, vel), noteOff(part, voice, note),
 * bend(part, voice, semitones), control(part, param, value 0..1),
 * source(source, value), action(name, arg).
 */
export class MusicInput extends Emitter {
  constructor() {
    super();
    this.scale = new ScaleLock();
    this.patches = new PatchBay();
    this.baseNote = 60;
    this.voices = new Map();
    this.nextVoice = 1;
    this.lastSource = new Map();
    /** Runs `fn` after `s` seconds (tests swap in a fake clock). */
    this.later = (fn, s) => setTimeout(fn, s * 1000);
  }
  startNote(part, pitch, vel, snap = true) {
    const p = snap ? this.scale.quantize(pitch) : pitch, n = Math.round(p), id = this.nextVoice++;
    this.voices.set(id, { part, note: n, pitch: p });
    this.emit("noteOn", part, id, n, clamp(vel, 0.01, 1));
    if (Math.abs(p - n) > 1e-3) this.emit("bend", part, id, p - n);
    return id;
  }
  moveNote(id, pitch) {
    const v = this.voices.get(id);
    if (!v) return;
    const p = this.scale.quantize(pitch);
    if (Math.abs(p - v.pitch) < 1e-4) return;
    v.pitch = p;
    let off = p - v.note;
    if (Math.abs(off) > 11.5) {
      this.emit("noteOff", v.part, id, v.note);
      v.note = Math.round(p);
      this.emit("noteOn", v.part, id, v.note, 0.7);
      off = p - v.note;
    }
    this.emit("bend", v.part, id, off);
  }
  endNote(id) {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    this.emit("noteOff", v.part, id, v.note);
  }
  endAll() { for (const id of [...this.voices.keys()]) this.endNote(id); }
  isSounding(id) { return this.voices.has(id); }
  strike(part, pitch, vel, length = 0.25, snap = true) {
    const id = this.startNote(part, pitch, vel, snap);
    this.later(() => this.endNote(id), length);
    return id;
  }
  send(source, value) {
    value = clamp(value, 0, 1);
    if (this.lastSource.get(source) === value) return;
    this.lastSource.set(source, value);
    this.emit("source", source, value);
    for (const r of this.patches.route(source, value)) this.emit("control", r.part, r.param, r.value);
  }
  setKnob(part, param, value) { this.emit("control", part, param, clamp(value, 0, 1)); }
  lastValue(source, d = 0) { return this.lastSource.has(source) ? this.lastSource.get(source) : d; }
  resend() { for (const [s, v] of this.lastSource) for (const r of this.patches.route(s, v)) this.emit("control", r.part, r.param, r.value); }
  action(name, arg = null) {
    if (name === "lock") { this.scale.enabled = arg == null ? !this.scale.enabled : !!arg; arg = this.scale.enabled; }
    this.emit("action", name, arg);
  }
}

// ---------------------------------------------------------------- hands

/** A mouse, a finger, or a tracked hand / controller. */
export class Hand {
  constructor(kind = "mouse", id = 0) {
    this.kind = kind;
    this.id = id;
    this.position = [0, 0, 0];
    this.velocity = [0, 0, 0];
    this.rayOrigin = [0, 0, 0];
    this.rayDir = [0, 0, -1];
    this.pressed = false;
    this.grip = false;
    this.squeeze = 0;
    /** Orientation as axes {x, y, z} (XR), for twisting and tilting. */
    this.basis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    this.buzz = null;
  }
  isXR() { return this.kind === "xr"; }
  /** 0..1 from hand speed into the surface (XR) or a default for pointers. */
  strikeStrength(normal = null, full = 2) {
    if (!this.isXR()) return clamp(0.7 + len(this.velocity) * 0.05, 0.4, 1);
    const s = normal ? Math.max(0, -dot(this.velocity, normal)) : len(this.velocity);
    return clamp(s / full, 0.08, 1);
  }
  pulse(s = 0.5) { if (this.buzz) this.buzz(clamp(s, 0, 1)); }
  /** Roll of the hand around its pointing axis (radians). */
  roll() { return Math.atan2(this.basis.x[1], this.basis.y[1]); }
  /** Forward tilt (radians, + = pointing down). */
  pitch() { return Math.asin(clamp(this.basis.z[1], -1, 1)); }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// ---------------------------------------------------------------- playable base

/**
 * Base for every object. `box` is its touchable volume in its own space
 * ({min:[x,y,z], max:[x,y,z]}); `pos` places it on the table `frame`.
 */
export class Playable {
  constructor(name, opts = {}) {
    this.name = name;
    this.part = opts.part ?? this.constructor.defaultPart ?? "keys";
    this.tint = opts.tint ?? "#ffb547";
    this.pos = opts.pos ?? [0, 0, 0];
    this.frame = opts.frame ?? { x: 0, y: 0, z: 0, yaw: 0 };
    this.box = { min: [-0.15, 0, -0.15], max: [0.15, 0.1, 0.15] };
    this.holds = new Map();
    this.flashes = new Map(); // shape key -> time left
    this.kit = null;
  }
  /** Called once with the hub: declare sources, label things. */
  attach(kit) {
    this.kit = kit;
    kit.scale.on("changed", () => this.onScale());
    this.declareSources();
    return this;
  }
  declareSources() {}
  onScale() {}
  handDown() {}
  handMove() {}
  handUp() {}
  wheel() {}
  update() {}
  /**
   * Shapes in local space: boxes {box: [bottomCentre, size], color, glow, yaw,
   * pitch, roll, pivot, alpha} and lines {line: [a, b], color, alpha}.
   */
  shapes() { return []; }
  /** Text tags in local space: [{text, at: [x,y,z], size}]. */
  labels() { return []; }

  // geometry: local <-> world through the table frame
  _yaw() { return this.frame.yaw; }
  world(l) {
    const c = Math.cos(this._yaw()), s = Math.sin(this._yaw());
    const x = this.pos[0] + l[0], y = this.pos[1] + l[1], z = this.pos[2] + l[2];
    return [this.frame.x + c * x + s * z, this.frame.y + y, this.frame.z - s * x + c * z];
  }
  worldDir(l) {
    const c = Math.cos(this._yaw()), s = Math.sin(this._yaw());
    return [c * l[0] + s * l[2], l[1], -s * l[0] + c * l[2]];
  }
  local(w) {
    const c = Math.cos(this._yaw()), s = Math.sin(this._yaw());
    const dx = w[0] - this.frame.x, dz = w[2] - this.frame.z;
    return [c * dx - s * dz - this.pos[0], w[1] - this.frame.y - this.pos[1], s * dx + c * dz - this.pos[2]];
  }
  localDir(d) {
    const c = Math.cos(this._yaw()), s = Math.sin(this._yaw());
    return [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]];
  }
  localOf(hand) { return this.local(hand.position); }
  frac(l, axis) { return clamp((l[axis] - this.box.min[axis]) / Math.max(this.box.max[axis] - this.box.min[axis], 1e-6), 0, 1); }
  contains(w, margin = 0) {
    const l = this.local(w);
    return [0, 1, 2].every((i) => l[i] >= this.box.min[i] - margin && l[i] <= this.box.max[i] + margin);
  }
  /** What a pointer ray can hit (default: the whole box). Objects with reach above them override it. */
  pickBox() { return this.box; }
  /** Distance along a world ray to the pick box, or -1. */
  hitRay(o, d) {
    const lo = this.local(o), ld = this.localDir(d), box = this.pickBox();
    let t0 = 0, t1 = Infinity;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-9) {
        if (lo[i] < box.min[i] || lo[i] > box.max[i]) return -1;
        continue;
      }
      let a = (box.min[i] - lo[i]) / ld[i], b = (box.max[i] - lo[i]) / ld[i];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return -1;
    }
    return t0;
  }
  /** Plane a pointer drags on after pressing: {p, n} in world. Default: the top. */
  dragPlane(hit) { return { p: hit, n: [0, 1, 0] }; }
  facePlane(hit) { return { p: hit, n: this.worldDir([0, 0, 1]) }; }

  // sources
  sourceName(what) { return `${this.name}.${what}`; }
  declare(what, label, part = "", param = "", lo = 0, hi = 1) {
    const s = this.sourceName(what);
    this.kit.patches.register(s, label);
    if (param && this.kit.patches.targetsOf(s).length === 0) this.kit.patches.setPatch(s, part, param, lo, hi);
  }
  send(what, v) { this.kit?.send(this.sourceName(what), v); }
  patchText(what) { const t = this.kit?.patches.targetsOf(this.sourceName(what))[0]; return t ? t.param : "-"; }
  flash(key, time = 0.25) { this.flashes.set(key, time); }
  glowOf(key, base = 0.15) { return base + 2.5 * Math.max(0, this.flashes.get(key) || 0) / 0.25; }
  tickFlashes(dt) { for (const [k, v] of this.flashes) { if (v - dt <= 0) this.flashes.delete(k); else this.flashes.set(k, v - dt); } }
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t)));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- note objects

/** Bars to strike; sweep for a glissando; where on the bar you hit is "spot". */
export class ChimeBars extends Playable {
  static defaultPart = "mallet";
  constructor(name = "Bars", o = {}) {
    super(name, { tint: "#9ccc65", ...o });
    this.count = o.count ?? 8;
    this.width = 0.56;
    this.depth = 0.24;
    this.noteLength = 0.6;
    this.box = { min: [-this.width / 2, 0, -this.depth / 2], max: [this.width / 2, 0.09, this.depth / 2] };
    this.dip = new Array(this.count).fill(0);
  }
  declareSources() { this.declare("spot", "Bars: hit spot", this.part, "model.position", 0.15, 0.85); }
  noteOf(i) { return this.kit.scale.step(this.kit.baseNote, i); }
  barAt(l) { return clamp(Math.floor(this.frac(l, 0) * this.count), 0, this.count - 1); }
  barLen(i) { return this.depth * lerp(1, 0.62, i / Math.max(this.count - 1, 1)); }
  barX(i) { return this.box.min[0] + (this.width / this.count) * (i + 0.5); }
  handDown(h) { const l = this.localOf(h), i = this.barAt(l); this.holds.set(h.id, i); this._strike(h, i, l); }
  handMove(h) {
    if (!this.holds.has(h.id)) return;
    const l = this.localOf(h), i = this.barAt(l);
    if (i !== this.holds.get(h.id)) { this.holds.set(h.id, i); this._strike(h, i, l); }
  }
  handUp(h) { this.holds.delete(h.id); }
  _strike(h, i, l) {
    const s = h.strikeStrength(this.worldDir([0, 1, 0]));
    this.send("spot", clamp(Math.abs(l[2]) / (this.barLen(i) / 2), 0, 1));
    this.kit.strike(this.part, this.noteOf(i), s, this.noteLength);
    this.flash(i);
    this.dip[i] = 0.12;
    h.pulse(s * 0.6);
  }
  update(dt) { this.tickFlashes(dt); for (let i = 0; i < this.count; i++) this.dip[i] = Math.max(0, this.dip[i] - dt); }
  shapes() {
    const out = [{ box: [[0, 0, 0], [this.width + 0.02, 0.02, this.depth * 0.55]], color: "#2a3644" }];
    const w = this.width / this.count;
    for (let i = 0; i < this.count; i++) {
      out.push({ box: [[this.barX(i), 0.025 - (this.dip[i] > 0 ? 0.008 : 0), 0], [w * 0.82, 0.025, this.barLen(i)]], color: mix(this.tint, "#ffd166", i / (this.count - 1)), glow: this.glowOf(i) });
    }
    return out;
  }
  labels() { return Array.from({ length: this.count }, (_, i) => ({ text: noteName(this.noteOf(i), false), at: [this.barX(i), 0.06, this.barLen(i) / 2 - 0.02], size: 11 })); }
}

/** A frame of strings: touch to pluck, pull to bend, sweep to strum. */
export class LightStrings extends Playable {
  static defaultPart = "harp";
  constructor(name = "Strings", o = {}) {
    super(name, { tint: "#7ad7ff", ...o });
    this.count = 7;
    this.width = 0.42;
    this.height = 0.36;
    this.maxBend = 2;
    this.box = { min: [-this.width / 2, 0.03, -0.05], max: [this.width / 2, 0.03 + this.height, 0.05] };
    this.wobble = new Array(this.count).fill(0);
    this.t = 0;
  }
  declareSources() { this.declare("pull", "Strings: pull", this.part, "model.brightness", 0.35, 1); }
  noteOf(i) { return this.kit.scale.step(this.kit.baseNote, i); }
  stringAt(l) { return clamp(Math.floor(this.frac(l, 0) * this.count), 0, this.count - 1); }
  stringX(i) { return this.box.min[0] + (this.width * (i + 0.5)) / this.count; }
  dragPlane(hit) { return this.facePlane(hit); }
  handDown(h) { const l = this.localOf(h); this._pluck(h, this.stringAt(l), l); }
  handMove(h) {
    const st = this.holds.get(h.id);
    if (!st) return;
    const l = this.localOf(h), i = this.stringAt(l);
    if (i !== st.string) { this.kit.endNote(st.voice); this._pluck(h, i, l); return; }
    const d = sub(l, st.start);
    const pull = clamp(h.isXR() ? Math.abs(d[2]) * 25 : Math.abs(d[1]) * 8, 0, 1);
    this.kit.moveNote(st.voice, this.noteOf(i) + pull * this.maxBend);
    this.send("pull", pull);
    this.wobble[i] = Math.max(this.wobble[i], pull * 0.01);
  }
  handUp(h) {
    const st = this.holds.get(h.id);
    if (!st) return;
    this.holds.delete(h.id);
    this.kit.later(() => this.kit.endNote(st.voice), 1.2);
    this.send("pull", 0);
  }
  _pluck(h, i, l) {
    const s = h.strikeStrength(this.worldDir([0, 0, 1]));
    const voice = this.kit.startNote(this.part, this.noteOf(i), s);
    this.holds.set(h.id, { voice, string: i, start: l });
    this.wobble[i] = 0.006 * (0.5 + s);
    this.flash(i, 0.6);
    h.pulse(s * 0.4);
  }
  update(dt) { this.t += dt; this.tickFlashes(dt); for (let i = 0; i < this.count; i++) this.wobble[i] *= Math.exp(-dt * 4); }
  shapes() {
    const f = "#3a4a5c", W = this.width, H = this.height;
    const out = [
      { box: [[0, 0, 0], [W + 0.04, 0.03, 0.06]], color: f },
      { box: [[0, H + 0.03, 0], [W + 0.04, 0.02, 0.04]], color: f },
      { box: [[-W / 2 - 0.01, 0, 0], [0.02, H + 0.05, 0.04]], color: f },
      { box: [[W / 2 + 0.01, 0, 0], [0.02, H + 0.05, 0.04]], color: f },
    ];
    for (let i = 0; i < this.count; i++) {
      const x = this.stringX(i), z = Math.sin(this.t * 90 + i) * this.wobble[i];
      out.push({ box: [[x, 0.03, z], [0.005, H, 0.005]], color: mix(this.tint, "#ffffff", (i / this.count) * 0.5), glow: this.glowOf(i, 0.6) });
    }
    return out;
  }
  labels() { return Array.from({ length: this.count }, (_, i) => ({ text: noteName(this.noteOf(i), false), at: [this.stringX(i), 0.05, 0.035], size: 10 })); }
}

/** A field you play in the air: left-right pitch, height and depth shape it. */
export class ThereminOrb extends Playable {
  static defaultPart = "lead";
  constructor(name = "Orb", o = {}) {
    super(name, { tint: "#ff4f9a", ...o });
    this.size = [0.44, 0.36, 0.3];
    this.octaves = 2;
    this.lowOffset = -12;
    this.box = { min: [-0.22, 0.06, -0.15], max: [0.22, 0.42, 0.15] };
    this.voice = 0;
    this.handId = -1;
    this.marker = null;
  }
  declareSources() {
    this.declare("height", "Orb: height", this.part, "filter.cutoff", 0.25, 0.9);
    this.declare("depth", "Orb: depth", this.part, "vibrato.depth", 0, 0.6);
  }
  pitchAt(l) { return this.kit.baseNote + this.lowOffset + this.frac(l, 0) * this.octaves * 12; }
  dragPlane() { return { p: this.world([0, 0.24, 0]), n: this.worldDir([0, 0, 1]) }; }
  handDown(h) {
    if (this.handId !== -1) return;
    this.handId = h.id;
    const l = this.localOf(h);
    this.voice = this.kit.startNote(this.part, this.pitchAt(l), 0.4 + 0.5 * h.strikeStrength());
    this._shape(l);
  }
  handMove(h) { if (h.id !== this.handId) return; const l = this.localOf(h); this.kit.moveNote(this.voice, this.pitchAt(l)); this._shape(l); }
  handUp(h) { if (h.id !== this.handId) return; this.handId = -1; this.kit.endNote(this.voice); this.voice = 0; this.marker = null; }
  _shape(l) {
    this.send("height", this.frac(l, 1));
    this.send("depth", 1 - this.frac(l, 2));
    this.marker = [0, 1, 2].map((i) => lerp(this.box.min[i], this.box.max[i], this.frac(l, i)));
  }
  shapes() {
    const [W, H, D] = this.size, cy = 0.06 + H / 2;
    const out = [{ box: [[0, 0, 0], [W, 0.03, D]], color: "#2a3644" }];
    const glow = this.marker ? 0.3 + this.frac(this.marker, 1) * 1.2 : 0.1;
    out.push({ box: [[0, cy - H / 2, 0], [W * 0.98, H, D * 0.98]], color: this.tint, alpha: 0.07, glow });
    // Three rings outline the field.
    for (const [ax, r1, r2] of [[1, W / 2, D / 2], [2, W / 2, H / 2], [0, D / 2, H / 2]]) {
      for (let k = 0; k < 32; k++) {
        const pt = (a) => ax === 1 ? [Math.sin(a) * r1, cy, Math.cos(a) * r2] : ax === 2 ? [Math.sin(a) * r1, cy + Math.cos(a) * r2, 0] : [0, cy + Math.cos(a) * r2, Math.sin(a) * r1];
        out.push({ line: [pt((k / 32) * Math.PI * 2), pt(((k + 1) / 32) * Math.PI * 2)], color: this.tint, alpha: 0.5 });
      }
    }
    const lo = this.kit.baseNote + this.lowOffset;
    for (let n = lo; n <= lo + this.octaves * 12; n++) {
      if (this.kit.scale.enabled && !this.kit.scale.inScale(n)) continue;
      const x = this.box.min[0] + ((n - lo) / (this.octaves * 12)) * W, tonic = mod(n - this.kit.scale.root, 12) === 0;
      out.push({ line: [[x, 0.032, -D / 2], [x, 0.032, D / 2]], color: this.tint, alpha: tonic ? 0.9 : 0.35 });
    }
    if (this.marker) out.push({ box: [[this.marker[0], this.marker[1] - 0.015, this.marker[2]], [0.03, 0.03, 0.03]], color: "#ffffff", glow: 3 });
    return out;
  }
}

/** A strip to slide along for a continuous glide. */
export class PitchRibbon extends Playable {
  static defaultPart = "bass";
  constructor(name = "Ribbon", o = {}) {
    super(name, { tint: "#2ec4b6", ...o });
    this.length = o.length ?? 0.7;
    this.width = 0.07;
    this.octaves = 2;
    this.lowOffset = -24;
    this.box = { min: [-this.length / 2, 0, -this.width / 2], max: [this.length / 2, 0.06, this.width / 2] };
    this.glowX = null;
  }
  declareSources() {
    this.declare("across", "Ribbon: across", this.part, "filter.cutoff", 0.15, 0.7);
    this.declare("press", "Ribbon: press", this.part, "filter.emphasis", 0.1, 0.8);
  }
  pitchAt(l) { return this.kit.baseNote + this.lowOffset + this.frac(l, 0) * this.octaves * 12; }
  handDown(h) { const l = this.localOf(h); this.holds.set(h.id, this.kit.startNote(this.part, this.pitchAt(l), 0.5 + 0.5 * h.strikeStrength(this.worldDir([0, 1, 0])))); this._shape(l); }
  handMove(h) { if (!this.holds.has(h.id)) return; const l = this.localOf(h); this.kit.moveNote(this.holds.get(h.id), this.pitchAt(l)); this._shape(l); }
  handUp(h) { if (this.holds.has(h.id)) { this.kit.endNote(this.holds.get(h.id)); this.holds.delete(h.id); } if (!this.holds.size) this.glowX = null; }
  _shape(l) { this.send("across", this.frac(l, 2)); this.send("press", 1 - this.frac(l, 1)); this.glowX = clamp(l[0], this.box.min[0], this.box.max[0]); }
  shapes() {
    const out = [{ box: [[0, 0, 0], [this.length, 0.015, this.width]], color: mix(this.tint, "#000000", 0.5), glow: 0.2 }];
    const lo = this.kit.baseNote + this.lowOffset;
    for (let n = lo; n <= lo + this.octaves * 12; n++) {
      const on = this.kit.scale.enabled ? this.kit.scale.inScale(n) : [0, 2, 4, 5, 7, 9, 11].includes(mod(n, 12));
      if (!on) continue;
      const x = this.box.min[0] + ((n - lo) / (this.octaves * 12)) * this.length, tonic = mod(n - this.kit.scale.root, 12) === 0;
      out.push({ line: [[x, 0.017, -this.width / 2], [x, 0.017, tonic ? this.width / 2 : 0]], color: "#ffffff", alpha: tonic ? 0.9 : 0.3 });
    }
    if (this.glowX != null) out.push({ box: [[this.glowX, 0.01, 0], [0.02, 0.018, this.width]], color: "#ffffff", glow: 3 });
    return out;
  }
}

/** Eight drum pads; the rim is brighter than the middle (sets that voice's tone). */
export class DrumPads extends Playable {
  static defaultPart = "drums";
  static PADS = [[36, "Kick", "kick"], [38, "Snare", "snare"], [39, "Clap", "clap"], [42, "Hat", "chat"], [45, "Low tom", "ltom"], [50, "High tom", "htom"], [46, "Open hat", "ohat"], [49, "Cymbal", "cymbal"]];
  constructor(name = "Pads", o = {}) {
    super(name, { tint: "#ff8a3d", ...o });
    this.pad = 0.13;
    this.box = { min: [-0.26, 0, -0.13], max: [0.26, 0.07, 0.13] };
    this.squash = new Array(8).fill(0);
  }
  center(i) { return [this.box.min[0] + this.pad * ((i % 4) + 0.5), 0, this.box.min[2] + this.pad * (Math.floor(i / 4) + 0.5)]; }
  padAt(l) { return Math.min(clamp(Math.floor(this.frac(l, 2) * 2), 0, 1) * 4 + clamp(Math.floor(this.frac(l, 0) * 4), 0, 3), 7); }
  handDown(h) {
    const l = this.localOf(h), i = this.padAt(l), c = this.center(i);
    this.holds.set(h.id, i);
    const edge = clamp(Math.hypot(l[0] - c[0], l[2] - c[2]) / (this.pad * 0.42), 0, 1);
    this.kit.setKnob(this.part, `${DrumPads.PADS[i][2]}.tone`, lerp(0.3, 0.85, edge));
    const s = h.strikeStrength(this.worldDir([0, 1, 0]), 2.5);
    this.kit.strike(this.part, DrumPads.PADS[i][0], s, 0.1, false);
    this.flash(i, 0.15);
    this.squash[i] = 0.1;
    h.pulse(s);
  }
  handMove(h) { if (h.isXR() || !this.holds.has(h.id)) return; if (this.padAt(this.localOf(h)) !== this.holds.get(h.id)) this.handDown(h); }
  handUp(h) { this.holds.delete(h.id); }
  update(dt) { this.tickFlashes(dt); for (let i = 0; i < 8; i++) this.squash[i] = Math.max(0, this.squash[i] - dt); }
  shapes() {
    const out = [{ box: [[0, 0, 0], [0.54, 0.02, 0.28]], color: "#2a3644" }];
    for (let i = 0; i < 8; i++) {
      const c = this.center(i), hgt = this.squash[i] > 0 ? 0.012 : 0.025;
      out.push({ box: [[c[0], 0.02, c[2]], [this.pad * 0.82, hgt, this.pad * 0.82]], color: mix(this.tint, "#ff4f9a", i / 8), glow: this.glowOf(i) });
    }
    return out;
  }
  labels() { return DrumPads.PADS.map((p, i) => ({ text: p[1], at: add(this.center(i), [0, 0.05, 0]), size: 10 })); }
}

/** Blocks that hold the chords of the key; lift your hand above to open the sound. */
export class ChordBlocks extends Playable {
  static defaultPart = "keys";
  constructor(name = "Blocks", o = {}) {
    super(name, { tint: "#ffd166", ...o });
    this.count = 7;
    this.block = 0.08;
    this.gap = 0.015;
    this.reach = 0.3;
    this.sevenths = false;
    /** Another part that doubles every chord an octave lower (a pad under the keys); "" for none. */
    this.layerPart = o.layerPart ?? "pad";
    const w = this.count * this.block + (this.count - 1) * this.gap;
    this.width = w;
    this.box = { min: [-w / 2, 0, -this.block / 2], max: [w / 2, this.block + this.reach, this.block / 2] };
    this.lift = new Array(this.count).fill(0);
  }
  declareSources() { this.declare("lift", "Blocks: lift", this.part, "filter.cutoff", 0.3, 0.95); }
  chordOf(i) { return this.kit.scale.chord(this.kit.baseNote - 12, i, this.sevenths); }
  /** Pointers hit the blocks themselves; the reach above them is for XR hands. */
  pickBox() { return { min: this.box.min, max: [this.box.max[0], this.block + 0.01, this.box.max[2]] }; }
  blockAt(l) { return clamp(Math.floor(this.frac(l, 0) * this.count), 0, this.count - 1); }
  blockX(i) { return -this.width / 2 + this.block / 2 + i * (this.block + this.gap); }
  dragPlane(hit) { return this.facePlane(hit); }
  handDown(h) {
    const l = this.localOf(h);
    if (h.isXR() && l[1] > this.block + 0.015) return;
    const i = this.blockAt(l), s = h.strikeStrength(this.worldDir([0, 1, 0]));
    const voices = this.chordOf(i).flatMap((n) => [
      this.kit.startNote(this.part, n, 0.45 + 0.45 * s),
      ...(this.layerPart ? [this.kit.startNote(this.layerPart, n - 12, 0.6)] : []),
    ]);
    this.holds.set(h.id, { i, voices, y0: l[1] });
    this.flash(i, 0.4);
    h.pulse(s * 0.5);
  }
  handMove(h) {
    const st = this.holds.get(h.id);
    if (!st) { if (h.isXR()) this.handDown(h); return; }
    const l = this.localOf(h);
    const lift = clamp(h.isXR() ? (l[1] - this.block) / this.reach : (l[1] - st.y0) / (this.reach * 0.6), 0, 1);
    this.send("lift", lift);
    this.lift[st.i] = lift;
    if (!h.isXR() && this.blockAt(l) !== st.i && l[1] - st.y0 < 0.02) { this.handUp(h); this.handDown(h); }
  }
  handUp(h) {
    const st = this.holds.get(h.id);
    if (!st) return;
    this.holds.delete(h.id);
    for (const v of st.voices) this.kit.endNote(v);
    this.lift[st.i] = 0;
  }
  update(dt) { this.tickFlashes(dt); }
  shapes() {
    return Array.from({ length: this.count }, (_, i) => ({ box: [[this.blockX(i), this.lift[i] * 0.03, 0], [this.block, this.block, this.block]], color: mix(this.tint, "#ff8a3d", i / this.count), glow: this.glowOf(i) }));
  }
  labels() { return Array.from({ length: this.count }, (_, i) => ({ text: this.kit.scale.chordName(this.kit.baseNote - 12, i), at: [this.blockX(i), this.block + 0.01, 0], size: 11 })); }
}

/** A music-box disc: tap to place pegs, flick to spin, pegs play at the comb. */
export class MusicBoxWheel extends Playable {
  static defaultPart = "mallet";
  constructor(name = "MusicBox", o = {}) {
    super(name, { tint: "#ffd166", ...o });
    this.radius = 0.13;
    this.rings = 6;
    this.slots = 16;
    this.maxRps = 2;
    this.friction = 0.25;
    this.motorRps = 0;
    this.rps = 0;
    this.rot = 0;
    this.pegs = new Set(); // "ring,slot"
    this.box = { min: [-this.radius, 0, -this.radius], max: [this.radius, 0.06, this.radius] };
  }
  declareSources() { this.kit.patches.register(this.sourceName("speed"), "Music box: speed"); }
  ringR(r) { return lerp(this.radius * 0.3, this.radius * 0.9, r / (this.rings - 1)); }
  noteOf(r) { return this.kit.scale.step(this.kit.baseNote, r); }
  cellAt(l) {
    const r = Math.hypot(l[0], l[2]);
    const ring = clamp(Math.round(((r - this.radius * 0.3) / (this.radius * 0.6)) * (this.rings - 1)), 0, this.rings - 1);
    const a = mod(Math.atan2(l[0], l[2]) - this.rot, Math.PI * 2);
    return [ring, Math.round(a / ((Math.PI * 2) / this.slots)) % this.slots];
  }
  togglePeg([ring, slot]) { const k = `${ring},${slot}`; if (this.pegs.has(k)) { this.pegs.delete(k); return false; } this.pegs.add(k); return true; }
  spin(rps) { this.rps = clamp(rps, -this.maxRps, this.maxRps); }
  handDown(h) { const l = this.localOf(h); this.holds.set(h.id, { a: Math.atan2(l[0], l[2]), t: performance.now(), v: 0, moved: 0, l }); }
  handMove(h) {
    const g = this.holds.get(h.id);
    if (!g) return;
    const l = this.localOf(h), a = Math.atan2(l[0], l[2]), now = performance.now();
    const dt = Math.max((now - g.t) / 1000, 1e-3), da = angleDiff(g.a, a);
    g.moved += Math.abs(da);
    if (g.moved > 0.15) { this.advance(da); g.v = lerp(g.v, da / (Math.PI * 2) / dt, 0.5); this.rps = g.v; }
    g.a = a;
    g.t = now;
  }
  handUp(h) {
    const g = this.holds.get(h.id);
    if (!g) return;
    this.holds.delete(h.id);
    if (g.moved <= 0.15) { this.togglePeg(this.cellAt(g.l)); h.pulse(0.3); } else this.spin(g.v);
  }
  wheel(h, steps) { this.spin(this.rps + steps * 0.1); }
  update(dt) {
    this.tickFlashes(dt);
    if (!this.holds.size) {
      if (this.motorRps) this.rps = lerp(this.rps, this.motorRps, 1 - Math.exp(-dt * 2));
      else { this.rps *= Math.exp(-this.friction * dt); if (Math.abs(this.rps) < 0.01) this.rps = 0; }
      this.advance(this.rps * Math.PI * 2 * dt);
    }
    this.send("speed", clamp(Math.abs(this.rps) / this.maxRps, 0, 1));
  }
  advance(da) {
    if (!da) return;
    const before = this.rot, step = (Math.PI * 2) / this.slots, T = Math.PI * 2;
    this.rot += da;
    let crossed = false;
    for (const k of this.pegs) {
      const [ring, slot] = k.split(",").map(Number), off = slot * step;
      if (Math.floor((before + off) / T) !== Math.floor((this.rot + off) / T)) {
        this.kit.strike(this.part, this.noteOf(ring), 0.75, 0.35);
        this.flash(k, 0.3);
        crossed = true;
      }
    }
    if (crossed) this.flash("comb", 0.15);
  }
  shapes() {
    const out = [{ box: [[0, 0.01, 0], [this.radius * 2, 0.01, this.radius * 2]], color: "#2a3644", yaw: this.rot }];
    for (let r = 0; r < this.rings; r++) {
      const R = this.ringR(r);
      for (let k = 0; k < 40; k++) {
        const a1 = (k / 40) * Math.PI * 2, a2 = ((k + 1) / 40) * Math.PI * 2;
        out.push({ line: [[Math.sin(a1) * R, 0.021, Math.cos(a1) * R], [Math.sin(a2) * R, 0.021, Math.cos(a2) * R]], color: this.tint, alpha: 0.25 });
      }
    }
    for (const k of this.pegs) {
      const [ring, slot] = k.split(",").map(Number), a = slot * ((Math.PI * 2) / this.slots) + this.rot, R = this.ringR(ring);
      out.push({ box: [[Math.sin(a) * R, 0.02, Math.cos(a) * R], [0.012, 0.014, 0.012]], color: mix(this.tint, "#ff8a3d", ring / this.rings), glow: this.glowOf(k, 0.8) });
    }
    out.push({ box: [[0, 0.025, (this.radius + this.radius * 0.3) / 2], [0.01, 0.02, this.radius * 0.7 + 0.02]], color: "#ffffff", glow: this.glowOf("comb", 1.2) });
    return out;
  }
}

// ---------------------------------------------------------------- shaping objects

/** A knob: drag around it, wheel, or grip and twist your wrist (XR). */
export class TwistDial extends Playable {
  constructor(name = "Dial", o = {}) {
    super(name, { tint: "#9b7bff", ...o });
    this.radius = 0.06;
    this.label = o.label ?? "Dial";
    this.value = o.value ?? 0.5;
    this.target = [o.toPart ?? "keys", o.toParam ?? "filter.cutoff"];
    this.box = { min: [-0.06, 0, -0.06], max: [0.06, 0.07, 0.06] };
  }
  static SWEEP = (270 * Math.PI) / 180;
  declareSources() { this.declare("turn", `${this.label}: turn`, ...this.target); this.send("turn", this.value); }
  setValue(v) { this.value = clamp(v, 0, 1); this.send("turn", this.value); }
  _angle(l) { return Math.atan2(-l[0], -l[2]); }
  handDown(h) { this.holds.set(h.id, { a: this._angle(this.localOf(h)), roll: h.roll(), v: this.value, grip: h.grip }); h.pulse(0.2); }
  handMove(h) {
    const g = this.holds.get(h.id);
    if (!g) return;
    if (h.grip !== g.grip) Object.assign(g, { a: this._angle(this.localOf(h)), roll: h.roll(), v: this.value, grip: h.grip });
    if (h.isXR() && h.grip) this.setValue(g.v - angleDiff(g.roll, h.roll()) / TwistDial.SWEEP);
    else { const a = this._angle(this.localOf(h)); this.setValue(this.value - angleDiff(g.a, a) / TwistDial.SWEEP); g.a = a; }
  }
  handUp(h) { this.holds.delete(h.id); }
  wheel(h, steps) { this.setValue(this.value + steps * 0.03); }
  shapes() {
    const yaw = TwistDial.SWEEP / 2 - this.value * TwistDial.SWEEP;
    return [
      { box: [[0, 0, 0], [0.13, 0.01, 0.13]], color: "#2a3644" },
      { box: [[0, 0.01, 0], [0.1, 0.045, 0.1]], color: this.tint, glow: 0.2, yaw },
      { box: [[-Math.sin(yaw) * 0.025, 0.055, -Math.cos(yaw) * 0.025], [0.008, 0.006, 0.05]], color: "#ffffff", glow: 2, yaw },
    ];
  }
  labels() { return [{ text: `${this.label}
→ ${this.patchText("turn")}`, at: [0, 0.01, 0.09], size: 11 }]; }
}

/** A fader; with springBack a lever that returns to rest (patch to "@bend" for a whammy). */
export class SlideFader extends Playable {
  constructor(name = "Fader", o = {}) {
    super(name, { tint: "#ffb547", ...o });
    this.length = 0.22;
    this.label = o.label ?? "Fader";
    this.springBack = !!o.springBack;
    this.rest = o.rest ?? 0.5;
    this.value = this.springBack ? this.rest : (o.value ?? 0.5);
    this.target = [o.toPart ?? "keys", o.toParam ?? "reverb.mix"];
    this.held = 0;
    this.box = { min: [-0.04, 0, -0.13], max: [0.04, 0.08, 0.13] };
  }
  declareSources() { this.declare("slide", `${this.label}: slide`, ...this.target); this.send("slide", this.value); }
  zOf(v) { return this.length / 2 - v * this.length; }
  setValue(v) { this.value = clamp(v, 0, 1); this.send("slide", this.value); }
  handDown(h) { this.held++; this.handMove(h); h.pulse(0.2); }
  handMove(h) { this.setValue((this.length / 2 - this.localOf(h)[2]) / this.length); }
  handUp() { this.held = Math.max(0, this.held - 1); }
  wheel(h, steps) { this.setValue(this.value + steps * 0.04); }
  update(dt) {
    if (this.springBack && !this.held && Math.abs(this.value - this.rest) > 0.001) {
      this.setValue(lerp(this.value, this.rest, 1 - Math.exp(-dt * 14)));
      if (Math.abs(this.value - this.rest) < 0.004) this.setValue(this.rest);
    }
  }
  shapes() {
    const out = [{ box: [[0, 0, 0], [0.05, 0.012, this.length + 0.03]], color: "#2a3644" }, { box: [[0, 0.004, 0], [0.006, 0.012, this.length]], color: "#0b1016" }];
    if (this.springBack) out.push({ box: [[0, 0.004, this.zOf(this.rest)], [0.05, 0.014, 0.004]], color: "#8d9aab" });
    out.push({ box: [[0, 0.013, this.zOf(this.value)], [0.05, 0.03, 0.025]], color: this.tint, glow: 0.25 });
    return out;
  }
  labels() { return [{ text: `${this.label}
→ ${this.patchText("slide")}`, at: [0, 0.01, this.length / 2 + 0.035], size: 11 }]; }
}

/** A square with a puck: two knobs at once. */
export class XYPad extends Playable {
  constructor(name = "XY", o = {}) {
    super(name, { tint: "#7ad7ff", ...o });
    this.size = 0.18;
    this.label = o.label ?? "XY";
    this.x = 0.5;
    this.y = 0.5;
    this.targets = [o.toPart ?? "keys", o.xParam ?? "filter.cutoff", o.yParam ?? "filter.resonance"];
    this.box = { min: [-0.09, 0, -0.09], max: [0.09, 0.06, 0.09] };
  }
  declareSources() {
    const [part, xp, yp] = this.targets;
    this.declare("x", `${this.label}: x`, part, xp);
    this.declare("y", `${this.label}: y`, part, yp, 0, 0.7);
    this.send("x", this.x);
    this.send("y", this.y);
  }
  setXY(x, y) { this.x = clamp(x, 0, 1); this.y = clamp(y, 0, 1); this.send("x", this.x); this.send("y", this.y); }
  handDown(h) { this.handMove(h); h.pulse(0.2); }
  handMove(h) { const l = this.localOf(h); this.setXY(this.frac(l, 0), 1 - this.frac(l, 2)); }
  shapes() {
    const S = this.size, out = [{ box: [[0, 0, 0], [S, 0.012, S]], color: "#1b2a38", glow: 0.1 }];
    for (let i = 0; i <= 4; i++) {
      const t = -S / 2 + (S * i) / 4;
      out.push({ line: [[t, 0.013, -S / 2], [t, 0.013, S / 2]], color: this.tint, alpha: 0.25 }, { line: [[-S / 2, 0.013, t], [S / 2, 0.013, t]], color: this.tint, alpha: 0.25 });
    }
    out.push({ box: [[-S / 2 + this.x * S, 0.012, S / 2 - this.y * S], [0.034, 0.02, 0.034]], color: this.tint, glow: 0.8 });
    return out;
  }
  labels() { return [{ text: `${this.label}
↔ ${this.patchText("x")}
↕ ${this.patchText("y")}`, at: [0, 0.01, this.size / 2 + 0.03], size: 11 }]; }
}

/** A wheel to flick; its spin speed drives a knob and slows by itself. */
export class Flywheel extends Playable {
  constructor(name = "Flywheel", o = {}) {
    super(name, { tint: "#2ec4b6", ...o });
    this.radius = 0.08;
    this.maxRps = 3;
    this.friction = 0.35;
    this.label = o.label ?? "Flywheel";
    this.target = [o.toPart ?? "mallet", o.toParam ?? "perf.tremolo"];
    this.rps = 0;
    this.rot = 0;
    this.box = { min: [-0.08, 0, -0.08], max: [0.08, 0.06, 0.08] };
  }
  declareSources() { this.declare("speed", `${this.label}: speed`, ...this.target); this.send("speed", 0); }
  _angle(l) { return Math.atan2(l[0], l[2]); }
  spin(rps) { this.rps = clamp(rps, -this.maxRps, this.maxRps); }
  handDown(h) { this.holds.set(h.id, { a: this._angle(this.localOf(h)), t: performance.now(), v: 0 }); }
  handMove(h) {
    const g = this.holds.get(h.id);
    if (!g) return;
    const a = this._angle(this.localOf(h)), now = performance.now(), dt = Math.max((now - g.t) / 1000, 1e-3), da = angleDiff(g.a, a);
    this.rot += da;
    g.v = lerp(g.v, da / (Math.PI * 2) / dt, 0.5);
    this.rps = g.v;
    g.a = a;
    g.t = now;
  }
  handUp(h) { const g = this.holds.get(h.id); if (!g) return; this.spin(g.v); this.holds.delete(h.id); h.pulse(Math.abs(this.rps) / this.maxRps); }
  wheel(h, steps) { this.spin(this.rps + steps * 0.3); }
  update(dt) {
    if (!this.holds.size) {
      this.rps *= Math.exp(-this.friction * dt);
      if (Math.abs(this.rps) < 0.02) this.rps = 0;
      this.rot += this.rps * Math.PI * 2 * dt;
    }
    this.send("speed", Math.round(clamp(Math.abs(this.rps) / this.maxRps, 0, 1) * 250) / 250);
  }
  shapes() {
    const out = [{ box: [[0, 0, 0], [0.02, 0.02, 0.02]], color: "#2a3644" }, { box: [[0, 0.02, 0], [0.16, 0.012, 0.16]], color: mix(this.tint, "#000000", 0.3), glow: 0.15, yaw: this.rot }];
    for (let k = 0; k < 6; k++) {
      const a = this.rot + (k * Math.PI * 2) / 6;
      out.push({ box: [[Math.sin(a) * 0.036, 0.032, Math.cos(a) * 0.036], [0.008, 0.004, 0.072]], color: k ? this.tint : "#ffffff", glow: 1.2, yaw: a });
    }
    return out;
  }
  labels() { return [{ text: `${this.label}
→ ${this.patchText("speed")}`, at: [0, 0.01, this.radius + 0.03], size: 11 }]; }
}

/** A cube on a ball joint: tip it forward-back (pitch) and side to side (roll). */
export class TiltCube extends Playable {
  constructor(name = "Tilt", o = {}) {
    super(name, { tint: "#ff4f9a", ...o });
    this.cube = 0.09;
    this.maxTilt = (40 * Math.PI) / 180;
    this.springBack = !!o.springBack;
    this.label = o.label ?? "Tilt";
    this.targets = [o.toPart ?? "lead", o.pitchParam ?? "delay.mix", o.rollParam ?? "filter.resonance"];
    this.pitch = 0;
    this.rollA = 0;
    this.box = { min: [-0.072, 0, -0.072], max: [0.072, 0.144, 0.072] };
  }
  declareSources() {
    const [part, pp, rp] = this.targets;
    this.declare("pitch", `${this.label}: pitch`, part, pp, 0, 0.8);
    this.declare("roll", `${this.label}: roll`, part, rp, 0, 0.8);
    this._send();
  }
  setTilt(p, r) { this.pitch = clamp(p, -this.maxTilt, this.maxTilt); this.rollA = clamp(r, -this.maxTilt, this.maxTilt); this._send(); }
  _send() { this.send("pitch", 0.5 + (0.5 * this.pitch) / this.maxTilt); this.send("roll", 0.5 + (0.5 * this.rollA) / this.maxTilt); }
  dragPlane(hit) { return this.facePlane(hit); }
  handDown(h) { this.holds.set(h.id, { hp: h.pitch(), hr: h.roll(), p: this.pitch, r: this.rollA, l: this.localOf(h), grip: h.grip }); h.pulse(0.2); }
  handMove(h) {
    const g = this.holds.get(h.id);
    if (!g) return;
    if (h.grip !== g.grip) Object.assign(g, { hp: h.pitch(), hr: h.roll(), p: this.pitch, r: this.rollA, l: this.localOf(h), grip: h.grip });
    if (h.isXR() && h.grip) this.setTilt(g.p + (h.pitch() - g.hp), g.r - angleDiff(g.hr, h.roll()));
    else { const d = sub(this.localOf(h), g.l); this.setTilt(g.p + (d[1] / 0.12) * this.maxTilt, g.r + (d[0] / 0.12) * this.maxTilt); }
  }
  handUp(h) { this.holds.delete(h.id); }
  update(dt) {
    if (this.springBack && !this.holds.size && (Math.abs(this.pitch) > 0.001 || Math.abs(this.rollA) > 0.001)) {
      const k = Math.exp(-dt * 8);
      this.setTilt(this.pitch * k, this.rollA * k);
    }
  }
  shapes() {
    const c = this.cube;
    return [
      { box: [[0, 0, 0], [0.04, 0.03, 0.04]], color: "#3a4a5c" },
      { box: [[0, 0.03, 0], [c, c, c]], color: this.tint, glow: 0.3, pitch: -this.pitch, roll: -this.rollA, pivot: [0, 0.03, 0] },
    ];
  }
  labels() { return [{ text: `${this.label}
⇅ ${this.patchText("pitch")}
⇄ ${this.patchText("roll")}`, at: [0, 0.01, 0.1], size: 11 }]; }
}

/** LOCK / KEY / SCALE buttons for the scale lock. */
export class ScaleSwitch extends Playable {
  constructor(name = "Scale", o = {}) {
    super(name, { tint: "#ffb547", ...o });
    this.button = 0.07;
    const w = 3 * this.button + 2 * 0.012;
    this.width = w;
    this.box = { min: [-w / 2, 0, -0.035], max: [w / 2, 0.05, 0.035] };
    this.down = -1;
  }
  bx(i) { return -this.width / 2 + this.button / 2 + i * (this.button + 0.012); }
  handDown(h) {
    const i = clamp(Math.floor(this.frac(this.localOf(h), 0) * 3), 0, 2);
    this.down = i;
    this.press(["lock", "key", "scale"][i]);
    this.flash(i, 0.2);
    h.pulse(0.4);
  }
  handUp() { this.down = -1; }
  press(what) {
    const sc = this.kit.scale;
    if (what === "lock") this.kit.action("lock");
    else if (what === "key") sc.root = sc.root + 1;
    else {
      const names = Object.keys(SCALES).filter((n) => n !== "chromatic");
      sc.scale = names[(names.indexOf(sc.scale) + 1) % names.length];
    }
    this.kit.action("scaleChanged", this.kit.scale.describe());
  }
  update(dt) { this.tickFlashes(dt); }
  shapes() {
    const out = [];
    for (let i = 0; i < 3; i++) {
      out.push({ box: [[this.bx(i), 0, 0], [this.button, 0.01, this.button]], color: "#2a3644" });
      const on = i !== 0 || this.kit.scale.enabled;
      out.push({ box: [[this.bx(i), 0.01, 0], [this.button * 0.85, this.down === i ? 0.012 : 0.018, this.button * 0.85]], color: on ? this.tint : "#5b6878", glow: this.glowOf(i, 0.2) });
    }
    return out;
  }
  labels() {
    const sc = this.kit.scale;
    return [`LOCK ${sc.enabled ? "ON" : "OFF"}`, `KEY ${NOTE_NAMES[sc.root]}`, sc.scale.toUpperCase()].map((text, i) => ({ text, at: [this.bx(i), 0.035, 0], size: 10 }));
  }
}

// ---------------------------------------------------------------- drivers

/** Picks the nearest object hit by a world ray: {obj, point, dist} or null. */
export function pickRay(objects, o, d, reach = Infinity) {
  let best = null;
  for (const obj of objects) {
    const t = obj.hitRay(o, d);
    if (t >= 0 && t <= reach && (!best || t < best.dist)) best = { obj, point: add(o, scl(d, t)), dist: t };
  }
  return best;
}

function planeHit(p, n, o, d) {
  const den = dot(n, d);
  if (Math.abs(den) < 1e-6) return null;
  const t = dot(n, sub(p, o)) / den;
  return t < 0 ? null : add(o, scl(d, t));
}

/** Mouse and multi-touch: press casts a ray, drags slide along the object's plane. */
export class PointerDriver {
  constructor(objects) { this.objects = objects; this.hands = new Map(); }
  /** ray = {o, d} world. Returns true if it landed on an object. */
  down(key, ray, kind = "mouse", id = 0) {
    if (this.hands.has(key)) this.up(key);
    const hit = pickRay(this.objects, ray.o, ray.d);
    if (!hit) return false;
    const h = new Hand(kind, id);
    h.position = hit.point;
    h.rayOrigin = ray.o;
    h.rayDir = ray.d;
    h.pressed = true;
    h.squeeze = 1;
    const plane = hit.obj.dragPlane(hit.point);
    this.hands.set(key, { h, obj: hit.obj, plane, last: hit.point, t: performance.now() });
    hit.obj.handDown(h);
    return true;
  }
  move(key, ray) {
    const st = this.hands.get(key);
    if (!st) return;
    const p = planeHit(st.plane.p, st.plane.n, ray.o, ray.d);
    if (!p) return;
    const now = performance.now(), dt = Math.max((now - st.t) / 1000, 1e-3);
    st.h.velocity = st.h.velocity.map((v, i) => lerp(v, (p[i] - st.last[i]) / dt, 0.5));
    st.h.position = p;
    st.last = p;
    st.t = now;
    st.obj.handMove(st.h);
  }
  up(key) {
    const st = this.hands.get(key);
    if (!st) return;
    this.hands.delete(key);
    st.h.pressed = false;
    st.obj.handUp(st.h);
  }
  wheel(ray, steps) {
    const hit = pickRay(this.objects, ray.o, ray.d);
    if (!hit) return false;
    const h = new Hand("mouse", 0);
    h.position = hit.point;
    hit.obj.wheel(h, steps);
    return true;
  }
  releaseAll() { for (const k of [...this.hands.keys()]) this.up(k); }
}

/**
 * WebXR hands and controllers. Each frame, pass one entry per input source:
 * {id, tip:[x,y,z], axes:{x,y,z}, ray:{o,d}, trigger 0..1, grip 0..1, buzz(s)}.
 * Touch to play (speed sets velocity), grip to hold on, trigger to play from afar.
 */
export class XRHandsDriver {
  constructor(objects) { this.objects = objects; this.state = new Map(); this.releaseMargin = 0.025; this.reach = 4; }
  update(inputs, dt) {
    const seen = new Set();
    for (const inp of inputs) {
      seen.add(inp.id);
      let st = this.state.get(inp.id);
      if (!st) { st = { h: new Hand("xr", 100 + this.state.size), mode: "", obj: null, plane: null, last: inp.tip, was: false }; this.state.set(inp.id, st); }
      const h = st.h;
      if (dt > 0) h.velocity = h.velocity.map((v, i) => lerp(v, (inp.tip[i] - st.last[i]) / dt, 0.6));
      st.last = inp.tip;
      h.basis = inp.axes || h.basis;
      h.rayOrigin = inp.ray?.o || inp.tip;
      h.rayDir = inp.ray?.d || [0, 0, -1];
      h.squeeze = inp.trigger || 0;
      h.grip = (inp.grip || 0) > 0.6;
      h.buzz = inp.buzz || null;
      const pressing = h.squeeze > 0.6 || h.grip;
      if (st.mode === "") {
        const obj = this._touching(inp.tip);
        if (obj) { h.position = inp.tip; h.pressed = true; st.mode = "touch"; st.obj = obj; obj.handDown(h); }
        else if (pressing && !st.was) {
          const hit = pickRay(this.objects, h.rayOrigin, h.rayDir, this.reach);
          if (hit) { st.plane = hit.obj.dragPlane(hit.point); h.position = hit.point; h.pressed = true; st.mode = "ray"; st.obj = hit.obj; hit.obj.handDown(h); }
        }
      } else if (st.mode === "touch") {
        h.position = inp.tip;
        if (st.obj.contains(inp.tip, this.releaseMargin) || h.grip) st.obj.handMove(h);
        else this._letGo(st);
      } else if (st.mode === "ray") {
        if (pressing) { const p = planeHit(st.plane.p, st.plane.n, h.rayOrigin, h.rayDir); if (p) { h.position = p; st.obj.handMove(h); } }
        else this._letGo(st);
      }
      st.was = pressing;
    }
    for (const [id, st] of this.state) if (!seen.has(id) && st.mode) this._letGo(st);
  }
  holding(id) { return this.state.get(id)?.obj || null; }
  _letGo(st) { st.h.pressed = false; st.obj?.handUp(st.h); st.mode = ""; st.obj = null; }
  _touching(tip) {
    let best = null, bd = Infinity;
    for (const o of this.objects) {
      if (!o.contains(tip)) continue;
      const d = len(sub(tip, o.world([0, 0, 0])));
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  releaseAll() { for (const st of this.state.values()) if (st.mode) this._letGo(st); }
}

// ---------------------------------------------------------------- the table layout

/** The Instrument Table's objects, same layout as the Godot scene. */
export function makeTable(kit, frame) {
  const o = (cls, name, pos, extra = {}) => new cls(name, { pos, frame, ...extra }).attach(kit);
  return [
    o(LightStrings, "Strings", [-0.55, 0, -0.36]),
    o(ThereminOrb, "Orb", [0, 0, -0.32]),
    o(MusicBoxWheel, "MusicBox", [0.52, 0, -0.3]),
    o(ScaleSwitch, "Scale", [0.83, 0, -0.33]),
    o(ChimeBars, "Bars", [-0.55, 0, -0.02]),
    o(ChordBlocks, "Blocks", [0.08, 0, -0.02]),
    o(DrumPads, "Pads", [0.69, 0, -0.02]),
    o(PitchRibbon, "Ribbon", [-0.64, 0, 0.3], { length: 0.55 }),
    o(TwistDial, "Dial", [-0.22, 0, 0.3], { label: "Keys tone", toPart: "keys", toParam: "filter.cutoff", value: 0.6 }),
    o(SlideFader, "Fader", [-0.04, 0, 0.3], { label: "Pad level", toPart: "pad", toParam: "@volume", value: 0.6 }),
    o(SlideFader, "Whammy", [0.1, 0, 0.3], { label: "Lead bend", springBack: true, toPart: "lead", toParam: "@bend", tint: "#ff4f9a" }),
    o(XYPad, "XY", [0.32, 0, 0.3], { label: "Bass filter", toPart: "bass", xParam: "filter.cutoff", yParam: "filter.emphasis" }),
    o(Flywheel, "Flywheel", [0.58, 0, 0.3], { label: "Shimmer" }),
    o(TiltCube, "Tilt", [0.83, 0, 0.3], { label: "Lead tilt" }),
  ];
}

export const TITLES = {
  Strings: "Light strings · harp", Orb: "Orb · lead", MusicBox: "Music box · mallet", Scale: "Scale",
  Bars: "Chime bars · mallet", Blocks: "Chord blocks · keys", Pads: "Drum pads", Ribbon: "Ribbon · bass",
};
