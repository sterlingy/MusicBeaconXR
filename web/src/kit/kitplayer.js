// The beacon blend on SynthKit's own instruments, through its web module
// (the same C++ engine as the Godot app, compiled to WebAssembly). A browser
// twin of scripts/beacon/beacon_player.gd: same instrument and base preset per
// part, the same song-parameter translation (parammap.js), and a pad holding
// the harmony's chords. Song automation isn't played here yet, as in the app.
//
// makeKitInstruments() returns the same shape as synths.js makeInstruments(),
// so BeaconEngine drives either one.

import { Channel } from "../synths.js";
import { toSynth } from "./parammap.js";

export const INSTRUMENT = { drums: "Pulsar", bass: "Undertow", keys: "Prism", lead: "Prism", pluck: "Driftwood", texture: "Tangle", pad: "Prism" };
export const BASE_PRESET = { drums: "Classic Eight", bass: "Deep Current", keys: "Prism Keys", lead: "Comet Tail", pluck: "Nylon Pluck", texture: "Drone Garden", pad: "Aurora Pad" };
export const PARTS = ["drums", "bass", "keys", "lead", "pluck", "texture", "pad"];
export const DRUM_NOTE = { kick: 36, snare: 38, clap: 39, hat: 42, open: 46 };
const PAD_MOODS = ["Drift", "Glow", "Tide"];
const AWAKE = 0.0005;

/** How much pad a song wants: calm, low-energy songs lean on it (BeaconPlayer.pad_level). */
export function padLevel(song) {
  const energy = Number(song.energy ?? 0.5);
  const moodK = PAD_MOODS.includes(song.mood) ? 1 : 0.6;
  return Math.max(0.12, Math.min(0.7, 0.75 - energy * 0.6)) * moodK;
}

/** The pad's share of a blend: each active song's pad level by its weight. */
export function padGain(active) {
  return active.reduce((s, a) => s + a.w * padLevel(a.song), 0);
}

/** Phones get Prism's light voices and a smaller voice budget, like the app on Android. */
export function isPhone(nav = globalThis.navigator) {
  return /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent || "");
}

/** Applies only the values that moved, as BeaconPlayer._apply_params does. */
export function changedParams(done, target) {
  const out = {};
  for (const [id, v] of Object.entries(target)) {
    if (!(id in done) || Math.abs(done[id] - v) > 0.002 * Math.max(1, Math.abs(v))) {
      out[id] = v;
      done[id] = v;
    }
  }
  return out;
}

class KitPart {
  constructor(role, synth, channel) {
    this.role = role;
    this.synth = synth;
    this.channel = channel;
    this.applied = {};
    this.held = []; // the pad's chord
  }
  setParams(params) {
    for (const [id, v] of Object.entries(changedParams(this.applied, toSynth(this.role, params || {})))) this.synth.setParam(id, v);
  }
  setAutomation() {} // not yet: the app doesn't play automation either
  applyChannel() {} // the synth's own space and echo sends carry the sound
  hit(voice, t, vel) {
    const n = DRUM_NOTE[voice];
    if (n === undefined) return;
    this.synth.noteOn(n, vel, t);
    this.synth.noteOff(n, t + 0.1);
  }
  chord(notes, t, dur, vel) { for (const n of notes) this.note(n, t, dur, vel); }
  note(n, t, dur, vel) {
    this.synth.noteOn(n, vel, t);
    this.synth.noteOff(n, t + dur);
  }
  /** The pad holds a chord, tied across bars while it stays the same so it swells instead of retriggering. */
  hold(notes, t) {
    if (notes.length === this.held.length && notes.every((n, i) => n === this.held[i])) return false;
    for (const n of this.held) this.synth.noteOff(n, t);
    for (const n of notes) this.synth.noteOn(n, 0.7, t);
    this.held = notes.slice();
    return true;
  }
  release() {
    this.synth.allNotesOff();
    this.held = [];
  }
}

/**
 * Loads SynthKit's web module and one synth per part, each into its own
 * Channel (level and meter; no browser sends, since the synths have their own).
 * `base` is where the site serves SynthKit (web/serve.py and build_site.py: synthkit/).
 */
export async function makeKitInstruments(bus, { base = new URL("../../synthkit/", import.meta.url), phone = isPhone() } = {}) {
  const { loadSynthKit } = await import(new URL("synthkit.js", base).href);
  const kit = await loadSynthKit(bus.ctx);
  const index = await (await fetch(new URL("presets/factory/index.json", base))).json();
  const presetFor = async (instrument, name) => {
    const entry = (index[instrument] || []).find((p) => p.name === name);
    if (!entry) throw new Error(`SynthKit preset ${instrument} / ${name} not found`);
    return (await fetch(new URL(`presets/factory/${entry.file}`, base))).json();
  };
  const out = { kind: "kit", kit, channels: {}, parts: PARTS };
  const synths = [];
  await Promise.all(PARTS.map(async (role) => {
    const synth = await kit.createSynth(INSTRUMENT[role]);
    await synth.applyPreset(await presetFor(INSTRUMENT[role], BASE_PRESET[role]));
    if (INSTRUMENT[role] === "Prism") {
      synth.setParam("voice.quality", phone ? 0 : 2);
      synth.setParam("voice.budget", phone ? 12 : 24);
      synth.setParam("out.gain", 0); // asleep until the blend brings the part in
    }
    const ch = new Channel(bus);
    synth.connect(ch.input);
    out.channels[role] = wakeOnLevel(ch, synth, INSTRUMENT[role] === "Prism");
    out[role] = new KitPart(role, synth, ch);
    synths.push(synth);
  }));
  out.setTempo = (bpm) => { for (const s of synths) s.setTempo(bpm); };
  out.stop = () => { for (const r of PARTS) out[r].release(); };
  out.dispose = () => {
    for (const s of synths) s.dispose();
    for (const r of PARTS) out.channels[r].level.disconnect();
  };
  return out;
}

/**
 * A Prism part faded out of the blend sleeps (out.gain 0: no voices, no CPU)
 * and wakes the moment it's wanted again, as in the app.
 */
function wakeOnLevel(ch, synth, prism) {
  if (!prism) return ch;
  const set = ch.set.bind(ch);
  let awake = false, timer = null;
  ch.set = (param, value, tc = 0.15, at = 0) => {
    if (param === "level") {
      clearTimeout(timer);
      if (value > AWAKE && !awake) { awake = true; synth.setParam("out.gain", 1); }
      else if (value <= AWAKE && awake) timer = setTimeout(() => { awake = false; synth.setParam("out.gain", 0); }, Math.max(500, tc * 8000));
    }
    set(param, value, tc, at);
  };
  return ch;
}
