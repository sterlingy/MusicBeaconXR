// Synths page: play and shape each of the six browser instruments by hand,
// browse their presets and animate their parameters. Uses the same
// instrument code as Chord Master XR (synths.js), so a sound made here sounds the
// same in a song. A sound is the song format's track `params` plus `automation`.

import { Bus, makeInstruments } from "./synths.js";
import { SPEC, INSTRUMENTS as NAMES, controls, control, isChoice, defaults, automatable, automate, clampParam, checkAutomation, SHAPES, RATES } from "./params.js";
import { PRESETS, presetSound } from "./presets.js";

const $ = (id) => document.getElementById(id);

const NOTE_LEN = { Pulsar: 0.2, Undertow: 0.3, Lumen: 1.2, Comet: 0.4, Driftwood: 0.5, Tangle: 2.5 };
const BASE_OCT = { Undertow: 2, Lumen: 4, Comet: 5, Driftwood: 4, Tangle: 3 };
const DRUMS = [["kick", "Kick", "A"], ["snare", "Snare", "S"], ["clap", "Clap", "D"], ["hat", "Hat", "F"], ["open", "Open hat", "G"]];
const KEYS = "AWSEDFTGYHUJK"; // C to C on a computer keyboard
const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const SHAPE_LABEL = { sine: "Sine", triangle: "Triangle", saw: "Saw up", ramp: "Saw down", square: "Square", random: "Random steps", drift: "Drift" };
const rateLabel = (b) => b < 1 ? `1/${1 / b} bar` : `${b} bar${b === 1 ? "" : "s"}`;
const CHANNEL_PARAMS = ["reverb.send", "delay.send", "chorus.mix", "master.drive", "drive"];

// Demo loops, 16th steps over 4 bars, C minor.
const CHORDS = [[48, 51, 55], [44, 48, 51], [51, 55, 58], [46, 50, 53]]; // Cm Ab Eb Bb
const ROOTS = [36, 32, 39, 34];
function loopEvents(name, bar, s) {
  const root = ROOTS[bar % 4], ch = CHORDS[bar % 4];
  if (name === "Pulsar") {
    const out = [];
    if ([0, 7, 8, 10].includes(s) && (s !== 7 || bar % 2)) out.push(["kick", 0.95]);
    if (s === 4 || s === 12) out.push(["snare", 0.85]);
    if (s === 12 && bar % 2) out.push(["clap", 0.6]);
    if (s % 2 === 0 && s !== 14) out.push(["hat", s % 4 ? 0.45 : 0.7]);
    if (s === 14) out.push(["open", 0.55]);
    return out.map(([v, vel]) => ({ voice: v, vel }));
  }
  if (name === "Undertow") {
    const pat = { 0: 0, 3: 0, 6: 12, 8: 0, 10: 7, 13: 0, 14: 10 };
    return s in pat ? [{ notes: [root + pat[s]], len: s === 6 || s === 14 ? 1 : 2, vel: s % 4 ? 0.7 : 0.9 }] : [];
  }
  if (name === "Lumen") return s === 0 ? [{ notes: ch.map((m) => m + 12), len: 14, vel: 0.7 }] : s === 10 && bar % 2 ? [{ notes: ch.map((m) => m + 12), len: 4, vel: 0.55 }] : [];
  if (name === "Comet") {
    const mel = [[0, 72, 3], [3, 70, 1], [4, 67, 2], [6, 70, 2], [8, 72, 4], [12, 75, 2], [14, 74, 2]];
    const e = mel.find(([st]) => st === s);
    return e && bar % 2 === 0 ? [{ notes: [e[1] + (bar === 2 ? -2 : 0)], len: e[2], vel: 0.75 }] : [];
  }
  if (name === "Driftwood") {
    const arp = [0, 1, 2, 1];
    return s % 2 === 0 ? [{ notes: [ch[arp[(s / 2) % 4]] + 24 + (s >= 8 && s < 12 ? 12 : 0)], len: 1, vel: 0.6 + 0.2 * (s % 4 === 0) }] : [];
  }
  if (name === "Tangle") return s === 0 ? [{ notes: [root + 24], len: 16, vel: 0.7 }] : [];
  return [];
}

