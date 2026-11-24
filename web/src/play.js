// Instrument Table in the browser: MusicInputKit's objects on a table, played
// with the mouse, touch (several fingers), or your hands and controllers in
// WebXR (VR and AR). Sound comes from PlaySound (the Web Audio synths).

import { mat4, hexColor, Renderer } from "./ar/gl.js";
import { MusicInput, makeTable, PointerDriver, XRHandsDriver, TITLES, NOTE_NAMES, SCALES } from "./play/kit.js";
import { PlaySound, PARTS } from "./play/sound.js";

const $ = (id) => document.getElementById(id);
const BG = [0.043, 0.063, 0.086, 1];
const TABLE_Y = 0.8;
const STORE = "instrumentTable.v1";
const FRONT_TITLES = new Set(["Bars", "Blocks", "Pads", "Ribbon"]);

// ---------------------------------------------------------------- kit, objects, sound

const kit = new MusicInput();
let saved = null;
try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { saved = null; }
if (saved) {
  kit.scale.enabled = saved.lock ?? true;
  kit.scale.root = saved.root ?? 0;
  kit.scale.scale = saved.scale ?? "major";
  kit.patches.load(saved.patches || []);
}
const frame = { x: 0, y: TABLE_Y, z: 0, yaw: 0 };
const objects = makeTable(kit, frame);
const sound = new PlaySound();
sound.listen(kit);
kit.resend();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ patches: kit.patches.toJSON(), ...kit.scale.toJSON() })); } catch { /* private mode */ } };
kit.patches.on("changed", save);
kit.scale.on("changed", () => { save(); syncScaleUI(); });
const pointer = new PointerDriver(objects);
const xrHands = new XRHandsDriver(objects);

// ---------------------------------------------------------------- matrices

const T = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const S = (x, y, z) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
const mul = (...ms) => ms.reduce((a, b) => mat4.mul(a, b));

function frameMatrix(pos) { return mul(T(frame.x, frame.y, frame.z), Ry(frame.yaw), T(pos[0], pos[1], pos[2])); }

/** A box shape's model matrix: bottom-centre c, size s, optional yaw / tilt about a pivot. */
function boxMatrix(W, sh) {
  const [c, s] = sh.box;
  let local;
  if (sh.pivot && (sh.pitch || sh.roll)) {
    const p = sh.pivot;
    local = mul(T(p[0], p[1], p[2]), Rx(sh.pitch || 0), Rz(sh.roll || 0), T(c[0] - p[0], c[1] - p[1], c[2] - p[2]), Ry(sh.yaw || 0), S(s[0], s[1], s[2]));
  } else {
    local = mul(T(c[0], c[1], c[2]), Ry(sh.yaw || 0), S(s[0], s[1], s[2]));
  }
  return mat4.mul(W, local);
}

// ---------------------------------------------------------------- scene

const colorCache = new Map();
const col = (hex, a = 1) => { const k = hex + a; if (!colorCache.has(k)) colorCache.set(k, hexColor(hex, a)); return colorCache.get(k); };

function buildScene({ floor = true, tips = [] } = {}) {
  const boxes = [], clear = [], lines = [];
  const line = (a, b, c) => lines.push(a[0], a[1], a[2], 0, 1, 0, ...c, b[0], b[1], b[2], 0, 1, 0, ...c);
  const W0 = frameMatrix([0, 0, 0]);
  boxes.push({ m: mat4.mul(W0, mul(T(0, -0.04, 0), S(2, 0.04, 1))), color: col("#1a2430") });
  for (const x of [-0.95, 0.95]) for (const z of [-0.45, 0.45]) boxes.push({ m: mat4.mul(W0, mul(T(x, -frame.y, z), S(0.05, frame.y - 0.04, 0.05))), color: col("#141c25") });
  for (const o of objects) {
    const W = frameMatrix(o.pos);
    for (const sh of o.shapes()) {
      if (sh.box) {
        const b = { m: boxMatrix(W, sh), color: col(sh.color, sh.alpha ?? 1), glow: sh.glow || 0 };
        (sh.alpha != null && sh.alpha < 1 ? clear : boxes).push(b);
      } else if (sh.line) {
        line(o.world(sh.line[0]), o.world(sh.line[1]), col(sh.color, sh.alpha ?? 1));
      }
    }
  }
  if (floor) {
    const g = [0.35, 0.45, 0.55, 0.18];
    for (let k = -4; k <= 4; k++) { line([k, 0, -4], [k, 0, 4], g); line([-4, 0, k], [4, 0, k], g); }
  }
  for (const t of tips) {
    boxes.push({ m: mul(T(t.tip[0], t.tip[1] - 0.008, t.tip[2]), S(0.016, 0.016, 0.016)), color: col("#ffb547"), glow: 1.5 });
    if (t.ray) line(t.ray.o, [t.ray.o[0] + t.ray.d[0] * 2, t.ray.o[1] + t.ray.d[1] * 2, t.ray.o[2] + t.ray.d[2] * 2], [1, 0.71, 0.28, 0.6]);
  }
  return { boxes: boxes.concat(clear), lines: new Float32Array(lines) };
}

