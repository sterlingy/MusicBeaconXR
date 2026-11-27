// Remix: a layer over whatever is playing, so a listener can make it their own.
// Off, nothing changes. On, every song you hear is transformed by your settings
// before the blend: key, tempo, mode, how busy the parts are, their sound
// (brightness, space, grit, width), each part's level and instrument. The
// result is still an ordinary song, so "Place my version" plants exactly what
// you hear as a normal beacon (baked in). The app has the same rules
// (scripts/beacon/remix.gd); tests/remix_check.gd checks them against this
// file's answers in tests/fixtures/remix.json (web/tools/export_remix.mjs).

import { hash01 } from "./song.js";

export const PARTS = ["drums", "bass", "keys", "lead", "pluck", "texture", "pad"];
/** The dials: [id, label, min, max, step]. All rest at 0 ("as written"). */
export const DIALS = [
  ["energy", "Energy", -1, 1, 0.05],
  ["brightness", "Brightness", -1, 1, 0.05],
  ["space", "Space", -1, 1, 0.05],
  ["mood", "Mood", -1, 1, 0.5],
  ["tempo", "Tempo", -1, 1, 0.05],
  ["key", "Key", -6, 6, 1],
  ["character", "Character", -1, 1, 0.05],
  ["width", "Width", -1, 1, 0.05],
];
/** Mood steps through modes from bright to dark, keeping the key's root. */
export const MOOD_LADDER = ["lydian", "major", "mixolydian", "dorian", "minor", "phrygian"];
/**
 * Swap sound: each part's other instruments, after its own (index 0).
 * "wave:x" a synth wave, "model:x" a pluck model, "sample:x" a sampled
 * instrument, "synth" the part's synth (no sample).
 */
