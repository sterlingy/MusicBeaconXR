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

test("AR placement: the viewer stands on the listener, facing the field's north", async () => {
  const { worldOf, fieldOf, placeAt } = await import("../src/ar/placement.js");
  const s = { scale: 1 / 50, theta: 0, anchor: { x: 0, y: 0, z: 0 } };
  placeAt(s, { x: -38, y: 27 }, 2, 0, 3, 1, 0); // standing at (2, 3), facing +x
  const f = fieldOf(s, 2, 3);
  assert.ok(Math.abs(f.x + 38) < 1e-9 && Math.abs(f.y - 27) < 1e-9);
  // One real meter forward (+x) is 50 field meters north (-y).
  const g = fieldOf(s, 3, 3);
  assert.ok(Math.abs(g.x + 38) < 1e-9 && Math.abs(g.y - (27 - 50)) < 1e-9);
  const w = worldOf(s, { x: -38, y: 27 }, 0.5);
  assert.ok(Math.abs(w[0] - 2) < 1e-9 && w[1] === 0.5 && Math.abs(w[2] - 3) < 1e-9);
});

// ---------------------------------------------------------------- explore and travel

import { travelSeconds as _travelSeconds, pointerSource } from "../src/input/listener.js";

test("great circles and Move times match the app", () => {
  const g = geoSpace();
  const lon = { lat: 51.51, lon: -0.13 }, ny = { lat: 40.71, lon: -74 };
  assert.ok(Math.abs(g.distance(lon, ny) - 5570) < 30);
  const mid = g.interp(lon, ny, 0.5);
  assert.ok(mid.lat > 51.5 && mid.lon < -30 && mid.lon > -45, "bows north over the Atlantic");
  const hop = _travelSeconds(g, lon, { lat: 51.6, lon: 0 }), far = _travelSeconds(g, lon, { lat: -30, lon: 150 });
  assert.ok(hop >= 3 && hop < 4 && far > 10 && far <= 12);
  const flat = planarSpace();
  assert.deepEqual(flat.interp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5), { x: 5, y: 10 });
});

test("Move glides there, eases, arrives; walking or a jump cancels it", () => {
  const li = new ListenerInput({ space: planarSpace(), position: { x: 0, y: 0 } });
  let arrived = null;
  li.on("arrived", (p) => { arrived = p; });
  li.travelTo({ x: 100, y: 0 }, 2);
  li.tick(0.2);
  assert.ok(li.position.x < 10, "eases in");
  li.tick(0.8);
  assert.ok(Math.abs(li.position.x - 50) < 2, "halfway at half time");
  li.tick(1.1);
  assert.deepEqual(arrived, { x: 100, y: 0 });
  assert.equal(li.traveling, false);
  li.travelTo({ x: 0, y: 0 }, 2);
  li.jumpTo({ x: 7, y: 7 });
  li.tick(0.5);
  assert.deepEqual(li.position, { x: 7, y: 7 });
});

function fakeCanvas() {
  const h = {};
  return {
    width: 100, height: 100,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    addEventListener: (t, f) => { h[t] = f; }, removeEventListener: (t) => { delete h[t]; },
    fire: (t, e) => h[t]?.({ pointerId: 1, button: 0, preventDefault() {}, ...e }),
  };
}

test("explore pointer: drag pans without moving, tap selects, long press and right-click ask where to go", async () => {
  const el = fakeCanvas();
  const pans = [], acts = [];
  let end = null;
  const li = new ListenerInput({ space: planarSpace(), position: { x: 0, y: 0 } });
  li.add(pointerSource(el, (x, y) => ({ x, y }), { mode: "explore", longPressMs: 30, onOrbit: (dx, dy) => pans.push([dx, dy]), onOrbitEnd: (vx, vy) => { end = [vx, vy]; } }));
  li.on("action", (n, a) => acts.push([n, a]));
  el.fire("pointerdown", { clientX: 10, clientY: 10 });
  el.fire("pointermove", { clientX: 30, clientY: 10 });
  el.fire("pointermove", { clientX: 40, clientY: 15 });
  el.fire("pointerup", { clientX: 40, clientY: 15 });
  assert.equal(pans.length, 2);
  assert.ok(end, "a drag ends with a flick speed");
  assert.equal(li.target, null);
  assert.equal(acts.length, 0, "a drag isn't a tap");
  el.fire("pointerdown", { clientX: 50, clientY: 50 });
  el.fire("pointerup", { clientX: 51, clientY: 50 });
  assert.equal(acts[0][0], "select");
  assert.equal(li.target, null, "a tap doesn't walk");
  acts.length = 0;
  el.fire("pointerdown", { clientX: 60, clientY: 60 });
  await new Promise((r) => setTimeout(r, 60));
  el.fire("pointerup", { clientX: 60, clientY: 60 });
  assert.deepEqual(acts.map((a) => a[0]), ["point"], "a long press asks where to go, and isn't also a tap");
  assert.deepEqual(acts[0][1].pos, { x: 60, y: 60 });
  acts.length = 0;
  el.fire("contextmenu", { clientX: 20, clientY: 30 });
  assert.deepEqual(acts.map((a) => a[0]), ["point"], "right-click asks too");
});