// ---------------------------------------------------------------- flat view

const canvas = $("view");
const gl = canvas.getContext("webgl", { xrCompatible: true, antialias: true, alpha: true });
const renderer = gl ? new Renderer(gl) : null;
if (!gl) setMsg("This browser has no WebGL, so the 3D table can't run.", true);

const cam = { yaw: 0, pitch: -0.66, dist: 1.6, fov: 0.87, target: [0, TABLE_Y, 0.02] };
function eye() {
  const cp = Math.cos(cam.pitch);
  return [cam.target[0] + Math.sin(cam.yaw) * cp * cam.dist, cam.target[1] - Math.sin(cam.pitch) * cam.dist, cam.target[2] + Math.cos(cam.yaw) * cp * cam.dist];
}
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
  // Step back until the whole table (2 m) fits. Tall screens (phones in
  // portrait) look down from the side, so the table's long side runs up the screen.
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const portrait = aspect < 0.8;
  cam.fitDist = portrait ? Math.max(1.6, 1.4 / Math.tan(cam.fov / 2)) : Math.max(1.4, Math.min(4, 1.25 / (Math.tan(cam.fov / 2) * aspect)));
  cam.home = portrait ? { yaw: Math.PI / 2, pitch: -1.15 } : { yaw: 0, pitch: -0.66 };
  if (cam.portrait !== portrait) {
    cam.portrait = portrait;
    // Portrait: aim a little toward the back row, whose strings and orb stand tall.
    cam.target = [0, TABLE_Y, portrait ? -0.05 : 0.02];
    Object.assign(cam, cam.home, { dist: cam.fitDist });
  }
}
new ResizeObserver(resize).observe(canvas);

/** World ray through a point on the canvas (CSS pixels). */
function rayAt(px, py) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const x = (px / w) * 2 - 1, y = 1 - (py / h) * 2, ty = Math.tan(cam.fov / 2), aspect = w / h;
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const fwd = [-sy * cp, sp, -cy * cp], right = [cy, 0, -sy], up = [sy * sp, cp, cy * sp];
  const d = [0, 1, 2].map((i) => fwd[i] + right[i] * x * ty * aspect + up[i] * y * ty);
  const n = Math.hypot(...d);
  return { o: eye(), d: d.map((v) => v / n) };
}

const orbit = new Map(); // pointerId -> [x, y]
function unlockSound() {
  sound.ensure();
  $("sound").textContent = "Sound on";
  $("sound").disabled = true;
}

canvas.addEventListener("pointerdown", (e) => {
  unlockSound();
  canvas.setPointerCapture(e.pointerId);
  const kind = e.pointerType === "touch" ? "touch" : "mouse";
  if (e.button === 0 && pointer.down(e.pointerId, rayAt(e.offsetX, e.offsetY), kind, e.pointerId)) return;
  orbit.set(e.pointerId, [e.clientX, e.clientY]);
});
canvas.addEventListener("pointermove", (e) => {
  if (orbit.has(e.pointerId)) {
    const [x, y] = orbit.get(e.pointerId);
    cam.yaw -= (e.clientX - x) * 0.006;
    cam.pitch = Math.max(-1.45, Math.min(-0.12, cam.pitch - (e.clientY - y) * 0.006));
    orbit.set(e.pointerId, [e.clientX, e.clientY]);
    return;
  }
  pointer.move(e.pointerId, rayAt(e.offsetX, e.offsetY));
});
const lift = (e) => { orbit.delete(e.pointerId); pointer.up(e.pointerId); };
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (!pointer.wheel(rayAt(e.offsetX, e.offsetY), e.deltaY < 0 ? 1 : -1)) cam.dist = Math.max(0.5, Math.min(4, cam.dist * (e.deltaY < 0 ? 0.92 : 1.087)));
}, { passive: false });
window.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea")) return;
  if (e.key === "l" || e.key === "L") kit.action("lock");
  else if (e.key === "p" || e.key === "P") togglePatches();
  else if (e.key === "r" || e.key === "R") Object.assign(cam, cam.home, { dist: cam.fitDist });
});

