// Song blending, with no audio: turns beacon weights and songs into the
// parameters and notes for one step. The audio engine plays what this
// returns, and the tests check it directly.

import { ROLES, degreeToMidi, chordNotes, chordName, romanName, keyName, hash01 } from "./song.js";
import { sectionName } from "./form.js";

const LOG_PARAM = /cutoff|tone|tune|rate|amount/;
// The songs' lead notes all carry +1 octave, so the lead starts at octave 3.
const ROLE_OCTAVE = { bass: 2, lead: 3, pluck: 4, texture: 3 };
// Lowest and highest MIDI note a part may play; notes outside fold in by
// octaves. A bass above G3 stops sounding like a bass, and a lead above G6
// turns piercing.
const ROLE_RANGE = { bass: [28, 55], lead: [52, 91] };
export function foldIntoRange(role, midi) {
  const r = ROLE_RANGE[role];
  if (!r) return midi;
  while (midi > r[1]) midi -= 12;
  while (midi < r[0]) midi += 12;
  return midi;
}
const DRUM_VOICES = ["kick", "snare", "hat", "open", "clap"];
/** Params that follow a section's energy: brighter in a chorus, darker in a breakdown. */
const BRIGHT = { bass: "filter.cutoff", keys: "filter.cutoff", lead: "filter.cutoff", texture: "filter.cutoff" };

/** How much this song plays `role` in its current section (1 without a form). */
const layer = (a, role) => a.pos?.shaped ? a.pos.layers[role] ?? 1 : 1;
/** Filter brightness for a song's current energy, relative to its own average. */
const brightness = (a) => a.pos?.shaped ? Math.pow(2, Math.max(-1.2, Math.min(0.6, (a.pos.energy - (a.song.energy ?? 0.5)) * 1.6))) : 1;

/**
 * Blends the active songs' tracks.
 * `active` is [{id, w, song, pos?}], weights summing to 1; `pos` (from
 * form.js songPosition) is where each song is, and its section decides how
 * much of each part plays and how bright it is.
 * Returns {roles: {role: {gain, params, sources: [{id, share}]}}}.
 */
export function blend(active) {
  const roles = {};
  for (const role of ROLES) {
    let gain = 0;
    const sources = [];
    for (const a of active) {
      const t = a.song.tracks[role];
      const lvl = t ? t.level * layer(a, role) : 0;
      gain += a.w * lvl;
      sources.push({ id: a.id, share: a.w * lvl });
    }
    const total = sources.reduce((s, x) => s + x.share, 0);
    for (const s of sources) s.share = total > 0 ? s.share / total : 0;
    roles[role] = { gain, params: blendParams(active, role, sources), automation: leadAutomation(active, role, sources), sources };
  }
  return { roles };
}

/** Automation comes whole from the song that's loudest in the role (shapes don't average well). */
function leadAutomation(active, role, sources) {
  let best = -1, out = null;
  sources.forEach((s, i) => { if (s.share > best) { best = s.share; out = active[i].song.tracks[role]?.automation || null; } });
  return out;
}

function blendParams(active, role, sources) {
  const out = {};
  // Text parameters (waveform, model) come from whichever song is loudest in this role.
  let lead = null, best = -1;
  sources.forEach((s, i) => { if (s.share > best) { best = s.share; lead = active[i]; } });
  if (lead && lead.song.tracks[role]) Object.assign(out, lead.song.tracks[role].params);
  // Numbers are averaged by each song's share of the role (by its weight if no song plays the role).
  const useShare = sources.some((s) => s.share > 0);
  const keys = new Set();
  for (const a of active) for (const [k, v] of Object.entries(a.song.tracks[role]?.params || {})) if (typeof v === "number") keys.add(k);
  for (const k of keys) {
    const vals = active.map((a) => {
      const v = a.song.tracks[role]?.params?.[k];
      if (typeof v !== "number") return v;
      if (BRIGHT[role] === k) return v * brightness(a);
      if (role === "pluck" && k === "brightness") return Math.min(1, v * Math.sqrt(brightness(a)));
      return v;
    });
    // Frequencies and rates blend on a log scale, so halfway between 200 Hz and 3200 Hz is 800 Hz.
    const log = LOG_PARAM.test(k) && vals.every((v) => typeof v !== "number" || v > 0);
    let acc = 0, wsum = 0;
    vals.forEach((v, i) => {
      if (typeof v !== "number") return;
      const w = useShare ? sources[i].share : active[i].w;
      if (w <= 0) return;
      acc += w * (log ? Math.log(v) : v);
      wsum += w;
    });
    if (wsum <= 0) continue;
    let v = acc / wsum;
    if (log) v = Math.exp(v);
    const range = lead?.song.morph?.[role]?.[k];
    if (range) v = Math.max(range[0], Math.min(range[1], v));
    out[k] = v;
  }
  return out;
}

/**
 * Harmony state: which song sets key, chords and phrase position.
 * Switches only on a bar line, and only when another song is clearly stronger
 * (hysteresis), so standing on a border doesn't flip the key back and forth.
 */
export class Harmony {
  constructor({ hysteresis = 0.08, phraseBars = 1 } = {}) {
    this.hysteresis = hysteresis;
    this.phraseBars = phraseBars;
    this.id = null;
    this.song = null;
    this.changedAtBar = -1;
  }

