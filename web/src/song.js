// Beacon songs: the portable song format, music theory helpers and a seeded
// generator that gives every beacon its own song.
//
// Song format (version 2), JSON:
// {
//   format: "beacon-song", version: 2,
//   title, author,
//   key: { root: 0-11 (0 = C), mode: "major" | "minor" | "dorian" | ... },
//   bpm, bars: 4, steps: 16 (per bar),
//   progression: [chord per bar: a scale degree, 0-based, e.g. [0, 5, 3, 4],
//                 or a borrowed chord { d, m }: degree d of mode m on the same
//                 root, e.g. { d: 6, m: "mixolydian" } = bVII in a major key],
//   tracks: {
//     <role>: {
//       instrument: "Pulsar" | "Undertow" | "Comet" | "Lumen" | "Driftwood" | "Tangle",
//       level: 0..1 (0 = this song leaves the role out),
//       params: { <param id>: value },   // the instrument's sound (see params.js)
//       automation?: { <param id>: { shape, bars, depth, phase } },  // params that move over time
//       preset?: "name",                  // the factory preset the sound started from
//       sample?: "id",                    // a sampled instrument to play instead (SAMPLE_CHOICES)
//       pattern: [...]                    // see below
//     }
//   },
//   morph: { <role>: { <param id>: [min, max] } }  // how far blending may push each param
//   pad?: { sample: "id" },          // the harmony pad on a sampled instrument (strings, brass)
//   form: [{ section: "intro" | "verse" | "pre" | "chorus" | "bridge" | "break" | "outro", bars }],
//   sections: { <section>: { progression?, energy?, layers?: { <role>: 0..1 }, material?: "A" | "B", feel?: "half" } }
// }
//
// Version 2 adds `form`, `sections` and each track's optional `patternB`
// (the chorus material; `pattern` is the verse material). Without a form a
// song is one 4-bar loop (that's all a version 1 song is). See form.js for
// how sections shape the arrangement.
//
// Patterns are scale-relative so any song can play over any harmony:
//   drums:  { kick: [16 velocities], snare: [...], hat: [...], open: [...], clap: [...] }
//   others: one bar (16 steps) per entry; a step is null (rest) or
//           { d: scale degree above the chord root, o: octave offset, v: velocity, g: gate in steps }
//   keys:   steps are { v, g } (the whole chord plays)

export const SONG_SECTIONS = ["intro", "verse", "pre", "chorus", "bridge", "break", "outro"];

import { PRESETS, presetSound } from "./presets.js";
import { controls, isChoice, automatable, checkAutomation, SHAPES } from "./params.js";
import { chooseKits, checkKit } from "./kitsounds.js";

export const ROLES = ["drums", "bass", "keys", "lead", "pluck", "texture"];
export const ROLE_INSTRUMENT = {
  drums: "Pulsar", bass: "Undertow", keys: "Lumen", lead: "Comet", pluck: "Driftwood", texture: "Tangle",
};

export const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};
export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** MIDI note for `degree` steps up the scale from the tonic (any integer). */
export function degreeToMidi(key, degree, octave = 4) {
  const scale = MODES[key.mode] || MODES.major;
  const n = scale.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return 12 * (octave + 1 + oct) + key.root + scale[idx];
}

/**
 * A chord from a progression as {key, d}: a plain degree is in the song's own
 * key; a borrowed chord {d, m} is degree d of mode m on the same root (modal
 * mixture: bVII, bIII, iv, II...), and its notes and the melodies over it use
 * that mode's scale.
 */
export function chordRef(key, c) {
  if (c && typeof c === "object") return { key: { root: key.root, mode: MODES[c.m] ? c.m : key.mode }, d: c.d | 0 };
  return { key, d: c | 0 };
}
/** True for a borrowed chord ({d, m}). */
export const isBorrowed = (c) => !!c && typeof c === "object";
/** MIDI note `deg` scale steps above the chord's root (in the chord's own scale). */
export function chordTone(key, c, deg, octave = 4) {
  const r = chordRef(key, c);
  return degreeToMidi(r.key, r.d + deg, octave);
}

/** Triad (or 7th) on a chord (a degree or a borrowed chord), as MIDI notes. */
export function chordNotes(key, chord, octave = 4, size = 3) {
  const { key: k, d } = chordRef(key, chord);
  const out = [];
  for (let i = 0; i < size; i++) out.push(degreeToMidi(k, d + 2 * i, octave));
  return out;
}

export function chordName(key, degree) {
  const [a, b, c] = chordNotes(key, degree, 4, 3);
  const third = b - a, fifth = c - a;
  const root = NOTE_NAMES[a % 12];
  if (third === 3 && fifth === 6) return root + "dim";
  if (third === 3) return root + "m";
  if (fifth === 8) return root + "aug";
  return root;
}

const CHROMATIC_ROMAN = ["I", "bII", "II", "bIII", "III", "IV", "#IV", "V", "bVI", "VI", "bVII", "VII"];
export function romanName(key, degree) {
  const [a, b] = chordNotes(key, degree, 4, 3);
  // A borrowed chord is named by its distance from the tonic (bVII, bIII, iv...).
  const r = isBorrowed(degree) ? CHROMATIC_ROMAN[(((a - key.root) % 12) + 12) % 12] : ROMAN[(((degree | 0) % 7) + 7) % 7];
  return b - a === 3 ? r.toLowerCase() : r;
}

export function keyName(key) {
  return `${NOTE_NAMES[key.root]} ${key.mode.replace(/([A-Z])/g, " $1").toLowerCase()}`;
}

// ---------- seeded randomness

/** 32-bit string hash (FNV-1a). */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small fast PRNG (mulberry32); returns floats in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic number in [0, 1) for a tuple of integers (used for pattern mixing). */
export function hash01(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h ^= (p | 0) + 0x7f4a7c15 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const range = (r, lo, hi) => lo + (hi - lo) * r();
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ---------- generator

const PROGRESSIONS = {
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 3], [0, 3, 0, 4], [5, 3, 0, 4], [0, 1, 3, 4]],
  minor: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 3, 6, 2], [0, 5, 3, 4]],
  dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 1, 3, 0]],
  mixolydian: [[0, 6, 3, 0], [0, 3, 6, 3], [0, 4, 6, 3]],
  lydian: [[0, 1, 0, 1], [0, 1, 4, 0], [0, 6, 1, 0]],
  phrygian: [[0, 1, 0, 6], [0, 1, 2, 1]],
  harmonicMinor: [[0, 3, 4, 0], [0, 5, 4, 4], [0, 3, 5, 4]],
};

