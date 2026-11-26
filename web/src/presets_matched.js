// Presets matched to sounds in reference songs by web/tools/match_presets.mjs
// (rebuild with: node web/tools/match_presets.mjs). Each entry notes the
// song part it was matched to and what it measured on SynthKit.
// Generated file: edit the targets in the tool, not this file.

export const MATCHED = {
 "Undertow": [
  {
   "name": "Round Low",
   "energy": 0.4,
   "params": {
    "osc.detune": 18.5,
    "sub.level": 0.11,
    "osc.octave": "8'",
    "filter.cutoff": 216,
    "filter.emphasis": 9.4,
    "fenv.amount": 0,
    "fenv.decay": 1.5,
    "aenv.attack": 0.001,
    "aenv.release": 0.1,
    "drive": 0.8
   }
  },
  {
   "name": "Sub Hold",
   "energy": 0.6,
   "params": {
    "osc.wave": "square",
    "osc.detune": 12,
    "sub.level": 0.11,
    "filter.cutoff": 276,
    "filter.emphasis": 10,
    "fenv.amount": 80,
    "fenv.decay": 1.39,
    "aenv.attack": 0.014,
    "aenv.release": 0.01,
    "drive": 1
   }
  },
  {
   "name": "Rolling Low",
   "energy": 0.85,
   "params": {
    "osc.detune": 18.5,
    "sub.level": 0,
    "osc.octave": "8'",
    "filter.cutoff": 339,
    "filter.emphasis": 0.1,
    "fenv.amount": 0,
    "fenv.decay": 0.02,
    "aenv.attack": 0.086,
    "aenv.release": 0.01,
    "drive": 0.75,
    "reverb.send": 0.05
   }
  }
 ],
 "Lumen": [
  {
   "name": "Wide Warm Pad",
   "energy": 0.3,
   "params": {
    "osc2.wave": "triangle",
    "osc.detune": 30,
    "filter.cutoff": 1001,
    "filter.resonance": 0.8,
    "fenv.amount": 3.45,
    "fenv.decay": 1.09,
    "aenv.attack": 0.064,
    "aenv.release": 0.08,
    "chorus.mix": 0.9,
    "reverb.send": 0.3
   }
  },
  {
   "name": "Downtempo Bed",
   "energy": 0.6,
   "params": {
    "osc.wave": "sine",
    "osc.detune": 0,
    "filter.cutoff": 1008,
    "filter.resonance": 0.6,
    "fenv.amount": 1.05,
    "fenv.decay": 2.49,
    "aenv.attack": 0.128,
    "aenv.release": 0.22,
    "chorus.mix": 0.2,
    "reverb.send": 0.25
   }
  },
  {
   "name": "Choir Haze",
   "energy": 0.25,
   "params": {
    "osc.wave": "triangle",
    "osc2.wave": "triangle",
    "osc2.octave": 1,
    "osc.detune": 16,
    "filter.cutoff": 6842,
    "filter.resonance": 10,
    "fenv.amount": 4,
    "fenv.decay": 2.72,
    "aenv.attack": 0.003,
    "aenv.release": 0.83
   }
  }
 ],
 "Driftwood": [
  {
   "name": "Clean Strum",
   "energy": 0.5,
   "params": {
    "model": "steel",
    "brightness": 0.96,
    "decay": 2.2,
    "body.cutoff": 8000,
    "body.resonance": 4.7,
    "click": 0,
    "reverb.send": 0.25
   }
  }
 ],
 "Comet": [
  {
   "name": "Psy Arp",
   "energy": 0.8,
   "params": {
    "osc.wave": "square",
    "osc2.wave": "triangle",
    "osc2.semis": 12,
    "osc2.level": 0,
    "filter.cutoff": 3553,
    "filter.resonance": 7,
    "fenv.amount": 3.1,
    "vibrato.rate": 3.3,
    "vibrato.depth": 43,
    "portamento": 0.03,
    "aenv.attack": 0.001,
    "aenv.release": 0.01,
    "drive": 0.28,
    "delay.send": 0.25,
    "reverb.send": 0.15
   }
  }
 ]
};

export const MATCHED_FROM = {
 "Round Low": {
  "from": "Sowing the Seeds of Love, Woman in Chains: bass",
  "measured": {
   "bright": 119,
   "attack": 85,
   "decay": 683,
   "hf": -72.4
  }
 },
 "Sub Hold": {
  "from": "Stoned: bass",
  "measured": {
   "bright": 110,
   "attack": 171,
   "decay": 437,
   "hf": -78.1
  }
 },
 "Rolling Low": {
  "from": "Shpongle, The Aquatic Garden: bass",
  "measured": {
   "bright": 150,
   "attack": 75,
   "decay": 192,
   "hf": -83.2
  }
 },
 "Wide Warm Pad": {
  "from": "Sowing, Woman in Chains, Pier: pads ('other')",
  "measured": {
   "bright": 1001,
   "attack": 149,
   "decay": 1301,
   "hf": -38.9
  }
 },
 "Downtempo Bed": {
  "from": "Stoned: synth bed ('other')",
  "measured": {
   "bright": 900,
   "attack": 117,
   "decay": 885,
   "hf": -37.5
  }
 },
 "Choir Haze": {
  "from": "Pier: choir-like layer",
  "measured": {
   "bright": 792,
   "attack": 117,
   "decay": 1280,
   "hf": -43
  }
 },
 "Clean Strum": {
  "from": "Sowing, Woman in Chains: guitar",
  "measured": {
   "bright": 780,
   "attack": 11,
   "decay": 704,
   "hf": -21.4
  }
 },
 "Psy Arp": {
  "from": "Shpongle (Aquatic Garden, Brain in a Fish Tank): synth arps ('other')",
  "measured": {
   "bright": 1027,
   "attack": 117,
   "decay": 619,
   "hf": -33.7
  }
 }
};
