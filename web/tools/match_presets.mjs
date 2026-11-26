// Matches new factory presets to sounds measured in reference songs
// (tools/separate.py + tools/analyze.py): plays candidate settings through
// SynthKit's own engine (the WebAssembly build, exactly as the website and
// the app play songs: the part's base preset plus the mapped settings),
// measures them the way analyze.py measures a song's parts, and searches
// until they match. Every result must also pass the "never shrill" limit for
// its part (the same as web/tests/kit.test.mjs and tools/tone_check.gd).
//
//   node web/tools/match_presets.mjs            # all targets -> web/src/presets_matched.js
//   node web/tools/match_presets.mjs "Round Low"
//
// The targets below are the measurements from analysis/stems/*/report.json,
// kept here so the presets can be rebuilt without the songs.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toSynth } from "../src/kit/parammap.js";
import { INSTRUMENT, BASE_PRESET } from "../src/kit/kitplayer.js";
import { PRESETS, presetSound } from "../src/presets.js";
import { controls, isChoice } from "../src/params.js";

const root = new URL("../../", import.meta.url);
const KIT = new URL("addons/synthkit/", root);
const SR = 48000;
const LIMIT = { bass: -30, keys: -22, lead: -22, pluck: -15, texture: -22 };
const ROLE_INSTR = { bass: "Undertow", keys: "Lumen", lead: "Comet", pluck: "Driftwood", texture: "Tangle" };

/**
 * What to match: the part's role, MIDI notes to play (around the source's
 * median pitch), notes per second, and the measured targets: brightness
 * (spectral centroid, Hz), share of energy per band, attack and decay (ms).
 */
export const TARGETS = [
  { name: "Round Low", role: "bass", energy: 0.4, from: "Sowing the Seeds of Love, Woman in Chains: bass",
    notes: [36, 38, 41, 43], rate: 2.2, bright: 215, bands: { sub: 0.07, low: 0.9, lowmid: 0.02 }, attack: 80, decay: 545 },
  { name: "Sub Hold", role: "bass", energy: 0.6, from: "Stoned: bass",
    notes: [32, 32, 29, 34], rate: 1.5, bright: 153, bands: { sub: 0.57, low: 0.43, lowmid: 0.0 }, attack: 163, decay: 348 },
  { name: "Rolling Low", role: "bass", energy: 0.85, from: "Shpongle, The Aquatic Garden: bass",
    notes: [39, 39, 39, 42], rate: 3.6, bright: 150, bands: { sub: 0.03, low: 0.95, lowmid: 0.01 }, attack: 100, decay: 260 },
  { name: "Wide Warm Pad", role: "keys", energy: 0.3, from: "Sowing, Woman in Chains, Pier: pads ('other')",
    notes: [54, 57, 61, 59], rate: 0.6, bright: 1000, bands: { low: 0.35, lowmid: 0.47, mid: 0.13, presence: 0.05 }, attack: 116, decay: 1300 },
  { name: "Downtempo Bed", role: "keys", energy: 0.6, from: "Stoned: synth bed ('other')",
    notes: [57, 55, 60, 57], rate: 2.0, bright: 895, bands: { low: 0.27, lowmid: 0.55, mid: 0.15, presence: 0.01 }, attack: 116, decay: 870 },
  { name: "Choir Haze", role: "keys", energy: 0.25, from: "Pier: choir-like layer",
    notes: [67, 64, 62, 67], rate: 0.8, bright: 882, bands: { low: 0.08, lowmid: 0.78, mid: 0.14, presence: 0.0 }, attack: 116, decay: 1277 },
  { name: "Clean Strum", role: "pluck", energy: 0.5, from: "Sowing, Woman in Chains: guitar",
    notes: [46, 50, 53, 58], rate: 2.6, bright: 1690, bands: { low: 0.3, lowmid: 0.39, mid: 0.135, presence: 0.17 }, attack: 116, decay: 750 },
  { name: "Psy Arp", role: "lead", energy: 0.8, from: "Shpongle (Aquatic Garden, Brain in a Fish Tank): synth arps ('other')",
    notes: [57, 61, 64, 69], rate: 3.1, bright: 1020, bands: { low: 0.165, lowmid: 0.665, mid: 0.13, presence: 0.025 }, attack: 105, decay: 725 },
];

