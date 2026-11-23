// Web Audio versions of the six SynthKit instruments.
//
// These are browser ports of the instrument designs (same roles, similar
// controls and parameter ids where they line up), not bit-exact copies of the
// C++ engine. Every note is synthesized live: no samples.
//
// Each instrument plays into its own Channel (level, reverb and delay sends).
// Instruments read their current parameters (`this.p`) when a note starts;
// channel-level parameters (sends, chorus, drive) follow continuously.

import { automate, ROLE_OF } from "./params.js";

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Bus {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.comp).connect(this.analyser).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 3.2, 2.6);
    this.reverbIn = ctx.createGain();
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.7;
    this.reverbIn.connect(this.reverb).connect(reverbOut).connect(this.master);

    this.delayIn = ctx.createGain();
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.375;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    this.delayIn.connect(this.delay);
    this.delay.connect(tone).connect(fb).connect(this.delay);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.6;
    tone.connect(delayOut).connect(this.master);
    delayOut.connect(this.reverbIn);

    this.noise = makeNoise(ctx, 2);
  }

  setTempo(bpm) {
    // Dotted eighth, the classic ping-pong-ish echo.
    this.delay.delayTime.setTargetAtTime(clamp(0.75 * 60 / bpm, 0.05, 1.9), this.ctx.currentTime, 0.3);
  }
}