const tagsEl = $("tags");
const tagPool = [];
function drawTags(proj, view) {
  const pv = mat4.mul(proj, view), w = canvas.clientWidth, h = canvas.clientHeight;
  let n = 0;
  const put = (text, wp, cls, size) => {
    const x = pv[0] * wp[0] + pv[4] * wp[1] + pv[8] * wp[2] + pv[12];
    const y = pv[1] * wp[0] + pv[5] * wp[1] + pv[9] * wp[2] + pv[13];
    const ww = pv[3] * wp[0] + pv[7] * wp[1] + pv[11] * wp[2] + pv[15];
    if (ww <= 0.05) return;
    let el = tagPool[n];
    if (!el) { el = document.createElement("span"); tagsEl.append(el); tagPool.push(el); }
    n++;
    el.hidden = false;
    if (el.textContent !== text) el.textContent = text;
    el.className = cls;
    el.style.left = `${((x / ww) * 0.5 + 0.5) * w}px`;
    el.style.top = `${(0.5 - (y / ww) * 0.5) * h}px`;
    el.style.fontSize = size ? `${Math.max(9, Math.min(16, (size * 1.6) / ww))}px` : "";
  };
  for (const o of objects) {
    for (const t of o.labels()) put(t.text, o.world(t.at), "", t.size);
    // Middle row: the name goes in front, clear of the back row. Others: above.
    const front = FRONT_TITLES.has(o.name);
    if (TITLES[o.name]) put(TITLES[o.name], o.world(front ? [0, 0.005, o.box.max[2] + 0.03] : [0, Math.min(o.box.max[1], 0.45) + 0.05, o.box.min[2]]), "title");
  }
  for (let i = n; i < tagPool.length; i++) tagPool[i].hidden = true;
}

function step(dt) { for (const o of objects) o.update(dt); }

let last = performance.now();
function previewFrame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.session) {
    step(dt);
    if (renderer && canvas.width) {
      const proj = mat4.perspective(cam.fov, canvas.width / canvas.height, 0.02, 60);
      const e = eye(), view = mat4.fps(e, cam.yaw, cam.pitch);
      renderer.draw(buildScene(), proj, view, { x: 0, y: 0, width: canvas.width, height: canvas.height }, { clear: BG });
      drawTags(proj, view);
    }
  }
  requestAnimationFrame(previewFrame);
}

// ---------------------------------------------------------------- XR

const state = { session: null, mode: null, refSpace: null, lastXR: null, needPlace: false, pressed: new Map() };

async function supported(mode) {
  try { return !!navigator.xr && (await navigator.xr.isSessionSupported(mode)); } catch { return false; }
}

async function startXR(mode) {
  if (state.session || !gl) return;
  const want = navigator.xr.requestSession(mode, {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["hand-tracking", "dom-overlay"],
    domOverlay: { root: $("overlay") },
  });
  unlockSound();
  let session;
  try { session = await want; } catch (e) { setMsg(`Couldn't start ${mode === "immersive-ar" ? "AR" : "VR"}: ${e.message}`, true); return; }
  state.session = session;
  state.mode = mode;
  state.needPlace = true;
  pointer.releaseAll();
  document.body.classList.add("in-xr", mode === "immersive-ar" ? "in-ar" : "in-vr");
  await gl.makeXRCompatible();
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  state.refSpace = await session.requestReferenceSpace("local-floor");
  session.addEventListener("end", endXR);
  setMsg("Reach out and play: hit, pluck and touch. Grip to hold and twist. Trigger plays from a distance. Right stick: table height. Left stick press: bring the table to you.");
  state.lastXR = null;
  session.requestAnimationFrame(xrFrame);
}

function endXR() {
  xrHands.releaseAll();
  state.session = null;
  state.mode = null;
  document.body.classList.remove("in-xr", "in-ar", "in-vr");
  Object.assign(frame, { x: 0, y: TABLE_Y, z: 0, yaw: 0 });
  setMsg("Left XR.");
}