  update(active, bar) {
    if (!active.length) return false;
    const top = active.reduce((a, b) => (b.w > a.w ? b : a));
    const cur = active.find((a) => a.id === this.id);
    if (this.id === null) { this._set(top, bar); return true; }
    if (bar % this.phraseBars !== 0) return false;
    if (!cur || (top.id !== this.id && top.w > cur.w + this.hysteresis)) { this._set(top, bar); return true; }
    if (cur) this.song = cur.song; // a song may have been edited or replaced
    return false;
  }

  _set(a, bar) { this.id = a.id; this.song = a.song; this.pos = a.pos || null; this.changedAtBar = bar; }

  /** The chord for this bar: from the leading song's current section when it has a form. */
  chordDegree(bar) {
    const p = this.pos?.progression || this.song.progression;
    const i = this.pos ? this.pos.barInSection : bar;
    return p[i % p.length];
  }

  describe(bar) {
    const k = this.song.key, d = this.chordDegree(bar);
    return { key: keyName(k), chord: chordName(k, d), roman: romanName(k, d), id: this.id, title: this.song.title, section: this.pos ? sectionName(this.pos) : null };
  }
}

/** Picks the song that supplies role/voice at this step, weighted by share. Deterministic per bar-in-phrase and step. */
export function pickSource(sources, bar, step, salt) {
  const r = hash01(bar % 4, step, salt);
  let acc = 0;
  for (const s of sources) {
    acc += s.share;
    if (r < acc) return s.id;
  }
  return null;
}

/**
 * The notes for one 16th step.
 * Returns [{role, id, voice?, notes: [midi], vel, gate}] (gate in steps).
 */
export function stepEvents(active, mix, harmony, bar, step) {
  const byId = new Map(active.map((a) => [a.id, a.song]));
  const posOf = new Map(active.map((a) => [a.id, a.pos]));
  const key = harmony.song.key;
  const chordDeg = harmony.chordDegree(bar);
  const events = [];
  ROLES.forEach((role, ri) => {
    const m = mix.roles[role];
    if (m.gain <= 0.001) return;
    if (role === "drums") {
      DRUM_VOICES.forEach((voice, vi) => {
        const id = pickSource(m.sources, bar, step, 100 + vi);
        const v = id && drumHit(byId.get(id).tracks.drums, posOf.get(id), voice, step);
        if (v) events.push({ role, id, voice, notes: [], vel: v, gate: 1 });
      });
      return;
    }
    const id = pickSource(m.sources, bar, step, ri);
    if (!id) return;
    const song = byId.get(id), pos = posOf.get(id);
    const t = song.tracks[role];
    const pat = pos?.material === "B" && t.patternB ? t.patternB : t.pattern;
    const barPat = pat[(pos ? pos.barInSection : bar) % pat.length];
    const ev = barPat && barPat[step];
    if (!ev) return;
    const lift = role === "lead" && pos?.type === "chorus" && pos.isLast && pos.count > 1 ? 1 : 0; // last chorus: lead up an octave
    if (role === "keys") {
      const oct = Math.round(m.params.octave ?? 4);
      events.push({ role, id, notes: chordNotes(key, chordDeg, oct, Math.round(m.params.voicing ?? 3)), vel: ev.v, gate: ev.g });
    } else {
      const midi = foldIntoRange(role, degreeToMidi(key, chordDeg + ev.d, ROLE_OCTAVE[role] + (ev.o || 0) + lift));
      events.push({ role, id, notes: [midi], vel: ev.v, gate: ev.g });
    }
  });
  return events;
}

/**
 * One drum voice at one step, shaped by the song's section: fewer hats and no
 * kick when energy is low, a half-time feel in a bridge, a snare fill into a
 * bigger section, and a crash at the top of a chorus.
 */
export function drumHit(track, pos, voice, step) {
  if (!track) return 0;
  const pat = pos?.material === "B" && track.patternB ? track.patternB : track.pattern;
  let v = pat?.[voice]?.[step] || 0;
  if (!pos?.shaped) return v;
  const e = pos.energy;
  const lastBar = pos.barInSection === pos.bars - 1;
  if (pos.fill && lastBar && step >= 12) {
    // Fill: a rising snare run over the last beat, nothing else.
    return voice === "snare" ? 0.4 + 0.15 * (step - 12) : voice === "kick" && step === 12 ? 0.8 : 0;
  }
  if (pos.barInSection === 0 && step === 0 && pos.type === "chorus") {
    if (voice === "open") return 0.95; // crash
    if (voice === "kick") return 1;
  }
  if (pos.feel === "half") {
    if (voice === "kick") return step === 0 ? 0.9 : step === 10 && v ? 0.7 : 0;
    if (voice === "snare") return step === 8 ? 0.85 : 0;
    if (voice === "clap" || voice === "open") return 0;
  }
  if (voice === "kick" && e < 0.28) return 0;
  if (voice === "hat" && v && step % 4 !== 0 && hash01(step, pos.barInSection % 4, 11) > (e - 0.15) * 1.8) return 0;
  if (voice === "open" && e < 0.45) return 0;
  if (voice === "clap" && e < 0.55) return 0;
  if (voice === "snare" && v < 0.5 && e < 0.5) return 0; // ghost notes only when busy
  return v;
}

/** Tempo the blend is heading for: the weighted average of the songs' tempos. */
export function targetTempo(active) {
  let s = 0, w = 0;
  for (const a of active) { s += a.w * a.song.bpm; w += a.w; }
  return w > 0 ? s / w : 110;
}
