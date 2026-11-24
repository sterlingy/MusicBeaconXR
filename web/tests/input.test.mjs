// ListenerKit (web/src/input/listener.js): spaces, priority, targets, wander, sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ListenerInput, planarSpace, localSpace, geoSpace, keyboardSource, geolocationSource, poseSource } from "../src/input/listener.js";
import { makeLocalGridField, makeGridField, weigh } from "../src/beacons.js";

const close = (a, b, eps = 1e-6) => Object.keys(b).every((k) => Math.abs(a[k] - b[k]) < eps);

test("planar: forward is screen-up (-y), right is +x, clamped", () => {
  const s = planarSpace({ half: 250 });
  assert.ok(close(s.step({ x: 0, y: 0 }, [0, 1], 10), { x: 0, y: -10 }));
  assert.ok(close(s.step({ x: 0, y: 0 }, [1, 0], 10), { x: 10, y: 0 }));
  assert.ok(close(s.step({ x: 245, y: 0 }, [1, 0], 10), { x: 250, y: 0 }));
  const t = s.toward({ x: 0, y: 0 }, { x: 30, y: -40 });
  assert.ok(Math.abs(t.dist - 50) < 1e-9 && close({ a: t.dir[0], b: t.dir[1] }, { a: 0.6, b: 0.8 }));
});

test("geo: north is +lat, wraps the date line, stretches longitude", () => {
  const s = geoSpace();
  assert.ok(close(s.step({ lat: 0, lon: 0 }, [0, 1], 5), { lat: 5, lon: 0 }));
  assert.ok(close(s.step({ lat: 0, lon: 178 }, [1, 0], 5), { lat: 0, lon: -177 }));
  assert.ok(Math.abs(s.step({ lat: 60, lon: 0 }, [1, 0], 5).lon - 10) < 1e-9);
  const t = s.toward({ lat: 0, lon: 170 }, { lat: 0, lon: -170 });
  assert.ok(t.dir[0] > 0.99 && Math.abs(t.dist - 20) < 1e-9, "short way across the date line");
});

test("local: forward is north, steps are meters", () => {
  const f = makeLocalGridField({ lat: 51.5, lon: -0.12 }, 10, 1);
  const s = localSpace(f);
  const a = f.fromXY({ x: 0, y: 0 });
  const b = s.step(a, [0, 1], 100);
  const q = f.toXY(b);
  assert.ok(Math.abs(q.x) < 1e-6 && Math.abs(q.y - 100) < 1e-6);
});

test("listener walks to a target, then stops", () => {
  const li = new ListenerInput({ space: planarSpace(), position: { x: 10, y: 10 }, speed: 50 });
  const seen = [];
  li.on("moved", (p) => seen.push(p));
  li.setTarget({ x: 10, y: -40 });
  for (let i = 0; i < 10; i++) li.tick(0.1);
  assert.ok(close(li.position, { x: 10, y: -40 }));
  assert.equal(li.target, null);
  assert.equal(seen.length, 10);
});

test("a move intent beats the target and clears it; partial stick is slower; manual is signalled", () => {
  const li = new ListenerInput({ space: planarSpace(), speed: 50 });
  let dir = [1, 0];
  const manual = [];
  li.on("manual", (k) => manual.push(k));
  li.add({ moveIntent: () => dir });
  li.setTarget({ x: -200, y: 0 });
  li.tick(0.1);
  assert.ok(close(li.position, { x: 5, y: 0 }));
  assert.equal(li.target, null);
  dir = [0.5, 0];
  li.tick(0.1);
  assert.ok(close(li.position, { x: 7.5, y: 0 }));
  assert.deepEqual(manual, ["walk", "walk"]);
});

test("holdTarget keeps the target after arriving (dragging)", () => {
  const li = new ListenerInput({ space: planarSpace(), speed: 50 });
  li.holdTarget = true;
  li.setTarget({ x: 1, y: 0 });
  li.tick(0.1);
  assert.ok(li.target);
});