const PRE_PROGRESSIONS = [[3, 4, 3, 4], [1, 3, 4, 4], [5, 3, 4, 4], [3, 3, 4, 4]];
const BRIDGE_PROGRESSIONS = [[3, 4, 5, 4], [5, 3, 1, 4], [3, 0, 4, 4], [5, 4, 3, 4], [1, 5, 3, 4]];

// Generator v2 (shaped by six reference songs studied in analysis/: warm
// chord-rich songs, drone journeys, ambient pieces and downtempo grooves).
// Borrowed-chord progressions (modal mixture): {d, m} is degree d of mode m
// on the key's root, e.g. in C major {d: 6, m: "mixolydian"} = Bb (bVII).
const bc = (d, m) => ({ d, m });
const BORROWED = {
  major: [[0, bc(6, "mixolydian"), 3, 0], [0, bc(4, "mixolydian"), 3, bc(2, "minor")], [0, bc(2, "minor"), 3, 4], [0, 3, bc(3, "minor"), 0],
    [0, bc(5, "minor"), bc(6, "minor"), 0], [0, bc(1, "lydian"), 3, 0], [3, bc(6, "mixolydian"), 0, 0]],
  minor: [[0, 6, 3, 0], [0, bc(3, "dorian"), 0, 6], [0, 5, 6, bc(4, "harmonicMinor")], [0, 6, 2, bc(4, "harmonicMinor")], [0, bc(3, "dorian"), 6, 0]],
  dorian: [[0, bc(4, "harmonicMinor"), 3, 0]],
  mixolydian: [[0, bc(2, "minor"), 6, 0]],
};
// Drone journeys sit on one chord or sway slowly between two.
const SWAYS = [[0, 0, 0, 0], [0, 0, 6, 6], [0, 0, 5, 5], [0, 0, 3, 3], [0, 6, 0, 6], [0, 0, 1, 1]];

/**
 * Song families: what kind of song a beacon plays. "song" is a classic form;
 * "journey" is a drone that builds over minutes; "ambient" has long pads and
 * little or no beat or bass; "groove" is a steady downtempo loop.
 */
export const FAMILIES = ["song", "journey", "ambient", "groove"];
const FAMILY_BPM = { journey: [120, 132], ambient: [64, 92], groove: [104, 122] };
/** How likely a family takes a borrowed-chord progression when its mode has some. */
const BORROW_ODDS = { song: 0.5, journey: 0, ambient: 0.35, groove: 0.6 };

// Song forms. Lengths are fitted to a target duration of 2.5 to 4.5 minutes.
const FORMS = [
  ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"],
  ["intro", "verse", "pre", "chorus", "verse", "pre", "chorus", "bridge", "chorus", "chorus", "outro"],
  ["intro", "verse", "verse", "chorus", "verse", "chorus", "break", "chorus", "outro"],
  ["intro", "verse", "chorus", "verse", "chorus", "break", "bridge", "chorus", "chorus", "outro"],
];
const FAMILY_FORMS = {
  journey: [["intro", "verse", "pre", "chorus", "break", "pre", "chorus", "outro"], ["intro", "verse", "verse", "pre", "chorus", "break", "chorus", "outro"]],
  ambient: [["intro", "verse", "break", "verse", "outro"], ["intro", "verse", "bridge", "verse", "outro"]],
  groove: [["intro", "verse", "chorus", "verse", "chorus", "break", "chorus", "outro"], ["intro", "verse", "verse", "chorus", "verse", "chorus", "chorus", "outro"]],
};
/** Journeys build further than the default sections: quiet start, big peak, deep drop. */
const JOURNEY_ENERGY = { intro: 0.3, verse: 0.6, pre: 0.8, chorus: 1.25, break: 0.3, outro: 0.4 };
const AMBIENT_ENERGY = { intro: 0.35, verse: 0.55, break: 0.3, bridge: 0.5, outro: 0.3 };
const SECTION_SIZES = { intro: [4, 8], verse: [8, 16], pre: [4, 8], chorus: [8, 16], bridge: [8, 16], break: [4, 8], outro: [4, 8, 16] };
export const MIN_SONG_SECONDS = 120, MAX_SONG_SECONDS = 300;

/** A form for `bpm` close to `targetSec` long, always within 2 to 5 minutes. */
function fitForm(r, sections, bpm, targetSec) {
  const spb = 240 / bpm;
  const want = targetSec / spb;
  const form = sections.map((t) => ({ section: t, bars: t === "verse" ? 16 : SECTION_SIZES[t][0] }));
  const total = () => form.reduce((n, f) => n + f.bars, 0);
  const step = (dir) => {
    // Grow (or shrink) a random section that can still change, verses and choruses first.
    const order = form.map((f, i) => i).sort((a, b) => (["verse", "chorus"].includes(form[b].section) - ["verse", "chorus"].includes(form[a].section)) || r() - 0.5);
    for (const i of order) {
      const sizes = SECTION_SIZES[form[i].section], k = sizes.indexOf(form[i].bars);
      if (dir > 0 && k < sizes.length - 1) { form[i].bars = sizes[k + 1]; return true; }
      if (dir < 0 && k > 0) { form[i].bars = sizes[k - 1]; return true; }
    }
    return false;
  };
  for (let n = 0; n < 40 && total() < want - 4; n++) if (!step(1)) break;
  for (let n = 0; n < 40 && total() > want + 4; n++) if (!step(-1)) break;
  // Hard limits: add a chorus before the outro, or drop sections from the middle.
  const lastBeforeOutro = () => form.length - (form[form.length - 1].section === "outro" ? 1 : 0);
  while (total() * spb < MIN_SONG_SECONDS) form.splice(lastBeforeOutro(), 0, { section: "chorus", bars: 8 });
  while (total() * spb > MAX_SONG_SECONDS) {
    const i = form.findIndex((f, k) => k > 1 && k < form.length - 2 && f.section !== "chorus");
    if (i < 0) break;
    form.splice(i, 1);
  }
  while (total() * spb > MAX_SONG_SECONDS && step(-1));
  return form;
}

