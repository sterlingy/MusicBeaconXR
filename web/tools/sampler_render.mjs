// Renders notes on SynthKit's Sampler (the WASM engine) from a built sample
// program, to check pitch, loops and level offline:
//   node web/tools/sampler_render.mjs web/samples/web/piano out.wav 60,64,67 [seconds] [hold]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const KIT = new URL("../../addons/synthkit/", import.meta.url);
const { SynthKitCore } = await import(new URL("web/synthkit-worklet.js", KIT).href);
const module = await WebAssembly.compile(readFileSync(fileURLToPath(new URL("web/synthkit.wasm", KIT))));
const [dir, out, notesArg = "60", secArg = "4", holdArg = "2", velArg = "0.8"] = process.argv.slice(2);
const SR = 48000;
const prog = JSON.parse(readFileSync(`${dir}/program.json`, "utf-8"));
const s = new SynthKitCore(module, SR, { log: () => {}, isolated: true });
s.setInstrument("Sampler");
for (const [k, v] of Object.entries(prog.params || {})) s.setParam(k, v);
s.samplerBegin();
let bad = 0;
for (const z of prog.zones) {
  const ok = s.samplerAddOgg(readFileSync(`${dir}/${z.file}`), { ...z, loopStart: z.loop_start, loopEnd: z.loop_end });
  if (!ok) bad++;
}
if (!s.samplerCommit()) throw new Error("commit failed");
const notes = notesArg.split(",").map(Number);
const total = Math.round(Number(secArg) * SR), hold = Math.round(Number(holdArg) * SR);
const L = new Float32Array(total), R = new Float32Array(total);
for (const n of notes) s.noteOn(n, Number(velArg), 0);
for (const n of notes) s.noteOff(n, hold);
for (let f = 0; f < total; f += 512) {
  const n = Math.min(512, total - f);
  const [l, r] = s.render(n);
  L.set(l.subarray(0, n), f); R.set(r.subarray(0, n), f);
}
let peak = 0, nan = 0;
for (let i = 0; i < total; i++) { if (!Number.isFinite(L[i] + R[i])) nan++; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const buf = Buffer.alloc(44 + total * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + total * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(total * 4, 40);
for (let i = 0; i < total; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
writeFileSync(out, buf);
console.log(JSON.stringify({ program: prog.id, zones: prog.zones.length, failed: bad, memoryMB: +(s.samplerBytes() / 1e6).toFixed(1), peakDb: +(20 * Math.log10(peak + 1e-9)).toFixed(1), nan }));
s.destroy();
