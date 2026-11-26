// Factory presets: 20 per instrument. Each is {name, energy, params, automation?}.
// `energy` (0..1) says what kind of song it suits, so the song generator
// can pick sounds that fit a beacon's mood. Params not listed use the
// instrument's defaults (params.js).

import { defaults } from "./params.js";
import { MATCHED } from "./presets_matched.js";

/** Builds presets from rows: [name, energy, ...values in `keys` order, automation?]. */
function table(keys, rows) {
  return rows.map((row) => {
    const [name, energy, ...rest] = row;
    const auto = rest.length > keys.length ? rest[keys.length] : null;
    const params = {};
    keys.forEach((k, i) => { if (rest[i] !== undefined && rest[i] !== null) params[k] = rest[i]; });
    return auto ? { name, energy, params, automation: auto } : { name, energy, params };
  });
}
/** Automation shorthand: A("filter.cutoff", "sine", 4, 0.4) */
const A = (...items) => {
  const out = {};
  for (let i = 0; i < items.length; i += 4) out[items[i]] = { shape: items[i + 1], bars: items[i + 2], depth: items[i + 3], phase: 0 };
  return out;
};

export const PRESETS = {
  Pulsar: table(
    ["kick.tune", "kick.punch", "kick.decay", "snare.tone", "snare.snap", "snare.decay", "hat.tone", "hat.decay", "clap.tone", "clap.decay", "master.drive", "reverb.send", "delay.send"],
    [
      ["808 Boom", 0.5, 45, 0.4, 0.9, 180, 0.5, 0.2, 8500, 0.05, 1100, 0.25, 0.1, 0.1, 0],
      ["909 Punch", 0.8, 55, 0.85, 0.4, 210, 0.7, 0.16, 9500, 0.04, 1300, 0.18, 0.25, 0.08, 0],
      ["Lo-fi Dust", 0.4, 48, 0.3, 0.5, 170, 0.35, 0.22, 5200, 0.07, 900, 0.2, 0.4, 0.15, 0, A("hat.tone", "drift", 8, 0.2)],
      ["Tight Funk", 0.7, 60, 0.7, 0.25, 240, 0.6, 0.1, 10500, 0.03, 1500, 0.12, 0.15, 0.06, 0],
      ["Deep House", 0.7, 47, 0.55, 0.55, 190, 0.5, 0.18, 9000, 0.06, 1250, 0.22, 0.1, 0.12, 0],
      ["Techno Steel", 0.9, 52, 0.9, 0.35, 230, 0.8, 0.14, 11500, 0.035, 1600, 0.15, 0.5, 0.08, 0, A("hat.decay", "sine", 4, 0.3)],
      ["Brush Kit", 0.2, 58, 0.2, 0.3, 260, 0.9, 0.3, 7000, 0.09, 1800, 0.3, 0, 0.3, 0],
      ["Trap Sub", 0.75, 38, 0.5, 1.1, 220, 0.75, 0.14, 12000, 0.025, 1400, 0.2, 0.2, 0.08, 0],
      ["Breakbeat", 0.85, 62, 0.75, 0.3, 250, 0.65, 0.15, 8000, 0.05, 1300, 0.14, 0.35, 0.1, 0],
      ["Minimal Click", 0.6, 56, 0.95, 0.2, 280, 0.4, 0.08, 13000, 0.02, 2200, 0.08, 0.05, 0.06, 0, A("kick.decay", "triangle", 8, 0.25)],
      ["Dub Room", 0.45, 50, 0.45, 0.6, 160, 0.45, 0.25, 6500, 0.08, 1000, 0.3, 0.1, 0.4, 0.3],
      ["Electro Zap", 0.85, 65, 1, 0.28, 300, 0.85, 0.12, 10000, 0.03, 2400, 0.1, 0.45, 0.06, 0, A("snare.tone", "saw", 2, 0.3)],
      ["Soft Pillow", 0.15, 44, 0.15, 0.5, 150, 0.3, 0.25, 4500, 0.06, 800, 0.25, 0, 0.25, 0],
      ["Industrial", 0.95, 42, 0.8, 0.7, 140, 0.9, 0.3, 7500, 0.1, 700, 0.35, 0.9, 0.12, 0],
      ["Garage Shuffle", 0.7, 54, 0.6, 0.32, 235, 0.7, 0.12, 9800, 0.045, 1700, 0.16, 0.12, 0.08, 0],
      ["Afro Wood", 0.55, 70, 0.35, 0.25, 320, 0.35, 0.12, 6000, 0.05, 1900, 0.12, 0.08, 0.12, 0],
      ["Cinematic Hit", 0.5, 35, 0.7, 1.2, 130, 0.6, 0.45, 5500, 0.12, 650, 0.45, 0.3, 0.5, 0],
      ["Glitch Tick", 0.65, 85, 0.9, 0.12, 380, 0.5, 0.06, 14000, 0.02, 2800, 0.06, 0.2, 0.05, 0.25, A("hat.tone", "random", 1, 0.35)],
      ["Disco Bright", 0.8, 57, 0.65, 0.38, 215, 0.6, 0.17, 11000, 0.07, 1350, 0.2, 0.1, 0.1, 0],
      ["Ambient Pulse", 0.25, 40, 0.25, 0.8, 145, 0.25, 0.3, 5000, 0.15, 900, 0.4, 0, 0.45, 0.2, A("hat.decay", "drift", 16, 0.4)],
    ]),

  Undertow: table(
    ["osc.wave", "osc.detune", "sub.wave", "sub.level", "filter.cutoff", "filter.emphasis", "fenv.amount", "fenv.decay", "aenv.attack", "aenv.release", "glide", "drive", "reverb.send", "delay.send"],
    [
      ["Classic Saw", 0.5, "sawtooth", 6, "square", 0.4, 500, 3, 1200, 0.25, 0.004, 0.12, 0, 0, 0.04, 0],
      ["Acid Squelch", 0.8, "sawtooth", 2, "square", 0.2, 300, 10, 3500, 0.18, 0.003, 0.1, 0.06, 0.3, 0.04, 0, A("filter.cutoff", "sine", 4, 0.45)],
      ["Sub Rumble", 0.3, "sine", 0, "sine", 0.9, 220, 0.5, 100, 0.2, 0.006, 0.2, 0, 0, 0.02, 0],
      ["Reese", 0.7, "sawtooth", 22, "square", 0.3, 700, 2, 600, 0.4, 0.005, 0.15, 0, 0.2, 0.05, 0, A("filter.cutoff", "drift", 8, 0.35)],
      ["Funk Pluck", 0.7, "square", 4, "square", 0.3, 380, 6, 2600, 0.1, 0.002, 0.06, 0, 0.1, 0.03, 0],
      ["Round Moog", 0.5, "sawtooth", 3, "square", 0.5, 420, 4, 900, 0.3, 0.004, 0.15, 0, 0.1, 0.04, 0],
      ["Deep Dub", 0.35, "sine", 0, "sine", 0.7, 300, 2, 300, 0.3, 0.008, 0.3, 0, 0.05, 0.1, 0.15],
      ["Growl", 0.9, "sawtooth", 14, "square", 0.4, 900, 7, 2000, 0.2, 0.003, 0.1, 0, 0.7, 0.04, 0, A("filter.cutoff", "saw", 1, 0.3)],
      ["Rubber", 0.55, "triangle", 5, "sine", 0.6, 600, 5, 1500, 0.12, 0.003, 0.1, 0.08, 0.1, 0.04, 0],
      ["Hoover", 0.85, "sawtooth", 28, "square", 0.5, 1500, 3, 800, 0.6, 0.01, 0.2, 0.12, 0.3, 0.08, 0, A("osc.detune", "sine", 8, 0.3)],
      ["Mellow Finger", 0.3, "triangle", 2, "sine", 0.5, 350, 1, 400, 0.2, 0.01, 0.2, 0, 0, 0.04, 0],
      ["Wobble", 0.85, "sawtooth", 10, "square", 0.4, 400, 8, 500, 0.3, 0.004, 0.12, 0, 0.4, 0.04, 0, A("filter.cutoff", "sine", 0.5, 0.6)],
      ["Synthwave", 0.6, "sawtooth", 9, "square", 0.35, 800, 3, 1800, 0.22, 0.003, 0.18, 0, 0.1, 0.05, 0.1],
      ["Square Thump", 0.65, "square", 0, "square", 0.6, 450, 2, 1000, 0.15, 0.003, 0.1, 0, 0.15, 0.03, 0],
      ["Slow Glide", 0.4, "sawtooth", 7, "sine", 0.5, 550, 4, 700, 0.4, 0.006, 0.3, 0.25, 0.1, 0.06, 0],
      ["Nasal Mid", 0.6, "square", 12, "triangle", 0.2, 1200, 9, 1500, 0.25, 0.004, 0.12, 0, 0.2, 0.04, 0, A("filter.emphasis", "triangle", 4, 0.3)],
      ["Velvet", 0.2, "sine", 4, "sine", 0.4, 900, 1, 200, 0.4, 0.03, 0.4, 0, 0, 0.12, 0],
      ["Electro Bite", 0.9, "sawtooth", 3, "square", 0.25, 250, 11, 4500, 0.09, 0.002, 0.08, 0, 0.5, 0.03, 0],
      ["Drifter", 0.4, "triangle", 16, "sine", 0.5, 650, 3, 600, 0.5, 0.008, 0.25, 0.1, 0.1, 0.08, 0, A("filter.cutoff", "drift", 16, 0.4)],
      ["Distorted Sub", 0.8, "sine", 0, "square", 0.8, 500, 2, 400, 0.2, 0.004, 0.12, 0, 0.85, 0.03, 0],
    ]),

  Lumen: table(
    ["osc.wave", "osc2.wave", "osc2.octave", "osc.detune", "filter.cutoff", "filter.resonance", "fenv.amount", "fenv.decay", "aenv.attack", "aenv.release", "glide", "chorus.mix", "reverb.send", "delay.send"],
    [
      ["Warm Pad", 0.3, "sawtooth", "sawtooth", 0, 10, 1800, 1, 0, 0.8, 0.6, 2, 0, 0.5, 0.5, 0],
      ["Glass Keys", 0.5, "triangle", "sine", 1, 4, 5000, 0.5, 1, 0.5, 0.005, 0.8, 0, 0.3, 0.35, 0],
      ["Stab Chord", 0.85, "sawtooth", "square", 0, 6, 1200, 3, 2.5, 0.15, 0.003, 0.2, 0, 0.2, 0.2, 0.1],
      ["Strings", 0.4, "sawtooth", "sawtooth", 0, 14, 3000, 0.7, 0, 0.8, 0.8, 1.8, 0, 0.6, 0.55, 0, A("filter.cutoff", "sine", 8, 0.2)],
      ["Organ", 0.6, "square", "sine", 1, 2, 4500, 0.5, 0, 0.5, 0.01, 0.15, 0, 0.4, 0.2, 0],
      ["Choir Air", 0.2, "triangle", "sine", 1, 18, 2200, 1, 0, 1, 1.2, 2.5, 0, 0.7, 0.7, 0, A("filter.cutoff", "drift", 16, 0.3)],
      ["EP Bell", 0.5, "sine", "triangle", 1, 3, 6000, 0.5, 1.5, 0.4, 0.004, 1.2, 0, 0.35, 0.3, 0],
      ["Sweep Pad", 0.35, "sawtooth", "sawtooth", 0, 12, 900, 4, 0, 0.8, 1, 2.5, 0, 0.5, 0.6, 0, A("filter.cutoff", "triangle", 16, 0.6)],
      ["House Chord", 0.8, "sawtooth", "sawtooth", 0, 8, 1500, 4, 2, 0.2, 0.003, 0.3, 0, 0.25, 0.25, 0.2],
      ["Dream Glide", 0.3, "sawtooth", "triangle", 1, 10, 2500, 1, 0, 0.8, 0.4, 2, 0.35, 0.6, 0.6, 0],
      ["Hollow Square", 0.45, "square", "square", -1, 6, 1600, 2, 0.5, 0.5, 0.05, 0.8, 0, 0.3, 0.4, 0],
      ["Trance Supersaw", 0.85, "sawtooth", "sawtooth", 1, 26, 4000, 1.5, 1, 0.4, 0.01, 0.6, 0, 0.8, 0.45, 0.1, A("filter.cutoff", "saw", 4, 0.3)],
      ["Felt Piano", 0.35, "triangle", "sine", 0, 3, 1400, 0.5, 1, 0.3, 0.004, 0.6, 0, 0.1, 0.3, 0],
      ["Lo-fi Tape", 0.4, "sawtooth", "triangle", 0, 20, 1100, 1, 0.5, 0.5, 0.03, 1, 0, 0.9, 0.3, 0, A("osc.detune", "drift", 4, 0.3)],
      ["Bright Brass", 0.75, "sawtooth", "sawtooth", 0, 7, 2500, 2, 2, 0.3, 0.06, 0.4, 0, 0.2, 0.25, 0],
      ["Night Drone", 0.15, "sine", "sawtooth", -1, 9, 700, 3, 0, 0.8, 1.5, 3, 0, 0.4, 0.75, 0, A("filter.resonance", "sine", 8, 0.3)],
      ["Pluck Chords", 0.7, "sawtooth", "square", 0, 5, 900, 2, 3, 0.12, 0.003, 0.25, 0, 0.3, 0.3, 0.25],
      ["Shimmer", 0.3, "triangle", "triangle", 1, 12, 7000, 0.5, 0, 0.8, 0.3, 2.5, 0, 0.6, 0.8, 0, A("filter.cutoff", "sine", 2, 0.25)],
      ["Wurly", 0.55, "square", "triangle", 0, 4, 2000, 1.5, 1.2, 0.25, 0.005, 0.5, 0, 0.5, 0.2, 0, A("chorus.mix", "sine", 4, 0.4)],
      ["Gated Pulse", 0.9, "sawtooth", "sawtooth", 0, 10, 2000, 2, 0, 0.8, 0.005, 0.1, 0, 0.4, 0.3, 0, A("filter.cutoff", "square", 0.5, 0.5)],
    ]),

  Comet: table(
    ["osc.wave", "osc2.wave", "osc2.semis", "osc2.level", "filter.cutoff", "filter.resonance", "fenv.amount", "vibrato.rate", "vibrato.depth", "portamento", "aenv.attack", "aenv.release", "drive", "delay.send", "reverb.send"],
    [
      ["Classic Lead", 0.6, "sawtooth", "square", 7, 0.55, 3000, 2, 0.85, 5.5, 10, 0, 0.01, 0.2, 0, 0.3, 0.2],
      // Tamed (filter 4500 -> 3200 Hz, osc 2 and drive lower): nudged brighter, it crossed the "never shrill" line.
      ["Sync Scream", 0.9, "sawtooth", "sawtooth", 12, 0.5, 3200, 5, 1.5, 6, 6, 0.03, 0.005, 0.15, 0.35, 0.25, 0.15],
      ["Flute", 0.3, "sine", "triangle", 12, 0.2, 2500, 0.5, 0.2, 5, 14, 0.02, 0.08, 0.25, 0, 0.2, 0.35],
      ["Chip Square", 0.7, "square", "square", 12, 0.3, 8000, 0, 0, 6, 0, 0, 0.002, 0.08, 0, 0.15, 0.1],
      ["Soft Whistle", 0.25, "sine", "sine", 24, 0.15, 3000, 0, 0, 5.5, 18, 0.05, 0.06, 0.3, 0, 0.35, 0.4],
      ["Saw Glide", 0.55, "sawtooth", "sawtooth", 12, 0.6, 2800, 3, 0.9, 5, 8, 0.12, 0.01, 0.25, 0.1, 0.3, 0.25],
      ["Brass Lead", 0.65, "sawtooth", "square", 12, 0.4, 1800, 2, 1.8, 5, 8, 0.02, 0.05, 0.2, 0.2, 0.2, 0.2],
      ["Acid Lead", 0.85, "sawtooth", "square", -12, 0.3, 900, 9, 2.5, 6, 0, 0.06, 0.003, 0.12, 0.3, 0.3, 0.1, A("filter.cutoff", "sine", 2, 0.4)],
      ["Oboe Reed", 0.4, "square", "triangle", 12, 0.3, 1600, 4, 0.5, 5, 10, 0.02, 0.04, 0.2, 0.1, 0.15, 0.3],
      ["Fifths Hook", 0.75, "sawtooth", "sawtooth", 7, 0.8, 3500, 1, 0.8, 5.5, 5, 0, 0.005, 0.2, 0.15, 0.35, 0.2],
      ["Wobble Lead", 0.8, "square", "sawtooth", 12, 0.5, 1500, 6, 0.6, 4, 20, 0.04, 0.01, 0.2, 0.3, 0.3, 0.2, A("filter.cutoff", "triangle", 1, 0.4)],
      ["Glass Sine", 0.3, "sine", "triangle", 19, 0.25, 6000, 0, 0, 6, 6, 0.02, 0.01, 0.4, 0, 0.45, 0.4],
      ["Detuned Duo", 0.6, "sawtooth", "sawtooth", 12, 0.45, 3200, 2, 1, 5.2, 12, 0.03, 0.01, 0.25, 0.1, 0.3, 0.25],
      ["Distorted", 0.9, "sawtooth", "square", 5, 0.6, 2200, 3, 1.2, 6, 8, 0.02, 0.005, 0.15, 0.8, 0.2, 0.1],
      ["Theremin", 0.2, "sine", "sine", 0, 0, 4000, 0, 0, 6.5, 35, 0.2, 0.1, 0.4, 0, 0.3, 0.45],
      ["Pluck Lead", 0.7, "square", "sawtooth", 12, 0.4, 1200, 4, 3, 5, 0, 0, 0.002, 0.1, 0.1, 0.4, 0.2],
      ["Talk Box", 0.7, "sawtooth", "square", 7, 0.5, 1000, 8, 1, 5, 6, 0.03, 0.02, 0.2, 0.2, 0.2, 0.2, A("filter.cutoff", "random", 0.5, 0.45)],
      ["Spacey", 0.3, "triangle", "sine", 7, 0.4, 3500, 1, 0.4, 4.5, 15, 0.08, 0.05, 0.6, 0, 0.6, 0.6, A("delay.send", "sine", 8, 0.3)],
      ["Hard Square", 0.85, "square", "square", -12, 0.5, 5000, 2, 1, 6, 4, 0, 0.003, 0.1, 0.4, 0.2, 0.1],
      ["Sweeping Saw", 0.7, "sawtooth", "sawtooth", 7, 0.5, 1500, 4, 0.5, 5.5, 8, 0.04, 0.01, 0.25, 0.2, 0.3, 0.2, A("filter.cutoff", "saw", 4, 0.5)],
    ]),

  Driftwood: table(
    ["model", "brightness", "decay", "body.cutoff", "body.resonance", "click", "reverb.send", "delay.send"],
    [
      ["Nylon Guitar", 0.4, "nylon", 0.5, 1.4, 6000, 0.7, 0.1, 0.25, 0],
      ["Steel Guitar", 0.55, "steel", 0.7, 1.8, 10000, 0.7, 0.15, 0.25, 0],
      ["Harp", 0.3, "string", 0.55, 2.5, 8000, 0.5, 0.05, 0.5, 0],
      ["Koto", 0.5, "steel", 0.85, 1, 9000, 3, 0.25, 0.3, 0],
      ["Marimba", 0.55, "marimba", 0.6, 1, 12000, 0.5, 0.25, 0.2, 0],
      ["Kalimba", 0.5, "kalimba", 0.7, 1.2, 9000, 1, 0.3, 0.3, 0.15],
      ["Vibraphone", 0.35, "vibes", 0.5, 3, 7000, 0.5, 0.1, 0.4, 0, A("body.cutoff", "sine", 1, 0.2)],
      ["Glass Harp", 0.3, "glass", 0.7, 2.5, 12000, 0.5, 0.05, 0.55, 0],
      ["Tubular Bell", 0.25, "bell", 0.6, 3.5, 10000, 0.5, 0.2, 0.5, 0],
      ["Muted Pluck", 0.7, "string", 0.3, 0.3, 2500, 2, 0.35, 0.15, 0],
      ["Banjo Bright", 0.75, "steel", 1, 0.6, 12000, 4, 0.4, 0.15, 0],
      ["Music Box", 0.45, "glass", 0.9, 1.5, 12000, 0.5, 0.45, 0.35, 0.2],
      ["Woodblock", 0.8, "marimba", 0.3, 0.2, 4000, 3, 0.6, 0.15, 0],
      ["Harpsichord", 0.6, "steel", 0.95, 1.2, 8000, 6, 0.35, 0.25, 0],
      ["Pizzicato", 0.5, "nylon", 0.4, 0.5, 4000, 1, 0.2, 0.35, 0],
      ["Steel Drum", 0.6, "kalimba", 0.8, 1.4, 6000, 5, 0.2, 0.3, 0],
      ["Celesta", 0.4, "vibes", 0.8, 1.8, 12000, 0.5, 0.25, 0.45, 0],
      ["Dark Mallet", 0.3, "marimba", 0.2, 1.6, 1500, 2, 0.1, 0.35, 0],
      ["Shimmer Bell", 0.2, "bell", 0.9, 3, 12000, 0.5, 0.05, 0.7, 0.3, A("body.cutoff", "drift", 8, 0.3)],
      ["Rain Drops", 0.4, "glass", 0.8, 0.6, 9000, 4, 0.3, 0.5, 0.35, A("body.cutoff", "random", 1, 0.35)],
    ]),

  Tangle: table(
    ["car.wave", "ratio", "fm.index", "ratio2", "fm2.index", "lfo.rate", "lfo.depth", "filter.cutoff", "filter.resonance", "aenv.attack", "aenv.release", "glide", "reverb.send", "delay.send"],
    [
      ["FM Drone", 0.4, "sine", 2, 2, 3, 0, 0.2, 0.5, 1500, 0.7, 0.6, 1.8, 0, 0.6, 0],
      ["Bell Cloud", 0.3, "sine", 3.5, 3, 7, 1, 0.1, 0.4, 4000, 0.5, 0.05, 3, 0, 0.7, 0],
      ["Metallic Wash", 0.5, "sine", 1.5, 6, 4.5, 2, 0.3, 0.7, 2500, 2, 1, 2.5, 0, 0.7, 0, A("fm.index", "sine", 8, 0.3)],
      ["Deep Space", 0.2, "triangle", 0.5, 1.5, 2, 0.5, 0.05, 0.6, 800, 3, 2.5, 4, 0.5, 0.8, 0, A("filter.cutoff", "drift", 16, 0.4)],
      ["Growl Pad", 0.6, "sawtooth", 1, 3, 2, 1, 0.4, 0.6, 1200, 4, 0.8, 2, 0, 0.5, 0, A("filter.cutoff", "sine", 4, 0.4)],
      ["Glass Choir", 0.25, "sine", 4, 1, 6, 0.5, 0.15, 0.3, 6000, 0.5, 1.5, 3, 0.3, 0.75, 0],
      ["Brass Swell", 0.5, "sawtooth", 1, 2, 3, 0, 0.5, 0.3, 1800, 1, 1.2, 1.5, 0, 0.45, 0],
      ["Wobble Texture", 0.75, "square", 2, 4, 5, 0, 2, 0.8, 1500, 5, 0.3, 1, 0, 0.4, 0],
      ["Ocean", 0.2, "sine", 1, 1, 2.5, 3, 0.07, 0.9, 1000, 1, 2.5, 4, 0, 0.8, 0, A("fm2.index", "drift", 8, 0.35)],
      ["Chime Sweep", 0.4, "sine", 5, 2, 8, 1, 0.25, 0.5, 5000, 1, 0.4, 2.5, 0, 0.6, 0, A("filter.cutoff", "saw", 8, 0.4)],
      ["Dirty Organ", 0.65, "square", 2, 1.5, 4, 1, 0.8, 0.2, 2500, 2, 0.2, 0.8, 0, 0.3, 0],
      ["Slow Morph", 0.3, "triangle", 3, 4, 1.5, 2, 0.03, 0.7, 1800, 2, 2, 3, 1, 0.7, 0, A("fm.index", "triangle", 16, 0.5)],
      ["Ring Mod", 0.6, "sine", 1.5, 8, 2.5, 3, 0.6, 0.4, 3000, 1, 0.3, 1.5, 0, 0.5, 0],
      ["Warm Bed", 0.3, "triangle", 1, 0.8, 2, 0.3, 0.1, 0.3, 900, 0.5, 1.8, 3, 0.2, 0.6, 0],
      ["Alien Glide", 0.55, "sawtooth", 2.5, 3, 6, 2, 0.4, 0.6, 2000, 6, 0.5, 2, 1.2, 0.6, 0, A("filter.resonance", "sine", 4, 0.3)],
      ["Rhythmic Shimmer", 0.8, "sine", 4, 2, 8, 1, 4, 0.6, 5000, 1, 0.1, 1, 0, 0.5, 0.3],
      ["Bass Drone", 0.4, "sine", 0.5, 2, 1, 1, 0.1, 0.5, 500, 2, 1, 3, 0, 0.4, 0],
      ["Frozen Air", 0.15, "sine", 6, 0.5, 7.5, 0.5, 0.05, 0.5, 8000, 0.5, 3, 4, 0, 0.85, 0],
      ["Pulse Grit", 0.85, "square", 3, 5, 2, 2, 1.5, 0.7, 1600, 7, 0.2, 1, 0, 0.4, 0, A("filter.cutoff", "square", 1, 0.4)],
      ["Comet Tail", 0.5, "sawtooth", 1.5, 2.5, 3.5, 1, 0.3, 0.6, 2200, 3, 0.6, 3, 0.6, 0.6, 0.4, A("delay.send", "sine", 8, 0.3)],
    ]),
};

// Presets matched to sounds in reference songs (web/tools/match_presets.mjs):
// they join each instrument's list, so the song generator picks them too.
for (const [instrument, list] of Object.entries(MATCHED)) PRESETS[instrument].push(...list);

/** A preset's full param set (defaults filled in) and its automation. */
export function presetSound(instrument, preset) {
  return { params: { ...defaults(instrument), ...preset.params }, automation: preset.automation ? structuredClone(preset.automation) : {} };
}