const MOODS = [
  { name: "Drift", energy: 0.25, bpm: [72, 90], modes: ["lydian", "major", "dorian"], families: ["ambient", "ambient", "song"] },
  { name: "Glow", energy: 0.4, bpm: [80, 100], modes: ["major", "mixolydian", "lydian"], families: ["song", "song", "ambient"] },
  { name: "Tide", energy: 0.55, bpm: [96, 112], modes: ["minor", "dorian"], families: ["song", "groove", "groove"] },
  { name: "Pulse", energy: 0.75, bpm: [110, 124], modes: ["minor", "phrygian", "harmonicMinor"], families: ["groove", "journey", "song"] },
  { name: "Rush", energy: 0.9, bpm: [120, 132], modes: ["mixolydian", "minor", "dorian"], families: ["journey", "journey", "groove"] },
];
const NAME_A = ["Amber", "Cobalt", "Salt", "Cedar", "Neon", "Paper", "Velvet", "Iron", "Moss", "Silver", "Ember", "Glass", "Coral", "Dusk", "Lunar", "Copper"];
const NAME_B = ["Harbor", "Orchard", "Signal", "Lantern", "Canyon", "Garden", "Circuit", "Meadow", "Station", "Shore", "Ridge", "Hollow", "Bloom", "Current", "Atlas", "Field"];

/**
 * A complete song for a beacon, the same every time for the same seed string.
 * `hint` can steer it: {mood: 0..4, root, mode}.
 */
/**
 * Each part's level scale for SynthKit (web: SynthKit mode; the Godot app),
 * so the parts keep the balance the generator's level ranges were tuned for
 * by ear. Measured: every part of 66 songs (grid and a globe sample) rendered
 * on SynthKit, its median loudness matched to the median of the original
 * browser synths; the loudest gap (pluck) is 1 and the others scale down.
 * kitplayer.js / beacon_player.gd KIT_GAIN_DB then sets the overall level. The pad's share is in kitplayer.js padLevel().
 */
export const MIX = { drums: 0.214, bass: 0.602, keys: 0.441, lead: 0.716, pluck: 1, texture: 0.216 };

export function generateSong(seedString, hint = {}) {
  const r = rng(hashString(seedString));
  const mood = MOODS[hint.mood ?? Math.floor(r() * MOODS.length)];
  const family = hint.family ?? pick(r, mood.families);
  const mode = hint.mode ?? pick(r, mood.modes);
  const key = { root: hint.root ?? Math.floor(r() * 12), mode };
  const e = Math.min(1, Math.max(0, mood.energy + range(r, -0.1, 0.1)));
  const bpm = FAMILY_BPM[family] || mood.bpm;
  const song = {
    format: "beacon-song",
    version: 2,
    title: `${pick(r, NAME_A)} ${pick(r, NAME_B)}`,
    author: "generator",
    mood: mood.name,
    family,
    energy: round(e),
    key,
    bpm: Math.round(range(r, bpm[0], bpm[1])),
    bars: 4,
    steps: 16,
    progression: pickProgression(r, family, mode).slice(),
    tracks: {},
    morph: {},
  };
  song.tracks.drums = genDrums(r, e, family);
  song.tracks.bass = genBass(r, e, family);
  song.tracks.keys = genKeys(r, e, family);
  song.tracks.lead = genLead(r, e, family);
  song.tracks.pluck = genPluck(r, e, family);
  song.tracks.texture = genTexture(r, e, family);
  for (const role of ROLES) dressTrack(r, song.tracks[role], role, e);
  if (family === "ambient") {
    // An ambient heartbeat's hats are as dark as Pulsar makes them (never shrill).
    const d = song.tracks.drums.params;
    d["hat.tone"] = Math.min(d["hat.tone"], 4500);
  }
  for (const role of ROLES) song.morph[role] = defaultMorph(role);
  addStructure(r, song, e);
  // Part levels are mixed for SynthKit, the instruments every platform plays.
  for (const role of ROLES) song.tracks[role].level = round(song.tracks[role].level * MIX[role], 3);
  assignSamples(song, seedString);
  // Each part's SynthKit sound (src/kitsounds.js), from the seed's own stream so the notes don't change.
  chooseKits(rng(hashString(`${seedString}|kit`)), song, pick, range);
  return song;
}

/**
 * Sampled instruments (SynthKit's Sampler, playing the sample packs built by
 * tools/build_samples.py): which recorded instrument a part may play instead
 * of its synth. Parts are listed in the order they're rolled.
 */
export const SAMPLE_CHOICES = {
  drums: ["orch_kit"],
  bass: ["contrabass_pizz", "contrabass", "tuba", "bassoon"],
  keys: ["piano"],
  lead: ["horn", "flute", "clarinet", "oboe", "trumpet"],
  pluck: ["harp", "strings_pizz", "marimba", "glock", "xylo"],
  pad: ["strings", "strings", "trombone", "horn"],
};
/** How often each family's parts go acoustic: ambient and journey songs lean orchestral, grooves stay electronic. */
export const SAMPLE_ODDS = {
  ambient: { drums: 0.1, bass: 0.3, keys: 0.5, lead: 0.45, pluck: 0.5, pad: 0.6 },
  journey: { drums: 0.25, bass: 0.35, keys: 0.45, lead: 0.55, pluck: 0.45, pad: 0.6 },
  song: { drums: 0.15, bass: 0.3, keys: 0.45, lead: 0.35, pluck: 0.35, pad: 0.4 },
  groove: { drums: 0.08, bass: 0.2, keys: 0.3, lead: 0.2, pluck: 0.3, pad: 0.25 },
};

/**
 * Picks the song's sampled parts from its own seed (seed + "|samples"), so the
 * notes and synth sounds are the same as without them. A player that doesn't
 * have a sample (still loading, or not in its pack) plays the part's synth.
 */
