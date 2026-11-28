// SynthKit-native song sounds: the factory presets a song's parts choose from,
// and how a song's small "tune" offsets move the loaded preset. Songs store
// `track.kit = {preset, tune: {bright, space, grit, width}}` (and `song.pad.kit`);
// the players load that SynthKit preset and apply kitParams() on top. Songs
// without a kit (planted or shared before kits) play the part's base preset
// through parammap.js as before. The app's twin is scripts/beacon/kit_sounds.gd
// (tests/kit_sound_check.gd keeps them identical).
//
// Every preset here stays under the parts' "never shrill" limits
// (web/tests/kit.test.mjs), and the tune can only darken a part more than it
// can brighten it.

/** The instrument each part plays (as kitplayer.js INSTRUMENT). */
export const KIT_INSTRUMENT = { drums: "Pulsar", bass: "Undertow", keys: "Prism", lead: "Prism", pluck: "Driftwood", texture: "Tangle", pad: "Prism" };

/** [preset name, energy it suits]: a song picks one whose energy is within 0.3 of its own. */
export const KIT_SOUNDS = {
  drums: [["Classic Eight", 0.5], ["Tight Funk", 0.6], ["Boom Bap", 0.5], ["Deep House", 0.65], ["Trap Thunder", 0.8], ["Lo-Fi Dust", 0.3], ["Hand Toms", 0.35]],
  bass: [["Deep Current", 0.5], ["Riptide Pluck", 0.6], ["Sub Floor", 0.35], ["Acid Tide", 0.8], ["Hollow Reed", 0.4], ["Wobble Deep", 0.7]],
  keys: [["Prism Keys", 0.5], ["Glass EP", 0.4], ["Drawbar Drift", 0.7]],
  lead: [["Comet Tail", 0.6], ["Talking Lead", 0.5]],
  pluck: [["Nylon Pluck", 0.5], ["Steel Harp", 0.6], ["Muted Pluck", 0.55], ["Marimba", 0.45], ["Vibes", 0.35], ["Kalimba", 0.4], ["Temple Bell", 0.2], ["Glass Drops", 0.3]],
  texture: [["Drone Garden", 0.25], ["Basic Voice", 0.5], ["FM Bell", 0.4]],
  pad: [["Aurora Pad", 0.4], ["Glass Choir", 0.3], ["Dust Halo", 0.3]],
};
export const KIT_PARTS = Object.keys(KIT_SOUNDS);
export const TUNES = ["bright", "space", "grit", "width"];
/** How far a song's tune can go (-TUNE_MAX..TUNE_MAX); Remix can push it to -1..1. */
export const TUNE_MAX = 0.4;

/**
 * Level trims (dB) that put each preset at its part's base preset's loudness,
 * so a song's part levels (song.js MIX) hold whichever preset it plays.
 * Measured by web/tools/kit_levels.mjs on SynthKit's engine.
 */
export const KIT_TRIM = {
  "Tight Funk": 4.8,
  "Boom Bap": -4.3,
  "Deep House": -2.2,
  "Trap Thunder": -7.3,
  "Lo-Fi Dust": -2.7,
  "Hand Toms": 4,
  "Riptide Pluck": 8.5,
  "Sub Floor": 0.6,
  "Acid Tide": 4.3,
  "Hollow Reed": -2.4,
  "Wobble Deep": 1.9,
  "Glass EP": 1.5,
  "Drawbar Drift": 1.2,
  "Talking Lead": -3.1,
  "Steel Harp": -6.8,
  "Muted Pluck": 8.1,
  "Marimba": -17.9,
  "Vibes": -19.1,
  "Kalimba": -18.7,
  "Temple Bell": -21.2,
  "Glass Drops": -27.9,
  "Basic Voice": -3.6,
  "FM Bell": -5.2,
  "Glass Choir": -7.6,
  "Dust Halo": -6.7,
};

