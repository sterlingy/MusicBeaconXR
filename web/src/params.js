// Every instrument's parameters: ranges, defaults, which ones can be
// animated, plus the automation math. Pure data and functions (no audio), so
// the synths, the Synths page, the song generator and the tests share it.
//
// A control is [id, label, min, max, step, default, opts] for numbers, or
// [id, label, [choices], default] for choices. opts: {unit, log, auto: false}.
// Numbers can be automated unless `auto: false` (steps like semitones and
// ratios, or glide times, which only make sense as fixed settings).

export const SPEC = {
  Pulsar: {
    role: "drums", blurb: "Analog-style drums built from oscillators, noise and envelopes.",
    groups: {
      Kick: [["kick.tune", "Tune", 30, 90, 1, 50, { unit: "Hz" }], ["kick.punch", "Punch", 0, 1, 0.01, 0.6], ["kick.decay", "Decay", 0.1, 1.2, 0.01, 0.45, { unit: "s" }]],
      Snare: [["snare.tone", "Tone", 120, 400, 1, 200, { unit: "Hz" }], ["snare.snap", "Snap", 0, 1, 0.01, 0.55], ["snare.decay", "Decay", 0.05, 0.5, 0.005, 0.18, { unit: "s" }]],
      Hats: [["hat.tone", "Tone", 3000, 14000, 50, 8000, { unit: "Hz", log: true }], ["hat.decay", "Decay", 0.02, 0.2, 0.005, 0.06, { unit: "s" }]],
      Clap: [["clap.tone", "Tone", 600, 3000, 10, 1200, { unit: "Hz", log: true }], ["clap.decay", "Decay", 0.05, 0.5, 0.005, 0.18, { unit: "s" }]],
      Output: [["master.drive", "Drive", 0, 1, 0.01, 0], ["reverb.send", "Reverb", 0, 1, 0.01, 0.08], ["delay.send", "Delay", 0, 1, 0.01, 0]],
    },
  },
  Undertow: {
    role: "bass", blurb: "Fat mono bass: two detuned oscillators plus a sub, into a two-stage low-pass with a filter envelope, drive and glide.",
    groups: {
      Oscillators: [["osc.wave", "Wave", ["sawtooth", "square", "triangle", "sine"], "sawtooth"], ["osc.detune", "Detune", 0, 30, 0.5, 6, { unit: "ct" }], ["sub.wave", "Sub wave", ["square", "sine", "triangle"], "square"], ["sub.level", "Sub", 0, 1, 0.01, 0.4]],
      Filter: [["filter.cutoff", "Cutoff", 40, 8000, 1, 500, { unit: "Hz", log: true }], ["filter.emphasis", "Emphasis", 0, 12, 0.1, 3], ["fenv.amount", "Filter env", 0, 6000, 10, 1200, { unit: "Hz" }], ["fenv.decay", "Env decay", 0.02, 1.5, 0.01, 0.25, { unit: "s" }]],
      Amp: [["aenv.attack", "Attack", 0.001, 0.3, 0.001, 0.004, { unit: "s", log: true }], ["aenv.release", "Release", 0.01, 1, 0.01, 0.12, { unit: "s" }], ["glide", "Glide", 0, 0.5, 0.005, 0, { unit: "s", auto: false }]],
      Output: [["drive", "Drive", 0, 1, 0.01, 0], ["reverb.send", "Reverb", 0, 1, 0.01, 0.04], ["delay.send", "Delay", 0, 1, 0.01, 0]],
    },
  },
  Lumen: {
    role: "keys", blurb: "Polyphonic keys and pads: two drifting oscillators per note, a filter envelope, chord glide, chorus and reverb.",
    groups: {
      Oscillators: [["osc.wave", "Wave 1", ["sawtooth", "triangle", "square", "sine"], "sawtooth"], ["osc2.wave", "Wave 2", ["sawtooth", "triangle", "square", "sine"], "sawtooth"], ["osc2.octave", "Osc 2 octave", -1, 1, 1, 0, { auto: false }], ["osc.detune", "Detune", 0, 30, 0.5, 8, { unit: "ct" }]],
      Filter: [["filter.cutoff", "Cutoff", 80, 12000, 1, 2000, { unit: "Hz", log: true }], ["filter.resonance", "Resonance", 0, 10, 0.1, 1], ["fenv.amount", "Filter env", 0, 4, 0.05, 0, { unit: "oct" }], ["fenv.decay", "Env decay", 0.05, 3, 0.01, 0.8, { unit: "s" }]],
      Amp: [["aenv.attack", "Attack", 0.003, 2, 0.001, 0.02, { unit: "s", log: true }], ["aenv.release", "Release", 0.05, 4, 0.01, 1, { unit: "s" }], ["glide", "Glide", 0, 1, 0.01, 0, { unit: "s", auto: false }]],
      Output: [["chorus.mix", "Chorus", 0, 1, 0.01, 0.3], ["reverb.send", "Reverb", 0, 1, 0.01, 0.35], ["delay.send", "Delay", 0, 1, 0.01, 0]],
    },
  },
  Comet: {
    role: "lead", blurb: "Cutting mono lead: a second oscillator tuned in semitones, filter envelope, fade-in vibrato, glide, drive and a tempo-synced delay.",
    groups: {
      Oscillators: [["osc.wave", "Wave 1", ["sawtooth", "square", "triangle", "sine"], "sawtooth"], ["osc2.wave", "Wave 2", ["square", "sawtooth", "triangle", "sine"], "square"], ["osc2.semis", "Osc 2 pitch", -12, 24, 1, 7, { unit: "st", auto: false }], ["osc2.level", "Osc 2 level", 0, 1, 0.01, 0.55]],
      Filter: [["filter.cutoff", "Cutoff", 200, 12000, 1, 3000, { unit: "Hz", log: true }], ["filter.resonance", "Resonance", 0, 10, 0.1, 2], ["fenv.amount", "Filter env", 0, 4, 0.05, 0.85, { unit: "oct" }]],
      Motion: [["vibrato.rate", "Vibrato rate", 0.5, 10, 0.1, 5.5, { unit: "Hz" }], ["vibrato.depth", "Vibrato depth", 0, 50, 1, 10, { unit: "ct" }], ["portamento", "Glide", 0, 0.5, 0.005, 0, { unit: "s", auto: false }], ["aenv.attack", "Attack", 0.001, 1, 0.001, 0.01, { unit: "s", log: true }], ["aenv.release", "Release", 0.01, 1.5, 0.01, 0.2, { unit: "s" }]],
      Output: [["drive", "Drive", 0, 1, 0.01, 0], ["delay.send", "Delay", 0, 1, 0.01, 0.3], ["reverb.send", "Reverb", 0, 1, 0.01, 0.2]],
    },
  },
  Driftwood: {
    role: "pluck", blurb: "Physical modeling: plucked strings (Karplus-Strong), or mallet and bell modes, through a body filter.",
    groups: {
      Model: [["model", "Model", ["string", "steel", "nylon", "marimba", "kalimba", "vibes", "glass", "bell"], "string"], ["brightness", "Brightness", 0, 1, 0.01, 0.6], ["decay", "Decay", 0.1, 4, 0.05, 1.2, { unit: "s" }]],
      Body: [["body.cutoff", "Body tone", 300, 12000, 10, 12000, { unit: "Hz", log: true }], ["body.resonance", "Body res.", 0, 10, 0.1, 0.7], ["click", "Attack click", 0, 1, 0.01, 0.15]],
      Output: [["reverb.send", "Reverb", 0, 1, 0.01, 0.3], ["delay.send", "Delay", 0, 1, 0.01, 0]],
    },
  },
  Tangle: {
    role: "texture", blurb: "The modular, here as one patch: a carrier with two FM modulators, an LFO on the modulation depth, glide, and a resonant low-pass.",
    groups: {
      FM: [["car.wave", "Carrier", ["sine", "triangle", "sawtooth", "square"], "sine"], ["ratio", "Ratio 1", 0.5, 8, 0.5, 2, { auto: false }], ["fm.index", "Depth 1", 0, 10, 0.1, 2], ["ratio2", "Ratio 2", 0.5, 8, 0.5, 3, { auto: false }], ["fm2.index", "Depth 2", 0, 10, 0.1, 0]],
      LFO: [["lfo.rate", "Rate", 0.02, 5, 0.01, 0.2, { unit: "Hz", log: true }], ["lfo.depth", "Depth", 0, 1, 0.01, 0.5]],
      Filter: [["filter.cutoff", "Cutoff", 80, 12000, 1, 1500, { unit: "Hz", log: true }], ["filter.resonance", "Resonance", 0, 10, 0.1, 0.7]],
      Amp: [["aenv.attack", "Attack", 0.01, 3, 0.01, 0.6, { unit: "s", log: true }], ["aenv.release", "Release", 0.05, 4, 0.01, 1.8, { unit: "s" }], ["glide", "Glide", 0, 2, 0.01, 0, { unit: "s", auto: false }]],
      Output: [["reverb.send", "Reverb", 0, 1, 0.01, 0.6], ["delay.send", "Delay", 0, 1, 0.01, 0]],
    },
  },
};
export const INSTRUMENTS = Object.keys(SPEC);
export const ROLE_OF = Object.fromEntries(INSTRUMENTS.map((n) => [n, SPEC[n].role]));
export const INSTRUMENT_OF = Object.fromEntries(INSTRUMENTS.map((n) => [SPEC[n].role, n]));

