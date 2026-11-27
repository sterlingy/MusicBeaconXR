// Plays MusicInputKit's events in the browser: the web twin of SynthBridge.
// Strikes (bars, strings, music box, drums) use the Web Audio instruments in
// synths.js; held notes (orb, ribbon, chord blocks) use LiveVoice below, which
// can bend, wobble and follow knob moves while it sounds.
//
// Knob ids match the Godot side's where they can, so the same patches work in
// both: filter.cutoff, filter.resonance, vibrato.depth, reverb.mix, @bend...

import { Bus, Channel, Driftwood, Pulsar, mtof } from "../synths.js";
import * as Remix from "../remix.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const logMap = (lo, hi) => (v) => lo * Math.pow(hi / lo, v);
const linMap = (lo, hi) => (v) => lo + (hi - lo) * v;

/** Held-note parts: oscillators, envelope and starting knob values. */
const LIVE = {
  keys: { waves: ["sawtooth", "sawtooth"], det: [-7, 7], mult: [1, 1], amp: 0.13, attack: 0.03, release: 0.9, cutoff: 2400, q: 0.9, chorus: true },
  lead: { waves: ["sine", "triangle"], det: [0, 4], mult: [1, 2], amp: 0.2, attack: 0.02, release: 0.35, cutoff: 5000, q: 1.5 },
  bass: { waves: ["sawtooth", "square"], det: [-5, 5], mult: [1, 0.5], amp: 0.2, attack: 0.006, release: 0.18, cutoff: 600, q: 3 },
  pad: { waves: ["sawtooth", "triangle"], det: [-12, 12], mult: [1, 2], amp: 0.09, attack: 1.2, release: 2.8, cutoff: 1400, q: 1.2, chorus: true },
};
/** One-shot parts on Driftwood: model and how long notes ring. */
const PLUCKED = {
  mallet: { model: "marimba", dur: 0.6, brightness: 0.6, decay: 1.2 },
  harp: { model: "steel", dur: 1.4, brightness: 0.55, decay: 2.5 },
};
export const PARTS = ["mallet", "harp", "lead", "bass", "drums", "keys", "pad"];
const DRUM_NOTES = { 36: "kick", 38: "snare", 39: "clap", 42: "hat", 46: "open", 45: "ltom", 50: "htom", 49: "cymbal" };

/** Every knob a patch can reach, per part: param -> [label, apply(state, v 0..1)]. */
function knobsFor(part) {
  const k = {
    "@volume": ["Volume", (s, v) => { s.volume = v; }],
    "reverb.mix": ["Reverb", (s, v) => { s.reverb = v; }],
    "delay.mix": ["Delay", (s, v) => { s.delay = v * 0.8; }],
    "perf.tremolo": ["Tremolo", (s, v) => { s.tremolo = v; }],
  };
  if (LIVE[part]) {
    const [lo, hi] = part === "bass" ? [20, 18000] : [30, 18000];
    Object.assign(k, {
      "@bend": ["Pitch bend", (s, v) => { s.bend = (v * 2 - 1) * 12; }],
      "filter.cutoff": ["Filter cutoff", (s, v) => { s.cutoff = logMap(lo, hi)(v); }],
      [part === "bass" ? "filter.emphasis" : "filter.resonance"]: ["Resonance", (s, v) => { s.q = linMap(0.5, 18)(v); }],
      "vibrato.depth": ["Vibrato depth", (s, v) => { s.vib = v * 60; }],
      "vibrato.rate": ["Vibrato rate", (s, v) => { s.vibRate = logMap(0.1, 12)(v); }],
      "aenv.release": ["Release", (s, v) => { s.release = logMap(0.02, 4)(v); }],
    });
    if (part === "keys" || part === "pad") k["chorus.mix"] = ["Chorus", (s, v) => { s.chorus = v; }];
  } else if (PLUCKED[part]) {
    Object.assign(k, {
      "model.brightness": ["Brightness", (s, v) => { s.brightness = v; }],
      "model.position": ["Strike position", (s, v) => { s.click = 0.05 + 0.5 * Math.abs(v - 0.5) * 2; }],
      "model.decay": ["Decay", (s, v) => { s.decay = logMap(0.2, 6)(v); }],
    });
  } else if (part === "drums") {
    for (const voice of ["kick", "snare", "clap", "chat", "ohat", "ltom", "htom", "cymbal"]) k[`${voice}.tone`] = [`${voice} tone`, (s, v) => { s.tone[voice] = v; }];
    k["master.drive"] = ["Drive", (s, v) => { s.drive = v; }];
  }
  return k;
}

export class PlaySound {
  constructor() {
    this.ctx = null;
    this.parts = {};
    this.voices = new Map(); // voice id -> LiveVoice
    this.knobs = Object.fromEntries(PARTS.map((p) => [p, knobsFor(p)]));
    this.state = Object.fromEntries(PARTS.map((p) => [p, this._defaults(p)]));
    this.volume = 0.8;
  }