// ---------------------------------------------------------------- engine

const { SynthKitCore } = await import(new URL("web/synthkit-worklet.js", KIT).href);
const module = await WebAssembly.compile(readFileSync(fileURLToPath(new URL("web/synthkit.wasm", KIT))));
const index = JSON.parse(readFileSync(fileURLToPath(new URL("presets/factory/index.json", KIT)), "utf-8"));
const basePreset = {};
for (const role of Object.keys(ROLE_INSTR)) {
  const e = index[INSTRUMENT[role]].find((p) => p.name === BASE_PRESET[role]);
  basePreset[role] = JSON.parse(readFileSync(fileURLToPath(new URL(`presets/factory/${e.file}`, KIT)), "utf-8"));
}

/** Plays `params` (website param space) as role on SynthKit; returns mono audio. */
function render(role, params, notes, rate) {
  const s = new SynthKitCore(module, SR, { log: () => {}, isolated: true });
  s.setInstrument(INSTRUMENT[role]);
  s.applyPreset(basePreset[role]);
  if (INSTRUMENT[role] === "Prism") s.setParam("voice.quality", 0);
  for (const [k, v] of Object.entries(toSynth(role, params))) s.setParam(k, v);
  for (const k of ["send.space", "send.echo", "reverb.mix"]) s.setParam(k, 0); // dry, to measure the sound itself
  const step = Math.round(SR / rate), gate = Math.round(step * 0.85);
  const count = 8, total = step * count + SR; // eight notes, then a second of tail
  const ons = [];
  for (let i = 0; i < count; i++) ons.push([i * step, notes[i % notes.length], i * step + gate]);
  const out = new Float32Array(total);
  const BLOCK = 512;
  for (let f = 0; f < total; f += BLOCK) {
    const n = Math.min(BLOCK, total - f);
    for (const [on, note, off] of ons) {
      if (off >= f && off < f + n) s.noteOff(note, off - f);
      if (on >= f && on < f + n) s.noteOn(note, 0.8, on - f);
    }
    const [l, r] = s.render(n);
    for (let i = 0; i < n; i++) out[f + i] = (l[i] + r[i]) * 0.5;
  }
  s.destroy();
  return { audio: out, ons: ons.map((o) => o[0]) };
}

// ---------------------------------------------------------------- measuring (as tools/analyze.py)

const N = 2048, HOP = 512;
const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
function fftMag(frame) {
  // Radix-2 FFT, returns |X| for bins 0..N/2.
  const re = Float64Array.from(frame), im = new Float64Array(N);
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const mag = new Float64Array(N / 2 + 1);
  for (let k = 0; k <= N / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

const BANDS = { sub: [20, 60], low: [60, 250], lowmid: [250, 1000], mid: [1000, 2000], presence: [2000, 5000], air: [5000, 24000] };

export function measure({ audio, ons }) {
  const frames = Math.floor((audio.length - N) / HOP);
  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = 0; i < N; i++) s += audio[f * HOP + i] ** 2; rms[f] = Math.sqrt(s / N); }
  const peak = Math.max(...rms);
  if (peak < 1e-5) return null;
  const power = new Float64Array(N / 2 + 1);
  const cents = [];
  const hz = (k) => (k * SR) / N;
  for (let f = 0; f < frames; f++) {
    if (rms[f] < peak * 0.05) continue;
    const frame = new Float64Array(N);
    for (let i = 0; i < N; i++) frame[i] = audio[f * HOP + i] * win[i];
    const m = fftMag(frame);
    let num = 0, den = 0;
    for (let k = 1; k <= N / 2; k++) { const p = m[k] * m[k]; power[k] += p; num += hz(k) * m[k]; den += m[k]; }
    cents.push(num / (den || 1));
  }
  const tot = power.reduce((a, b) => a + b, 0) || 1;
  const bands = {};
  for (const [b, [lo, hi]] of Object.entries(BANDS)) { let s = 0; for (let k = 1; k <= N / 2; k++) if (hz(k) >= lo && hz(k) < hi) s += power[k]; bands[b] = s / tot; }
  cents.sort((a, b) => a - b);
  // Attack and decay around each note: time to the peak (within 250 ms), then to 10% of it (-20 dB).
  const att = [], dec = [];
  for (const on of ons) {
    const f0 = Math.floor(on / HOP);
    const seg = rms.slice(f0, f0 + Math.round((2 * SR) / HOP));
    if (seg.length < 4) continue;
    const look = Math.max(2, Math.round((0.25 * SR) / HOP));
    let pk = 0;
    for (let i = 1; i < Math.min(look, seg.length); i++) if (seg[i] > seg[pk]) pk = i;
    att.push((pk * HOP * 1000) / SR);
    for (let i = pk; i < seg.length; i++) if (seg[i] < seg[pk] * 0.1) { dec.push(((i - pk) * HOP * 1000) / SR); break; }
  }
  const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : null);
  return { bright: cents[cents.length >> 1] || 0, bands, attack: med(att), decay: med(dec) };
}