export class Channel {
  constructor(bus, { chorus = false, drive = false } = {}) {
    const ctx = bus.ctx;
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.level = ctx.createGain();
    this.level.gain.value = 0;
    let node = this.input;
    if (drive) {
      this.shaper = ctx.createWaveShaper();
      this.shaper.curve = driveCurve(0);
      this.shaper.oversample = "2x";
      node.connect(this.shaper);
      node = this.shaper;
    }
    if (chorus) {
      // Two modulated short delays mixed with the dry signal.
      const wet = ctx.createGain();
      wet.gain.value = 0;
      this.chorusWet = wet;
      for (const [base, rate] of [[0.012, 0.31], [0.019, 0.47]]) {
        const d = ctx.createDelay(0.05);
        d.delayTime.value = base;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = rate;
        const depth = ctx.createGain();
        depth.gain.value = 0.004;
        lfo.connect(depth).connect(d.delayTime);
        lfo.start();
        node.connect(d).connect(wet);
      }
      wet.connect(this.level);
    }
    node.connect(this.level);
    this.level.connect(bus.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0;
    this.level.connect(this.reverbSend).connect(bus.reverbIn);
    this.level.connect(this.delaySend).connect(bus.delayIn);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 256;
    this.level.connect(this.meter);
    this._drive = -1;
  }

  set(param, value, tc = 0.15, at = 0) {
    const t = Math.max(this.ctx.currentTime, at || 0);
    if (param === "level") this.level.gain.setTargetAtTime(value, t, tc);
    else if (param === "reverb") this.reverbSend.gain.setTargetAtTime(value, t, tc);
    else if (param === "delay") this.delaySend.gain.setTargetAtTime(value, t, tc);
    else if (param === "chorus" && this.chorusWet) this.chorusWet.gain.setTargetAtTime(value * 0.8, t, tc);
    else if (param === "drive" && this.shaper) {
      const q = Math.round(value * 20) / 20;
      if (q !== this._drive) { this._drive = q; this.shaper.curve = driveCurve(q); }
    }
  }

  peak() {
    const a = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(a);
    let m = 0;
    for (const v of a) m = Math.max(m, Math.abs(v));
    return m;
  }
}

// ---------------------------------------------------------------- instruments

/**
 * Shared by all six. Params come from `this.p` (set by the mixer or the
 * Synths page); `at(id, def, t)` is a param's value at audio time t with its
 * automation applied, and `follow()` makes an AudioParam track an automated
 * param over a note, so a held pad's cutoff keeps moving.
 */
class Instrument {
  constructor(bus, channel, name) {
    this.bus = bus;
    this.ctx = bus.ctx;
    this.out = channel.input;
    this.channel = channel;
    this.name = name;
    this.p = {};
    this.auto = null;
    this.clock = null; // audio time -> beats, for automation
  }
  setParams(p) { this.p = p; }
  /** Automation map ({param id: {shape, bars, depth, phase}}) and the clock it runs on. */
  setAutomation(auto, clock) {
    this.auto = auto && Object.keys(auto).length ? auto : null;
    this.clock = clock || null;
  }
  get(id, def) { const v = this.p[id]; return v === undefined ? def : v; }
  at(id, def, t) {
    const v = this.get(id, def), a = this.auto?.[id];
    return a && this.clock ? automate(this.name, id, v, a, this.clock(t)) : v;
  }
  follow(param, id, def, t0, t1, f = (x) => x) {
    param.setValueAtTime(f(this.at(id, def, t0)), t0);
    if (!this.auto?.[id] || !this.clock || t1 <= t0) return;
    const n = Math.min(32, Math.max(2, Math.ceil((t1 - t0) / 0.04)));
    for (let i = 1; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      param.linearRampToValueAtTime(f(this.at(id, def, t)), t);
    }
  }
  /** Sends, chorus and drive, which act on the whole channel (called every step while playing). */
  applyChannel(t, tc = 0.05) {
    const ch = this.channel, role = ROLE_OF[this.name];
    ch.set("reverb", this.at("reverb.send", role === "drums" ? 0.08 : role === "bass" ? 0.04 : 0.2, t), tc, t);
    ch.set("delay", this.at("delay.send", 0, t), tc, t);
    if (role === "keys") ch.set("chorus", this.at("chorus.mix", 0.3, t), tc, t);
    if (role === "drums") ch.set("drive", this.at("master.drive", 0, t), tc, t);
    if (role === "bass" || role === "lead") ch.set("drive", this.at("drive", 0, t), tc, t);
  }
}

/** Pulsar: analog-style drums built from oscillators, noise and envelopes. */
export class Pulsar extends Instrument {
  hit(voice, t, vel) {
    const ctx = this.ctx;
    if (voice === "kick") {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = this.at("kick.tune", 50, t), punch = this.at("kick.punch", 0.6, t), dec = this.at("kick.decay", 0.45, t);
      o.frequency.setValueAtTime(f * (1 + punch * 5), t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.02 + punch * 0.06);
      g.gain.setValueAtTime(vel * 1.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + dec + 0.05);
      this._noise(t, 0.008, (0.1 + 0.3 * punch) * vel, "highpass", 3000).connect(this.out);
    } else if (voice === "snare") {
      const dec = this.at("snare.decay", 0.18, t), tone = this.at("snare.tone", 200, t), snap = this.at("snare.snap", 0.55, t);
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(tone * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(tone, t + 0.03);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vel * (0.65 - 0.35 * snap), t);
      og.gain.exponentialRampToValueAtTime(0.001, t + dec * 0.6);
      o.connect(og).connect(this.out);
      o.start(t);
      o.stop(t + dec);
      this._noise(t, dec, vel * (0.15 + 0.75 * snap), "highpass", 1200 + 1200 * snap).connect(this.out);
    } else if (voice === "hat" || voice === "open") {
      const dec = this.at("hat.decay", 0.06, t) * (voice === "open" ? 5 : 1);
      this._noise(t, dec, vel * 0.32, "highpass", this.at("hat.tone", 8000, t)).connect(this.out);
    } else if (voice === "clap") {
      const tone = this.at("clap.tone", 1200, t), tail = this.at("clap.decay", 0.18, t);
      for (const [dt, a] of [[0, 0.5], [0.011, 0.45], [0.023, 0.6]]) {
        this._noise(t + dt, dt === 0.023 ? tail : 0.012, vel * a, "bandpass", tone).connect(this.out);
      }
    }
  }

  _noise(t, dur, amp, type, freq) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.bus.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (type === "bandpass") f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.005, dur));
    src.connect(f).connect(g);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    return g;
  }
}

