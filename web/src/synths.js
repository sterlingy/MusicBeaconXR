// Web Audio versions of the six SynthKit instruments.
//
// These are browser ports of the instrument designs (same roles, similar
// controls and parameter ids where they line up), not bit-exact copies of the
// C++ engine. Every note is synthesized live: no samples.
//
// Each instrument plays into its own Channel (level, reverb and delay sends).
// Instruments read their current parameters (`this.p`) when a note starts;
// channel-level parameters (sends, chorus, drive) follow continuously.

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

  set(param, value, tc = 0.15) {
    const t = this.ctx.currentTime;
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

class Instrument {
  constructor(bus, channel) {
    this.bus = bus;
    this.ctx = bus.ctx;
    this.out = channel.input;
    this.channel = channel;
    this.p = {};
  }
  setParams(p) { this.p = p; }
  get(id, def) { const v = this.p[id]; return v === undefined ? def : v; }
}

/** Pulsar: analog-style drums built from oscillators, noise and envelopes. */
export class Pulsar extends Instrument {
  hit(voice, t, vel) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.out);
    if (voice === "kick") {
      const o = ctx.createOscillator();
      const f = this.get("kick.tune", 50);
      const dec = this.get("kick.decay", 0.45);
      o.frequency.setValueAtTime(f * 4, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      g.gain.setValueAtTime(vel * 1.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      o.connect(g);
      o.start(t);
      o.stop(t + dec + 0.05);
      const click = this._noise(t, 0.008, 0.25 * vel, "highpass", 3000);
      click.connect(this.out);
    } else if (voice === "snare") {
      const dec = this.get("snare.decay", 0.18);
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(this.get("snare.tone", 200) * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(this.get("snare.tone", 200), t + 0.03);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vel * 0.5, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + dec * 0.6);
      o.connect(og).connect(this.out);
      o.start(t);
      o.stop(t + dec);
      this._noise(t, dec, vel * 0.55, "highpass", 1500).connect(this.out);
      g.disconnect();
    } else if (voice === "hat" || voice === "open") {
      const dec = this.get("hat.decay", 0.06) * (voice === "open" ? 5 : 1);
      this._noise(t, dec, vel * 0.32, "highpass", this.get("hat.tone", 8000)).connect(this.out);
      g.disconnect();
    } else if (voice === "clap") {
      for (const [dt, a] of [[0, 0.5], [0.011, 0.45], [0.023, 0.6]]) {
        this._noise(t + dt, dt === 0.023 ? 0.18 : 0.012, vel * a, "bandpass", 1200).connect(this.out);
      }
      g.disconnect();
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
  constructor(bus, channel) {
    super(bus, channel);
    this.last = null; // {nodes, gain, end, midi}
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
    const fromMidi = glide > 0 && this.last && this.last.end > t - 0.05 ? this.last.midi : midi;
    this._steal(t);
    const wave = this.get("osc.wave", "sawtooth");
    const det = this.get("osc.detune", 6);
    const f = mtof(midi), f0 = mtof(fromMidi);
    const mix = ctx.createGain();
    const oscs = [];
    for (const [type, ratio, cents, amp] of [[wave, 1, -det, 0.35], [wave, 1, det, 0.35], ["square", 0.5, 0, this.get("sub.level", 0.4) * 0.45]]) {
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
    const cutoff = this.get("filter.cutoff", 500);
    const q = 0.5 + this.get("filter.emphasis", 3) * 0.9;
    const amt = this.get("fenv.amount", 1200) * (0.5 + vel * 0.5);
    const fdec = this.get("fenv.decay", 0.25);
    let node = mix;
    for (let i = 0; i < 2; i++) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = i === 0 ? q : 0.7;
      lp.frequency.setValueAtTime(clamp(cutoff + amt, 40, 16000), t);
      lp.frequency.setTargetAtTime(clamp(cutoff, 40, 16000), t + 0.005, fdec / 3);
      node.connect(lp);
      node = lp;
    }
    const g = ctx.createGain();
    const rel = this.get("aenv.release", 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.8, t + 0.004);
    g.gain.setValueAtTime(vel * 0.8, t + dur);
    g.gain.setTargetAtTime(0, t + dur, rel / 3);
    node.connect(g).connect(this.out);
    const end = t + dur + rel * 2 + 0.05;
    for (const o of oscs) { o.start(t); o.stop(end); }
    this.last = { oscs, gain: g, end, midi };
  }
}

/** Comet: cutting mono lead with a second oscillator, vibrato and delay. */
export class Comet extends MonoSynth {
  note(midi, t, dur, vel) {
    const ctx = this.ctx;
    const port = this.get("portamento", 0);
    const fromMidi = port > 0 && this.last && this.last.end > t - 0.05 ? this.last.midi : midi;
    this._steal(t);
    const f = mtof(midi), f0 = mtof(fromMidi);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = this.get("vibrato.rate", 5.5);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(this.get("vibrato.depth", 10), t + 0.35); // vibrato fades in
    lfo.connect(depth);
    const mix = ctx.createGain();
    const oscs = [lfo];
    const semis = this.get("osc2.semis", 7);
    for (const [type, mult, amp] of [[this.get("osc.wave", "sawtooth"), 1, 0.4], ["square", Math.pow(2, semis / 12), 0.22]]) {
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
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.5 + this.get("filter.resonance", 2);
    const cut = this.get("filter.cutoff", 3000);
    lp.frequency.setValueAtTime(clamp(cut * 1.8, 60, 16000), t);
    lp.frequency.setTargetAtTime(clamp(cut, 60, 16000), t + 0.01, 0.08);
    const g = ctx.createGain();
    const rel = this.get("aenv.release", 0.2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.6, t + 0.01);
    g.gain.setValueAtTime(vel * 0.6, t + dur);
    g.gain.setTargetAtTime(0, t + dur, rel / 3);
    mix.connect(lp).connect(g).connect(this.out);
    const end = t + dur + rel * 2 + 0.05;
    for (const o of oscs) { o.start(t); o.stop(end); }
    this.last = { oscs, gain: g, end, midi };
  }
}

/** Lumen: polyphonic keys and pads with drift, chorus and reverb. */
export class Lumen extends Instrument {
  chord(notes, t, dur, vel) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = clamp(this.get("filter.cutoff", 2000), 80, 16000);
    lp.Q.value = 0.5 + this.get("filter.resonance", 1);
    const g = ctx.createGain();
    const atk = this.get("aenv.attack", 0.02);
    const rel = this.get("aenv.release", 1);
    const amp = vel * 0.32 / Math.sqrt(notes.length);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + Math.max(0.003, atk));
    g.gain.setValueAtTime(amp, t + Math.max(dur, atk));
    g.gain.setTargetAtTime(0, t + Math.max(dur, atk), rel / 3);
    lp.connect(g).connect(this.out);
    const end = t + Math.max(dur, atk) + rel * 2.5 + 0.05;
    const det = this.get("osc.detune", 8);
    const wave = this.get("osc.wave", "sawtooth");
    for (const m of notes) {
      for (const sign of [-1, 1]) {
        const o = ctx.createOscillator();
        o.type = wave;
        o.frequency.value = mtof(m);
        o.detune.value = sign * det + (Math.random() - 0.5) * 6; // a little analog drift per voice
        o.connect(lp);
        o.start(t);
        o.stop(end);
      }
    }
  }
}

/** Driftwood: physical modeling. Karplus-Strong string, or modal mallets. */
export class Driftwood extends Instrument {
  constructor(bus, channel) {
    super(bus, channel);
    this.cache = new Map();
  }

  note(midi, t, dur, vel) {
    const model = this.get("model", "string");
    const bright = Math.round(this.get("brightness", 0.6) * 10) / 10;
    const decay = Math.round(this.get("decay", 1.2) * 4) / 4;
    const key = `${model}|${midi}|${bright}|${decay}`;
    let buf = this.cache.get(key);
    if (!buf) {
      buf = model === "string" ? renderString(this.ctx, midi, bright, decay) : renderModal(this.ctx, midi, model, bright, decay);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vel * 0.7;
    src.connect(g).connect(this.out);
    src.start(t);
  }
}

/** Tangle: the modular, here as a self-modulating FM texture patch. */
export class Tangle extends Instrument {
  note(midi, t, dur, vel) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * this.get("ratio", 2);
    const index = ctx.createGain();
    index.gain.value = this.get("fm.index", 2) * f * 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = this.get("lfo.rate", 0.2);
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = this.get("lfo.depth", 0.5) * this.get("fm.index", 2) * f * 0.5;
    lfo.connect(lfoAmt).connect(index.gain);
    mod.connect(index).connect(car.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = clamp(this.get("filter.cutoff", 1500), 80, 12000);
    const g = ctx.createGain();
    const atk = Math.min(1.5, dur * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel * 0.22, t + atk);
    g.gain.setValueAtTime(vel * 0.22, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.6);
    car.connect(lp).connect(g).connect(this.out);
    const end = t + dur + 3;
    for (const o of [car, mod, lfo]) { o.start(t); o.stop(end); }
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

function renderString(ctx, midi, brightness, decay) {
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
  const damp = 0.35 + 0.15 * brightness;
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
  // Mallet attack: a short soft click.
  for (let i = 0; i < Math.min(len, 96); i++) y[i] += (Math.random() * 2 - 1) * 0.15 * brightness * (1 - i / 96);
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
    bass: new Channel(bus),
    keys: new Channel(bus, { chorus: true }),
    lead: new Channel(bus),
    pluck: new Channel(bus),
    texture: new Channel(bus),
  };
  return {
    channels: ch,
    drums: new Pulsar(bus, ch.drums),
    bass: new Undertow(bus, ch.bass),
    keys: new Lumen(bus, ch.keys),
    lead: new Comet(bus, ch.lead),
    pluck: new Driftwood(bus, ch.pluck),
    texture: new Tangle(bus, ch.texture),
  };
}