export const SWAPS = {
  drums: ["own", "synth", "sample:orch_kit"],
  bass: ["own", "wave:sawtooth", "wave:square", "wave:triangle", "sample:contrabass_pizz", "sample:tuba", "sample:bassoon"],
  keys: ["own", "wave:sine", "wave:triangle", "wave:sawtooth", "sample:piano"],
  lead: ["own", "wave:sine", "wave:triangle", "wave:sawtooth", "wave:square", "sample:flute", "sample:horn", "sample:clarinet", "sample:trumpet", "sample:oboe"],
  pluck: ["own", "model:nylon", "model:marimba", "model:vibes", "model:kalimba", "model:bell", "model:glass", "sample:harp", "sample:strings_pizz", "sample:glock"],
  texture: ["own"],
  pad: ["own", "synth", "sample:strings", "sample:horn", "sample:trombone"],
};
/** Each part's level multiplier runs 0..1.5 (levels themselves stop at 1). */
export const LEVEL_MAX = 1.5;
/** Safe ranges for the sound settings the dials move, per part (as params.js allows). */
const RANGES = {
  drums: { "hat.tone": [3000, 14000], "master.drive": [0, 1], "reverb.send": [0, 0.3], "delay.send": [0, 0.3] },
  bass: { "filter.cutoff": [40, 8000], "filter.emphasis": [0, 12], drive: [0, 1], "osc.detune": [0, 30], "reverb.send": [0, 0.35], "delay.send": [0, 0.3] },
  keys: { "filter.cutoff": [80, 12000], "filter.resonance": [0, 10], "chorus.mix": [0, 1], "osc.detune": [0, 30], "reverb.send": [0, 0.7], "delay.send": [0, 0.5] },
  lead: { "filter.cutoff": [200, 12000], "filter.resonance": [0, 10], drive: [0, 1], "reverb.send": [0, 0.7], "delay.send": [0, 0.5] },
  pluck: { brightness: [0, 1], "reverb.send": [0, 0.7], "delay.send": [0, 0.5] },
  texture: { "filter.cutoff": [80, 12000], "filter.resonance": [0, 10], "reverb.send": [0, 0.8], "delay.send": [0, 0.5] },
};
const ROLE_SALT = { drums: 20, bass: 21, keys: 22, lead: 23, pluck: 24, texture: 25 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Fresh settings: off, every dial at rest, every part as written. */
export function defaults() {
  const parts = {};
  for (const p of PARTS) parts[p] = { level: 1, swap: 0 };
  return { on: false, energy: 0, brightness: 0, space: 0, mood: 0, tempo: 0, key: 0, character: 0, width: 0, hold: false, parts };
}

/** Settings read back from storage or a file, with anything missing or out of range made safe. */
export function normalize(s) {
  const d = defaults();
  if (!s || typeof s !== "object") return d;
  d.on = !!s.on;
  d.hold = !!s.hold;
  for (const [id, , lo, hi] of DIALS) d[id] = clamp(Number.isFinite(+s[id]) ? +s[id] : 0, lo, hi);
  d.key = Math.round(d.key);
  for (const p of PARTS) {
    const q = s.parts?.[p] || {};
    d.parts[p].level = clamp(Number.isFinite(+q.level) ? +q.level : 1, 0, LEVEL_MAX);
    d.parts[p].swap = clamp(Math.round(+q.swap || 0), 0, SWAPS[p].length - 1);
  }
  return d;
}

/** True when the settings would change anything at all. */
export function isNeutral(s) {
  for (const [id] of DIALS) if (Math.abs(s[id] || 0) > 1e-9) return false;
  for (const p of PARTS) if (Math.abs((s.parts?.[p]?.level ?? 1) - 1) > 1e-9 || (s.parts?.[p]?.swap || 0) !== 0) return false;
  return true;
}

/** A short key for caching transformed songs: same settings, same key. */
export function signature(s) {
  return JSON.stringify([DIALS.map(([id]) => s[id] || 0), PARTS.map((p) => [s.parts?.[p]?.level ?? 1, s.parts?.[p]?.swap || 0])]);
}

/** The mode `mood` steps from `mode`: brighter for mood > 0, darker for mood < 0 (whole steps of 0.5). */
export function moodMode(mode, mood) {
  const steps = Math.round(mood * 2);
  if (!steps) return mode;
  const i = MOOD_LADDER.indexOf(mode === "harmonicMinor" ? "minor" : mode);
  if (i < 0) return mode;
  return MOOD_LADDER[clamp(i - steps, 0, MOOD_LADDER.length - 1)];
}

/** One song with the settings applied (a new object; the original is untouched). */
export function remixSong(song, s) {
  const out = JSON.parse(JSON.stringify(song));
  if (!out || !out.tracks) return out;
  const e = s.energy || 0, b = s.brightness || 0, sp = s.space || 0, c = s.character || 0, wd = s.width || 0;
  if (s.tempo) out.bpm = clamp(Math.round(out.bpm * (1 + 0.15 * s.tempo) * 10) / 10, 40, 220);
  if (out.key) {
    if (s.key) out.key.root = (((out.key.root + Math.round(s.key)) % 12) + 12) % 12;
    if (s.mood) out.key.mode = moodMode(out.key.mode, s.mood);
  }
  for (const [role, t] of Object.entries(out.tracks)) {
    if (!t) continue;
    const p = (t.params = t.params || {});
    const R = RANGES[role] || {};
    const set = (k, v) => { const r = R[k]; p[k] = r3(r ? clamp(v, r[0], r[1]) : v); };
    // Level: the part's own multiplier, and a little more or less drums and pluck with energy.
    let lvl = (t.level ?? 0) * (s.parts?.[role]?.level ?? 1);
    if (role === "drums" || role === "pluck") lvl *= 1 + 0.25 * e;
    t.level = r3(clamp(lvl, 0, 1));
    // Energy: busier or sparser patterns.
    if (e) {
      if (role === "drums") t.pattern = drumEnergy(t.pattern, e);
      else {
        if (t.pattern) t.pattern = noteEnergy(t.pattern, e, role);
        if (t.patternB) t.patternB = noteEnergy(t.patternB, e, role);
      }
    }
    // Brightness: every filter together, the pluck's brightness, the hats' tone.
    if (b) {
      if (p["filter.cutoff"] != null) set("filter.cutoff", p["filter.cutoff"] * Math.pow(2, 1.2 * b));
      if (role === "pluck" && p.brightness != null) set("brightness", p.brightness + 0.3 * b);
      if (role === "drums" && p["hat.tone"] != null) set("hat.tone", p["hat.tone"] * Math.pow(2, 0.5 * b));
    }
    // Space: reverb and delay sends up toward a tasteful ceiling, or down toward dry.
    if (sp) {
      for (const k of ["reverb.send", "delay.send"]) {
        if (!R[k]) continue;
        const v = p[k] ?? 0, cap = R[k][1];
        set(k, sp >= 0 ? v + (cap - v) * sp * 0.8 : v * (1 + sp));
      }
    }
    // Character: smooth to gritty (drive, resonance, emphasis).
    if (c) {
      if (role === "drums") set("master.drive", (p["master.drive"] ?? 0) + 0.35 * c);
      if (role === "bass") { set("drive", (p.drive ?? 0) + 0.3 * c); if (p["filter.emphasis"] != null) set("filter.emphasis", p["filter.emphasis"] + 3 * c); }
      if (role === "lead") set("drive", (p.drive ?? 0) + 0.3 * c);
      if ((role === "keys" || role === "lead" || role === "texture") && p["filter.resonance"] != null) set("filter.resonance", p["filter.resonance"] + 2.5 * c);
    }
    // Width: chorus and detune.
    if (wd) {
      if (role === "keys") set("chorus.mix", (p["chorus.mix"] ?? 0) + 0.4 * wd);
      if ((role === "keys" || role === "bass") && p["osc.detune"] != null) set("osc.detune", p["osc.detune"] * (1 + 0.8 * wd));
    }
    // Swap sound.
    applySwap(t, p, SWAPS[role]?.[s.parts?.[role]?.swap || 0]);
  }
  // The pad: its level follows the song (energy, mood), so only its instrument swaps.
  const padSwap = SWAPS.pad[s.parts?.pad?.swap || 0];
  if (padSwap && padSwap !== "own") {
    if (padSwap === "synth") delete out.pad;
    else if (padSwap.startsWith("sample:")) out.pad = { ...(out.pad || {}), sample: padSwap.slice(7) };
  }
  if (s.parts?.pad && s.parts.pad.level !== 1) out.padLevel = r3(clamp(s.parts.pad.level, 0, LEVEL_MAX));
  return out;
}

function applySwap(t, p, sw) {
  if (!sw || sw === "own") return;
  if (sw === "synth") delete t.sample;
  else if (sw.startsWith("wave:")) { p["osc.wave"] = sw.slice(5); delete t.sample; }
  else if (sw.startsWith("model:")) { p.model = sw.slice(6); delete t.sample; }
  else if (sw.startsWith("sample:")) t.sample = sw.slice(7);
}

/** Drums: sparser keeps the main hits (kick on the beat, loud hits); busier adds quiet off-beat hats and lifts velocities. */
function drumEnergy(pat, e) {
  if (!pat) return pat;
  const out = {};
  for (const [voice, steps] of Object.entries(pat)) {
    out[voice] = steps.map((v, i) => {
      v = +v || 0;
      if (e < 0) {
        if (!v) return 0;
        const keep = (voice === "kick" && i % 4 === 0) || v >= 0.85 || hash01(i, voice.length, 31) >= -e * 0.7;
        return keep ? v : 0;
      }
      if (v) return r3(Math.min(1, v * (1 + 0.2 * e)));
      if (voice === "hat" && i % 2 === 1 && hash01(i, 7, 32) < e) return r3(0.18 + 0.12 * e);
      return 0;
    });
  }
  return out;
}

/** Melodic parts: sparser drops notes off the beat (the bass keeps its downbeats); busier plays them a little harder. */
function noteEnergy(bars, e, role) {
  return bars.map((bar, bi) => (bar || []).map((ev, i) => {
    if (!ev) return ev;
    if (e < 0) {
      const anchor = i % 4 === 0 && (role === "bass" || i === 0);
      return anchor || hash01(bi, i, ROLE_SALT[role] || 29) >= -e * 0.6 ? ev : null;
    }
    return { ...ev, v: r3(Math.min(1, (ev.v ?? 0.8) * (1 + 0.15 * e))) };
  }));
}

/** "Place my version": the song you hear most, remixed, named as a remix of the original. */
export function bake(song, s) {
  const out = remixSong(song, s);
  out.remixOf = song.title || "";
  out.title = `${(song.title || "Song").slice(0, 52)} (remix)`;
  return out;
}

/** Dice: random settings within tasteful ranges (parts' levels and sounds untouched). `rand` returns [0, 1). */
export function dice(s, rand = Math.random) {
  const n = normalize(s);
  const pick = (lo, hi, step) => Math.round((lo + (hi - lo) * rand()) / step) * step;
  n.energy = r3(pick(-0.6, 0.6, 0.05));
  n.brightness = r3(pick(-0.6, 0.6, 0.05));
  n.space = r3(pick(-0.5, 0.7, 0.05));
  n.mood = pick(-1, 1, 0.5);
  n.tempo = r3(pick(-0.4, 0.4, 0.05));
  n.key = pick(-3, 3, 1);
  n.character = r3(pick(-0.5, 0.5, 0.05));
  n.width = r3(pick(-0.5, 0.6, 0.05));
  return n;
}