/** Shared mono-synth voice handling: one voice at a time, with glide. */
class MonoSynth extends Instrument {
  constructor(bus, channel, name) {
    super(bus, channel, name);
    this.last = null; // {oscs, gain, end, midi}
  }
  /** The note to glide from: the last one, if it's still sounding (or just ended). */
  _from(midi, t, glide) {
    return glide > 0 && this.last && this.last.end > t - 0.05 ? this.last.midi : midi;
  }
  _steal(t) {
    const v = this.last;
    if (v && v.end > t) {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.008);
      for (const o of v.oscs) { try { o.stop(t + 0.06); } catch { /* already stopped */ } }
    }
  }
}

/** Undertow: fat mono bass, 3 oscillators into a 24 dB low-pass. */
export class Undertow extends MonoSynth {
  note(midi, t, dur, vel) {
    const ctx = this.ctx;
    const glide = this.get("glide", 0);
    const fromMidi = this._from(midi, t, glide);
    this._steal(t);
    const wave = this.get("osc.wave", "sawtooth");
    const det = this.at("osc.detune", 6, t);
    const f = mtof(midi), f0 = mtof(fromMidi);
    const mix = ctx.createGain();
    const oscs = [];
    for (const [type, ratio, cents, amp] of [[wave, 1, -det, 0.35], [wave, 1, det, 0.35], [this.get("sub.wave", "square"), 0.5, 0, this.at("sub.level", 0.4, t) * 0.45]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = cents;
      o.frequency.setValueAtTime(f0 * ratio, t);
      if (fromMidi !== midi) o.frequency.exponentialRampToValueAtTime(f * ratio, t + glide);
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(mix);
      oscs.push(o);
    }
    const rel = this.at("aenv.release", 0.12, t), atk = this.at("aenv.attack", 0.004, t);
    const end = t + dur + rel * 2 + 0.05;
    const cutoff = this.at("filter.cutoff", 500, t);
    const q = 0.5 + this.at("filter.emphasis", 3, t) * 0.9;
    const amt = this.at("fenv.amount", 1200, t) * (0.5 + vel * 0.5);
    const envCents = 1200 * Math.log2(Math.min(16000, cutoff + amt) / Math.max(40, cutoff));
    const fdec = this.at("fenv.decay", 0.25, t);
    let node = mix;
    for (let i = 0; i < 2; i++) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = i === 0 ? q : 0.7;
      this.follow(lp.frequency, "filter.cutoff", 500, t, end, (v) => clamp(v, 40, 16000));
      lp.detune.setValueAtTime(envCents, t);
      lp.detune.setTargetAtTime(0, t + 0.005, fdec / 3);
      node.connect(lp);
      node = lp;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.8, t + Math.max(0.002, atk));
    g.gain.setValueAtTime(vel * 0.8, t + Math.max(dur, atk));
    g.gain.setTargetAtTime(0, t + Math.max(dur, atk), rel / 3);
    node.connect(g).connect(this.out);
    for (const o of oscs) { o.start(t); o.stop(end); }
    this.last = { oscs, gain: g, end, midi };
  }
}

