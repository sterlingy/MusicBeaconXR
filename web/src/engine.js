// The audio engine: a look-ahead clock that, every 16th step, asks the mixer
// what the current beacon blend should play and schedules it sample-accurately
// on the Web Audio instruments, or (synthMode "kit") on SynthKit's own
// instruments through its web module, the same engine as the Godot app.

import { weigh } from "./beacons.js";
import { chordNotes, generateSong, ROLES } from "./song.js";
import { blend, Harmony, stepEvents, targetTempo } from "./mixer.js";
import { Bus, makeInstruments } from "./synths.js";
import { songPosition } from "./form.js";
import { makeKitInstruments, padGain } from "./kit/kitplayer.js";

/** "web": the browser's own instruments (synths.js). "kit": SynthKit's, as in the app. */
export const SYNTH_MODES = ["web", "kit"];

/** Wall-clock seconds: the shared clock every beacon's song runs on. */
const wallNow = () => Date.now() / 1000;

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
    this.clockT = null; // song-clock time sampled at the last bar line (while playing)
    this.anchor = { t: 0, beat: 0, bpm: 108 }; // audio time -> beats, for automation
    this.beatAt = (t) => this.anchor.beat + ((t - this.anchor.t) * this.anchor.bpm) / 60;
    this.synthMode = "web";
    this.setField(field);
  }

  /**
   * Switches fields. With `keep`, the field is a re-centered copy of the same
   * kind (a local grid following the listener): songs, harmony and position
   * carry over, so the music doesn't jump.
   */
  setField(field, { keep = false } = {}) {
    const same = keep && this.field?.kind === field.kind;
    this.field = field;
    if (!same) {
      this.songCache.clear();
      this.harmony = new Harmony({ hysteresis: this.harmony.hysteresis, phraseBars: this.harmony.phraseBars });
      this.pos = field.kind === "grid" ? { x: 0, y: 0 } : { ...(field.center || { lat: 0, lon: 0 }) };
    }
    this.pos = field.clamp(this.pos);
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

  /**
   * Where each active song is. While playing, songs move on at bar lines
   * (sampled mid-bar, see _playStep), so walking around never jumps a song
   * to a different bar in the middle of one.
   */
  _position(t = this.running && this.clockT != null ? this.clockT : wallNow()) {
    for (const a of this.active) a.pos = songPosition(a.song, t);
    if (this.harmony.song) this.harmony.pos = this.active.find((a) => a.id === this.harmony.id)?.pos || songPosition(this.harmony.song, t);
  }

  /** Recomputes weights and the blended mix for the current position. */
  refresh() {
    this.weights = weigh(this.field, this.pos, this.opts);
    this.active = this.weights.map((n) => ({ id: n.id, w: n.w, d: n.d, beacon: n.beacon, song: this.songFor(n.beacon) }));
    this._position();
    this.mix = blend(this.active);
    if (this.harmony.id === null) this.harmony.update(this.active, 0);
    if (this.running) this._applyMix();
  }

  async start() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
      this.bus = new Bus(this.ctx);
    }
    await this.ctx.resume();
    if (!this.inst) await this._makeInstruments();
    this.bus.master.gain.value = this.volume;
    this.running = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.clockT = null;
    this.refresh();
    this.bpm = targetTempo(this.active);
    this._setTempo(this.bpm);
    this._applyMix(0.01);
    this._timer = setInterval(() => this._tick(), 25);
    this._emit();
  }

  /**
   * Picks the audio back up after the system paused it (screen lock, a phone
   * call, another app taking audio). Safe to call any time.
   */
  async resume() {
    if (!this.running || !this.ctx || this.ctx.state === "running") return;
    try { await this.ctx.resume(); } catch { return; }
    this.nextTime = this.ctx.currentTime + 0.05;
  }

  /**
   * While the page is hidden, browsers slow timers to as little as once a
   * second, so schedule further ahead then (moves still apply, a little later).
   */
  setBackground(hidden) {
    this.lookahead = hidden ? 1.5 : 0.12;
  }

  stop() {
    this.running = false;
    clearInterval(this._timer);
    if (this.inst) {
      for (const r of this._parts()) this.inst.channels[r].set("level", 0, 0.05);
      this.inst.stop?.();
    }
    this._emit();
  }

  /**
   * Picks the instruments ("web" or "kit"). Takes effect at once: a playing
   * engine restarts on the new set. If SynthKit can't load, it stays on "web".
   */
  async setSynthMode(mode) {
    if (!SYNTH_MODES.includes(mode) || mode === this.synthMode) return this.synthMode;
    const was = this.running;
    if (was) this.stop();
    this._dropInstruments();
    this.synthMode = mode;
    if (was) await this.start();
    else this._emit();
    return this.synthMode;
  }

  async _makeInstruments() {
    if (this.synthMode === "kit") {
      try {
        this.inst = await makeKitInstruments(this.bus);
        return;
      } catch (err) {
        console.warn("SynthKit couldn't load; using the browser instruments", err);
        this.synthMode = "web";
        this._note("synthError", String(err?.message || err));
      }
    }
    this.inst = makeInstruments(this.bus);
  }

  _dropInstruments() {
    if (!this.inst) return;
    if (this.inst.dispose) this.inst.dispose();
    else for (const r of ROLES) this.inst.channels[r].level.disconnect();
    this.inst = null;
  }

  /** Parts with a channel: the six song parts, plus SynthKit's pad. */
  _parts() { return this.inst?.parts || ROLES; }

  _setTempo(bpm) {
    this.bus.setTempo(bpm);
    this.inst?.setTempo?.(bpm);
  }

  setVolume(v) {
    this.volume = v;
    if (this.bus) this.bus.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  _applyMix(tc = 0.15) {
    for (const role of ROLES) {
      const m = this.mix.roles[role];
      const inst = this.inst[role];
      inst.setParams(m.params);
      inst.setAutomation(m.automation, this.beatAt);
      this.inst.channels[role].set("level", m.gain, tc);
      inst.applyChannel(this.ctx.currentTime, tc);
    }
    if (this.inst.pad) this.inst.channels.pad.set("level", padGain(this.active), tc);
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
      // Move every song to the bar it's on at the middle of this bar, then
      // re-blend: sections change layers, brightness and chords on bar lines.
      this.clockT = wallNow() + (t - this.ctx.currentTime) + 120 / this.bpm;
      this._position();
      this.mix = blend(this.active);
      this._applyMix(0.25);
      if (this.harmony.update(this.active, bar)) this._note("harmony", this.harmony.describe(bar));
      this.harmony.pos = this.active.find((a) => a.id === this.harmony.id)?.pos || songPosition(this.harmony.song, this.clockT);
      const target = targetTempo(this.active);
      this.bpm += (target - this.bpm) * this.tempoGlide;
      if (Math.abs(target - this.bpm) < 0.05) this.bpm = target;
      this._setTempo(this.bpm);
      // SynthKit's pad holds the harmony's chord (root, third, fifth, seventh).
      if (this.inst.pad && this.harmony.song && padGain(this.active) > 0.001) {
        this.inst.pad.hold(chordNotes(this.harmony.song.key, this.harmony.chordDegree(bar), 3, 4), t);
      }
    }
    const stepDur = 60 / this.bpm / 4;
    this.anchor = { t, beat: n / 4, bpm: this.bpm };
    // Automated sends, chorus and drive move continuously, so update them every step.
    for (const role of ROLES) {
      const a = this.mix.roles[role].automation;
      if (a && (a["reverb.send"] || a["delay.send"] || a["chorus.mix"] || a["master.drive"] || a.drive)) this.inst[role].applyChannel(t, 0.03);
    }
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
      synthMode: this.synthMode,
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
