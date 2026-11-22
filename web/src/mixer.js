// Song blending, with no audio: turns beacon weights and songs into the
// parameters and notes for one step. The audio engine plays what this
// returns, and the tests check it directly.

import { ROLES, degreeToMidi, chordNotes, chordName, romanName, keyName, hash01 } from "./song.js";

const LOG_PARAM = /cutoff|tone|tune|rate|amount/;
const ROLE_OCTAVE = { bass: 2, lead: 4, pluck: 4, texture: 3 };
const DRUM_VOICES = ["kick", "snare", "hat", "open", "clap"];

/**
 * Blends the active songs' tracks.
 * `active` is [{id, w, song}], weights summing to 1.
 * Returns {roles: {role: {gain, params, sources: [{id, share}]}}}.
 */
export function blend(active) {
  const roles = {};
  for (const role of ROLES) {
    let gain = 0;
    const sources = [];
    for (const a of active) {
      const t = a.song.tracks[role];
      const lvl = t ? t.level : 0;
      gain += a.w * lvl;
      sources.push({ id: a.id, share: a.w * lvl });
    }
    const total = sources.reduce((s, x) => s + x.share, 0);
    for (const s of sources) s.share = total > 0 ? s.share / total : 0;
    roles[role] = { gain, params: blendParams(active, role, sources), sources };
  }
  return { roles };
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
    const vals = active.map((a) => a.song.tracks[role]?.params?.[k]);
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

  _set(a, bar) { this.id = a.id; this.song = a.song; this.changedAtBar = bar; }

  chordDegree(bar) {
    const p = this.song.progression;
    return p[bar % p.length];
  }

  describe(bar) {
    const k = this.song.key, d = this.chordDegree(bar);
    return { key: keyName(k), chord: chordName(k, d), roman: romanName(k, d), id: this.id, title: this.song.title };
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
  const key = harmony.song.key;
  const chordDeg = harmony.chordDegree(bar);
  const events = [];
  ROLES.forEach((role, ri) => {
    const m = mix.roles[role];
    if (m.gain <= 0.001) return;
    if (role === "drums") {
      DRUM_VOICES.forEach((voice, vi) => {
        const id = pickSource(m.sources, bar, step, 100 + vi);
        const v = id && byId.get(id).tracks.drums?.pattern?.[voice]?.[step];
        if (v) events.push({ role, id, voice, notes: [], vel: v, gate: 1 });
      });
      return;
    }
    const id = pickSource(m.sources, bar, step, ri);
    if (!id) return;
    const song = byId.get(id);
    const t = song.tracks[role];
    const barPat = t.pattern[bar % t.pattern.length];
    const ev = barPat && barPat[step];
    if (!ev) return;
    if (role === "keys") {
      const oct = Math.round(m.params.octave ?? 4);
      events.push({ role, id, notes: chordNotes(key, chordDeg, oct, Math.round(m.params.voicing ?? 3)), vel: ev.v, gate: ev.g });
    } else {
      const midi = degreeToMidi(key, chordDeg + ev.d, ROLE_OCTAVE[role] + (ev.o || 0));
      events.push({ role, id, notes: [midi], vel: ev.v, gate: ev.g });
    }
  });
  return events;
}

/** Tempo the blend is heading for: the weighted average of the songs' tempos. */
export function targetTempo(active) {
  let s = 0, w = 0;
  for (const a of active) { s += a.w * a.song.bpm; w += a.w; }
  return w > 0 ? s / w : 110;
}