/** Comet: cutting mono lead with a second oscillator, filter envelope, vibrato and glide. */
export class Comet extends MonoSynth {
  note(midi, t, dur, vel) {
    const ctx = this.ctx;
    const port = this.get("portamento", 0);
    const fromMidi = this._from(midi, t, port);
    this._steal(t);
    const f = mtof(midi), f0 = mtof(fromMidi);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = this.at("vibrato.rate", 5.5, t);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(this.at("vibrato.depth", 10, t), t + 0.35); // vibrato fades in
    lfo.connect(depth);
    const mix = ctx.createGain();
    const oscs = [lfo];
    const semis = this.get("osc2.semis", 7);
    const lvl2 = this.at("osc2.level", 0.55, t);
    for (const [type, mult, amp] of [[this.get("osc.wave", "sawtooth"), 1, 0.4], [this.get("osc2.wave", "square"), Math.pow(2, semis / 12), 0.4 * lvl2]]) {
      if (amp <= 0) continue;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * mult, t);
      if (fromMidi !== midi) o.frequency.exponentialRampToValueAtTime(f * mult, t + port);
      depth.connect(o.detune);
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(mix);
      oscs.push(o);
    }
    const rel = this.at("aenv.release", 0.2, t), atk = this.at("aenv.attack", 0.01, t);
    const end = t + Math.max(dur, atk) + rel * 2 + 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5 + this.at("filter.resonance", 2, t);
    this.follow(lp.frequency, "filter.cutoff", 3000, t, end, (v) => clamp(v, 60, 16000));
    lp.detune.setValueAtTime(1200 * this.at("fenv.amount", 0.85, t), t);
    lp.detune.setTargetAtTime(0, t + 0.01, 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.6, t + Math.max(0.002, atk));
    g.gain.setValueAtTime(vel * 0.6, t + Math.max(dur, atk));
    g.gain.setTargetAtTime(0, t + Math.max(dur, atk), rel / 3);
    mix.connect(lp).connect(g).connect(this.out);
    for (const o of oscs) { o.start(t); o.stop(end); }
    this.last = { oscs, gain: g, end, midi };
  }
}

/** Lumen: polyphonic keys and pads with drift, a filter envelope, chord glide, chorus and reverb. */
export class Lumen extends Instrument {
  chord(notes, t, dur, vel) {
    const ctx = this.ctx;
    const atk = this.at("aenv.attack", 0.02, t);
    const rel = this.at("aenv.release", 1, t);
    const end = t + Math.max(dur, atk) + rel * 2.5 + 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    this.follow(lp.frequency, "filter.cutoff", 2000, t, end, (v) => clamp(v, 80, 16000));
    lp.Q.value = 0.5 + this.at("filter.resonance", 1, t);
    const fenv = this.at("fenv.amount", 0, t);
    if (fenv > 0) {
      lp.detune.setValueAtTime(1200 * fenv, t);
      lp.detune.setTargetAtTime(0, t + 0.005, this.at("fenv.decay", 0.8, t) / 3);
    }
    const g = ctx.createGain();
    const amp = vel * 0.32 / Math.sqrt(notes.length);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + Math.max(0.003, atk));
    g.gain.setValueAtTime(amp, t + Math.max(dur, atk));
    g.gain.setTargetAtTime(0, t + Math.max(dur, atk), rel / 3);
    lp.connect(g).connect(this.out);
    const det = this.at("osc.detune", 8, t);
    const waves = [this.get("osc.wave", "sawtooth"), this.get("osc2.wave", this.get("osc.wave", "sawtooth"))];
    const oct2 = Math.pow(2, Math.round(this.get("osc2.octave", 0)));
    // Chord glide: each voice slides from the matching note of the chord before, if it's still sounding.
    const glide = this.get("glide", 0);
    const prev = glide > 0 && this.lastChord && this.lastChord.end > t - 0.05 ? this.lastChord.notes : null;
    notes.forEach((m, i) => {
      const from = prev ? prev[Math.min(i, prev.length - 1)] : m;
      [-1, 1].forEach((sign, k) => {
        const o = ctx.createOscillator();
        o.type = waves[k];
        const mult = k === 1 ? oct2 : 1;
        o.frequency.setValueAtTime(mtof(from) * mult, t);
        if (from !== m) o.frequency.exponentialRampToValueAtTime(mtof(m) * mult, t + glide);
        o.detune.value = sign * det + (Math.random() - 0.5) * 6; // a little analog drift per voice
        o.connect(lp);
        o.start(t);
        o.stop(end);
      });
    });
    this.lastChord = { notes: notes.slice(), end: t + Math.max(dur, atk) + rel };
  }
}

/** Driftwood: physical modeling. Karplus-Strong strings, or modal mallets and bells, through a body filter. */
export class Driftwood extends Instrument {
  constructor(bus, channel, name) {
    super(bus, channel, name);
    this.cache = new Map();
  }