const _controls = Object.fromEntries(INSTRUMENTS.map((n) => [n, Object.values(SPEC[n].groups).flat()]));
const _byId = Object.fromEntries(INSTRUMENTS.map((n) => [n, Object.fromEntries(_controls[n].map((c) => [c[0], c]))]));

export const controls = (n) => _controls[n] || [];
export const control = (n, id) => _byId[n]?.[id];
export const isChoice = (c) => Array.isArray(c[2]);
/** Numeric params that can be animated. */
export const automatable = (n) => controls(n).filter((c) => !isChoice(c) && c[6]?.auto !== false).map((c) => c[0]);

export function defaults(n) {
  const p = {};
  for (const c of controls(n)) p[c[0]] = isChoice(c) ? c[3] : c[5];
  return p;
}

/** Clamps a value into its control's range (and onto its step), or checks a choice. */
export function clampParam(n, id, v) {
  const c = control(n, id);
  if (!c) return v;
  if (isChoice(c)) return c[2].includes(v) ? v : c[3];
  const x = Math.max(c[2], Math.min(c[3], +v));
  return Number.isFinite(x) ? x : c[5];
}

// ---------------------------------------------------------------- automation
//
// An automation is {shape, bars, depth, phase}:
//   shape  "sine" | "triangle" | "saw" (rises) | "ramp" (falls) | "square" | "random" (steps) | "drift" (smooth random)
//   bars   cycle length in bars (4 beats each): 0.25 to 32
//   depth  0..1: how far it swings, as a fraction of the control's range (log controls swing in octaves)
//   phase  0..1: where in the cycle it starts
// It swings around the param's set value, both ways, and stays inside the control's range.

