// Music Beacon XR in AR and VR (WebXR), with a plain 3D preview for screens.
//
// AR (immersive-ar: Chrome on Android, Quest Browser with passthrough): the
// test grid is laid on your floor at a scale you pick, and your phone or
// headset is the listener: walk around the room to move between beacons.
// VR (immersive-vr: Quest Browser, PC VR browsers, Vision Pro): the same, in a
// dark room. Preview (any browser): first person, WASD / arrows to walk,
// drag to look.
//
// Position comes from ListenerKit (src/input/listener.js): a pose source in
// XR, keyboard / gamepad in the preview. The music is the same BeaconEngine as
// the main page.

import { makeGridField } from "./beacons.js";
import { BeaconEngine } from "./engine.js";
import { ListenerInput, planarSpace, keyboardSource, poseSource } from "./input/listener.js";
import { Renderer, mat4, hexColor } from "./ar/gl.js";
import { worldOf as worldOfIn, fieldOf as fieldOfIn, placeAt as placeAtIn, SCALES } from "./ar/placement.js";

const $ = (id) => document.getElementById(id);
const MOOD_COLOR = { Drift: "#8fa7ff", Glow: "#f5c04a", Tide: "#2ec4b6", Pulse: "#ff4f9a", Rush: "#ff8a3d" };
const ACCENT = hexColor("#ffb547");
const BG = [0.043, 0.063, 0.086, 1];
const WALK_REAL = 1.4; // preview walking speed, real meters per second
const EYE = 1.6;

const field = makeGridField(5, 100);
const engine = new BeaconEngine(field);
const state = {
  scale: 1 / 50,
  yaw: 0, pitch: -0.25, // preview camera
  anchor: { x: 0, y: 0, z: 0 }, theta: 0, // field placement in the XR floor space
  session: null, mode: null, refSpace: null, hitSource: null, reticle: null,
  needPlace: true, xrPos: null, flashes: new Map(),
};

// ---------------------------------------------------------------- field <-> world

const worldOf = (p, y = 0) => worldOfIn(state, p, y);
const fieldOf = (wx, wz) => fieldOfIn(state, wx, wz);
const placeAt = (...a) => placeAtIn(state, ...a);

// ---------------------------------------------------------------- listener

const input = new ListenerInput({ space: planarSpace({ half: 250, margin: 20 }), position: { x: -38, y: 27 }, speed: () => WALK_REAL / state.scale });
input.on("moved", (p) => engine.setPosition(p));
input.on("action", (name) => { if (name === "toggle_play") togglePlay(); });
engine.setPosition(input.position);

// Preview: keys walk relative to where the camera looks.
const keys = keyboardSource(window, { wanderKey: true });
const lookKeys = {
  name: "look-keys",
  attach: (li) => keys.attach(li),
  detach: () => keys.detach(),
  moveIntent: () => {
    const [kx, ky] = keys.moveIntent();
    if (!kx && !ky) return null;
    const c = Math.cos(state.yaw - state.theta), s = Math.sin(state.yaw - state.theta);
    return [kx * c - ky * s, kx * s + ky * c];
  },
};
input.add(lookKeys);
// XR: the viewer's floor position is the listener.
const pose = poseSource(() => state.xrPos, (x, z) => ({ x, y: z }));

// ---------------------------------------------------------------- scene