  note(midi, t, dur, vel) {
    const model = this.get("model", "string");
    const bright = Math.round(this.at("brightness", 0.6, t) * 10) / 10;
    const decay = Math.round(this.at("decay", 1.2, t) * 4) / 4;
    const key = `${model}|${midi}|${bright}|${decay}`;
    let buf = this.cache.get(key);
    if (!buf) {
      buf = STRINGS[model] ? renderString(this.ctx, midi, bright, decay, STRINGS[model]) : renderModal(this.ctx, midi, model, bright, decay);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const body = this.ctx.createBiquadFilter();
    body.type = "lowpass";
    body.Q.value = 0.5 + this.at("body.resonance", 0.7, t);
    this.follow(body.frequency, "body.cutoff", 12000, t, t + buf.duration, (v) => clamp(v, 100, 16000));
    const g = this.ctx.createGain();
    g.gain.value = vel * 0.7;
    src.connect(body).connect(g).connect(this.out);
    src.start(t);
    const click = this.at("click", 0.15, t);
    if (click > 0.01) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.bus.noise;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "bandpass";
      hp.frequency.value = Math.min(9000, mtof(midi) * 6);
      const ng = this.ctx.createGain();
      ng.gain.setValueAtTime(click * vel * 0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
      n.connect(hp).connect(ng).connect(this.out);
      n.start(t, Math.random());
      n.stop(t + 0.03);
    }
  }
}

/** Tangle: the modular, as a carrier with two FM modulators, an LFO on the depth, glide and a resonant low-pass. */
export class Tangle extends Instrument {
  note(midi, t, dur, vel) {
    const ctx = this.ctx;
    const glide = this.get("glide", 0);
    const fromMidi = glide > 0 && this.last && this.last.end > t - 0.05 ? this.last.midi : midi;
    const f = mtof(midi), f0 = mtof(fromMidi);
    const slide = (param, mult) => {
      param.setValueAtTime(f0 * mult, t);
      if (fromMidi !== midi) param.exponentialRampToValueAtTime(f * mult, t + glide);
    };
    const car = ctx.createOscillator();
    car.type = this.get("car.wave", "sine");
    slide(car.frequency, 1);
    const idx1 = this.at("fm.index", 2, t), idx2 = this.at("fm2.index", 0, t);
    const mods = [];
    for (const [ratio, idx] of [[this.get("ratio", 2), idx1], [this.get("ratio2", 3), idx2]]) {
      if (idx <= 0) continue;
      const mod = ctx.createOscillator();
      slide(mod.frequency, ratio);
      const gain = ctx.createGain();
      gain.gain.value = idx * f * 0.5;
      mod.connect(gain).connect(car.frequency);
      mods.push([mod, gain, idx]);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = this.at("lfo.rate", 0.2, t);
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = this.at("lfo.depth", 0.5, t) * idx1 * f * 0.5;
    if (mods[0]) lfo.connect(lfoAmt).connect(mods[0][1].gain);
    const atk = Math.min(this.at("aenv.attack", 0.6, t), Math.max(0.01, dur * 0.8));
    const rel = this.at("aenv.release", 1.8, t);
    const end = t + dur + rel * 2.5;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5 + this.at("filter.resonance", 0.7, t);
    this.follow(lp.frequency, "filter.cutoff", 1500, t, end, (v) => clamp(v, 80, 12000));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.22, t + atk);
    g.gain.setValueAtTime(vel * 0.22, t + Math.max(dur, atk));
    g.gain.setTargetAtTime(0, t + Math.max(dur, atk), rel / 3);
    car.connect(lp).connect(g).connect(this.out);
    for (const o of [car, lfo, ...mods.map((m) => m[0])]) { o.start(t); o.stop(end); }
    this.last = { midi, end: t + dur };
  }
}

// ---------------------------------------------------------------- helpers

function makeNoise(ctx, seconds) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, decay);
      lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4; // slightly darker tail
      d[i] = lp * env;
    }
  }
  return buf;
}