// ---------------------------------------------------------------- state

const state = {
  name: NAMES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "Lumen",
  params: {}, auto: {}, preset: {}, // per instrument
  open: null, // param id whose automation row is open
  oct: 0,
  chord: false,
  noteLen: { ...NOTE_LEN },
  loop: false,
  bpm: 100,
};

/** Keeps only known params, clamped into range. */
function cleanParams(n, src) {
  const p = defaults(n);
  for (const [k, v] of Object.entries(src || {})) if (control(n, k)) p[k] = clampParam(n, k, v);
  return p;
}
function cleanAuto(n, src) {
  const out = {};
  for (const [k, a] of Object.entries(src || {})) if (!checkAutomation(n, { [k]: a }).length) out[k] = { shape: a.shape, bars: +a.bars, depth: +a.depth, phase: +a.phase || 0 };
  return out;
}
function load(n) {
  try {
    const v = JSON.parse(localStorage.getItem(`beacon.synth.${n}`));
    if (!v || typeof v !== "object") return null;
    if (!v.params) return { params: cleanParams(n, v), auto: {}, preset: null }; // saved by the first version of this page
    return { params: cleanParams(n, v.params), auto: cleanAuto(n, v.automation), preset: v.preset || null };
  } catch { return null; }
}
function save(n) {
  try { localStorage.setItem(`beacon.synth.${n}`, JSON.stringify({ params: state.params[n], automation: state.auto[n], preset: state.preset[n] })); } catch {}
}
for (const n of NAMES) {
  const v = load(n);
  if (v) { state.params[n] = v.params; state.auto[n] = v.auto; state.preset[n] = v.preset; }
  else { const s = presetSound(n, PRESETS[n][0]); state.params[n] = s.params; state.auto[n] = s.automation; state.preset[n] = `f:0`; }
}

// User presets, per instrument, in this browser.
function userPresets(n) {
  try { const v = JSON.parse(localStorage.getItem(`beacon.synthPresets.${n}`)); return Array.isArray(v) ? v : []; } catch { return []; }
}
function saveUserPresets(n, list) {
  try { localStorage.setItem(`beacon.synthPresets.${n}`, JSON.stringify(list)); return true; } catch { return false; }
}
/** All presets for the picker: factory ("f:i") then yours ("u:i"). */
function presetList(n) {
  return [...PRESETS[n].map((p, i) => ({ key: `f:${i}`, name: p.name, factory: true, p })), ...userPresets(n).map((p, i) => ({ key: `u:${i}`, name: p.name, factory: false, p }))];
}

// A sound handed over from Chord Master XR (clicking an instrument there).
let handoffNote = "";
try {
  const h = JSON.parse(localStorage.getItem("beacon.synthHandoff"));
  if (h && SPEC[h.instrument] && h.params && Date.now() - (h.at || 0) < 60000) {
    const n = h.instrument;
    state.name = n;
    state.params[n] = cleanParams(n, { ...state.params[n], ...h.params });
    state.auto[n] = cleanAuto(n, h.automation);
    state.preset[n] = null;
    save(n);
    handoffNote = `Loaded the sound ${n} was playing in Chord Master XR${h.from ? ` (${h.from})` : ""}.`;
  }
  localStorage.removeItem("beacon.synthHandoff");
} catch {}

// ---------------------------------------------------------------- audio

