// Song form: sections (intro, verse, chorus, ...) laid out over time, and
// where a song is at any moment.
//
// Every beacon "broadcasts" its song on a shared clock: a song's position is
// worked out from the wall-clock time and the song itself, so two people at
// the same beacon hear the same section, and a song keeps going while nobody
// listens. A song without a form (version 1) is one loop, as before.
//
// Arranging ideas used here (standard practice in pop and electronic music):
// - Sections are 4, 8 or 16 bars; the chorus is the high point, the bridge
//   is the contrast (new chords, fewer layers), the outro winds down.
// - Energy has a blocky part that changes by section (which layers play,
//   how busy the drums are, how bright the filters are) and a smooth part,
//   tension, that rises through the bar or section before a lift.
// - Repetition with variation: each section (and each repeat of one) can
//   have its own lineup of instruments, parts can enter partway through a
//   section, the last chorus is the biggest, drum fills mark the way in.
//
// Which instruments play is not a fixed rule: every form entry may carry its
// own `layers` (0..1 per part) and `enter` (part -> fraction of the section
// after which it comes in). The defaults below only apply where a song says
// nothing, e.g. a hand-written song with just a list of sections.

import { hashString, ROLES } from "./song.js";

export const SECTION_TYPES = ["intro", "verse", "pre", "chorus", "bridge", "break", "outro"];
export const SECTION_LABEL = { intro: "Intro", verse: "Verse", pre: "Pre-chorus", chorus: "Chorus", bridge: "Bridge", break: "Breakdown", outro: "Outro", loop: "Loop" };
export const SECTION_COLOR = { intro: "#6f8fb3", verse: "#58a6a6", pre: "#b5a447", chorus: "#e0864a", bridge: "#a77bd0", break: "#7a8793", outro: "#5f7a99", loop: "#8d9aab" };

const ALL = Object.fromEntries(ROLES.map((r) => [r, 1]));
/** What each kind of section does when a song doesn't say: energy relative to the song's, layer levels, material and drum feel. */
export const SECTION_DEFAULTS = {
  intro: { energy: 0.45, layers: { drums: 0.5, bass: 0, keys: 1, lead: 0, pluck: 0.7, texture: 1 }, material: "A" },
  verse: { energy: 0.7, layers: { drums: 0.85, bass: 1, keys: 0.8, lead: 0, pluck: 1, texture: 0.6 }, material: "A" },
  pre: { energy: 0.85, layers: { drums: 0.85, bass: 1, keys: 1, lead: 0, pluck: 1, texture: 0.9 }, material: "A" },
  chorus: { energy: 1.15, layers: { ...ALL, texture: 0.7 }, material: "B" },
  bridge: { energy: 0.6, layers: { drums: 0.45, bass: 0.7, keys: 1, lead: 0.8, pluck: 0.5, texture: 1 }, material: "A", feel: "half" },
  break: { energy: 0.35, layers: { drums: 0, bass: 0.5, keys: 1, lead: 0, pluck: 0.8, texture: 1 }, material: "A" },
  outro: { energy: 0.5, layers: { drums: 0.6, bass: 0.6, keys: 1, lead: 0, pluck: 0.8, texture: 1 }, material: "B", fade: true },
};

/** The lineup for form entry `f`: its own layers over its section type's. */
export function entryLayers(song, f) {
  return { ...sectionSpec(song, f.section).layers, ...(f.layers || {}) };
}

export const hasForm = (song) => Array.isArray(song.form) && song.form.length > 0;

/** The section settings for `type`, with defaults filled in. */
export function sectionSpec(song, type) {
  const d = SECTION_DEFAULTS[type] || { energy: 1, layers: ALL, material: "A" };
  const s = song.sections?.[type] || {};
  return { ...d, ...s, layers: { ...d.layers, ...(s.layers || {}) } };
}

export function totalBars(song) {
  return hasForm(song) ? song.form.reduce((n, f) => n + f.bars, 0) : song.bars || 4;
}
export const secondsPerBar = (song) => 240 / song.bpm; // 4/4
export const lengthSeconds = (song) => totalBars(song) * secondsPerBar(song);

/** A fixed start point for each song, so beacons with the same tempo aren't in lockstep. */
function phase(song) {
  return hashString(`${song.title}|${song.bpm}|${totalBars(song)}`) / 4294967296;
}