/** Puts the table in front of the viewer, front edge at arm's length, facing them. */
function placeTable(m) {
  let fx = -m[8], fz = -m[10];
  const n = Math.hypot(fx, fz) || 1;
  fx /= n;
  fz /= n;
  frame.yaw = Math.atan2(-fx, -fz);
  frame.x = m[12] + fx * 0.6;
  frame.z = m[14] + fz * 0.6;
}

const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

function readInputs(xrf, dt) {
  const inputs = [], tips = [];
  for (const src of state.session.inputSources) {
    let tip = null, axes = null;
    if (src.hand) {
      const j = src.hand.get("index-finger-tip");
      const jp = j && xrf.getJointPose ? xrf.getJointPose(j, state.refSpace) : null;
      if (jp) { const m = jp.transform.matrix; tip = [m[12], m[13], m[14]]; axes = { x: [m[0], m[1], m[2]], y: [m[4], m[5], m[6]], z: [m[8], m[9], m[10]] }; }
    } else if (src.gripSpace) {
      const gp = xrf.getPose(src.gripSpace, state.refSpace);
      if (gp) { const m = gp.transform.matrix; tip = xf(m, [0, -0.01, -0.07]); axes = { x: [m[0], m[1], m[2]], y: [m[4], m[5], m[6]], z: [m[8], m[9], m[10]] }; }
    }
    if (!tip) continue;
    let ray = null;
    const rp = src.targetRaySpace ? xrf.getPose(src.targetRaySpace, state.refSpace) : null;
    if (rp) { const m = rp.transform.matrix; ray = { o: [m[12], m[13], m[14]], d: [-m[8], -m[9], -m[10]] }; }
    const gpad = src.gamepad, b = gpad?.buttons || [];
    const trigger = b[0]?.value || 0, grip = b[1]?.value || 0;
    const key = `${src.handedness}:${src.hand ? "hand" : "pad"}`;
    // Right stick: table height. Left stick press: bring the table here.
    if (gpad && src.handedness === "right" && Math.abs(gpad.axes[3] || 0) > 0.3) frame.y = Math.max(0.4, Math.min(1.4, frame.y - gpad.axes[3] * 0.3 * dt));
    const stickDown = !!b[3]?.pressed;
    if (src.handedness === "left" && stickDown && !state.pressed.get(key)) state.needPlace = true;
    state.pressed.set(key, stickDown);
    const act = gpad?.hapticActuators?.[0] || gpad?.vibrationActuator;
    inputs.push({ id: key, tip, axes, ray, trigger, grip, buzz: act ? (s) => { try { act.pulse ? act.pulse(s, 40) : act.playEffect?.("dual-rumble", { duration: 40, strongMagnitude: s }); } catch { /* no haptics */ } } : null });
    tips.push({ tip, ray: ray && trigger > 0.1 && !xrHands.holding(key) ? ray : null });
  }
  return { inputs, tips };
}

function xrFrame(t, xrf) {
  const session = xrf.session;
  if (session !== state.session) return;
  session.requestAnimationFrame(xrFrame);
  const dt = state.lastXR == null ? 0 : Math.min(0.1, (t - state.lastXR) / 1000);
  state.lastXR = t;
  const vp = xrf.getViewerPose(state.refSpace);
  if (vp && state.needPlace) { placeTable(vp.transform.matrix); state.needPlace = false; }
  const { inputs, tips } = readInputs(xrf, dt);
  xrHands.update(inputs, dt);
  step(dt);
  const layer = session.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  const ar = state.mode === "immersive-ar";
  gl.clearColor(...(ar ? [0, 0, 0, 0] : BG));
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (vp) {
    const scene = buildScene({ floor: !ar, tips });
    for (const view of vp.views) renderer.draw(scene, view.projectionMatrix, view.transform.inverse.matrix, layer.getViewport(view));
  }
}

// ---------------------------------------------------------------- UI

function setMsg(t, err = false) { $("msg").textContent = t; $("msg").classList.toggle("err", err); }