let ctx = null, bus = null, inst = null;
// Automation clock: audio time -> beats at the current tempo.
let anchor = { t: 0, beat: 0, bpm: state.bpm };
const beatAt = (t) => anchor.beat + ((t - anchor.t) * anchor.bpm) / 60;
function setBpm(bpm) {
  if (ctx) anchor = { t: ctx.currentTime, beat: beatAt(ctx.currentTime), bpm };
  else anchor.bpm = bpm;
  state.bpm = bpm;
  if (bus) bus.setTempo(bpm);
}

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    anchor = { t: ctx.currentTime, beat: 0, bpm: state.bpm };
    bus = new Bus(ctx);
    bus.setTempo(state.bpm);
    inst = makeInstruments(bus);
    for (const n of NAMES) apply(n);
    drawScope();
    setInterval(channelTick, 40);
  }
  if (ctx.state !== "running") ctx.resume();
  return ctx;
}

const instFor = (n) => inst[SPEC[n].role];
function apply(n) {
  if (!inst) return;
  const i = instFor(n);
  i.setParams(state.params[n]);
  i.setAutomation(state.auto[n], beatAt);
  inst.channels[SPEC[n].role].set("level", n === state.name ? 0.85 : 0, 0.02);
  i.applyChannel(ctx.currentTime, 0.05);
}
/** Automated sends, chorus and drive move continuously. */
function channelTick() {
  const n = state.name, a = state.auto[n];
  if (a && CHANNEL_PARAMS.some((k) => a[k])) instFor(n).applyChannel(ctx.currentTime + 0.04, 0.03);
}

function play(n, ev, t, stepDur) {
  const i = instFor(n);
  if (n === "Pulsar") return i.hit(ev.voice, t, ev.vel);
  const dur = ev.len != null ? ev.len * stepDur * 0.95 : state.noteLen[n];
  if (n === "Lumen") return i.chord(ev.notes, t, dur, ev.vel);
  for (const m of ev.notes) i.note(m, t, dur, ev.vel);
}

function playNote(midi, vel = 0.8) {
  const c = audio();
  const n = state.name;
  if (n === "Pulsar") return;
  const notes = state.chord ? [midi, midi + 3, midi + 7] : [midi]; // minor triad
  play(n, { notes, vel }, c.currentTime + 0.005);
  flashKey(midi);
}
function hitDrum(voice, vel = 0.9) {
  const c = audio();
  instFor("Pulsar").hit(voice, c.currentTime + 0.005, vel);
  const pad = document.querySelector(`[data-voice="${voice}"]`);
  if (pad) { pad.classList.add("on"); setTimeout(() => pad.classList.remove("on"), 120); }
}

// Loop scheduler: 25 ms tick, 120 ms look-ahead.
let next = 0, step = 0, timer = null;
function startLoop() {
  const c = audio();
  next = c.currentTime + 0.06; step = 0;
  anchor = { t: next, beat: 0, bpm: state.bpm }; // automation restarts with the loop
  timer = setInterval(tick, 25);
}
function stopLoop() { clearInterval(timer); timer = null; }
function tick() {
  const spb = 60 / state.bpm / 4;
  if (next < ctx.currentTime - 0.2) next = ctx.currentTime + 0.05; // after a stall, skip ahead
  while (next < ctx.currentTime + 0.12) {
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    for (const ev of loopEvents(state.name, bar, s)) play(state.name, ev, next, spb);
    const t = next, cur = s;
    setTimeout(() => showStep(cur), Math.max(0, (t - ctx.currentTime) * 1000));
    next += spb; step++;
  }
}

// ---------------------------------------------------------------- UI