test("wander stays on the field and toggles through actions", () => {
  const li = new ListenerInput({ space: planarSpace({ half: 250 }), speed: 55 });
  const acts = [];
  li.on("action", (n) => acts.push(n));
  li.action("toggle_wander");
  assert.ok(li.wander);
  assert.deepEqual(acts, ["toggle_wander"]);
  let worst = 0;
  for (let i = 0; i < 5000; i++) { li.tick(1 / 30); worst = Math.max(worst, Math.abs(li.position.x), Math.abs(li.position.y)); }
  assert.ok(worst <= 250);
});

test("geo wander stays off the poles", () => {
  const li = new ListenerInput({ space: geoSpace(), position: { lat: 70, lon: 0 }, speed: 18 });
  li.wander = true;
  let worst = 0;
  for (let i = 0; i < 5000; i++) { li.tick(1 / 30); worst = Math.max(worst, Math.abs(li.position.lat)); }
  assert.ok(worst < 90);
});

test("a driving source (pose) wins over everything", () => {
  const li = new ListenerInput({ space: planarSpace(), speed: 50 });
  li.add({ moveIntent: () => [1, 0] });
  li.sources.unshift(poseSource(() => ({ x: 3, z: 4 }), (x, z) => ({ x, y: z })));
  li.tick(0.1);
  assert.ok(close(li.position, { x: 3, y: 4 }));
});

test("keyboard source: keys to (right, forward), ignores form fields, Space toggles play", () => {
  const hs = {};
  const target = { addEventListener: (t, f) => { (hs[t] ||= []).push(f); }, removeEventListener() {}, dispatchEvent: (e) => (hs[e.type] || []).forEach((f) => f(e)) };
  const kb = keyboardSource(target, { gamepad: false, wanderKey: true, jumpKeys: true });
  const li = new ListenerInput();
  li.add(kb);
  const acts = [];
  li.on("action", (n, a) => acts.push([n, a]));
  const key = (type, code) => target.dispatchEvent({ type, code, target: { closest: () => null }, preventDefault() {} });
  key("keydown", "KeyW"); key("keydown", "KeyD");
  const d = kb.moveIntent();
  assert.ok(Math.abs(d[0] - Math.SQRT1_2) < 1e-9 && Math.abs(d[1] - Math.SQRT1_2) < 1e-9);
  key("keyup", "KeyW"); key("keyup", "KeyD");
  assert.deepEqual(kb.moveIntent(), [0, 0]);
  target.dispatchEvent({ type: "keydown", code: "KeyA", target: { closest: () => ({}) }, preventDefault() {} });
  assert.deepEqual(kb.moveIntent(), [0, 0], "typing in a field doesn't walk");
  key("keydown", "Space"); key("keydown", "KeyT"); key("keydown", "Digit3");
  assert.deepEqual(acts, [["toggle_play", undefined], ["toggle_wander", undefined], ["jump", 2]]);
});

test("geolocation source drives the position and stops on a hand move", () => {
  let cb = null, cleared = false;
  const geo = { watchPosition: (ok) => { cb = ok; return 7; }, clearWatch: (id) => { cleared = id === 7; } };
  const stops = [];
  const src = geolocationSource({ geo, onFix: (p, { first }) => (first ? { ...p, lat: p.lat + 1 } : undefined), onStop: (why) => stops.push(why) });
  const li = new ListenerInput({ space: geoSpace(), position: { lat: 0, lon: 0 } });
  li.add(src);
  li.add({ moveIntent: () => [0, 0] });
  assert.ok(src.start());
  cb({ coords: { latitude: 10, longitude: 20, accuracy: 5 } });
  li.tick(0.1);
  assert.ok(close(li.position, { lat: 11, lon: 20 }), "onFix can replace the position");
  cb({ coords: { latitude: 12, longitude: 20 } });
  li.tick(0.1);
  assert.ok(close(li.position, { lat: 12, lon: 20 }));
  li.manual("walk");
  assert.ok(cleared && !src.following);
  assert.deepEqual(stops, ["walk"]);
});

test("the grid start position weighs the same through the kit", () => {
  const f = makeGridField(5, 100);
  const li = new ListenerInput({ space: planarSpace({ half: 250 }), position: { x: -38, y: 27 } });
  assert.deepEqual(weigh(f, li.position).map((n) => n.id), weigh(f, { x: -38, y: 27 }).map((n) => n.id));
});
