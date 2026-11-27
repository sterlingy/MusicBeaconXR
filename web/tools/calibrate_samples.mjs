// Matches each sample program's loudness to the synth it stands in for, so a
// part keeps its place in the mix whichever sound plays it. Renders the same
// phrase on SynthKit's Sampler and on the part's synth (its base preset, as
// kitplayer.js loads it), both through the WASM engine, and writes the ratio
// as `level` into every tier's program.json and index.json:
//   node web/tools/calibrate_samples.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const R = new URL("../../", import.meta.url);
const KIT = new URL("addons/synthkit/", R);
const { SynthKitCore } = await import(new URL("web/synthkit-worklet.js", KIT).href);
const { INSTRUMENT, BASE_PRESET } = await import(new URL("web/src/kit/kitplayer.js", R).href);
const module = await WebAssembly.compile(readFileSync(fileURLToPath(new URL("web/synthkit.wasm", KIT))));
const index = JSON.parse(readFileSync(fileURLToPath(new URL("presets/factory/index.json", KIT)), "utf-8"));
const SR = 48000;
const TIERS = [["web", "web/samples/web"], ["full", "samples/full"], ["phone", "samples/phone"]];

// A typical phrase per part: [start s, note, velocity, length s].
const PHRASE = {
  pad: [[0, 48, 0.7, 3.5], [0, 55, 0.7, 3.5], [0, 60, 0.7, 3.5], [0, 64, 0.7, 3.5]],
  keys: [0, 0.5, 1, 1.5, 2, 2.5].flatMap((t) => [48, 55, 60, 64].map((n) => [t, n, 0.75, 0.4])),
  lead: [60, 62, 64, 67, 69, 67, 64, 62].map((n, i) => [i * 0.4, n + 7, 0.8, 0.35]),
  pluck: [60, 64, 67, 72, 67, 64, 60, 67].map((n, i) => [i * 0.3, n, 0.8, 0.2]),
  bass: [36, 36, 43, 41, 36, 38, 43, 41].map((n, i) => [i * 0.4, n, 0.85, 0.3]),
  drums: [0, 0.5, 1, 1.5, 2, 2.5].flatMap((t, i) => [[t, 36, 0.9, 0.1], [t + 0.25, 42, 0.6, 0.05], ...(i % 2 ? [[t, 38, 0.85, 0.1]] : [])]),
};

function render(s, phrase, seconds = 4.5) {
  const total = Math.round(seconds * SR), out = new Float32Array(total);
  const evs = phrase.flatMap(([t, n, v, len]) => [[Math.round(t * SR), 1, n, v], [Math.round((t + len) * SR), 0, n, 0]]).sort((a, b) => a[0] - b[0]);
  let k = 0;
  for (let f = 0; f < total; f += 256) {
    const n = Math.min(256, total - f);
    while (k < evs.length && evs[k][0] < f + n) {
      const [at, on, note, v] = evs[k++];
      if (on) s.noteOn(note, v, at - f); else s.noteOff(note, at - f);
    }
    const [l, r] = s.render(n);
    for (let i = 0; i < n; i++) out[f + i] = 0.5 * (l[i] + r[i]);
  }
  let acc = 0;
  for (const v of out) acc += v * v;
  return Math.sqrt(acc / total);
}

function synthLevel(role) {
  const s = new SynthKitCore(module, SR, { log: () => {}, isolated: true });
  s.setInstrument(INSTRUMENT[role]);
  const e = index[INSTRUMENT[role]].find((p) => p.name === BASE_PRESET[role]);
  s.applyPreset(JSON.parse(readFileSync(fileURLToPath(new URL(`presets/factory/${e.file}`, KIT)), "utf-8")));
  if (INSTRUMENT[role] === "Prism") { s.setParam("voice.quality", 2); s.setParam("out.gain", 1); }
  const v = render(s, PHRASE[role]);
  s.destroy();
  return v;
}

function sampleLevel(dir, prog) {
  const s = new SynthKitCore(module, SR, { log: () => {}, isolated: true });
  s.setInstrument("Sampler");
  s.samplerBegin();
  for (const z of prog.zones) s.samplerAddOgg(readFileSync(`${dir}/${prog.id}/${z.file}`), { ...z, loopStart: z.loop_start, loopEnd: z.loop_end });
  s.samplerCommit();
  for (const [k, v] of Object.entries(prog.params || {})) s.setParam(k, v);
  const v = render(s, PHRASE[prog.role]);
  s.destroy();
  return v;
}

const synthCache = {};
const levels = {}; // id -> level, measured on the web tier (the reference) and reused
for (const [tier, rel] of TIERS) {
  const dir = fileURLToPath(new URL(rel, R));
  if (!existsSync(`${dir}/index.json`)) continue;
  const idx = JSON.parse(readFileSync(`${dir}/index.json`, "utf-8"));
  for (const entry of idx.programs) {
    const path = `${dir}/${entry.id}/program.json`;
    const prog = JSON.parse(readFileSync(path, "utf-8"));
    // The pad role plays the harmony; programs made for other roles that also serve as pads use the pad phrase.
    const role = PHRASE[prog.role] ? prog.role : "lead";
    synthCache[role] ??= synthLevel(role);
    const own = sampleLevel(dir, { ...prog, role });
    const level = Math.round(Math.min(4, Math.max(0.1, synthCache[role] / Math.max(own, 1e-6))) * 1000) / 1000;
    prog.level = entry.level = level;
    writeFileSync(path, JSON.stringify(prog, null, 1));
    console.log(`${tier}/${entry.id} (${role}): synth ${(20 * Math.log10(synthCache[role])).toFixed(1)} dB, sample ${(20 * Math.log10(own)).toFixed(1)} dB -> level ${level}`);
  }
  writeFileSync(`${dir}/index.json`, JSON.stringify(idx, null, 1));
}