export const SHAPES = ["sine", "triangle", "saw", "ramp", "square", "random", "drift"];
export const RATES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];

function hash(i, salt) {
  let h = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}

/** The shape's value, -1..1, at cycle position x (cycles, any real number). */
export function wave(shape, x, salt = 1) {
  const f = x - Math.floor(x);
  switch (shape) {
    case "triangle": return 1 - 4 * Math.abs(f - 0.5);
    case "saw": return 2 * f - 1;
    case "ramp": return 1 - 2 * f;
    case "square": return f < 0.5 ? 1 : -1;
    case "random": return hash(Math.floor(x * 4), salt); // four steps per cycle
    case "drift": { // smoothed random, four points per cycle
      const k = Math.floor(x * 4), u = x * 4 - k, s = u * u * (3 - 2 * u);
      return hash(k, salt) * (1 - s) + hash(k + 1, salt) * s;
    }
    default: return Math.sin(2 * Math.PI * f);
  }
}

/** `base` moved by automation `a` at `beat` (beats since any fixed point), kept inside the control's range. */
export function automate(n, id, base, a, beat) {
  const c = control(n, id);
  if (!a || !c || isChoice(c) || typeof base !== "number") return base;
  const bars = Math.max(0.0625, +a.bars || 1);
  const w = wave(a.shape, beat / (4 * bars) + (+a.phase || 0), id.length * 31 + id.charCodeAt(0));
  const depth = Math.max(0, Math.min(1, +a.depth || 0));
  let v;
  if (c[6]?.log) v = base * Math.pow(2, w * depth * 0.5 * Math.log2(c[3] / c[2]));
  else v = base + w * depth * 0.5 * (c[3] - c[2]);
  return Math.max(c[2], Math.min(c[3], v));
}

/** Problems with an automation map for instrument `n` (empty if fine). */
export function checkAutomation(n, auto) {
  const errs = [];
  if (auto == null) return errs;
  if (typeof auto !== "object") return ["automation must be an object"];
  for (const [id, a] of Object.entries(auto)) {
    if (!automatable(n).includes(id)) errs.push(`${id} can't be automated on ${n}`);
    else if (!a || !SHAPES.includes(a.shape) || !(a.bars > 0 && a.bars <= 64) || !(a.depth >= 0 && a.depth <= 1)) errs.push(`automation for ${id} needs a shape, bars (0-64) and depth (0-1)`);
  }
  return errs;
}