function assignSamples(song, seedString) {
  const r = rng(hashString(`${seedString}|samples`));
  const odds = SAMPLE_ODDS[song.family] || SAMPLE_ODDS.song;
  for (const role of Object.keys(SAMPLE_CHOICES)) {
    const roll = r();
    const id = pick(r, SAMPLE_CHOICES[role]);
    if (roll >= odds[role]) continue;
    if (role === "pad") song.pad = { sample: id };
    else if (song.tracks[role]) song.tracks[role].sample = id;
  }
}

/** Every sample id a song may ask for. */
export const SAMPLE_IDS = [...new Set(Object.values(SAMPLE_CHOICES).flat())];

/** A verse progression for the family: a drone sway, a borrowed-chord one, or a plain one in the mode. */
function pickProgression(r, family, mode) {
  if (family === "journey") return pick(r, SWAYS);
  if (BORROWED[mode] && r() < BORROW_ODDS[family]) return pick(r, BORROWED[mode]);
  return pick(r, PROGRESSIONS[mode] || PROGRESSIONS.major);
}

const sameChords = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Gives a track its sound: a factory preset that suits the song's energy,
 * nudged so no two beacons sound quite alike, plus the preset's automation and
 * sometimes one or two more animated params.
 */
function dressTrack(r, t, role, e) {
  const n = ROLE_INSTRUMENT[role];
  const fits = PRESETS[n].filter((p) => Math.abs(p.energy - e) <= 0.3);
  const preset = pick(r, fits.length ? fits : PRESETS[n]);
  const base = presetSound(n, preset);
  const params = {};
  for (const c of controls(n)) {
    const v = base.params[c[0]];
    if (isChoice(c)) params[c[0]] = r() < 0.12 ? pick(r, c[2]) : v;
    else if (c[6]?.auto === false) params[c[0]] = v; // ratios, semitones, glide: keep the preset's
    else {
      // Up to ±12% of the control's range (in octaves for log controls).
      const [lo, hi, stepv] = [c[2], c[3], c[4]];
      let x = c[6]?.log ? v * Math.pow(2, range(r, -0.12, 0.12) * Math.log2(hi / lo)) : v + range(r, -0.12, 0.12) * (hi - lo);
      x = Math.round(Math.max(lo, Math.min(hi, x)) / stepv) * stepv;
      params[c[0]] = +x.toFixed(4);
    }
  }
  const keep = role === "keys" ? { voicing: t.params.voicing, octave: t.params.octave } : {};
  t.params = { ...params, ...keep };
  t.preset = preset.name;
  const auto = base.automation;
  const free = automatable(n).filter((id) => !auto[id] && !/send|mix$/.test(id));
  let extra = r() < 0.3 + e * 0.4 ? (r() < 0.35 ? 2 : 1) : 0;
  while (extra-- > 0 && free.length) {
    const id = free.splice(Math.floor(r() * free.length), 1)[0];
    auto[id] = { shape: pick(r, SHAPES), bars: pick(r, [1, 2, 4, 8, 16]), depth: round(range(r, 0.1, 0.4)), phase: round(r()) };
  }
  if (Object.keys(auto).length) t.automation = auto;
}

/** How likely each part is to play in a kind of section (the generator's tendencies, not rules). */
const PLAY_ODDS = { verse: 0.7, pre: 0.8, chorus: 0.9, bridge: 0.55, break: 0.4 };

/**
 * Chooses which instruments play where. A song uses its own palette (2 to 6
 * of the parts; the rest stay silent all song), and every section, every
 * repeat included, gets its own lineup from that palette: an intro can open
 * with one instrument or all of them, a chorus can be stripped back, a
 * breakdown can be one part alone. Repeats usually echo the earlier section
 * with a change, and sometimes a part enters partway through a section.
 */
function arrange(r, song) {
  if (song.family === "journey") return arrangeJourney(r, song);
  if (song.family === "ambient") return arrangeAmbient(r, song);
  if (song.family === "groove") return arrangeGroove(r, song);
  const count = pick(r, [2, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]);
  const melodic = ["keys", "lead", "pluck", "texture"];
  const palette = [pick(r, melodic)]; // something to carry the harmony or tune
  for (const role of shuffle(r, ROLES.filter((x) => x !== palette[0]))) if (palette.length < count) palette.push(role);
  for (const role of ROLES) {
    if (!palette.includes(role)) song.tracks[role].level = 0;
    else if (song.tracks[role].level < 0.3) song.tracks[role].level = round(range(r, 0.35, 0.7));
  }
  const some = (k) => shuffle(r, palette.slice()).slice(0, k);
  const lineup = (on) => Object.fromEntries(ROLES.map((x) => [x, on.includes(x) ? round(range(r, 0.7, 1)) : 0]));
  const seen = {};
  song.form.forEach((f, i) => {
    let on;
    const before = seen[f.section];
    if (f.section === "intro" || f.section === "outro") on = some(1 + Math.floor(r() * palette.length)); // any number, any parts
    else if (before && r() < 0.6) {
      // Echo the earlier one, with one part swapped in or out.
      on = before.slice();
      const off = palette.filter((x) => !on.includes(x));
      if (off.length && (r() < 0.6 || on.length < 2)) on.push(pick(r, off));
      else if (on.length > 1) on.splice(Math.floor(r() * on.length), 1);
    } else {
      on = palette.filter(() => r() < PLAY_ODDS[f.section]);
      if (!on.length) on = some(1);
    }
    const last = song.form.findLastIndex((g) => g.section === "chorus");
    if (i === last && r() < 0.7) on = palette.slice(); // usually everything in the last chorus
    seen[f.section] = on;
    f.layers = lineup(on);
    // Sometimes a part comes in partway through (a build).
    if (on.length > 1 && f.bars >= 8 && r() < 0.35) f.enter = { [pick(r, on)]: pick(r, [0.25, 0.5, 0.75]) };
  });
}

const lineupOf = (r, on) => Object.fromEntries(ROLES.map((x) => [x, on.includes(x) ? round(range(r, 0.75, 1)) : 0]));
/** Silences the parts not in the palette and makes sure the ones in it are heard. */
function usePalette(r, song, palette) {
  for (const role of ROLES) {
    if (!palette.includes(role)) song.tracks[role].level = 0;
    else if (song.tracks[role].level < 0.3) song.tracks[role].level = round(range(r, 0.35, 0.7));
  }
}

