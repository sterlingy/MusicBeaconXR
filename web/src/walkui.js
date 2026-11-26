// Walks: the trail of where you've been, walk recordings (path + blend +
// songs, src/walk.js), replaying them with the same music, editing their
// songs, and exporting the sound as WAV or MP3. Recordings are kept on this
// device (IndexedDB) and can be downloaded and imported as files.
//
// Exports play the walk in real time while recording the final mix (the
// player's own instruments, after the compressor), then encode it.

import * as W from "./walk.js";
import { Harmony } from "./mixer.js";

// lamejs, the MP3 encoder, loaded only when someone exports an MP3.
const LAME_URL = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";
const TRAIL_SAVE_MS = 10000;

/**
 * `ctx`: {engine, ui, $, esc, setMsg, setMode, centerLocal, select, store (DraftStore, maybe loading), fmtDist,
 *         moodColor, stopFollow, renderInspector, togglePlay}
 */
export function initWalks(ctx) {
  const { engine, ui, $, esc } = ctx;
  const msg = (t, err = false) => ctx.setMsg("wMsg", t, err);
  const st = {
    trails: {}, // field kind -> Trail
    showTrail: (() => { try { return localStorage.getItem("beacon.trailOn") !== "0"; } catch { return true; } })(),
    savedAt: 0,
    recorder: null, recStart: 0,
    list: [],
    replay: null, // {rec, start (perf ms), from (s), export?: {...}}
    audio: null, // live capture: {chunks, stop, started}
    saveTimer: 0,
  };
  const walks = () => ctx.store().walks();

  // ---------------------------------------------------------------- trail

  function trail(kind = engine.field.kind) {
    if (!st.trails[kind]) {
      let pts = [];
      try { pts = JSON.parse(localStorage.getItem(`beacon.trail.${kind}`) || "[]"); } catch {}
      st.trails[kind] = new W.Trail(Array.isArray(pts) ? pts : []);
    }
    return st.trails[kind];
  }

  function saveTrails(force = false) {
    if (!force && Date.now() - st.savedAt < TRAIL_SAVE_MS) return;
    st.savedAt = Date.now();
    for (const [k, t] of Object.entries(st.trails)) { try { localStorage.setItem(`beacon.trail.${k}`, JSON.stringify(t.points)); } catch {} }
  }

  const minStep = () => (engine.field.kind === "grid" ? 4 : engine.field.kind === "local" ? Math.max(3, engine.field.spacing / 40) : 30);

  // ---------------------------------------------------------------- recording

  function startRecording() {
    if (st.replay) return msg("Stop the replay first.", true);
    st.recorder = new W.WalkRecorder({
      field: engine.field, wallStart: engine.musicNow(), name: "",
      settings: { sharpness: engine.opts.sharpness, hysteresis: engine.harmony.hysteresis, phraseBars: engine.harmony.phraseBars, tempoGlide: engine.tempoGlide },
    });
    st.recStart = performance.now();
    st.recorder.sample(0, engine.pos, engine.active);
    render();
    msg("Recording your walk: move around; the path, the blend and the songs are kept (a few KB a minute).");
  }

  async function stopRecording() {
    const r = st.recorder;
    st.recorder = null;
    const rec = r.finish((performance.now() - st.recStart) / 1000);
    if (rec.duration < 1) { render(); return msg("That was too short to keep."); }
    rec.id = `walk-${rec.createdAt.toString(36)}`;
    rec.name = `Walk ${new Date(rec.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    await walks().put(rec);
    await refreshList();
    msg(`Saved "${rec.name}" (${W.clockText(rec.duration)}, ${Object.keys(rec.songs).length} songs).`);
  }

  async function refreshList() {
    try { st.list = await walks().list(); } catch { st.list = []; }
    render();
  }

  function saveSoon(rec) {
    clearTimeout(st.saveTimer);
    st.saveTimer = setTimeout(() => walks().put(rec).catch(() => {}), 500);
  }

  // ---------------------------------------------------------------- replay

  /** The beacon object for an id in the replaying recording. */
  function beaconOf(rec, id) {
    const b = rec.beacons[id];
    return { id, label: b?.label || id, pos: b?.pos || engine.pos };
  }

  async function startReplay(rec, { from = 0, exportAs = null } = {}) {
    if (st.recorder) return msg("Stop recording first.", true);
    stopReplay(true);
    // Show it on the field it was made on.
    const kind = rec.field.kind;
    if (ui.mode !== kind) ctx.setMode(kind);
    const first = W.frameAt(rec, from).pos;
    if (kind === "local") ctx.centerLocal(first);
    ctx.stopFollow?.();
    if (!engine.running) await ctx.togglePlay();
    if (!engine.running) return;
    engine.harmony = new Harmony({ hysteresis: rec.settings?.hysteresis ?? engine.harmony.hysteresis, phraseBars: rec.settings?.phraseBars ?? engine.harmony.phraseBars });
    if (rec.settings?.sharpness) engine.opts.sharpness = rec.settings.sharpness;
    st.prevLayerSong = engine.layerSong;
    engine.layerSong = (id) => rec.songs[id] || st.prevLayerSong?.(id) || null;
    st.replay = { rec, start: performance.now(), from, exportAs };
    engine.timeOffset = rec.wallStart + from - Date.now() / 1000;
    if (exportAs) {
      st.replay.chunks = [];
      st.replay.stopTap = await engine.tapOutput((c) => st.replay?.chunks.push(c));
    }
    tick();
    render();
    msg(exportAs ? `Exporting "${rec.name}" as ${exportAs.toUpperCase()}: it plays through once (${W.clockText(rec.duration - from)}).` : `Replaying "${rec.name}". Edit a song in the inspector and the replay plays it changed.`);
  }

  function stopReplay(quiet = false) {
    const r = st.replay;
    if (!r) return;
    st.replay = null;
    r.stopTap?.();
    engine.replay = null;
    engine.timeOffset = 0;
    engine.layerSong = st.prevLayerSong || null;
    engine.harmony = new Harmony({ hysteresis: engine.harmony.hysteresis, phraseBars: engine.harmony.phraseBars });
    engine.refresh();
    render();
    if (!quiet && !r.exportAs) msg("Replay stopped.");
    return r;
  }

  /** Each frame while replaying: the recorded blend at this moment. */
  function tick() {
    const r = st.replay;
    if (!r) return false;
    const t = r.from + (performance.now() - r.start) / 1000;
    if (t >= r.rec.duration) {
      const done = stopReplay(true);
      if (done.exportAs) finishExport(done);
      else msg(`"${done.rec.name}" finished.`);
      return true;
    }
    const f = W.frameAt(r.rec, t);
    engine.replay = { active: f.active.map((a) => ({ id: a.id, w: a.w, d: 0, beacon: beaconOf(r.rec, a.id), song: r.rec.songs[a.id] })) };
    if (f.pos) engine.pos = f.pos;
    engine.refresh();
    const seek = $("wSeek");
    if (document.activeElement !== seek) seek.value = String(t / r.rec.duration);
    $("wTime").textContent = `${W.clockText(t)} / ${W.clockText(r.rec.duration)}`;
    return true;
  }

  /** Editing a song while replaying: it goes into the recording. Returns true when it did. */
  function setSong(id, song) {
    const r = st.replay;
    if (!r || !r.rec.songs[id]) return false;
    r.rec.songs[id] = JSON.parse(JSON.stringify(song));
    saveSoon(r.rec);
    engine.songRev = (engine.songRev || 0) + 1;
    return true;
  }

  function findBeacon(id) {
    return st.replay && st.replay.rec.beacons[id] ? beaconOf(st.replay.rec, id) : null;
  }

  // ---------------------------------------------------------------- audio export

  async function encode(chunks, sampleRate, format) {
    const ch = W.joinChunks(chunks, 2);
    if (format === "wav") return new Blob([W.encodeWav(ch, sampleRate)], { type: "audio/wav" });
    if (!window.lamejs) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = LAME_URL;
        s.onload = resolve;
        s.onerror = () => reject(new Error("the MP3 encoder couldn't load (offline?); WAV still works"));
        document.head.append(s);
      });
    }
    const enc = new window.lamejs.Mp3Encoder(2, sampleRate, 192);
    const toI16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
    const L = toI16(ch[0]), R = toI16(ch[1]);
    const parts = [];
    for (let i = 0; i < L.length; i += 1152) {
      const b = enc.encodeBuffer(L.subarray(i, i + 1152), R.subarray(i, i + 1152));
      if (b.length) parts.push(new Uint8Array(b));
      if (i % (1152 * 400) === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    return new Blob(parts, { type: "audio/mpeg" });
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fileName = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "music-beacon";

  async function finishExport(r) {
    try {
      msg(`Encoding ${r.exportAs.toUpperCase()}…`);
      const blob = await encode(r.chunks, engine.ctx.sampleRate, r.exportAs);
      download(blob, `${fileName(r.rec.name)}.${r.exportAs}`);
      msg(`Exported "${r.rec.name}" (${(blob.size / 1e6).toFixed(1)} MB ${r.exportAs.toUpperCase()}).`);
    } catch (err) { msg("Export failed: " + err.message, true); }
  }

  async function toggleAudio() {
    if (st.audio) {
      const a = st.audio;
      st.audio = null;
      a.stop();
      render();
      if (!a.chunks.length) return msg("Nothing was recorded.");
      const fmt = $("wFormat").value;
      try {
        msg(`Encoding ${fmt.toUpperCase()}…`);
        const blob = await encode(a.chunks, engine.ctx.sampleRate, fmt);
        download(blob, `music-beacon-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${fmt}`);
        msg(`Saved ${W.clockText((performance.now() - a.started) / 1000)} of what you heard (${(blob.size / 1e6).toFixed(1)} MB ${fmt.toUpperCase()}).`);
      } catch (err) { msg("Couldn't save it: " + err.message, true); }
      return;
    }
    if (!engine.running) await ctx.togglePlay();
    if (!engine.running) return;
    const chunks = [];
    try {
      st.audio = { chunks, started: performance.now(), stop: await engine.tapOutput((c) => chunks.push(c)) };
      render();
      msg("Recording what you hear… press again to stop and save.");
    } catch (err) { msg("Can't record here: " + err.message, true); }
  }

  // ---------------------------------------------------------------- the list

  async function act(action, id) {
    const rec = st.list.find((r) => r.id === id);
    if (!rec) return;
    switch (action) {
      case "play": return startReplay(rec);
      case "wav": case "mp3": return startReplay(rec, { exportAs: action });
      case "data": return download(new Blob([JSON.stringify(rec)], { type: "application/json" }), `${fileName(rec.name)}.walk.json`);
      case "rename": {
        const v = prompt("Name this walk:", rec.name);
        if (v && v.trim()) { rec.name = v.trim().slice(0, 80); await walks().put(rec); render(); }
        return;
      }
      case "trim": {
        const v = prompt(`Keep from which second to which? (0 to ${Math.floor(rec.duration)}), e.g. "10-95"`, `0-${Math.floor(rec.duration)}`);
        const m = v && v.match(/(\d+(?:\.\d+)?)\s*[-–to ]+\s*(\d+(?:\.\d+)?)/);
        if (!m) return;
        const from = Math.max(0, +m[1]), to = Math.min(rec.duration, +m[2]);
        if (to - from < 1) return msg("Keep at least a second.", true);
        const cut = W.trimWalk(rec, from, to);
        cut.id = `walk-${Date.now().toString(36)}`;
        cut.name = `${rec.name} (${W.clockText(from)}–${W.clockText(to)})`;
        cut.createdAt = Date.now();
        await walks().put(cut);
        await refreshList();
        return msg(`Made "${cut.name}". The original is unchanged.`);
      }
      case "delete": {
        if (!confirm(`Delete "${rec.name}" from this device? This can't be undone (download it first to keep a copy).`)) return;
        if (st.replay?.rec.id === id) stopReplay(true);
        await walks().remove(id);
        return refreshList();
      }
    }
  }

  function render() {
    const rec = !!st.recorder, rep = !!st.replay;
    $("wRecord").textContent = rec ? "■ Stop recording" : "● Record walk";
    $("wRecord").classList.toggle("primary", !rec);
    $("wAudio").textContent = st.audio ? "■ Stop and save" : "● Record what I hear";
    $("wTrail").checked = st.showTrail;
    $("wReplay").hidden = !rep;
    if (rep) $("wReplayName").textContent = st.replay.exportAs ? `Exporting ${st.replay.rec.name}` : st.replay.rec.name;
    $("wList").innerHTML = st.list.length ? st.list.map((r) => `<div class="ditem" data-walk="${esc(r.id)}">
        <span class="dname" style="cursor:default"><i style="background:${ctx.moodColor(r.songs[r.samples[0]?.a[0]?.[0]]?.mood)}"></i><span>${esc(r.name)}<small>${W.clockText(r.duration)} · ${esc(r.field.kind === "grid" ? "test grid" : r.field.kind === "local" ? "local grid" : "globe")} · ${Object.keys(r.songs).length} songs</small></span></span>
        <div class="dbtns">${[["play", "▶ Replay"], ["wav", "Export WAV"], ["mp3", "Export MP3"], ["trim", "Trim"], ["rename", "Rename"], ["data", "Download"], ["delete", "Delete"]].map(([a, l]) => `<button class="btn small" data-wact="${a}">${l}</button>`).join("")}</div></div>`).join("")
      : `<p class="hint">No walks yet. Press Record walk and move around (or let Auto-walk wander).</p>`;
  }

  $("wRecord").addEventListener("click", () => (st.recorder ? stopRecording() : startRecording()));
  $("wAudio").addEventListener("click", toggleAudio);
  $("wTrail").addEventListener("change", (e) => { st.showTrail = e.target.checked; try { localStorage.setItem("beacon.trailOn", st.showTrail ? "1" : "0"); } catch {} });
  $("wClearTrail").addEventListener("click", () => {
    if (!confirm("Clear the trail of where you've been on this field? It's only on this device.")) return;
    trail().clear();
    saveTrails(true);
    msg("Trail cleared.");
  });
  $("wStopReplay").addEventListener("click", () => {
    const r = stopReplay();
    if (r?.exportAs) msg("Export cancelled.");
  });
  $("wSeek").addEventListener("change", (e) => {
    const r = st.replay;
    if (!r || r.exportAs) return;
    const t = +e.target.value * r.rec.duration;
    startReplay(r.rec, { from: t });
  });
  $("wList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-wact]");
    if (b) act(b.dataset.wact, b.closest("[data-walk]").dataset.walk);
  });
  $("wImport").addEventListener("click", () => $("wFile").click());
  $("wFile").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const rec = JSON.parse(await f.text());
      const errs = W.validateWalk(rec);
      if (errs.length) return msg("Not imported: " + errs.join("; "), true);
      rec.id = `walk-${Date.now().toString(36)}`;
      await walks().put(rec);
      await refreshList();
      msg(`Imported "${rec.name}".`);
    } catch (err) { msg("That file isn't a walk: " + err.message, true); }
  });
  addEventListener("pagehide", () => saveTrails(true));

  // ---------------------------------------------------------------- per frame

  /** Called every frame. Returns true while a replay drives the listener (input is paused). */
  function frame() {
    if (st.replay) return tick();
    const top = engine.active.reduce((m, a) => (!m || a.w > m.w ? a : m), null);
    if (trail().add(engine.pos, top?.song?.mood, Date.now(), { minM: minStep(), jumpM: engine.field.kind === "grid" ? 400 : 20000 })) saveTrails();
    if (st.recorder) st.recorder.sample((performance.now() - st.recStart) / 1000, engine.pos, engine.active);
    return false;
  }

  /**
   * Trail stretches to draw for the current field, oldest first, and the
   * replaying walk's path: [{pts: [{p, m, t}], replay}].
   */
  function lines() {
    const out = [];
    if (st.showTrail) for (const pts of trail().stretches()) out.push({ pts, replay: false });
    if (st.replay && st.replay.rec.field.kind === engine.field.kind) out.push({ pts: W.walkTrail(st.replay.rec).points, replay: true });
    return out;
  }

  // Wait for the device store before listing.
  (async () => { for (let i = 0; i < 50 && !ctx.store()?.db; i++) await new Promise((r) => setTimeout(r, 100)); refreshList(); })();
  render();

  return {
    frame, lines, setSong, findBeacon,
    get replaying() { return !!st.replay; },
    get state() { return st; },
  };
}

/** Draws trail lines with a 2D view's toScreen (null for points off the view): newer is brighter. */
export function drawLines(g, lines, toScreen, moodColor, d, now = Date.now()) {
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const { pts, replay } of lines) {
    let prev = null;
    for (const pt of pts) {
      const s = toScreen(pt.p);
      if (s && prev) {
        const age = replay ? 0 : Math.min(1, (now - pt.t) / (6 * 3600 * 1000)); // fades over six hours
        g.strokeStyle = replay ? "#ffffff" : moodColor(pt.m);
        g.globalAlpha = replay ? 0.55 : 0.85 - 0.6 * age;
        g.lineWidth = (replay ? 2 : 3) * d;
        if (replay) g.setLineDash([5 * d, 5 * d]);
        g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(s[0], s[1]); g.stroke();
        if (replay) g.setLineDash([]);
      }
      prev = s;
    }
  }
  g.globalAlpha = 1;
}