function buildScene(now) {
  const s = state.scale;
  const boxes = [];
  const lines = [];
  const line = (a, b, col) => { lines.push(...a, 0, 1, 0, ...col, ...b, 0, 1, 0, ...col); };
  // Floor grid: a line every 100 m through the beacons, and the field's edge.
  const gridCol = state.mode === "immersive-ar" ? [0.6, 0.75, 0.9, 0.55] : [0.35, 0.45, 0.55, 0.6];
  for (let k = -250; k <= 250; k += 50) {
    const col = k % 100 === 0 || Math.abs(k) === 250 ? gridCol : [gridCol[0], gridCol[1], gridCol[2], gridCol[3] * 0.35];
    line(worldOf({ x: k, y: -250 }, 0.002), worldOf({ x: k, y: 250 }, 0.002), col);
    line(worldOf({ x: -250, y: k }, 0.002), worldOf({ x: 250, y: k }, 0.002), col);
  }
  const weights = new Map(engine.active.map((a) => [a.id, a.w]));
  // Keep pillars readable at small scales: at least 6 cm wide and 25 cm tall.
  const wide = Math.max(10 * s, 0.06), tall = Math.max(14 * s, 0.25);
  for (const b of field.beacons) {
    const w = weights.get(b.id) || 0;
    const f = Math.max(0, 1 - (now - (state.flashes.get(b.id) || -1e9)) / 250);
    const song = engine.songFor(b);
    const col = hexColor(MOOD_COLOR[song.mood] || "#ffffff");
    const [x, y, z] = worldOf(b.pos);
    const k = 1 + 0.6 * w;
    boxes.push({ m: mat4.trs(x, y, z, state.theta, wide * k, tall * (1 + w), wide * k), color: col, glow: 0.15 + 1.2 * w + 1.5 * f });
    if (b.id === engine.harmony.id) boxes.push({ m: mat4.trs(x, y, z, state.theta, wide * 2.2, Math.max(0.004, tall * 0.03), wide * 2.2), color: [col[0], col[1], col[2], 0.6], glow: 0.8 });
  }
  // Blend lines from the listener to the three beacons.
  const from = worldOf(input.position, 0.01);
  for (const a of engine.active) {
    const col = hexColor(MOOD_COLOR[a.song.mood] || "#ffffff", 0.25 + 0.75 * a.w);
    line(from, worldOf(a.beacon.pos, tall * 0.5), col);
  }
  if (!state.session || state.mode === "immersive-vr") {
    // Listener marker (in XR you are the listener, but in VR a floor ring helps).
    const [x, y, z] = from;
    boxes.push({ m: mat4.trs(x, y, z, 0, wide * 0.8, Math.max(0.003, tall * 0.02), wide * 0.8), color: ACCENT, glow: 0.6 });
  }
  if (state.reticle) {
    const [x, y, z] = state.reticle;
    boxes.push({ m: mat4.trs(x, y, z, 0, 0.12, 0.004, 0.12), color: [1, 1, 1, 0.8], glow: 0.5 });
  }
  return { boxes, lines: new Float32Array(lines) };
}

// ---------------------------------------------------------------- readout

function renderStatus() {
  const h = engine.harmony.song;
  const rows = engine.active.map((a) => `<li><b>${a.beacon.label}</b> ${esc(a.song.title)} <span>${Math.round(a.w * 100)}%</span></li>`).join("");
  $("status").innerHTML = `<div class="key">${engine.running ? "▶" : "■"} ${h ? esc(h.title) : ""} · ${Math.round(engine.bpm)} BPM</div><ul>${rows}</ul>`;
  $("play").textContent = engine.running ? "■ Stop" : "▶ Play";
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function setMsg(t, err = false) { $("msg").textContent = t; $("msg").classList.toggle("err", err); }

async function togglePlay() {
  if (engine.running) engine.stop();
  else {
    try { await engine.start(); } catch (e) { setMsg("Audio couldn't start: " + e.message, true); }
  }
  renderStatus();
}

// ---------------------------------------------------------------- preview (no XR)

const canvas = $("view");
const gl = canvas.getContext("webgl", { xrCompatible: true, antialias: true, alpha: true });
const renderer = gl ? new Renderer(gl) : null;
if (!gl) setMsg("This browser has no WebGL, so the 3D view can't run.", true);

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}
new ResizeObserver(resize).observe(canvas);