/**
 * Where `song` is at wall-clock time `t` (seconds). Returns
 * {bar, length, seconds, totalSeconds, index, type, barInSection, bars, repeat, count, isLast, next, energy, layers, material, feel, progression}.
 */
export function songPosition(song, t) {
  const L = totalBars(song), spb = secondsPerBar(song);
  const exact = t / spb + phase(song) * L;
  const bar = ((Math.floor(exact) % L) + L) % L;
  const base = song.energy ?? 0.5;
  if (!hasForm(song)) {
    return {
      bar, length: L, seconds: bar * spb, totalSeconds: L * spb, index: 0, type: "loop", barInSection: bar, bars: L,
      repeat: 0, count: 1, isLast: true, next: "loop", energy: base, layers: ALL, material: "A", feel: null, fill: false, progression: song.progression, shaped: false,
    };
  }
  let start = 0, index = 0;
  while (index < song.form.length - 1 && bar >= start + song.form[index].bars) start += song.form[index++].bars;
  const f = song.form[index], type = f.section;
  const barInSection = bar - start;
  let repeat = 0, count = 0;
  song.form.forEach((g, i) => { if (g.section === type) { count++; if (i < index) repeat++; } });
  const nextF = song.form[(index + 1) % song.form.length];
  const spec = sectionSpec(song, type);
  const nextSpec = sectionSpec(song, nextF.section);
  const isLast = repeat === count - 1;

  // Energy: the section's level, plus tension.
  let e = spec.energy;
  const progress = (barInSection + 1) / f.bars;
  if (type === "pre") e += (nextSpec.energy - e) * progress; // builds all the way into the chorus
  else if (nextSpec.energy > e && barInSection === f.bars - 1) e += (nextSpec.energy - e) * 0.4; // a lift in the last bar
  if (type === "outro") e *= 1 - 0.6 * (barInSection / f.bars);
  if (type === "chorus" && isLast && count > 1) e += 0.1;
  if (type === "verse" && repeat > 0) e += 0.06;
  const energy = Math.max(0, Math.min(1, base * e));

  // Layers: this entry's lineup, parts that enter partway, and a fade if the section has one.
  const layers = entryLayers(song, f);
  for (const [r, at] of Object.entries(f.enter || {})) if (barInSection < Math.round(at * f.bars)) layers[r] = 0;
  if (spec.fade) for (const r of ROLES) layers[r] *= 1 - 0.75 * (barInSection / f.bars);

  return {
    bar, length: L, seconds: (exact % L + L) % L * spb, totalSeconds: L * spb, index, type, barInSection, bars: f.bars,
    repeat, count, isLast, next: nextF.section, energy, layers, material: spec.material, feel: spec.feel || null,
    fill: barInSection === f.bars - 1 && nextSpec.energy > spec.energy,
    progression: spec.progression || song.progression, shaped: true,
  };
}

/** "3:05" */
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Chorus 2" (number only when the section type repeats). */
export function sectionName(pos) {
  const label = SECTION_LABEL[pos.type] || pos.type;
  return pos.count > 1 ? `${label} ${pos.repeat + 1}` : label;
}

/** Form as text, e.g. "intro 8, verse 16, chorus 8", and back. */
export function formToText(form) { return (form || []).map((f) => `${f.section} ${f.bars}`).join(", "); }
export function parseForm(text) {
  const out = [];
  for (const part of String(text).split(/[,;\n]+/)) {
    const m = part.trim().toLowerCase().match(/^([a-z-]+)\s*(\d+)?$/);
    if (!m) { if (part.trim()) throw new Error(`can't read "${part.trim()}"`); continue; }
    const type = m[1] === "pre-chorus" || m[1] === "prechorus" ? "pre" : m[1] === "breakdown" ? "break" : m[1];
    if (!SECTION_TYPES.includes(type)) throw new Error(`unknown section "${m[1]}" (use ${SECTION_TYPES.join(", ")})`);
    const bars = m[2] ? +m[2] : 8;
    if (bars < 1 || bars > 64) throw new Error(`${type} needs 1 to 64 bars`);
    out.push({ section: type, bars });
  }
  if (!out.length) throw new Error("the form is empty");
  return out;
}