  _defaults(part) {
    const L = LIVE[part], P = PLUCKED[part];
    return {
      volume: part === "pad" ? 0.6 : 0.8, reverb: part === "drums" ? 0.06 : part === "pad" ? 0.5 : 0.25, delay: 0, tremolo: 0, bend: 0,
      cutoff: L?.cutoff ?? 2000, q: L?.q ?? 1, vib: 0, vibRate: 5.5, release: L?.release ?? 0.3, chorus: 0.4,
      brightness: P?.brightness ?? 0.6, decay: P?.decay ?? 1.2, click: 0.15, tone: {}, drive: 0,
    };
  }

  /** [[part, param, label], ...] for a patch UI. */
  targets() {
    // The "remix" targets turn Remix's dials (src/remix.js) for the beacon music (as the app's SynthBridge).
    return [...PARTS.flatMap((p) => Object.entries(this.knobs[p]).map(([id, [label]]) => [p, id, `${p} · ${label}`])),
      ...Remix.DIALS.map(([id, label]) => ["remix", `remix.${id}`, `remix · ${label.toLowerCase()}`])];
  }

  /** Makes the audio graph (call from a tap: browsers only start audio from one). */
  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return this.ctx; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.bus = new Bus(ctx);
    this.bus.master.gain.value = this.volume;
    for (const part of PARTS) {
      const ch = new Channel(this.bus, { chorus: part === "keys" || part === "pad", drive: part === "drums" || part === "bass" });
      const input = ctx.createGain(); // tremolo rides on this
      input.connect(ch.input);
      const trem = ctx.createOscillator();
      trem.frequency.value = 6;
      const tremDepth = ctx.createGain();
      tremDepth.gain.value = 0;
      trem.connect(tremDepth).connect(input.gain);
      trem.start();
      const bend = ctx.createConstantSource(); // part-wide bend (whammy), in cents
      bend.offset.value = 0;
      bend.start();
      const p = { ch, input, tremDepth, bend };
      if (PLUCKED[part]) { p.inst = new Driftwood(this.bus, ch, "Driftwood"); p.inst.out = input; }
      if (part === "drums") { p.inst = new Pulsar(this.bus, ch, "Pulsar"); p.inst.out = input; }
      this.parts[part] = p;
      this._applyPart(part);
    }
    return ctx;
  }

  setVolume(v) { this.volume = v; if (this.bus) this.bus.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  /** Wires a MusicInput hub to this. */
  listen(kit) {
    kit.on("noteOn", (part, voice, note, vel) => this.noteOn(part, voice, note, vel));
    kit.on("noteOff", (part, voice) => this.noteOff(voice));
    kit.on("bend", (part, voice, semis) => this.bend(voice, semis));
    kit.on("control", (part, param, v) => this.control(part, param, v));
  }

  control(part, param, v) {
    if (part === "remix") return this._remix(param.replace(/^remix\./, ""), v);
    const k = this.knobs[part]?.[param];
    if (!k) return;
    k[1](this.state[part], v);
    if (this.ctx) this._applyPart(part);
  }

  /** A patched object turning one of Remix's dials: Remix on, saved for the beacon music (localStorage "beacon.remix"). */
  _remix(id, v) {
    const d = Remix.DIALS.find((x) => x[0] === id);
    if (!d) return;
    let s = {};
    try { s = JSON.parse(localStorage.getItem("beacon.remix")) || {}; } catch { /* fresh */ }
    s = Remix.normalize({ ...s, on: true, [id]: Math.round((d[2] + (d[3] - d[2]) * Math.max(0, Math.min(1, v))) / d[4]) * d[4] });
    try { localStorage.setItem("beacon.remix", JSON.stringify({ ...s, hold: false })); } catch { /* not kept */ }
  }

  _applyPart(part) {
    const s = this.state[part], p = this.parts[part], t = this.ctx.currentTime;
    p.ch.set("level", s.volume, 0.03);
    p.ch.set("reverb", s.reverb, 0.05);
    p.ch.set("delay", s.delay, 0.05);
    if (part === "keys" || part === "pad") p.ch.set("chorus", s.chorus, 0.05);
    if (part === "drums") p.ch.set("drive", s.drive, 0.05);
    p.input.gain.setTargetAtTime(1 - s.tremolo * 0.45, t, 0.03);
    p.tremDepth.gain.setTargetAtTime(s.tremolo * 0.45, t, 0.03);
    p.bend.offset.setTargetAtTime(s.bend * 100, t, 0.015);
    if (p.inst instanceof Driftwood) p.inst.setParams({ model: PLUCKED[part].model, brightness: s.brightness, decay: s.decay, click: s.click });
    if (p.inst instanceof Pulsar) {
      const tone = s.tone;
      const set = (id, voice, lo, hi, d) => (tone[voice] != null ? lo * Math.pow(hi / lo, tone[voice]) : d);
      p.inst.setParams({
        "kick.punch": tone.kick ?? 0.6, "snare.tone": set("snare.tone", "snare", 140, 380, 200), "snare.snap": tone.snare ?? 0.55,
        "clap.tone": set("clap.tone", "clap", 700, 2800, 1200), "hat.tone": set("hat.tone", tone.chat != null ? "chat" : "ohat", 4000, 13000, 8000),
      });
    }
    for (const v of this.voices.values()) if (v.part === part) v.follow(s, t);
  }

  noteOn(part, voice, note, vel) {
    const ctx = this.ensure(), p = this.parts[part], s = this.state[part], t = ctx.currentTime + 0.003;
    if (!p) return;
    if (LIVE[part]) {
      this.voices.get(voice)?.stop(t);
      this.voices.set(voice, new LiveVoice(ctx, p, LIVE[part], s, part, note, vel, t));
    } else if (PLUCKED[part]) {
      p.inst.note(note, t, PLUCKED[part].dur, vel);
    } else if (part === "drums") {
      this._drum(p, DRUM_NOTES[note] || "kick", t, vel);
    }
  }

  noteOff(voice) {
    const v = this.voices.get(voice);
    if (!v) return;
    this.voices.delete(voice);
    v.stop(this.ctx.currentTime);
  }

  bend(voice, semis) { this.voices.get(voice)?.bendTo(semis, this.ctx.currentTime); }

  _drum(p, name, t, vel) {
    const ctx = this.ctx, tone = this.state.drums.tone;
    if (["kick", "snare", "clap", "hat", "open"].includes(name)) return p.inst.hit(name, t, vel);
    if (name === "cymbal") {
      const f = 5000 * Math.pow(2, (tone.cymbal ?? 0.5) * 1.5);
      return p.inst._noise(t, 1.4, vel * 0.25, "highpass", f).connect(p.input);
    }
    // Toms: a sine that drops in pitch.
    const base = (name === "ltom" ? 95 : 150) * Math.pow(2, ((tone[name] ?? 0.5) - 0.5));
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(base * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.08);
    g.gain.setValueAtTime(vel * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g).connect(p.input);
    o.start(t);
    o.stop(t + 0.5);
  }
}