let drag = null;
canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  state.yaw -= (e.clientX - drag[0]) * 0.005;
  state.pitch = Math.max(-1.4, Math.min(1.2, state.pitch - (e.clientY - drag[1]) * 0.005));
  drag = [e.clientX, e.clientY];
});
canvas.addEventListener("pointerup", () => { drag = null; });

let last = performance.now();
function previewFrame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.session) {
    input.tick(dt);
    takeFlashes(now);
    if (renderer && canvas.width) {
      const eye = worldOf(input.position, EYE);
      const proj = mat4.perspective(1.1, canvas.width / canvas.height, 0.02, 200);
      renderer.draw(buildScene(now), proj, mat4.fps(eye, state.yaw, state.pitch), { x: 0, y: 0, width: canvas.width, height: canvas.height }, { clear: BG });
    }
    if (now - (previewFrame.t || 0) > 150) { previewFrame.t = now; renderStatus(); }
  }
  requestAnimationFrame(previewFrame);
}

function takeFlashes(now) {
  for (const ev of engine.takeSounding()) state.flashes.set(ev.id, now);
}

// ---------------------------------------------------------------- XR

async function supported(mode) {
  try { return !!navigator.xr && (await navigator.xr.isSessionSupported(mode)); } catch { return false; }
}

async function startXR(mode) {
  if (state.session || !gl) return;
  // Ask for the session first: browsers only allow it straight from the tap.
  const want = navigator.xr.requestSession(mode, {
    requiredFeatures: ["local-floor"],
    optionalFeatures: ["hit-test", "dom-overlay"],
    domOverlay: { root: $("overlay") },
  });
  if (!engine.running) togglePlay();
  let session;
  try { session = await want; } catch (e) { setMsg(`Couldn't start ${mode === "immersive-ar" ? "AR" : "VR"}: ${e.message}`, true); return; }
  state.session = session;
  state.mode = mode;
  state.needPlace = true;
  document.body.classList.add("in-xr", mode === "immersive-ar" ? "in-ar" : "in-vr");
  await gl.makeXRCompatible();
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
  state.refSpace = await session.requestReferenceSpace("local-floor");
  if (session.requestHitTestSource) {
    try {
      const viewer = await session.requestReferenceSpace("viewer");
      state.hitSource = await session.requestHitTestSource({ space: viewer });
    } catch { state.hitSource = null; }
  }
  input.sources.unshift(pose);
  session.addEventListener("select", onSelect);
  session.addEventListener("squeeze", () => cycleScale(1));
  session.addEventListener("end", endXR);
  setMsg(mode === "immersive-ar"
    ? "Walk around to move between beacons. Tap a spot on the floor to put the middle of the field there."
    : "Walk around to move between beacons. Trigger re-centers the field on you, grip changes the scale.");
  state.lastXR = null;
  session.requestAnimationFrame(xrFrame);
}

function endXR() {
  state.session = null;
  state.mode = null;
  state.hitSource = null;
  state.reticle = null;
  state.xrPos = null;
  input.remove(pose);
  document.body.classList.remove("in-xr", "in-ar", "in-vr");
  setMsg("Left XR. The preview keeps your place in the field.");
}

function onSelect() {
  if (state.reticle) {
    // Put the field's middle on the tapped floor spot, keeping its heading.
    const [x, y, z] = state.reticle;
    const w = worldOf({ x: 0, y: 0 }, 0);
    state.anchor = { x: state.anchor.x + x - w[0], y, z: state.anchor.z + z - w[2] };
  } else {
    state.needPlace = true;
  }
}

function cycleScale(dir) {
  const i = SCALES.findIndex((v) => Math.abs(v - state.scale) < 1e-9);
  setScale(SCALES[(i + dir + SCALES.length) % SCALES.length]);
}