function fmt(v, c) {
  if (typeof v !== "number") return String(v);
  const unit = c[6]?.unit || "";
  if (unit === "Hz" && v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz`;
  const dec = c[4] >= 1 ? 0 : c[4] >= 0.1 ? 1 : c[4] >= 0.01 ? 2 : 3;
  return `${(+v).toFixed(dec)}${unit ? " " + unit : ""}`;
}
// Sliders run 0..1000; log controls map that range exponentially.
const toSlider = (v, c) => c[6]?.log ? 1000 * Math.log(v / c[2]) / Math.log(c[3] / c[2]) : 1000 * (v - c[2]) / (c[3] - c[2]);
function fromSlider(x, c) {
  let v = c[6]?.log ? c[2] * Math.pow(c[3] / c[2], x / 1000) : c[2] + (x / 1000) * (c[3] - c[2]);
  v = Math.round(v / c[4]) * c[4];
  return +Math.max(c[2], Math.min(c[3], v)).toFixed(4);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

function renderTabs() {
  $("tabs").innerHTML = NAMES.map((n) => `<a href="#${n}" role="tab" aria-selected="${n === state.name}" data-name="${n}">${n}<small>${roleLabel(SPEC[n].role)}</small></a>`).join("");
}
const roleLabel = (r) => r[0].toUpperCase() + r.slice(1);

function renderPresets() {
  const n = state.name, list = presetList(n), cur = state.preset[n];
  const opt = (x) => `<option value="${x.key}"${x.key === cur ? " selected" : ""}>${esc(x.name)}</option>`;
  const yours = list.filter((x) => !x.factory);
  $("preset").innerHTML = (cur ? "" : `<option value="" selected>(edited)</option>`)
    + `<optgroup label="Factory">${list.filter((x) => x.factory).map(opt).join("")}</optgroup>`
    + (yours.length ? `<optgroup label="Yours">${yours.map(opt).join("")}</optgroup>` : "");
  $("presetDelete").hidden = !(cur && cur.startsWith("u:"));
  const i = list.findIndex((x) => x.key === cur);
  $("presetCount").textContent = i >= 0 ? `${i + 1} / ${list.length}` : `${list.length} presets`;
}

function controlRow(n, c) {
  const p = state.params[n], id = c[0];
  if (isChoice(c)) {
    return `<div class="ctl"><span>${c[1]}</span><select data-p="${id}" aria-label="${c[1]}">${c[2].map((o) => `<option${o === p[id] ? " selected" : ""}>${o}</option>`).join("")}</select><output></output><i></i></div>`;
  }
  const can = automatable(n).includes(id), a = state.auto[n][id];
  const row = `<div class="ctl${a ? " animated" : ""}"><span>${c[1]}</span><input type="range" min="0" max="1000" step="1" data-p="${id}" value="${toSlider(p[id], c)}" aria-label="${c[1]}"><output data-out="${id}">${fmt(p[id], c)}</output>`
    + (can ? `<button class="auto" data-auto="${id}" aria-pressed="${!!a}" aria-expanded="${state.open === id}" title="Animate ${c[1]}">∿</button>` : `<i></i>`) + `</div>`;
  if (!can || state.open !== id) return row;
  const cfg = a || { shape: "sine", bars: 4, depth: 0.3, phase: 0 };
  return row + `<div class="autorow" data-for="${id}">
    <label>Shape <select data-a="shape">${SHAPES.map((s) => `<option value="${s}"${s === cfg.shape ? " selected" : ""}>${SHAPE_LABEL[s]}</option>`).join("")}</select></label>
    <label>Every <select data-a="bars">${RATES.map((r) => `<option value="${r}"${r === cfg.bars ? " selected" : ""}>${rateLabel(r)}</option>`).join("")}</select></label>
    <label class="grow">Depth <input type="range" data-a="depth" min="0" max="1" step="0.01" value="${cfg.depth}"><b>${Math.round(cfg.depth * 100)}%</b></label>
    <button class="btn small" data-a="${a ? "off" : "on"}">${a ? "Stop animating" : "Animate"}</button>
  </div>`;
}

function renderPanel() {
  const n = state.name, sp = SPEC[n];
  document.title = `${n} · Chord Master Synths`;
  $("name").textContent = n;
  $("blurb").textContent = sp.blurb;
  $("groups").innerHTML = Object.entries(sp.groups).map(([g, cs]) => `<fieldset><legend>${g}</legend>${cs.map((c) => controlRow(n, c)).join("")}</fieldset>`).join("");
  $("noteLen").value = state.noteLen[n];
  $("noteLenOut").textContent = `${state.noteLen[n].toFixed(2)} s`;
  $("noteLenWrap").hidden = n === "Pulsar";
  $("chordWrap").hidden = n === "Pulsar";
  $("keyboard").hidden = n === "Pulsar";
  $("octWrap").hidden = n === "Pulsar";
  $("pads").hidden = n !== "Pulsar";
  $("playHint").textContent = n === "Pulsar"
    ? "Tap the pads, or press A S D F G."
    : "Tap the keys, or play the row A W S E D F T G Y H U J K. Z and X change octave.";
  const count = Object.keys(state.auto[n]).length;
  $("autoCount").textContent = count ? `${count} animated` : "";
  renderKeyboard();
  renderTabs();
  renderPresets();
  for (const name of NAMES) apply(name);
}

function renderKeyboard() {
  const n = state.name;
  if (n === "Pulsar") {
    $("pads").innerHTML = DRUMS.map(([v, label, key]) => `<button class="pad" data-voice="${v}">${label}<kbd>${key}</kbd></button>`).join("");
    return;
  }
  const base = 12 * ((BASE_OCT[n] ?? 4) + state.oct + 1);
  const whites = [], blacks = [];
  let w = 0;
  for (let k = 0; k <= 24; k++) {
    const m = base + k, pc = m % 12, black = [1, 3, 6, 8, 10].includes(pc);
    const key = k < KEYS.length ? KEYS[k] : "";
    if (black) blacks.push(`<button class="key black" data-midi="${m}" style="left:calc(${w} * var(--kw) - var(--bw) / 2)" aria-label="${NOTE_NAMES[pc]}${Math.floor(m / 12) - 1}">${key ? `<kbd>${key}</kbd>` : ""}</button>`);
    else { whites.push(`<button class="key white" data-midi="${m}" aria-label="${NOTE_NAMES[pc]}${Math.floor(m / 12) - 1}">${pc === 0 ? `<em>C${Math.floor(m / 12) - 1}</em>` : ""}${key ? `<kbd>${key}</kbd>` : ""}</button>`); w++; }
  }
  $("keyboard").style.setProperty("--whites", w);
  $("keyboard").innerHTML = whites.join("") + blacks.join("");
  $("octOut").textContent = `C${(BASE_OCT[n] ?? 4) + state.oct}`;
}
function flashKey(midi) {
  const k = document.querySelector(`.key[data-midi="${midi}"]`);
  if (k) { k.classList.add("on"); setTimeout(() => k.classList.remove("on"), 140); }
}
function showStep(s) {
  const dots = $("steps").children;
  for (let i = 0; i < dots.length; i++) dots[i].classList.toggle("on", i === s && state.loop);
}

/** Animated params show their live value, and the slider's track shows where it is. */
function liveValues() {
  const n = state.name, now = ctx ? ctx.currentTime : performance.now() / 1000;
  for (const [id, a] of Object.entries(state.auto[n])) {
    const c = control(n, id), out = document.querySelector(`[data-out="${CSS.escape(id)}"]`);
    if (!c || !out) continue;
    const v = automate(n, id, state.params[n][id], a, beatAt(now));
    out.textContent = fmt(v, c);
    out.parentElement.style.setProperty("--live", `${(toSlider(v, c) / 10).toFixed(1)}%`);
  }
  requestAnimationFrame(liveValues);
}

function select(n) {
  if (!SPEC[n]) return;
  state.name = n;
  state.open = null;
  if (location.hash.slice(1) !== n) history.replaceState(null, "", `#${n}`);
  renderPanel();
  setMsg("");
}

function setMsg(t) { $("msg").textContent = t; }

/** Any manual change makes the sound "(edited)". */
function edited(n) { state.preset[n] = null; save(n); renderPresets(); }

function loadPreset(key) {
  const n = state.name, item = presetList(n).find((x) => x.key === key);
  if (!item) return;
  const s = item.factory ? presetSound(n, item.p) : { params: cleanParams(n, item.p.params), automation: cleanAuto(n, item.p.automation) };
  state.params[n] = s.params;
  state.auto[n] = s.automation;
  state.preset[n] = key;
  state.open = null;
  save(n);
  renderPanel();
  setMsg(`${item.name}${Object.keys(s.automation).length ? ` · animates ${Object.keys(s.automation).map((k) => control(n, k)[1].toLowerCase()).join(", ")}` : ""}`);
}

// Controls
$("groups").addEventListener("input", (e) => {
  const n = state.name;
  const ar = e.target.closest(".autorow");
  if (ar) {
    const id = ar.dataset.for, a = { ...(state.auto[n][id] || { shape: "sine", bars: 4, depth: 0.3, phase: 0 }) };
    const k = e.target.dataset.a;
    if (k === "depth") { a.depth = +e.target.value; e.target.nextElementSibling.textContent = `${Math.round(a.depth * 100)}%`; }
    else if (k === "bars") a.bars = +e.target.value;
    else if (k === "shape") a.shape = e.target.value;
    else return;
    state.auto[n] = { ...state.auto[n], [id]: a }; // changing a setting turns animation on
    const btn = ar.querySelector('[data-a="on"]');
    if (btn) { btn.dataset.a = "off"; btn.textContent = "Stop animating"; }
    document.querySelector(`[data-auto="${CSS.escape(id)}"]`)?.setAttribute("aria-pressed", "true");
    ar.previousElementSibling.classList.add("animated");
    apply(n);
    edited(n);
    return;
  }
  const id = e.target.dataset.p;
  if (!id) return;
  const c = control(n, id);
  const v = isChoice(c) ? e.target.value : fromSlider(+e.target.value, c);
  state.params[n] = { ...state.params[n], [id]: v };
  if (!isChoice(c)) e.target.nextElementSibling.textContent = fmt(v, c);
  apply(n);
  edited(n);
});
$("groups").addEventListener("click", (e) => {
  const n = state.name;
  const b = e.target.closest("[data-auto]");
  if (b) { state.open = state.open === b.dataset.auto ? null : b.dataset.auto; renderPanel(); return; }
  const t = e.target.closest('[data-a="on"], [data-a="off"]');
  if (!t) return;
  const id = t.closest(".autorow").dataset.for;
  const auto = { ...state.auto[n] };
  if (t.dataset.a === "off") delete auto[id];
  else {
    const row = t.closest(".autorow");
    auto[id] = { shape: row.querySelector('[data-a="shape"]').value, bars: +row.querySelector('[data-a="bars"]').value, depth: +row.querySelector('[data-a="depth"]').value, phase: 0 };
  }
  state.auto[n] = auto;
  apply(n);
  edited(n);
  renderPanel();
});
$("tabs").addEventListener("click", (e) => {
  const a = e.target.closest("[data-name]");
  if (!a) return;
  e.preventDefault();
  select(a.dataset.name);
});
window.addEventListener("hashchange", () => select(location.hash.slice(1)));

// Presets
$("preset").addEventListener("change", (e) => { if (e.target.value) loadPreset(e.target.value); });
function stepPreset(d) {
  const list = presetList(state.name);
  const i = list.findIndex((x) => x.key === state.preset[state.name]);
  const j = i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length;
  loadPreset(list[j].key);
}
$("presetPrev").addEventListener("click", () => stepPreset(-1));
$("presetNext").addEventListener("click", () => stepPreset(1));
$("presetSave").addEventListener("click", () => {
  $("saveRow").hidden = !$("saveRow").hidden;
  if (!$("saveRow").hidden) { $("saveName").value = ""; $("saveName").focus(); }
});
$("saveRow").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = state.name, name = $("saveName").value.trim().slice(0, 40);
  if (!name) return;
  const list = userPresets(n).filter((p) => p.name !== name);
  list.push({ name, params: state.params[n], automation: state.auto[n] });
  if (!saveUserPresets(n, list)) return setMsg("Couldn't save here (this browser blocks storage).");
  state.preset[n] = `u:${list.length - 1}`;
  save(n);
  $("saveRow").hidden = true;
  renderPresets();
  setMsg(`Saved "${name}" to your ${n} presets.`);
});
$("presetDelete").addEventListener("click", () => {
  const n = state.name, key = state.preset[n];
  if (!key?.startsWith("u:")) return;
  const list = userPresets(n), [gone] = list.splice(+key.slice(2), 1);
  saveUserPresets(n, list);
  state.preset[n] = null;
  save(n);
  renderPresets();
  setMsg(`Deleted "${gone?.name}". The sound stays loaded until you change it.`);
});