/** The trim for a part's preset (0 for unknown presets). */
export function kitTrim(preset) {
  return KIT_TRIM[preset] ?? 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r4 = (v) => Math.round(v * 10000) / 10000;
/** Octaves to move a cutoff: up to half an octave brighter, a whole octave darker. */
const oct = (t) => (t > 0 ? t * 0.5 : t);

/**
 * The SynthKit settings a tune puts on a preset: `base(id)` is the loaded
 * preset's value of a parameter (the synth's getParam after applyPreset).
 * `bright` multiplies the cutoffs too (a song section's brightness; 1 in the
 * app, which doesn't shape brightness by section). Returns {id: value}.
 */
export function kitParams(instrument, base, tune = {}, bright = 1) {
  const t = (k) => clamp(Number(tune[k]) || 0, -1, 1);
  const out = {};
  const add = (id, v, lo, hi) => { out[id] = r4(clamp(v, lo, hi)); };
  if (instrument === "Prism") {
    // Brighter stops at 3 kHz (or the preset's own cutoff, if that's higher): Prism's filter envelope opens it further.
    add("f1.cutoff", base("f1.cutoff") * Math.pow(2, oct(t("bright"))) * bright, 60, Math.max(3000, base("f1.cutoff")));
    add("f1.resonance", base("f1.resonance") + t("grit") * 1.5, 0, Math.max(3, base("f1.resonance")));
    add("send.space", base("send.space") + t("space") * 2, 0, 9);
    if (base("send.echo") > 0) add("send.echo", base("send.echo") + t("space") * 1.5, 0, 8);
    add("fx1.amount", base("fx1.amount") + t("width") * 2, 0, 10);
  } else if (instrument === "Undertow") {
    add("filter.cutoff", base("filter.cutoff") * Math.pow(2, oct(t("bright"))) * bright, 40, 6000);
    add("filter.emphasis", base("filter.emphasis") + t("grit") * 2, 0, Math.max(8, base("filter.emphasis")));
  } else if (instrument === "Pulsar") {
    add("chat.tone", base("chat.tone") + t("bright") * 1.5, 0, 9);
    add("ohat.tone", base("ohat.tone") + t("bright") * 1.5, 0, 9);
    add("master.drive", base("master.drive") + t("grit") * 2, 0, Math.max(6, base("master.drive")));
  } else if (instrument === "Driftwood") {
    add("model.brightness", (base("model.brightness") + t("bright") * 1.5) * Math.sqrt(bright), 0, 9);
    add("reverb.mix", base("reverb.mix") + t("space") * 2, 0, 9);
  }
  return out;
}

/** The parameters kitParams reads from the loaded preset, per instrument. */
export const KIT_READS = {
  Prism: ["f1.cutoff", "f1.resonance", "send.space", "send.echo", "fx1.amount"],
  Undertow: ["filter.cutoff", "filter.emphasis"],
  Pulsar: ["chat.tone", "ohat.tone", "master.drive"],
  Driftwood: ["model.brightness", "reverb.mix"],
  Tangle: [],
};

/**
 * Chooses a SynthKit sound for each part from the song's energy, with its own
 * random stream (`r`), so a song's notes are the same with or without kits.
 * Ambient songs keep their hats dark, as the generator always has.
 */
export function chooseKits(r, song, pick, range) {
  const e = Number(song.energy ?? 0.5);
  const tune = () => {
    const out = {};
    for (const k of TUNES) out[k] = Math.round(range(r, -TUNE_MAX, TUNE_MAX) * 100) / 100;
    return out;
  };
  for (const role of KIT_PARTS) {
    const fits = KIT_SOUNDS[role].filter(([, en]) => Math.abs(en - e) <= 0.3);
    const [preset] = pick(r, fits.length ? fits : KIT_SOUNDS[role]);
    const kit = { preset, tune: tune() };
    if (role === "drums" && song.family === "ambient") kit.tune.bright = Math.min(kit.tune.bright, -0.3);
    if (role === "pad") song.pad = { ...(song.pad || {}), kit };
    else if (song.tracks[role]) song.tracks[role].kit = kit;
  }
}

/** A kit is {preset: a name from KIT_SOUNDS[role], tune?: {bright, space, grit, width} in -1..1}. */
export function checkKit(role, kit) {
  if (!kit || typeof kit !== "object") return "kit must be an object";
  if (!KIT_SOUNDS[role]?.some(([n]) => n === kit.preset)) return `unknown ${role} kit preset ${kit.preset}`;
  for (const [k, v] of Object.entries(kit.tune || {})) {
    if (!TUNES.includes(k)) return `unknown kit tune ${k}`;
    if (typeof v !== "number" || v < -1 || v > 1) return `kit tune ${k} must be -1..1`;
  }
  return null;
}