/**
 * A drone journey builds: a pad or arpeggio alone, then the bass, then the
 * beat coming in partway through the build, everything at the peak, a deep
 * drop to the pads, and back.
 */
function arrangeJourney(r, song) {
  const palette = ["drums", "bass", "texture", pick(r, ["keys", "pluck"]), ...(r() < 0.6 ? ["lead"] : []), ...(r() < 0.4 ? ["keys"] : [])];
  const uniq = [...new Set(palette)];
  usePalette(r, song, uniq);
  const melodic = uniq.filter((x) => ["keys", "pluck", "texture"].includes(x));
  let peaks = 0;
  song.form.forEach((f) => {
    let on;
    if (f.section === "intro") on = melodic.slice(0, 1 + Math.floor(r() * melodic.length));
    else if (f.section === "verse") on = [...melodic, "bass"];
    else if (f.section === "pre") { on = [...melodic, "bass", "drums"]; f.enter = { drums: pick(r, [0.25, 0.5]) }; }
    else if (f.section === "chorus") { on = uniq.slice(); peaks++; }
    else if (f.section === "break") on = melodic.filter((x) => x !== "pluck" || r() < 0.5).concat(r() < 0.3 ? ["bass"] : []);
    else on = [pick(r, melodic), "drums"].concat(r() < 0.5 ? ["bass"] : []);
    if (!on.length) on = [pick(r, melodic)];
    f.layers = lineupOf(r, [...new Set(on)]);
  });
  song.sections = { ...song.sections };
  for (const [k, energy] of Object.entries(JOURNEY_ENERGY)) song.sections[k] = { ...(song.sections[k] || {}), energy };
}

/** Ambient: pads first; a beat (if any) is only a shimmer; bass is rare. */
function arrangeAmbient(r, song) {
  const palette = ["texture", "keys"];
  if (r() < 0.6) palette.push("pluck");
  if (r() < 0.45) palette.push("lead");
  if (r() < 0.3) palette.push("bass");
  if (song.tracks.drums.level > 0 && r() < 0.7) palette.push("drums");
  usePalette(r, song, palette);
  song.form.forEach((f) => {
    const on = palette.filter((x) => x === "texture" || x === "keys" ? r() < 0.9 : r() < (f.section === "break" ? 0.25 : 0.55));
    f.layers = lineupOf(r, on.length ? on : ["texture"]);
  });
  song.sections = { ...song.sections };
  for (const [k, energy] of Object.entries(AMBIENT_ENERGY)) song.sections[k] = { ...(song.sections[k] || {}), energy };
}

/** A downtempo groove keeps its beat, sub-bass and synth bed on almost all the way; tops come and go. */
function arrangeGroove(r, song) {
  const core = ["drums", "bass", pick(r, ["keys", "texture"])];
  const tops = shuffle(r, ["keys", "lead", "pluck", "texture"].filter((x) => !core.includes(x))).slice(0, 1 + Math.floor(r() * 2));
  const palette = [...core, ...tops];
  usePalette(r, song, palette);
  song.form.forEach((f) => {
    let on;
    if (f.section === "intro") on = core.filter((x) => x !== "bass" || r() < 0.5);
    else if (f.section === "break") on = [core[2], ...tops.filter(() => r() < 0.5)];
    else if (f.section === "outro") on = core.filter(() => r() < 0.8);
    else on = [...core, ...tops.filter(() => r() < (f.section === "chorus" ? 0.9 : 0.45))];
    f.layers = lineupOf(r, on.length ? on : core);
  });
}

/**
 * Gives a song its form: section order and lengths (2 to 5 minutes), chorus,
 * pre-chorus and bridge chords, chorus material (busier drums, a lead hook,
 * more rhythmic keys) and a few seeded arrangement choices.
 */
function addStructure(r, song, e) {
  const mode = song.key.mode;
  const fam = song.family;
  const pool = fam === "journey" ? SWAYS : [...(PROGRESSIONS[mode] || PROGRESSIONS.major), ...(fam !== "song" || r() < 0.5 ? BORROWED[mode] || [] : [])];
  const options = pool.filter((p) => !sameChords(p, song.progression));
  const chorus = options.length ? pick(r, options).slice() : [...song.progression.slice(2), ...song.progression.slice(0, 2)];
  song.form = fitForm(r, pick(r, FAMILY_FORMS[fam] || FORMS), song.bpm, fam === "journey" || fam === "ambient" ? range(r, 200, 290) : range(r, 150, 270));
  song.sections = {
    chorus: { progression: chorus },
    pre: { progression: pick(r, PRE_PROGRESSIONS).slice() },
    bridge: { progression: pick(r, BRIDGE_PROGRESSIONS).slice() },
  };
  arrange(r, song);
  if (r() < 0.3) song.sections.outro = { fade: false }; // some songs just stop at the end of the outro

  // Chorus material ("B"): the same instruments, busier and brighter.
  const up = (x) => Math.min(1, e + x);
  song.tracks.drums.patternB = genDrums(r, up(0.2), fam).pattern;
  song.tracks.bass.patternB = genBass(r, up(0.15), fam).pattern;
  song.tracks.keys.patternB = genKeys(r, up(0.3), fam).pattern;
  const hook = genLead(r, up(0.2), fam).pattern;
  const notes = hook.filter((b) => b.some(Boolean));
  song.tracks.lead.patternB = hook.map((b, i) => (b.some(Boolean) ? b : notes[i % notes.length] || b)); // the hook plays every bar
  song.tracks.pluck.patternB = genPluck(r, up(0.2), fam).pattern;
  const pad = Array(16).fill(null);
  pad[0] = { d: 0, o: 0, v: 0.6, g: 8 };
  pad[8] = { d: pick(r, [2, 4]), o: 0, v: 0.55, g: 8 };
  song.tracks.texture.patternB = [pad, pad, pad, pad];
  song.bars = 4;
}