/** Energy above 2.5 kHz relative to all energy, in dB (as the shrillness checks). */
function hfDb(x) {
  const a = Math.exp((-2 * Math.PI * 2500) / SR);
  const lp = [0, 0, 0, 0];
  let all = 0, hi = 0;
  for (let i = 0; i < x.length; i++) {
    let v = x[i];
    all += v * v;
    for (let k = 0; k < 4; k++) { lp[k] = v + a * (lp[k] - v); v -= lp[k]; }
    hi += v * v;
  }
  return 10 * Math.log10(Math.max(hi, 1e-15) / Math.max(all, 1e-12));
}

/** How far a measured sound is from a target (0 = identical). Shrill sounds never qualify. */
// How much each measure counts, per part. Basses are judged mostly on where
// their energy sits (a dark filter, not a loud sub-oscillator); a plucked
// string can't copy a strum's slow onset, so plucks skip attack.
const WEIGHTS = { bass: { bright: 0.5, bands: 4, attack: 0.35 }, pluck: { bright: 1.2, bands: 2.5, attack: 0 }, default: { bright: 1.2, bands: 2.5, attack: 0.35 } };

function cost(t, m, hf, role) {
  if (!m) return Infinity;
  if (hf > LIMIT[role] - 2) return 1e6 + hf;
  const w = WEIGHTS[role] || WEIGHTS.default;
  const l2 = (a, b) => Math.abs(Math.log2(Math.max(a, 1) / Math.max(b, 1)));
  let c = l2(m.bright, t.bright) * w.bright;
  for (const [b, v] of Object.entries(t.bands)) c += Math.abs(m.bands[b] - v) * w.bands;
  if (t.attack && m.attack != null) c += l2(m.attack, t.attack) * w.attack;
  if (t.decay) c += m.decay == null ? 1.5 : l2(m.decay, t.decay) * 0.6;
  return c;
}

// ---------------------------------------------------------------- search

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function evaluate(t, params) {
  const out = render(t.role, params, t.notes, t.rate);
  const m = measure(out), hf = hfDb(out.audio);
  return { params, m, hf, cost: cost(t, m, hf, t.role) };
}