// Keyboard and pads (pointer)
let down = false;
$("keyboard").addEventListener("pointerdown", (e) => {
  const k = e.target.closest(".key");
  if (!k) return;
  down = true;
  e.preventDefault();
  playNote(+k.dataset.midi);
});
$("keyboard").addEventListener("pointerover", (e) => {
  const k = e.target.closest(".key");
  if (down && k && e.buttons) playNote(+k.dataset.midi, 0.7); // glissando
});
window.addEventListener("pointerup", () => { down = false; });
$("pads").addEventListener("pointerdown", (e) => {
  const p = e.target.closest(".pad");
  if (!p) return;
  e.preventDefault();
  hitDrum(p.dataset.voice);
});

// Computer keyboard
const held = new Set();
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== "range") return;
  const key = e.key.toUpperCase();
  if (state.name === "Pulsar") {
    const d = DRUMS.find((x) => x[2] === key);
    if (d) { hitDrum(d[0]); e.preventDefault(); }
    return;
  }
  if (key === "Z" || key === "X") { state.oct = Math.max(-2, Math.min(2, state.oct + (key === "X" ? 1 : -1))); renderKeyboard(); return; }
  const k = KEYS.indexOf(key);
  if (k >= 0 && !held.has(key)) {
    held.add(key);
    playNote(12 * ((BASE_OCT[state.name] ?? 4) + state.oct + 1) + k);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => held.delete(e.key.toUpperCase()));