function genDrums(r, e, fam = "song") {
  const kick = Array(16).fill(0), snare = Array(16).fill(0), hat = Array(16).fill(0), open = Array(16).fill(0), clap = Array(16).fill(0);
  if (fam === "journey" || fam === "groove" || fam === "ambient") return familyDrums(r, e, fam, { kick, snare, hat, open, clap });
  const style = e < 0.35 ? "sparse" : e < 0.6 ? (r() < 0.5 ? "halftime" : "backbeat") : r() < 0.5 ? "four" : "broken";
  for (let i = 0; i < 16; i++) {
    if (style === "four" && i % 4 === 0) kick[i] = 0.95;
    if (style === "backbeat" && (i === 0 || i === 8 || (i === 10 && r() < 0.6))) kick[i] = 0.9;
    if (style === "broken" && [0, 3, 6, 10, 11].includes(i) && r() < 0.85) kick[i] = 0.85 + 0.1 * r();
    if (style === "halftime" && (i === 0 || (i === 11 && r() < 0.5))) kick[i] = 0.9;
    if (style === "sparse" && i === 0) kick[i] = 0.7;
    if ((style === "four" || style === "backbeat" || style === "broken") && (i === 4 || i === 12)) snare[i] = 0.85;
    if (style === "halftime" && i === 8) snare[i] = 0.9;
    if (e > 0.5 && r() < 0.08 && !snare[i]) snare[i] = 0.35; // ghost notes
    const hatEvery = e > 0.7 ? 1 : e > 0.4 ? 2 : 4;
    if (i % hatEvery === 0) hat[i] = round(0.45 + 0.35 * (i % 4 === 0 ? 1 : r()) * (style === "sparse" ? 0.6 : 1));
    if (e > 0.6 && i % 4 === 2 && r() < 0.5) { open[i] = 0.6; hat[i] = 0; }
    if (style === "four" && (i === 4 || i === 12) && r() < 0.5) clap[i] = 0.7;
  }
  return {
    instrument: "Pulsar",
    level: round(e < 0.3 ? range(r, 0, 0.4) : range(r, 0.6, 0.9)),
    params: {
      "kick.tune": round(range(r, 42, 60)), "kick.decay": round(range(r, 0.25, 0.7)),
      "snare.tone": round(range(r, 160, 260)), "snare.decay": round(range(r, 0.1, 0.3)),
      "hat.decay": round(range(r, 0.03, 0.12), 3), "hat.tone": round(range(r, 6000, 11000), 0),
      "master.drive": round(range(r, 0, 0.6)),
    },
    pattern: { kick, snare, hat, open, clap },
  };
}

/**
 * Drums for the v2 families: a driving four-on-the-floor with off-beat open
 * hats and rolling 16ths (journey), a busy syncopated programmed kick with
 * ghosted snares (groove), or only a soft shimmer of hats, if anything (ambient).
 */
function familyDrums(r, e, fam, p) {
  const { kick, snare, hat, open, clap } = p;
  let level = round(range(r, 0.6, 0.9));
  if (fam === "journey") {
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) kick[i] = 0.95;
      if (i % 4 === 2) open[i] = round(0.45 + 0.2 * r());
      else hat[i] = round(0.22 + 0.2 * r());
      if ((i === 4 || i === 12) && r() < 0.6) clap[i] = 0.65;
    }
  } else if (fam === "groove") {
    for (let i = 0; i < 16; i++) {
      if (i === 0 || ([3, 6, 8, 10, 11, 14].includes(i) && r() < 0.6)) kick[i] = round(0.8 + 0.15 * r());
      if (i === 4 || i === 12) snare[i] = 0.85;
      else if (r() < 0.12) snare[i] = 0.3; // ghost notes
      if (i % 2 === 0) hat[i] = round(0.45 + 0.25 * r());
    }
  } else {
    // Ambient: most pieces have no beat at all; some get a soft heartbeat (a
    // gentle kick, a hat or two). Not a hat shimmer: hats alone are all treble.
    if (r() < 0.6) level = 0;
    else {
      level = round(range(r, 0.25, 0.45));
      kick[0] = 0.6;
      if (r() < 0.5) kick[8] = 0.45;
      hat[4] = round(0.12 + 0.08 * r());
      if (r() < 0.5) hat[12] = round(0.1 + 0.08 * r());
    }
  }
  return {
    instrument: "Pulsar",
    level,
    params: {
      "kick.tune": round(range(r, 42, 60)), "kick.decay": round(range(r, 0.25, 0.7)),
      "snare.tone": round(range(r, 160, 260)), "snare.decay": round(range(r, 0.1, 0.3)),
      "hat.decay": round(fam === "ambient" ? range(r, 0.15, 0.4) : range(r, 0.03, 0.12), 3), "hat.tone": round(range(r, 6000, 11000), 0),
      "master.drive": round(range(r, 0, fam === "ambient" ? 0.1 : 0.6)),
    },
    pattern: { kick, snare, hat, open, clap },
  };
}

function genBass(r, e, fam = "song") {
  if (fam === "journey" || fam === "groove" || fam === "ambient") return familyBass(r, e, fam);
  const bar = Array(16).fill(null);
  const density = 0.15 + e * 0.5;
  for (let i = 0; i < 16; i++) {
    const strong = i % 4 === 0;
    if (i === 0 || (strong && r() < 0.7) || r() < density * 0.5) {
      const d = i === 0 ? 0 : pick(r, [0, 0, 0, 4, 2, 7, 6, 3]);
      bar[i] = { d, o: d === 7 ? 0 : r() < 0.15 ? 1 : 0, v: round(strong ? 0.9 : 0.65 + 0.2 * r()), g: e < 0.4 ? pick(r, [3, 4, 6]) : pick(r, [1, 1, 2]) };
    }
  }
  return {
    instrument: "Undertow",
    level: round(range(r, 0.6, 0.9)),
    params: {
      "osc.wave": pick(r, ["sawtooth", "square", "sawtooth"]), "osc.detune": round(range(r, 2, 12)),
      "sub.level": round(range(r, 0.2, 0.7)),
      "filter.cutoff": round(range(r, 200, 900 + e * 1200), 0), "filter.emphasis": round(range(r, 1, 9)),
      "fenv.amount": round(range(r, 200, 2400), 0), "fenv.decay": round(range(r, 0.08, 0.5)),
      "aenv.release": round(range(r, 0.05, 0.3)), glide: round(r() < 0.4 ? range(r, 0.02, 0.1) : 0, 3),
    },
    pattern: [bar, bar, bar, bar],
  };
}