function search(t, iterations = t.role === "pluck" || t.role === "bass" ? 600 : 320) {
  const n = ROLE_INSTR[t.role];
  const ctrls = controls(n).filter((c) => !isChoice(c) && c[6]?.auto !== false && !/send|chorus|delay|reverb/.test(c[0]));
  const choices = controls(n).filter((c) => isChoice(c));
  const r = rngFrom(t.name.length * 7919 + 13);
  // Start from every existing preset, as it is.
  let pool = PRESETS[n].map((p) => evaluate(t, presetSound(n, p).params)).sort((a, b) => a.cost - b.cost).slice(0, 3);
  // Try each choice (waveforms, models) on the best one.
  for (const c of choices) for (const opt of c[2]) { const e = evaluate(t, { ...pool[0].params, [c[0]]: opt }); if (e.cost < pool[pool.length - 1].cost) pool = [...pool, e].sort((a, b) => a.cost - b.cost).slice(0, 3); }
  // Then small random steps from the best few (hill climbing), narrowing as it goes.
  for (let it = 0; it < iterations; it++) {
    const base = pool[Math.floor(r() * pool.length)];
    const p = { ...base.params };
    const k = 1 + Math.floor(r() * 3), scale = 0.35 * (1 - it / iterations) + 0.04;
    for (let j = 0; j < k; j++) {
      const c = ctrls[Math.floor(r() * ctrls.length)];
      const [id, , lo, hi, stepv] = c;
      let v = p[id] ?? c[5];
      const g = (r() + r() + r() - 1.5) * 2 * scale;
      v = c[6]?.log ? v * Math.pow(hi / lo, g * 0.5) : v + g * (hi - lo);
      p[id] = +(Math.round(Math.max(lo, Math.min(hi, v)) / stepv) * stepv).toFixed(4);
    }
    const e = evaluate(t, p);
    if (e.cost < pool[pool.length - 1].cost) pool = [...pool, e].sort((a, b) => a.cost - b.cost).slice(0, 3);
  }
  return pool[0];
}

const fmt = (m) => m ? `${Math.round(m.bright)} Hz, sub ${((m.bands.sub || 0) * 100).toFixed(0)}% low ${(m.bands.low * 100).toFixed(0)}% lowmid ${(m.bands.lowmid * 100).toFixed(0)}% mid ${(m.bands.mid * 100).toFixed(0)}% presence ${(m.bands.presence * 100).toFixed(0)}%, attack ${Math.round(m.attack)} ms, decay ${m.decay == null ? "long" : Math.round(m.decay) + " ms"}` : "silent";

const only = process.argv[2];
const results = [];
for (const t of TARGETS.filter((x) => !only || x.name === only)) {
  const t0 = Date.now();
  const best = search(t);
  console.log(`${t.name} (${t.role}, ${t.from})\n  target  ${fmt({ bright: t.bright, bands: { sub: 0, low: 0, lowmid: 0, mid: 0, presence: 0, ...t.bands }, attack: t.attack, decay: t.decay })}\n  matched ${fmt(best.m)} · above 2.5 kHz ${best.hf.toFixed(1)} dB (limit ${LIMIT[t.role]}) · cost ${best.cost.toFixed(2)} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  // Keep only what differs from the instrument's defaults, rounded.
  const n = ROLE_INSTR[t.role];
  const defs = presetSound(n, { params: {} }).params;
  const params = {};
  for (const [k, v] of Object.entries(best.params)) if (defs[k] !== v) params[k] = typeof v === "number" ? +v.toFixed(4) : v;
  results.push({ instrument: n, name: t.name, energy: t.energy, from: t.from, params, measured: { bright: Math.round(best.m.bright), attack: Math.round(best.m.attack), decay: best.m.decay == null ? null : Math.round(best.m.decay), hf: +best.hf.toFixed(1) } });
}

if (!only) {
  const byInstr = {};
  for (const x of results) (byInstr[x.instrument] ||= []).push({ name: x.name, energy: x.energy, params: x.params });
  const body = `// Presets matched to sounds in reference songs by web/tools/match_presets.mjs
// (rebuild with: node web/tools/match_presets.mjs). Each entry notes the
// song part it was matched to and what it measured on SynthKit.
// Generated file: edit the targets in the tool, not this file.

export const MATCHED = ${JSON.stringify(byInstr, null, 1)};

export const MATCHED_FROM = ${JSON.stringify(Object.fromEntries(results.map((x) => [x.name, { from: x.from, measured: x.measured }])), null, 1)};
`;
  writeFileSync(fileURLToPath(new URL("web/src/presets_matched.js", root)), body);
  console.log("wrote web/src/presets_matched.js");
}