/** Changes the scale around the listener, so you stay on the same field spot. */
function setScale(s) {
  const head = worldOf(input.position, 0);
  state.scale = s;
  const w = worldOf(input.position, 0);
  state.anchor = { x: state.anchor.x + head[0] - w[0], y: state.anchor.y, z: state.anchor.z + head[2] - w[2] };
  $("scale").value = String(s);
}

function xrFrame(t, frame) {
  const session = frame.session;
  if (session !== state.session) return;
  session.requestAnimationFrame(xrFrame);
  const dt = state.lastXR == null ? 0 : Math.min(0.1, (t - state.lastXR) / 1000);
  state.lastXR = t;
  const vp = frame.getViewerPose(state.refSpace);
  if (vp) {
    const m = vp.transform.matrix;
    const hx = m[12], hz = m[14];
    if (state.needPlace) {
      placeAt(input.position, hx, 0, hz, -m[8], -m[10]);
      state.needPlace = false;
    }
    state.xrPos = (() => { const p = fieldOf(hx, hz); return { x: p.x, z: p.y }; })();
  }
  if (state.hitSource) {
    const hits = frame.getHitTestResults(state.hitSource);
    const hp = hits.length ? hits[0].getPose(state.refSpace) : null;
    state.reticle = hp ? [hp.transform.position.x, hp.transform.position.y, hp.transform.position.z] : null;
  }
  input.tick(dt);
  const now = performance.now();
  takeFlashes(now);
  const layer = session.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  const ar = state.mode === "immersive-ar";
  gl.clearColor(...(ar ? [0, 0, 0, 0] : BG));
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (vp) {
    const scene = buildScene(now);
    for (const view of vp.views) renderer.draw(scene, view.projectionMatrix, view.transform.inverse.matrix, layer.getViewport(view));
  }
  if (now - (xrFrame.t || 0) > 200) { xrFrame.t = now; renderStatus(); }
}

// ---------------------------------------------------------------- UI

for (const s of SCALES) {
  const o = document.createElement("option");
  o.value = String(s);
  o.textContent = s === 1 ? "Life size (1:1)" : `1:${Math.round(1 / s)} (field is ${+(500 * s).toFixed(1)} m across)`;
  $("scale").append(o);
}
$("scale").value = String(state.scale);
$("scale").addEventListener("change", (e) => setScale(+e.target.value));
$("play").addEventListener("click", togglePlay);
$("recenter").addEventListener("click", () => { state.needPlace = true; if (!state.session) state.yaw = state.theta; });
$("exit").addEventListener("click", () => state.session?.end());
$("vol").addEventListener("input", (e) => engine.setVolume(+e.target.value));

(async () => {
  const [ar, vr] = await Promise.all([supported("immersive-ar"), supported("immersive-vr")]);
  $("startAR").disabled = !ar;
  $("startVR").disabled = !vr;
  $("startAR").addEventListener("click", () => startXR("immersive-ar"));
  $("startVR").addEventListener("click", () => startXR("immersive-vr"));
  if (!ar && !vr) {
    setMsg(!window.isSecureContext
      ? "AR and VR need a secure page: use https (python web/serve.py --https) or localhost. The preview below works anywhere."
      : !navigator.xr
        ? "This browser has no WebXR. AR works in Chrome on Android and in the Quest Browser; VR in the Quest Browser and PC VR browsers. Walk the preview with WASD and drag to look."
        : "No AR or VR device found. Walk the preview with WASD and drag to look.");
  } else if (!ar) setMsg("VR is available here; AR needs Chrome on Android or the Quest Browser.");
  else setMsg("Pick a scale, then Start AR. Stand in an open space: the field is laid out around you.");
})();

// Local dev server only (web/serve.py sets BEACON_DEV_LOG): a handle for devtools and tests.
if (window.BEACON_DEV_LOG) window.__ar = { engine, input, state, buildScene, worldOf, fieldOf, placeAt, setScale, frame: previewFrame, canvas };

resize();
renderStatus();
requestAnimationFrame(previewFrame);