const scaleNames = Object.keys(SCALES).filter((n) => n !== "chromatic");
for (const [i, n] of NOTE_NAMES.entries()) $("key").append(new Option(n, String(i)));
for (const n of scaleNames) $("scale").append(new Option(n, n));
function syncScaleUI() {
  $("lock").checked = kit.scale.enabled;
  $("key").value = String(kit.scale.root);
  $("scale").value = kit.scale.scale;
}
syncScaleUI();
$("lock").addEventListener("change", (e) => kit.action("lock", e.target.checked));
$("key").addEventListener("change", (e) => { kit.scale.root = +e.target.value; });
$("scale").addEventListener("change", (e) => { kit.scale.scale = e.target.value; });
$("vol").addEventListener("input", (e) => sound.setVolume(+e.target.value));
$("sound").addEventListener("click", unlockSound);
$("patchBtn").addEventListener("click", togglePatches);
$("recenter").addEventListener("click", () => { state.needPlace = true; });
$("exit").addEventListener("click", () => state.session?.end());

function togglePatches() {
  const el = $("patches"), open = !el.classList.contains("open");
  el.classList.toggle("open", open);
  $("patchBtn").setAttribute("aria-expanded", String(open));
  $("patchBtn").textContent = open ? "Patches ▾" : "Patches ▸";
  if (open) fillPatches();
}

/** One row per moving part: which part it shapes and which knob. */
function fillPatches() {
  const el = $("patches");
  el.textContent = "";
  const table = document.createElement("table");
  for (const [source, label] of Object.entries(kit.patches.sources).sort((a, b) => a[1].localeCompare(b[1]))) {
    const tr = table.insertRow();
    tr.insertCell().textContent = label;
    const cur = kit.patches.targetsOf(source)[0];
    const partSel = document.createElement("select"), paramSel = document.createElement("select");
    partSel.setAttribute("aria-label", `${label}: part`);
    paramSel.setAttribute("aria-label", `${label}: knob`);
    partSel.append(new Option("—", ""));
    for (const p of PARTS) partSel.append(new Option(p, p));
    const fillParams = (part, sel) => {
      paramSel.textContent = "";
      for (const [id, [lbl]] of Object.entries(sound.knobs[part] || {})) paramSel.append(new Option(lbl, id));
      if (sel) paramSel.value = sel;
    };
    if (cur) { partSel.value = cur.part; fillParams(cur.part, cur.param); }
    partSel.addEventListener("change", () => {
      if (!partSel.value) { kit.patches.remove(source); paramSel.textContent = ""; return; }
      fillParams(partSel.value);
      kit.patches.setPatch(source, partSel.value, paramSel.value);
      kit.resend();
    });
    paramSel.addEventListener("change", () => { if (partSel.value) { kit.patches.setPatch(source, partSel.value, paramSel.value); kit.resend(); } });
    tr.insertCell().append(partSel);
    tr.insertCell().append(paramSel);
  }
  el.append(table);
  const reset = document.createElement("button");
  reset.textContent = "Reset patches";
  reset.addEventListener("click", () => { try { localStorage.removeItem(STORE); } catch { /* ignore */ } location.reload(); });
  el.append(reset);
}

(async () => {
  const [vr, ar] = await Promise.all([supported("immersive-vr"), supported("immersive-ar")]);
  $("startVR").disabled = !vr;
  $("startAR").disabled = !ar;
  $("startVR").addEventListener("click", () => startXR("immersive-vr"));
  $("startAR").addEventListener("click", () => startXR("immersive-ar"));
  if (!vr && !ar) {
    setMsg(!window.isSecureContext
      ? "VR and AR need a secure page (https or localhost). Mouse and touch work anywhere."
      : !navigator.xr ? "Play with the mouse or touch. VR and AR work in the Quest Browser and Chrome on Android." : "Play with the mouse or touch. No VR or AR device found.");
  } else setMsg(ar ? "Start AR to put the table in your room, or play here with the mouse or touch." : "Start VR to play with your hands, or play here with the mouse or touch.");
})();

// Local dev server only (web/serve.py sets BEACON_DEV_LOG): a handle for devtools and tests.
if (window.BEACON_DEV_LOG) window.__play = { kit, objects, sound, pointer, xrHands, frame, cam, step, rayAt, buildScene, state };

resize();
// Small screens: fold the panel to one row until it's opened.
const panel = document.querySelector(".panel");
$("fold").addEventListener("click", () => {
  const folded = panel.classList.toggle("folded");
  $("fold").textContent = folded ? "▾" : "▴";
  $("fold").setAttribute("aria-expanded", String(!folded));
});
if (window.innerWidth < 600) $("fold").click();
requestAnimationFrame(previewFrame);