$("octDown").addEventListener("click", () => { state.oct = Math.max(-2, state.oct - 1); renderKeyboard(); });
$("octUp").addEventListener("click", () => { state.oct = Math.min(2, state.oct + 1); renderKeyboard(); });
$("chord").addEventListener("click", () => {
  state.chord = !state.chord;
  $("chord").setAttribute("aria-pressed", state.chord);
});
$("noteLen").addEventListener("input", (e) => {
  state.noteLen[state.name] = +e.target.value;
  $("noteLenOut").textContent = `${(+e.target.value).toFixed(2)} s`;
});
$("loop").addEventListener("click", () => {
  state.loop = !state.loop;
  $("loop").textContent = state.loop ? "■ Stop loop" : "▶ Play loop";
  $("loop").setAttribute("aria-pressed", state.loop);
  if (state.loop) startLoop(); else { stopLoop(); showStep(-1); }
});
$("bpm").addEventListener("input", (e) => {
  setBpm(+e.target.value);
  $("bpmOut").textContent = state.bpm;
});
$("vol").addEventListener("input", (e) => { audio(); bus.master.gain.setTargetAtTime(+e.target.value, ctx.currentTime, 0.05); });

// Reset, random, copy, paste
$("reset").addEventListener("click", () => {
  const n = state.name;
  state.params[n] = defaults(n); state.auto[n] = {}; state.preset[n] = null; state.open = null;
  save(n); renderPanel(); setMsg(`${n} is back to its plain default sound, with nothing animated.`);
});
$("random").addEventListener("click", () => {
  const n = state.name, p = {};
  // Start from a random preset and push every control somewhere new, so it stays musical but different.
  const base = presetSound(n, PRESETS[n][Math.floor(Math.random() * PRESETS[n].length)]);
  for (const c of controls(n)) {
    if (isChoice(c)) p[c[0]] = Math.random() < 0.5 ? base.params[c[0]] : c[2][Math.floor(Math.random() * c[2].length)];
    else p[c[0]] = fromSlider(Math.max(0, Math.min(1000, toSlider(base.params[c[0]], c) + (Math.random() - 0.5) * 400)), c);
  }
  const auto = {};
  const can = automatable(n);
  for (let k = Math.floor(Math.random() * 3); k > 0; k--) {
    const id = can[Math.floor(Math.random() * can.length)];
    auto[id] = { shape: SHAPES[Math.floor(Math.random() * SHAPES.length)], bars: RATES[1 + Math.floor(Math.random() * 5)], depth: Math.round((0.15 + Math.random() * 0.35) * 100) / 100, phase: 0 };
  }
  state.params[n] = p; state.auto[n] = auto; state.preset[n] = null; state.open = null;
  save(n); renderPanel();
  setMsg(`A random sound${Object.keys(auto).length ? ` with ${Object.keys(auto).length} animated control${Object.keys(auto).length > 1 ? "s" : ""}` : ""}. Save it if you like it.`);
});
$("copy").addEventListener("click", async () => {
  const n = state.name, item = presetList(n).find((x) => x.key === state.preset[n]);
  const text = JSON.stringify({ instrument: n, preset: item?.name, params: state.params[n], automation: state.auto[n] }, null, 2);
  try { await navigator.clipboard.writeText(text); setMsg("Copied. params and automation fit a song track (Paste JSON in Chord Master XR)."); }
  catch { $("json").value = text; $("json").hidden = false; $("json").select(); setMsg("Copy the text below."); }
});
$("paste").addEventListener("click", () => {
  $("json").hidden = !$("json").hidden;
  $("applyJson").hidden = $("json").hidden;
  if (!$("json").hidden) { $("json").value = ""; $("json").focus(); setMsg("Paste a sound (or a song track) and press Apply."); }
});
$("applyJson").addEventListener("click", () => {
  try {
    const v = JSON.parse($("json").value);
    const n = SPEC[v.instrument] ? v.instrument : state.name;
    const src = v.params || v;
    const used = Object.keys(src).filter((k) => control(n, k)).length;
    if (!used) throw new Error(`no ${n} params in it`);
    state.params[n] = cleanParams(n, src);
    state.auto[n] = cleanAuto(n, v.automation);
    state.preset[n] = null;
    save(n);
    $("json").hidden = true; $("applyJson").hidden = true;
    select(n);
    setMsg(`Loaded ${used} ${n} settings${Object.keys(state.auto[n]).length ? ` and ${Object.keys(state.auto[n]).length} animations` : ""}.`);
  } catch (err) { setMsg(`Couldn't use that: ${err.message}`); }
});

// Scope
function drawScope() {
  const cv = $("scope"), g = cv.getContext("2d");
  const a = new Float32Array(bus.analyser.fftSize);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ffb547";
  (function frame() {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth * dpr, h = cv.clientHeight * dpr;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    bus.analyser.getFloatTimeDomainData(a);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = accent; g.lineWidth = 1.5 * dpr;
    g.beginPath();
    let start = 0;
    for (let i = 1; i < a.length / 2; i++) if (a[i - 1] < 0 && a[i] >= 0) { start = i; break; } // steady trace
    const n = a.length / 2;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w, y = h / 2 - a[start + i] * h * 0.45;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    requestAnimationFrame(frame);
  })();
}

// Phones: resume audio when the page comes back.
document.addEventListener("visibilitychange", () => { if (!document.hidden && ctx && ctx.state !== "running") ctx.resume(); });

$("steps").innerHTML = Array.from({ length: 16 }, (_, i) => `<i${i % 4 === 0 ? ' class="beat"' : ""}></i>`).join("");
renderPanel();
requestAnimationFrame(liveValues);
if (handoffNote) setMsg(handoffNote);
