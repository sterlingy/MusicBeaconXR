// Tests for the browser MusicInputKit (web/src/play/kit.js): scale lock, patch
// bay, hub, objects under simulated hands, and both drivers. No audio, no DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ScaleLock, PatchBay, MusicInput, Hand, ChimeBars, LightStrings, ThereminOrb, PitchRibbon, DrumPads,
  ChordBlocks, MusicBoxWheel, TwistDial, SlideFader, XYPad, Flywheel, TiltCube, ScaleSwitch,
  PointerDriver, XRHandsDriver, makeTable,
} from "../src/play/kit.js";

function rig() {
  const kit = new MusicInput();
  const timers = [];
  kit.later = (fn, s) => timers.push(fn);
  const log = { on: [], off: [], bend: [], knob: [] };
  kit.on("noteOn", (p, v, n, vel) => log.on.push([p, n, vel]));
  kit.on("noteOff", (p, v, n) => log.off.push([p, n]));
  kit.on("bend", (p, v, s) => log.bend.push([p, s]));
  kit.on("control", (p, param, v) => log.knob.push([p, param, v]));
  log.clear = () => { for (const k of ["on", "off", "bend", "knob"]) log[k].length = 0; };
  return { kit, log, timers };
}
const handAt = (obj, local, kind = "mouse", id = 0) => { const h = new Hand(kind, id); h.position = obj.world(local); h.pressed = true; return h; };

test("scale lock: snapping, steps, chords, and off", () => {
  const s = new ScaleLock();
  assert.equal(s.quantize(61.4), 62);
  assert.equal(s.quantize(61), 60);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => s.step(60, i)), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.equal(s.step(60, -1), 59);
  assert.deepEqual(s.chord(48, 1), [50, 53, 57]);
  assert.equal(s.chordName(48, 6), "Bdim");
  s.enabled = false;
  assert.equal(s.quantize(61.37), 61.37);
  assert.equal(s.step(60, 3), 63);
  assert.deepEqual(s.chord(48, 1), [49, 53, 56]);
});

test("patch bay: lo..hi, fan-out, cycle, save", () => {
  const pb = new PatchBay();
  pb.setPatch("Dial.turn", "keys", "filter.cutoff", 0.2, 0.6);
  assert.ok(Math.abs(pb.route("Dial.turn", 0.5)[0].value - 0.4) < 1e-9);
  pb.addPatch("Dial.turn", "lead", "delay.mix");
  assert.equal(pb.route("Dial.turn", 1).length, 2);
  const opts = [["keys", "a"], ["keys", "b"]];
  pb.setPatch("X.x", "keys", "a");
  assert.equal(pb.cycle("X.x", opts).param, "b");
  assert.equal(pb.cycle("X.x", opts), null);
  const pb2 = new PatchBay();
  pb2.load(JSON.parse(JSON.stringify(pb)));
  assert.equal(pb2.patches.length, pb.patches.length);
});

test("hub: bends, restarts past an octave, lock on snaps", () => {
  const { kit, log } = rig();
  kit.scale.enabled = false;
  const v = kit.startNote("lead", 60.5, 0.8);
  assert.equal(log.bend.length, 1);
  kit.moveNote(v, 80);
  assert.equal(log.on.length, 2);
  assert.equal(log.on[1][1], 80);
  kit.endNote(v);
  assert.equal(log.off.length, 2);
  kit.scale.enabled = true;
  log.clear();
  kit.startNote("lead", 60.8, 0.8);
  assert.equal(log.on[0][1], 60);
  assert.equal(log.bend.length, 0);
});