/** One held note: oscillators -> filter -> envelope, with vibrato and bends. */
class LiveVoice {
  constructor(ctx, p, cfg, s, part, note, vel, t) {
    this.ctx = ctx;
    this.part = part;
    this.cfg = cfg;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = clamp(s.cutoff, 20, 18000);
    this.filter.Q.value = s.q;
    this.amp = ctx.createGain();
    this.amp.gain.setValueAtTime(0, t);
    this.amp.gain.linearRampToValueAtTime(vel * cfg.amp, t + cfg.attack);
    this.filter.connect(this.amp).connect(p.input);
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = s.vibRate;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = s.vib;
    this.lfo.connect(this.lfoGain);
    this.bendSrc = ctx.createConstantSource();
    this.bendSrc.offset.value = 0;
    this.oscs = cfg.waves.map((w, i) => {
      const o = ctx.createOscillator();
      o.type = w;
      o.frequency.value = mtof(note) * cfg.mult[i];
      o.detune.value = cfg.det[i];
      this.lfoGain.connect(o.detune);
      this.bendSrc.connect(o.detune);
      p.bend.connect(o.detune);
      o.connect(this.filter);
      o.start(t);
      return o;
    });
    this.lfo.start(t);
    this.bendSrc.start(t);
    this.release = s.release;
    this.partBend = p.bend;
  }
  follow(s, t) {
    this.filter.frequency.setTargetAtTime(clamp(s.cutoff, 20, 18000), t, 0.02);
    this.filter.Q.setTargetAtTime(s.q, t, 0.02);
    this.lfoGain.gain.setTargetAtTime(s.vib, t, 0.05);
    this.lfo.frequency.setTargetAtTime(s.vibRate, t, 0.05);
    this.release = s.release;
  }
  bendTo(semis, t) { this.bendSrc.offset.setTargetAtTime(semis * 100, t, 0.012); }
  stop(t) {
    const end = t + this.release * 3 + 0.05;
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setValueAtTime(this.amp.gain.value, t);
    this.amp.gain.setTargetAtTime(0, t, this.release / 3);
    for (const o of this.oscs) o.stop(end);
    this.lfo.stop(end);
    this.bendSrc.stop(end);
    // Free the shared part-bend connections once the voice is gone.
    setTimeout(() => { for (const o of this.oscs) { try { this.partBend.disconnect(o.detune); } catch { /* already gone */ } } }, (end - t) * 1000 + 50);
  }
}
