// Song parameters (the browser instruments' ids and units) -> SynthKit engine
// parameters. A line-for-line port of scripts/beacon/param_map.gd, so the
// browser's SynthKit mode and the Godot app play a song the same way.
// web/tests/kit.test.mjs checks it against the app's own output for every song
// (tests/fixtures/param_map.json, written by tests/dump_param_map.gd).

const UNDERTOW_WAVE = { triangle: 0, sawtooth: 2, square: 4 };
// Prism's Analog engine waves (a.wave / b.wave): Saw 0, Square 1, Pulse 2, Triangle 3, Sine 4.
const PRISM_WAVE = { sawtooth: 0, square: 1, triangle: 3, sine: 4 };
const PRISM_ANALOG = 1;
const PRISM_WAVETABLE = 2;
const DRIFT_MODEL = { string: 0, marimba: 1, vibes: 2, kalimba: 3, bell: 4, glass: 5 };
// See PRISM_FILTER in param_map.gd: a song moves the preset's own cutoff by half
// its distance from a typical song, within a range, so Prism never turns shrill.
const PRISM_FILTER = {
  keys: { home: 2200, typical: 2100, down: 1.5, up: 0.5, res: 0.35, resMax: 3 },
  lead: { home: 1500, typical: 2500, down: 1.5, up: 0.4, res: 0.3, resMax: 3 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const has = (p, k) => Object.prototype.hasOwnProperty.call(p, k);
const num = (v) => Number(v);
// GDScript's round() rounds halves away from zero.
const roundAway = (v) => Math.sign(v) * Math.round(Math.abs(v));

export function toSynth(role, p = {}) {
  const o = {};
  switch (role) {
    case "drums":
      if (has(p, "kick.tune")) o["kick.tune"] = clamp(12 * Math.log2(num(p["kick.tune"]) / 50), -12, 12);
      if (has(p, "kick.decay")) o["kick.decay"] = clamp(num(p["kick.decay"]) * 10, 0, 10);
      if (has(p, "snare.tone")) o["snare.tune"] = clamp(12 * Math.log2(num(p["snare.tone"]) / 200), -12, 12);
      if (has(p, "snare.decay")) o["snare.decay"] = clamp(num(p["snare.decay"]) * 25, 0, 10);
      o["snare.tone"] = 3;
      if (has(p, "hat.decay")) {
        o["chat.decay"] = clamp(num(p["hat.decay"]) * 50, 0, 10);
        o["ohat.decay"] = clamp(num(p["hat.decay"]) * 60, 0, 10);
      }
      if (has(p, "hat.tone")) {
        o["chat.tone"] = clamp((num(p["hat.tone"]) - 6000) / 2000, 0, 5);
        o["ohat.tone"] = o["chat.tone"];
        o["chat.level"] = 3.5;
        o["ohat.level"] = 3.2;
      }
      if (has(p, "master.drive")) o["master.drive"] = clamp(num(p["master.drive"]) * 10, 0, 10);
      break;
    case "bass":
      if (has(p, "osc.wave")) {
        const w = UNDERTOW_WAVE[p["osc.wave"]] ?? 2;
        o["osc1.wave"] = w;
        o["osc2.wave"] = w;
      }
      if (has(p, "osc.detune")) o["osc2.freq"] = clamp(num(p["osc.detune"]) / 100, -7, 7);
      if (has(p, "sub.level")) {
        o["mix.osc3_on"] = 1;
        o["osc3.range"] = 1;
        o["mix.osc3"] = clamp(num(p["sub.level"]) * 10, 0, 10);
      }
      if (has(p, "filter.cutoff")) o["filter.cutoff"] = clamp(num(p["filter.cutoff"]), 20, 18000);
      if (has(p, "filter.emphasis")) o["filter.emphasis"] = clamp(num(p["filter.emphasis"]) * 0.5, 0, 5);
      if (has(p, "fenv.amount")) {
        const cut = clamp(num(p["filter.cutoff"] ?? 500), 40, 16000);
        const octaves = Math.log2(Math.min(16000, cut + num(p["fenv.amount"])) / cut);
        o["filter.contour"] = clamp(octaves * 2, 0, 10);
      }
      if (has(p, "fenv.decay")) o["fenv.decay"] = clamp(num(p["fenv.decay"]), 0.004, 10);
      if (has(p, "glide")) o["ctrl.glide"] = clamp(num(p.glide), 0, 5);
      break;
    case "lead":
      prismFilter("lead", p, o);
      if (has(p, "osc.wave")) {
        o["a.type"] = PRISM_ANALOG;
        o["a.wave"] = PRISM_WAVE[p["osc.wave"]] ?? 0;
      }
      if (has(p, "osc2.wave")) {
        o["b.type"] = PRISM_ANALOG;
        o["b.wave"] = PRISM_WAVE[p["osc2.wave"]] ?? 1;
      }
      if (has(p, "osc2.semis")) {
        let semis = roundAway(num(p["osc2.semis"]));
        while (semis > 12) semis -= 12;
        o["b.coarse"] = clamp(semis, -24, 12);
      }
      if (has(p, "osc2.level")) o["b.level"] = clamp(num(p["osc2.level"]) * 10, 0, 4);
      if (has(p, "vibrato.depth")) o["lfo1.vibrato"] = clamp(num(p["vibrato.depth"]), 0, 100);
      if (has(p, "vibrato.rate")) o["lfo1.rate"] = clamp(num(p["vibrato.rate"]), 0.1, 12);
      if (has(p, "portamento")) o["voice.glide"] = clamp(num(p.portamento), 0, 2);
      if (has(p, "delay.send")) o["send.echo"] = clamp(num(p["delay.send"]) * 10, 0, 10);
      if (has(p, "reverb.send")) o["send.space"] = clamp(num(p["reverb.send"]) * 10, 0, 10);
      if (has(p, "aenv.release")) o["env1.release"] = clamp(num(p["aenv.release"]), 0.005, 15);
      break;
    case "keys":
      prismFilter("keys", p, o);
      if (has(p, "osc.wave")) {
        const soft = p["osc.wave"] === "sine" || p["osc.wave"] === "triangle";
        o["a.type"] = soft ? PRISM_ANALOG : PRISM_WAVETABLE;
        o["a.wave"] = PRISM_WAVE[p["osc.wave"]] ?? 0;
      }
      if (has(p, "osc2.wave")) o["b.wave"] = PRISM_WAVE[p["osc2.wave"]] ?? 1;
      if (has(p, "osc2.octave")) o["b.coarse"] = clamp(Math.trunc(num(p["osc2.octave"])) * 12, -24, 24);
      if (has(p, "osc.detune")) o["b.fine"] = clamp(num(p["osc.detune"]), -50, 50);
      if (has(p, "aenv.attack")) o["env1.attack"] = clamp(num(p["aenv.attack"]), 0.001, 10);
      if (has(p, "aenv.release")) o["env1.release"] = clamp(num(p["aenv.release"]), 0.005, 15);
      if (has(p, "chorus.mix")) o["fx1.amount"] = clamp(num(p["chorus.mix"]) * 10, 0, 10);
      if (has(p, "reverb.send")) o["send.space"] = clamp(num(p["reverb.send"]) * 10, 0, 10);
      if (has(p, "delay.send")) o["send.echo"] = clamp(num(p["delay.send"]) * 10, 0, 10);
      break;
    case "pluck":
      if (has(p, "model")) o["model.type"] = DRIFT_MODEL[p.model] ?? 0;
      if (has(p, "brightness")) o["model.brightness"] = clamp(num(p.brightness) * 7, 0, 6.5);
      if (has(p, "decay")) o["model.decay"] = clamp(num(p.decay), 0.05, 20);
      if (has(p, "reverb.send")) o["reverb.mix"] = clamp(num(p["reverb.send"]) * 10, 0, 10);
      break;
    default:
      break; // texture: Tangle is a patch; the base preset makes the sound, the blend sets its level
  }
  return o;
}

function prismFilter(role, p, o) {
  const f = PRISM_FILTER[role];
  if (has(p, "filter.cutoff")) {
    const octaves = 0.5 * Math.log2(Math.max(num(p["filter.cutoff"]), 30) / f.typical);
    o["f1.cutoff"] = f.home * Math.pow(2, clamp(octaves, -f.down, f.up));
  }
  if (has(p, "filter.resonance")) o["f1.resonance"] = clamp(num(p["filter.resonance"]) * f.res, 0, f.resMax);
}