test("bars, pads, strings, orb, ribbon, blocks play the right notes", () => {
  const { kit, log } = rig();
  const bars = new ChimeBars("Bars").attach(kit);
  const w = bars.width / bars.count;
  const h = handAt(bars, [bars.box.min[0] + w * 2.5, 0.05, 0]);
  bars.handDown(h);
  assert.deepEqual(log.on[0].slice(0, 2), ["mallet", 64]);
  h.position = bars.world([bars.box.min[0] + w * 4.5, 0.05, 0]);
  bars.handMove(h);
  assert.equal(log.on[1][1], 67, "glissando to G");

  log.clear();
  const pads = new DrumPads("Pads").attach(kit);
  pads.handDown(handAt(pads, [...pads.center(3)].map((v, i) => i === 1 ? 0.04 : v)));
  assert.equal(log.on[0][1], 42, "hat pad is 42, not snapped");
  assert.equal(log.knob[0][1], "chat.tone");

  log.clear();
  const s = new LightStrings("Strings").attach(kit);
  const x = s.stringX(0);
  const sh = handAt(s, [x, 0.2, 0], "xr", 7);
  s.handDown(sh);
  sh.position = s.world([x, 0.2, 0.04]);
  s.handMove(sh);
  assert.ok(log.bend.at(-1)[1] > 1, "pulling bends up");

  log.clear();
  const orb = new ThereminOrb("Orb").attach(kit);
  const oh = handAt(orb, [orb.box.min[0] + 0.001, 0.2, 0]);
  orb.handDown(oh);
  assert.equal(log.on[0][1], 48);
  assert.ok(log.knob.some((k) => k[1] === "filter.cutoff"));
  orb.handUp(oh);

  log.clear();
  const r = new PitchRibbon("Ribbon").attach(kit);
  const rh = handAt(r, [r.box.min[0] + 0.001, 0.01, 0]);
  r.handDown(rh);
  assert.equal(log.on[0][1], 36);

  log.clear();
  const bl = new ChordBlocks("Blocks", { layerPart: "" }).attach(kit);
  const bh = handAt(bl, [bl.blockX(4), bl.block / 2, 0]);
  bl.handDown(bh);
  assert.deepEqual(log.on.map((o) => o[1]), [55, 59, 62], "V is G major");
  bl.handUp(bh);
  assert.equal(log.off.length, 3);

  log.clear();
  const layered = new ChordBlocks("Layered").attach(kit);
  const lh = handAt(layered, [layered.blockX(0), layered.block / 2, 0]);
  layered.handDown(lh);
  assert.deepEqual(log.on.filter((o) => o[0] === "pad").map((o) => o[1]), [36, 40, 43], "pad doubles the chord an octave down");
  layered.handUp(lh);
  assert.equal(log.off.length, 6);
});

test("shaping objects: dial, spring lever, XY, flywheel, tilt, scale switch", () => {
  const { kit, log } = rig();
  const d = new TwistDial("Dial").attach(kit);
  assert.equal(log.knob[0][1], "filter.cutoff");
  const h = handAt(d, [0, 0.05, -d.radius]);
  d.handDown(h);
  for (let i = 1; i < 10; i++) {
    const a = (-i * Math.PI) / 18;
    h.position = d.world([-Math.sin(a) * d.radius, 0.05, -Math.cos(a) * d.radius]);
    d.handMove(h);
  }
  assert.ok(Math.abs(d.value - (0.5 + 1 / 3)) < 0.02, `quarter turn clockwise: ${d.value}`);

  const f = new SlideFader("Whammy", { springBack: true, toPart: "lead", toParam: "@bend" }).attach(kit);
  const fh = handAt(f, [0, 0.03, -f.length / 2]);
  f.handDown(fh);
  assert.ok(f.value > 0.95);
  f.handUp(fh);
  for (let i = 0; i < 60; i++) f.update(1 / 60);
  assert.ok(Math.abs(f.value - 0.5) < 0.01);

  const xy = new XYPad("XY").attach(kit);
  xy.handDown(handAt(xy, [xy.size / 2 - 0.001, 0.02, -xy.size / 2 + 0.001]));
  assert.ok(xy.x > 0.98 && xy.y > 0.98);

  const fw = new Flywheel("Wheel").attach(kit);
  fw.spin(3);
  fw.update(0.01);
  const s0 = kit.lastValue("Wheel.speed");
  for (let i = 0; i < 120; i++) fw.update(1 / 30);
  const s1 = kit.lastValue("Wheel.speed");
  assert.ok(s0 > 0.95 && s1 < s0 && s1 > 0);

  const tc = new TiltCube("Tilt").attach(kit);
  const th = new Hand("xr", 12);
  th.grip = true;
  tc.handDown(th);
  // Tip the hand forward: its z axis gains an upward component.
  const a = 0.35;
  th.basis = { x: [1, 0, 0], y: [0, Math.cos(a), -Math.sin(a)], z: [0, Math.sin(a), Math.cos(a)] };
  tc.handMove(th);
  assert.ok(tc.pitch > 0.3, `pitch ${tc.pitch}`);

  const sw = new ScaleSwitch("Scale").attach(kit);
  sw.handDown(handAt(sw, [sw.bx(0), 0.02, 0]));
  assert.equal(kit.scale.enabled, false);
  sw.handDown(handAt(sw, [sw.bx(1), 0.02, 0]));
  assert.equal(kit.scale.root, 1);
  sw.handDown(handAt(sw, [sw.bx(2), 0.02, 0]));
  assert.equal(kit.scale.scale, "minor");
});