/**
 * Bass for the v2 families: a rolling 16th-note line on the root between the
 * kicks (journey), a held sub-bass on the root (groove), or rare long notes
 * (ambient). All deep, round and mono, as in the reference songs.
 */
function familyBass(r, e, fam) {
  const bar = Array(16).fill(null);
  if (fam === "journey") {
    for (let i = 0; i < 16; i++) if (i % 4 !== 0) bar[i] = { d: 0, o: 0, v: round(i % 4 === 1 ? 0.85 : 0.7), g: 1 };
    if (r() < 0.4) bar[15] = { d: pick(r, [4, 6]), o: 0, v: 0.75, g: 1 };
  } else if (fam === "groove") {
    bar[0] = { d: 0, o: 0, v: 0.9, g: pick(r, [6, 8]) };
    bar[8] = { d: pick(r, [0, 0, 4]), o: 0, v: 0.8, g: pick(r, [4, 6]) };
    if (r() < 0.4) bar[14] = { d: pick(r, [0, 6]), o: 0, v: 0.7, g: 2 };
  } else {
    bar[0] = { d: 0, o: 0, v: 0.7, g: 16 };
  }
  return {
    instrument: "Undertow",
    level: round(fam === "ambient" ? range(r, 0.3, 0.5) : range(r, 0.6, 0.9)),
    params: {
      "osc.wave": fam === "journey" ? pick(r, ["sawtooth", "square"]) : "square", "osc.detune": round(range(r, 1, 6)),
      "sub.level": round(range(r, 0.5, 0.9)),
      "filter.cutoff": round(fam === "journey" ? range(r, 300, 800) : range(r, 140, 380), 0), "filter.emphasis": round(range(r, 0.5, fam === "journey" ? 6 : 2)),
      "fenv.amount": round(fam === "journey" ? range(r, 300, 1600) : range(r, 0, 300), 0), "fenv.decay": round(range(r, 0.08, 0.3)),
      "aenv.release": round(fam === "journey" ? range(r, 0.04, 0.12) : range(r, 0.2, 0.6)), glide: 0,
    },
    pattern: [bar, bar, bar, bar],
  };
}

function genKeys(r, e, fam = "song") {
  const calm = e < 0.45 || fam === "ambient";
  const rhythm = pick(r, calm
    ? [[0], [0, 8]]
    : fam === "groove" ? [[2, 6, 10, 14], [0, 3, 8, 11], [3, 6, 11, 14]] : [[0, 6, 12], [2, 6, 10, 14], [0, 3, 8, 11], [4, 12]]);
  const gate = calm ? 16 / rhythm.length : pick(r, [1, 2, 3]);
  const bar = Array(16).fill(null);
  for (const s of rhythm) bar[s] = { v: round(0.55 + 0.25 * r()), g: gate };
  return {
    instrument: "Lumen",
    level: round(range(r, 0.4, 0.8)),
    params: {
      "osc.wave": pick(r, ["sawtooth", "triangle", "square"]), "osc.detune": round(range(r, 4, 18)),
      "filter.cutoff": round(range(r, 700, 4000), 0), "filter.resonance": round(range(r, 0.5, 4)),
      "aenv.attack": round(fam === "ambient" ? range(r, 0.8, 2) : calm ? range(r, 0.3, 1.2) : range(r, 0.005, 0.05), 3),
      "aenv.release": round(fam === "ambient" ? range(r, 2, 4) : range(r, 0.3, 2.5)),
      "chorus.mix": round(range(r, 0.1, 0.6)), "reverb.send": round(range(r, 0.2, 0.7)),
      voicing: pick(r, [3, 4]), octave: pick(r, [3, 4]),
    },
    pattern: [bar, bar, bar, bar],
  };
}

function genLead(r, e, fam = "song") {
  // A 2-bar motif with a call and a varied answer (ambient: a few long notes).
  const motif = Array(16).fill(null);
  let d = pick(r, [0, 2, 4, 7]);
  const notes = fam === "ambient" ? 2 + Math.floor(2 * r()) : 3 + Math.floor(e * 6 * r());
  const slots = shuffle(r, [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14]).slice(0, notes).sort((a, b) => a - b);
  for (const s of slots) {
    d += pick(r, [-2, -1, -1, 1, 1, 2, 3, -3, 0]);
    d = Math.max(-2, Math.min(9, d));
    motif[s] = { d, o: 1, v: round(0.6 + 0.3 * r()), g: fam === "ambient" ? pick(r, [4, 6, 8]) : pick(r, [1, 2, 2, 3]) };
  }
  const answer = motif.map((st, i) => (st && i < 12 ? { ...st, d: st.d + pick(r, [0, 0, 1, -1, 2]) } : null));
  const rest = Array(16).fill(null);
  return {
    instrument: "Comet",
    level: round(range(r, 0.35, 0.7)),
    params: {
      "osc.wave": pick(r, ["sawtooth", "square", "triangle"]), "osc2.semis": pick(r, [0, 7, 12, -12]),
      "filter.cutoff": round(range(r, 1200, 6000), 0), "filter.resonance": round(range(r, 0.5, 6)),
      "vibrato.depth": round(range(r, 0, 25)), "vibrato.rate": round(range(r, 4, 7)),
      portamento: round(range(r, 0, 0.08), 3), "delay.send": round(range(r, 0.1, 0.5)),
      "aenv.release": round(range(r, 0.08, 0.5)),
    },
    pattern: r() < 0.5 ? [motif, rest, answer, rest] : [rest, motif, rest, answer],
  };
}

