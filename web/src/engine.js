// The audio engine: a look-ahead clock that, every 16th step, asks the mixer
// what the current beacon blend should play and schedules it sample-accurately
// on the Web Audio instruments.

import { weigh } from "./beacons.js";
import { generateSong, ROLES } from "./song.js";
import { blend, Harmony, stepEvents, targetTempo } from "./mixer.js";
import { Bus, makeInstruments } from "./synths.js";

export class BeaconEngine {
  constructor(field) {
    this.ctx = null;
    this.running = false;
    this.overrides = new Map(); // beacon id -> song (loaded or edited songs)
    this.songCache = new Map();
    this.opts = { active: 3, sharpness: 1.5 };
    this.harmony = new Harmony();
    this.bpm = 108;
    this.tempoGlide = 0.35; // fraction of the gap closed per bar
    this.lookahead = 0.12;
    this.step = 0;
    this.nextTime = 0;
    this.volume = 0.8;
    this.listeners = new Set();
    this.recent = []; // recently played events, for the UI
    this.stepLog = [];
    this.setField(field);
  }

  setField(field) {
    this.field = field;
    this.songCache.clear();
    this.harmony = new Harmony({ hysteresis: this.harmony.hysteresis, phraseBars: this.harmony.phraseBars });
    this.pos = field.kind === "grid" ? { x: 0, y: 0 } : { lat: 0, lon: 0 };
    this.refresh();
  }

  songFor(beacon) {
    const id = typeof beacon === "string" ? beacon : beacon.id;
    if (this.overrides.has(id)) return this.overrides.get(id);
    let s = this.songCache.get(id);
    if (!s) {
      s = generateSong(`${this.field.kind}:${id}`);
      this.songCache.set(id, s);
    }
    return s;
  }

  setSong(id, song) {
    this.overrides.set(id, song);
    this.refresh();
  }

  setPosition(pos) {
    this.pos = this.field.clamp(pos);
    this.refresh();
  }

  /** Recomputes weights and the blended mix for the current position. */
  refresh() {
    this.weights = weigh(this.field, this.pos, this.opts);
    this.active = this.weights.map((n) => ({ id: n.id, w: n.w, d: n.d, beacon: n.beacon, song: this.songFor(n.beacon) }));
    this.mix = blend(this.active);
    if (this.harmony.id === null) this.harmony.update(this.active, 0);
    if (this.running) this._applyMix();
  }

  async start() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      this.bus = new Bus(this.ctx);
      this.inst = makeInstruments(this.bus);
    }
    await this.ctx.resume();
    this.bus.master.gain.value = this.volume;
    this.running = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.bpm = targetTempo(this.active);
    this.bus.setTempo(this.bpm);
    this._applyMix(0.01);
    this._timer = setInterval(() => this._tick(), 25);
    this._emit();
  }

  stop() {
    this.running = false;
    clearInterval(this._timer);
    if (this.inst) for (const r of ROLES) this.inst.channels[r].set("level", 0, 0.05);
    this._emit();
  }

  setVolume(v) {
    this.volume = v;
    if (this.bus) this.bus.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  _applyMix(tc = 0.15) {
    for (const role of ROLES) {
      const m = this.mix.roles[role];
      const ch = this.inst.channels[role];
      this.inst[role].setParams(m.params);
      ch.set("level", m.gain, tc);
      ch.set("reverb", m.params["reverb.send"] ?? (role === "drums" ? 0.08 : role === "bass" ? 0.04 : 0.2), tc);
      ch.set("delay", m.params["delay.send"] ?? 0, tc);
      if (role === "keys") ch.set("chorus", m.params["chorus.mix"] ?? 0.3, tc);
      if (role === "drums") ch.set("drive", m.params["master.drive"] ?? 0, tc);
    }
  }

  _tick() {
    if (!this.running) return;
    // A backgrounded tab can stall timers: skip ahead instead of bursting notes.
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < this.ctx.currentTime + this.lookahead) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += 60 / this.bpm / 4;
      this.step++;
    }
  }

  _playStep(n, t) {
    const bar = Math.floor(n / 16), s = n % 16;
    if (s === 0) {
      if (this.harmony.update(this.active, bar)) this._note("harmony", this.harmony.describe(bar));
      const target = targetTempo(this.active);
      this.bpm += (target - this.bpm) * this.tempoGlide;
      if (Math.abs(target - this.bpm) < 0.05) this.bpm = target;
      this.bus.setTempo(this.bpm);
    }
    const stepDur = 60 / this.bpm / 4;
    for (const ev of stepEvents(this.active, this.mix, this.harmony, bar, s)) {
      const inst = this.inst[ev.role];
      const dur = ev.gate * stepDur * 0.95;
      if (ev.role === "drums") inst.hit(ev.voice, t, ev.vel);
      else if (ev.role === "keys") inst.chord(ev.notes, t, dur, ev.vel);
      else inst.note(ev.notes[0], t, dur, ev.vel);
      this.recent.push({ ...ev, time: t });
    }
    if (this.recent.length > 200) this.recent.splice(0, this.recent.length - 200);
    this.position = { bar, step: s };
    this.stepLog.push({ time: t, bar, step: s });
    if (this.stepLog.length > 64) this.stepLog.shift();
  }

  /** The step the listener is hearing right now (scheduling runs ahead of it). */
  heardStep() {
    if (!this.ctx || !this.running) return null;
    const now = this.ctx.currentTime;
    let best = null;
    for (const e of this.stepLog) if (e.time <= now) best = e;
    return best;
  }

  /** What the UI shows. */
  state() {
    const bar = this.position?.bar ?? 0;
    return {
      running: this.running,
      bpm: this.bpm,
      targetBpm: targetTempo(this.active),
      bar, step: this.position?.step ?? 0,
      harmony: this.harmony.song ? this.harmony.describe(bar) : null,
      active: this.active,
      mix: this.mix,
    };
  }

  /** Events whose sound time has arrived, for flashing beacons and meters. */
  takeSounding() {
    if (!this.ctx) return [];
    const now = this.ctx.currentTime;
    const out = [];
    while (this.recent.length && this.recent[0].time <= now) out.push(this.recent.shift());
    return out;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const fn of this.listeners) fn("state", this.state()); }
  _note(type, data) { for (const fn of this.listeners) fn(type, data); }
}