function driveCurve(amount) {
  const n = 1024, c = new Float32Array(n), k = 1 + amount * 12;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

/** String variants: how bright the pluck is and how fast the highs die away. */
const STRINGS = { string: { bright: 0, damp: 0, len: 1 }, steel: { bright: 0.25, damp: -0.12, len: 1.3 }, nylon: { bright: -0.25, damp: 0.1, len: 0.75 } };

function renderString(ctx, midi, brightness, decay, variant = STRINGS.string) {
  brightness = clamp(brightness + variant.bright, 0, 1);
  decay *= variant.len;
  const sr = ctx.sampleRate;
  const f = mtof(midi);
  const N = Math.max(2, Math.round(sr / f));
  const seconds = Math.min(5, 0.3 + decay * 1.6);
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const y = buf.getChannelData(0);
  // Loss per period so the note falls by 60 dB over `decay` seconds.
  const g = Math.pow(0.001, 1 / (Math.max(0.05, decay) * f));
  const lpCoef = 0.15 + 0.85 * brightness; // pick brightness filters the excitation
  let s = 0;
  for (let i = 0; i < N; i++) {
    s = s + lpCoef * ((Math.random() * 2 - 1) - s);
    y[i] = s;
  }
  const damp = clamp(0.35 + 0.15 * brightness + variant.damp, 0.15, 0.5);
  for (let i = N; i < len; i++) {
    y[i] = g * ((1 - damp) * y[i - N] + damp * y[i - N - 1 < 0 ? 0 : i - N - 1]);
  }
  fadeOut(y, sr);
  return buf;
}

const MODAL = {
  marimba: [[1, 1], [3.99, 0.35], [10.65, 0.12]],
  kalimba: [[1, 1], [5.4, 0.3], [11.6, 0.1]],
  bell: [[1, 1], [2.76, 0.6], [5.4, 0.4], [8.93, 0.25]],
  vibes: [[1, 1], [4.0, 0.25], [10.0, 0.06]],
  glass: [[1, 1], [2.32, 0.5], [4.25, 0.3], [6.63, 0.18]],
};

function renderModal(ctx, midi, model, brightness, decay) {
  const sr = ctx.sampleRate;
  const f = mtof(midi);
  const modes = MODAL[model] || MODAL.marimba;
  const seconds = Math.min(5, 0.2 + decay * 1.4);
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const y = buf.getChannelData(0);
  modes.forEach(([ratio, amp], k) => {
    const fk = f * ratio;
    if (fk > sr * 0.45) return;
    const a = amp * Math.pow(brightness, k * 0.8);
    const tau = Math.max(0.03, decay / (1 + k * 1.8)) / 6.9; // higher modes die faster
    const w = 2 * Math.PI * fk / sr;
    for (let i = 0; i < len; i++) y[i] += a * Math.sin(w * i) * Math.exp(-i / sr / tau);
  });
  // (The mallet click is played live, see Driftwood's "click".)
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < len; i++) y[i] *= 0.8 / peak;
  fadeOut(y, sr);
  return buf;
}

function fadeOut(y, sr) {
  const n = Math.min(y.length, Math.floor(sr * 0.02));
  for (let i = 0; i < n; i++) y[y.length - 1 - i] *= i / n;
}

export function makeInstruments(bus) {
  const ch = {
    drums: new Channel(bus, { drive: true }),
    bass: new Channel(bus, { drive: true }),
    keys: new Channel(bus, { chorus: true }),
    lead: new Channel(bus, { drive: true }),
    pluck: new Channel(bus),
    texture: new Channel(bus),
  };
  return {
    channels: ch,
    drums: new Pulsar(bus, ch.drums, "Pulsar"),
    bass: new Undertow(bus, ch.bass, "Undertow"),
    keys: new Lumen(bus, ch.keys, "Lumen"),
    lead: new Comet(bus, ch.lead, "Comet"),
    pluck: new Driftwood(bus, ch.pluck, "Driftwood"),
    texture: new Tangle(bus, ch.texture, "Tangle"),
  };
}