test("music box: pegs play as they pass the comb; a tap places one", () => {
  const { kit, log } = rig();
  const mb = new MusicBoxWheel("MusicBox").attach(kit);
  mb.togglePeg([0, 12]);
  mb.togglePeg([2, 0]);
  mb.advance(Math.PI);
  assert.deepEqual(log.on.map((o) => o[1]), [60]);
  mb.advance(Math.PI);
  assert.deepEqual(log.on.map((o) => o[1]), [60, 64]);
  const tap = handAt(mb, [0, 0.02, mb.ringR(1)]);
  mb.handDown(tap);
  mb.handUp(tap);
  assert.equal(mb.pegs.size, 3);
});

test("pointer driver: a ray presses, a drag slides along the object's plane", () => {
  const { kit, log } = rig();
  const frame = { x: 0, y: 0.8, z: 0, yaw: 0 };
  const objects = makeTable(kit, frame);
  const p = new PointerDriver(objects);
  const bars = objects.find((o) => o.name === "Bars");
  const top = bars.world([bars.barX(0), 0.05, 0]);
  assert.ok(p.down(1, { o: [top[0], 2, top[2]], d: [0, -1, 0] }));
  assert.equal(log.on.at(-1)[1], 60);
  const end = bars.world([bars.barX(7), 0.05, 0]);
  p.move(1, { o: [end[0], 2, end[2]], d: [0, -1, 0] });
  assert.equal(log.on.at(-1)[1], 72, "dragged to the octave bar");
  p.up(1);
  assert.equal(p.down(2, { o: [5, 2, 5], d: [0, -1, 0] }), false, "empty space misses");
  // The chord blocks' reach above them doesn't catch rays aimed past them.
  const orb = objects.find((o) => o.name === "Orb");
  const blocks = objects.find((o) => o.name === "Blocks");
  const target = orb.world([0.05, 0.2, 0]);
  const from = [target[0], target[1] + 0.05, target[2] + 1.2];
  const d = [target[0] - from[0], target[1] - from[1], target[2] - from[2]], n = Math.hypot(...d);
  log.clear();
  assert.ok(blocks.hitRay(from, d.map((v) => v / n)) < 0, "ray over the blocks misses them");
  assert.ok(p.down(3, { o: from, d: d.map((v) => v / n) }));
  assert.equal(log.on[0][0], "lead", "and plays the orb behind");
});

test("XR hands: hit hard, rest, lift off, trigger from afar", () => {
  const { kit, log } = rig();
  const frame = { x: 0, y: 0.8, z: 0, yaw: 0.4 };
  const objects = makeTable(kit, frame);
  const pads = objects.find((o) => o.name === "Pads");
  const xr = new XRHandsDriver(objects);
  const kick = pads.world(pads.center(0));
  const above = [kick[0], kick[1] + 0.25, kick[2]];
  xr.update([{ id: "r", tip: above }], 0.016);
  xr.update([{ id: "r", tip: [kick[0], kick[1] + 0.05, kick[2]] }], 0.05);
  assert.equal(log.on.length, 1);
  assert.equal(log.on[0][1], 36);
  assert.ok(log.on[0][2] > 0.6, `firm hit: ${log.on[0][2]}`);
  xr.update([{ id: "r", tip: [kick[0], kick[1] + 0.05, kick[2]] }], 0.016);
  assert.equal(log.on.length, 1, "resting doesn't retrigger");
  xr.update([{ id: "r", tip: above }], 0.016);
  assert.equal(xr.holding("r"), null);
  const htom = pads.world(pads.center(5));
  xr.update([{ id: "r", tip: [htom[0], htom[1] + 1, htom[2]], ray: { o: [htom[0], htom[1] + 1, htom[2]], d: [0, -1, 0] }, trigger: 1 }], 0.016);
  assert.equal(log.on.at(-1)[1], 50, "trigger plays the pointed-at pad");
  xr.update([{ id: "r", tip: [htom[0], htom[1] + 1, htom[2]], ray: { o: [htom[0], htom[1] + 1, htom[2]], d: [0, -1, 0] }, trigger: 0 }], 0.016);
  assert.equal(xr.holding("r"), null);
});

test("the table frame turns and moves every object together", () => {
  const { kit } = rig();
  const frame = { x: 2, y: 0.9, z: -1, yaw: Math.PI / 2 };
  const objects = makeTable(kit, frame);
  for (const o of objects) {
    const w = o.world([0.01, 0.02, 0.03]);
    const l = o.local(w);
    assert.ok(Math.hypot(l[0] - 0.01, l[1] - 0.02, l[2] - 0.03) < 1e-9, `${o.name} round-trips`);
  }
});