function genPluck(r, e, fam = "song") {
  // Journeys arpeggiate in steady 16ths; ambient plucks are sparse.
  const shape = fam === "journey" ? pick(r, ["up", "updown"]) : pick(r, ["up", "down", "updown", "random"]);
  const every = fam === "journey" ? 1 : fam === "ambient" ? 4 : e > 0.6 ? 1 : 2;
  const bar = Array(16).fill(null);
  const tones = [0, 2, 4, 7];
  let k = 0;
  for (let i = 0; i < 16; i += every) {
    if (r() < (fam === "journey" ? 0.05 : 0.2)) continue;
    let d;
    if (shape === "up") d = tones[k % 4];
    else if (shape === "down") d = tones[3 - (k % 4)];
    else if (shape === "updown") d = tones[[0, 1, 2, 3, 2, 1][k % 6]];
    else d = pick(r, tones);
    bar[i] = { d, o: 1 + (r() < 0.15 ? 1 : 0), v: round(0.5 + 0.35 * r()), g: 1 };
    k++;
  }
  return {
    instrument: "Driftwood",
    level: round(r() < 0.3 ? 0 : range(r, 0.35, 0.7)),
    params: {
      model: pick(r, ["string", "string", "marimba", "kalimba"]),
      brightness: round(range(r, 0.3, 0.95)), decay: round(range(r, 0.3, 2.5)),
      "reverb.send": round(range(r, 0.1, 0.5)),
    },
    pattern: [bar, bar, bar, bar],
  };
}

function genTexture(r, e, fam = "song") {
  const bar = Array(16).fill(null);
  bar[0] = { d: pick(r, [0, 4, 7]), o: 0, v: 0.6, g: 16 };
  return {
    instrument: "Tangle",
    level: round(range(r, 0.15, 0.5) * (fam === "ambient" ? 1.6 : 1.1 - e * 0.6)),
    params: {
      ratio: pick(r, [0.5, 1, 1.5, 2, 3, 3.5]), "fm.index": round(range(r, 0.5, 6)),
      "lfo.rate": round(range(r, 0.05, 0.6)), "lfo.depth": round(range(r, 0.2, 0.9)),
      "filter.cutoff": round(range(r, 500, 3000), 0), "reverb.send": round(range(r, 0.4, 0.9)),
    },
    pattern: [bar, bar, bar, bar],
  };
}

function shuffle(r, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Parameters the engine blends between songs, with the allowed range (each control's whole range). */
export function defaultMorph(role) {
  const out = {};
  for (const c of controls(ROLE_INSTRUMENT[role])) if (!isChoice(c)) out[c[0]] = [c[2], c[3]];
  return out;
}

const okChord = (c) => Number.isInteger(c) || (isBorrowed(c) && Number.isInteger(c.d) && !!MODES[c.m]);

/** Checks a song (e.g. one a contributor uploads). Returns a list of problems, empty if OK. */
export function validateSong(s) {
  const errs = [];
  if (!s || typeof s !== "object") return ["not an object"];
  if (s.format !== "beacon-song") errs.push('format must be "beacon-song"');
  if (s.version !== 1 && s.version !== 2) errs.push("version must be 1 or 2");
  if (!s.key || !(s.key.root >= 0 && s.key.root <= 11) || !MODES[s.key.mode]) errs.push("key needs root 0-11 and a known mode");
  if (!(s.bpm >= 40 && s.bpm <= 220)) errs.push("bpm must be 40-220");
  if (!Array.isArray(s.progression) || s.progression.length < 1) errs.push("progression must be a non-empty array");
  else if (!s.progression.every(okChord)) errs.push("progression entries must be scale degrees or {d, m} borrowed chords");
  if (!s.tracks || typeof s.tracks !== "object") errs.push("tracks missing");
  else for (const [role, t] of Object.entries(s.tracks)) {
    if (!ROLES.includes(role)) errs.push(`unknown role ${role}`);
    else if (!(t.level >= 0 && t.level <= 1)) errs.push(`${role}.level must be 0-1`);
    else if (role === "drums" ? typeof t.pattern !== "object" : !Array.isArray(t.pattern)) errs.push(`${role}.pattern has the wrong shape`);
    else if (t.patternB != null && (role === "drums" ? typeof t.patternB !== "object" : !Array.isArray(t.patternB) || !t.patternB.length)) errs.push(`${role}.patternB has the wrong shape`);
    else if (t.sample != null && typeof t.sample !== "string") errs.push(`${role}.sample must be a sample id`);
    else if (t.kit != null && checkKit(role, t.kit)) errs.push(`${role}: ${checkKit(role, t.kit)}`);
    else for (const e of checkAutomation(ROLE_INSTRUMENT[role], t.automation)) errs.push(`${role}: ${e}`);
  }
  if (s.pad != null && (typeof s.pad !== "object" || (s.pad.sample != null && typeof s.pad.sample !== "string"))) errs.push("pad.sample must be a sample id");
  else if (s.pad?.kit != null && checkKit("pad", s.pad.kit)) errs.push(`pad: ${checkKit("pad", s.pad.kit)}`);
  if (s.form != null) {
    if (!Array.isArray(s.form) || !s.form.length) errs.push("form must be a non-empty array");
    else s.form.forEach((f, i) => {
      if (!f || !SONG_SECTIONS.includes(f.section)) errs.push(`form[${i}].section must be one of ${SONG_SECTIONS.join(", ")}`);
      if (!(Number.isInteger(f?.bars) && f.bars >= 1 && f.bars <= 64)) errs.push(`form[${i}].bars must be a whole number 1-64`);
      for (const [k, obj] of [["layers", f?.layers], ["enter", f?.enter]]) {
        if (obj == null) continue;
        if (typeof obj !== "object") errs.push(`form[${i}].${k} must be an object`);
        else for (const [role, v] of Object.entries(obj)) if (!ROLES.includes(role) || !(v >= 0 && v <= 1)) errs.push(`form[${i}].${k}.${role} must be a part with a value 0-1`);
      }
    });
  }
  if (s.sections != null) {
    if (typeof s.sections !== "object") errs.push("sections must be an object");
    else for (const [k, v] of Object.entries(s.sections)) {
      if (!SONG_SECTIONS.includes(k)) errs.push(`unknown section ${k}`);
      else if (v.progression != null && (!Array.isArray(v.progression) || !v.progression.length || !v.progression.every(okChord))) errs.push(`sections.${k}.progression must be a non-empty array of chords`);
    }
  }
  return errs;
}
