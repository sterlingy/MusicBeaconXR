// Measures the SynthKit presets the songs choose from (src/kitsounds.js) on
// SynthKit's own engine (the WebAssembly build the website plays) and writes
// their level trims into src/kitsounds.js KIT_TRIM: each preset is set to the
// loudness of its part's base preset (kitplayer.js BASE_PRESET), so a song's
// part levels hold whichever preset it plays. It also reports how much of
// each preset is above 2.5 kHz at the brightest tune a song can have (the
// "never shrill" measure of web/tests/kit.test.mjs).
//
//   node web/tools/kit_levels.mjs          # measure and write the trims (here and in scripts/beacon/kit_sounds.gd)
//   node web/tools/kit_levels.mjs --dry    # measure only

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KIT_SOUNDS, KIT_INSTRUMENT, KIT_READS, TUNE_MAX, kitParams } from "../src/kitsounds.js";
import { BASE_PRESET, DRUM_NOTE } from "../src/kit/kitplayer.js";

const root = new URL("../../", import.meta.url);
const KIT = new URL("addons/synthkit/", root);
const SR = 48000;
const { SynthKitCore } = await import(new URL("web/synthkit-worklet.js", KIT).href);
const module = await WebAssembly.compile(readFileSync(fileURLToPath(new URL("web/synthkit.wasm", KIT))));
const index = JSON.parse(readFileSync(fileURLToPath(new URL("presets/factory/index.json", KIT)), "utf-8"));
const presetJson = (instrument, name) => {
  const e = index[instrument].find((p) => p.name === name);
  if (!e) throw new Error(`no ${instrument} preset ${name}`);
  return JSON.parse(readFileSync(fileURLToPath(new URL(`presets/factory/${e.file}`, KIT)), "utf-8"));
};

/** A bar-long phrase per part, played twice: [frame, note, vel, offFrame]. */
function phrase(role) {
  const step = Math.round((SR * 60) / 110 / 4); // 16ths at 110 bpm
  const ons = [];
  for (let bar = 0; bar < 4; bar++) {
    const f0 = bar * 16 * step;
    if (role === "drums") {
      for (let s = 0; s < 16; s++) {
        const f = f0 + s * step;
        if (s % 4 === 0) ons.push([f, DRUM_NOTE.kick, 0.9, f + 4800]);
        if (s === 4 || s === 12) ons.push([f, DRUM_NOTE.snare, 0.8, f + 4800]);
        if (s % 2 === 0) ons.push([f, DRUM_NOTE.hat, 0.5, f + 4800]);
      }
    } else if (role === "pad" || role === "texture") {
      for (const n of [57, 60, 64]) ons.push([f0, n, 0.7, f0 + 16 * step - 1]);
    } else {
      const notes = role === "bass" ? [33, 33, 36, 38] : role === "keys" ? [57, 60, 64] : [69, 72, 76, 74];
      for (let s = 0; s < 16; s += role === "keys" ? 8 : 4) {
        const f = f0 + s * step;
        if (role === "keys") for (const n of notes) ons.push([f, n, 0.7, f + 7 * step]);
        else ons.push([f, notes[(s / 4) % notes.length], 0.8, f + 3 * step]);
      }
    }
  }
  return { ons, total: 64 * step };
}

/** Renders a preset (dry) with a tune; returns [rms dB, dB above 2.5 kHz]. */
function measure(role, name, tune) {
  const instrument = KIT_INSTRUMENT[role];
  const s = new SynthKitCore(module, SR, { log: () => {}, isolated: true });
  s.setInstrument(instrument);
  s.applyPreset(presetJson(instrument, name));
  if (instrument === "Prism") s.setParam("voice.quality", 0);
  if (tune) {
    const base = {};
    for (const id of KIT_READS[instrument]) base[id] = s.getParam(id);
    for (const [k, v] of Object.entries(kitParams(instrument, (id) => base[id] ?? 0, tune))) s.setParam(k, v);
  }
  for (const k of ["send.space", "send.echo", "reverb.mix"]) s.setParam(k, 0);
  const { ons, total } = phrase(role);
  const L = new Float32Array(total), R = new Float32Array(total);
  for (let f = 0; f < total; f += 512) {
    const n = Math.min(512, total - f);
    for (const [on, note, vel, off] of ons) {
      if (off >= f && off < f + n) s.noteOff(note, off - f);
      if (on >= f && on < f + n) s.noteOn(note, vel, on - f);
    }
    const [l, r] = s.render(n);
    L.set(l, f);
    R.set(r, f);
  }
  s.destroy();
  const a = Math.exp((-2 * Math.PI * 2500) / SR);
  const lp = [0, 0, 0, 0];
  let all = 0, hi = 0;
  for (let i = 0; i < total; i++) {
    let x = (L[i] + R[i]) * 0.5;
    all += x * x;
    for (let k = 0; k < 4; k++) { lp[k] = x + a * (lp[k] - x); x -= lp[k]; }
    hi += x * x;
  }
  return [10 * Math.log10(Math.max(all / total, 1e-15)), 10 * Math.log10(Math.max(hi, 1e-15) / Math.max(all, 1e-12))];
}

const trims = {};
const bright = { bright: TUNE_MAX, space: 0, grit: TUNE_MAX, width: TUNE_MAX };
for (const role of Object.keys(KIT_SOUNDS)) {
  const [ref] = measure(role, BASE_PRESET[role]);
  for (const [name] of KIT_SOUNDS[role]) {
    const [db] = measure(role, name);
    const [, hf] = measure(role, name, bright);
    const trim = Math.max(-30, Math.min(30, Math.round((ref - db) * 10) / 10));
    if (name !== BASE_PRESET[role] && Math.abs(trim) >= 0.5) trims[name] = trim;
    console.log(`${role.padEnd(8)} ${name.padEnd(16)} ${db.toFixed(1).padStart(6)} dB  trim ${trim.toFixed(1).padStart(5)}  above 2.5k (brightest) ${hf.toFixed(1)}`);
  }
}

if (!process.argv.includes("--dry")) {
  const file = fileURLToPath(new URL("web/src/kitsounds.js", root));
  const src = readFileSync(file, "utf-8");
  const body = Object.entries(trims).map(([n, v]) => `  ${JSON.stringify(n)}: ${v},`).join("\n");
  const out = src.replace(/export const KIT_TRIM = \{[^}]*\};/, `export const KIT_TRIM = {\n${body}\n};`);
  writeFileSync(file, out);
  // The app's copy (scripts/beacon/kit_sounds.gd).
  const gdFile = fileURLToPath(new URL("scripts/beacon/kit_sounds.gd", root));
  const gd = readFileSync(gdFile, "utf-8");
  const gdBody = Object.entries(trims).map(([n, v]) => `\t${JSON.stringify(n)}: ${Number.isInteger(v) ? v.toFixed(1) : v},`).join("\n");
  writeFileSync(gdFile, gd.replace(/const KIT_TRIM := \{[^}]*\}/, `const KIT_TRIM := {\n${gdBody}\n}`));
  console.log(`wrote ${Object.keys(trims).length} trims to web/src/kitsounds.js and scripts/beacon/kit_sounds.gd`);
}
