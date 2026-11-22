// Song editor: change a beacon's song with controls instead of JSON.
// Every change goes to the engine right away, so you hear it while you stand
// near the beacon.

import { MODES, NOTE_NAMES, ROLES, ROLE_INSTRUMENT, chordName, validateSong } from "./song.js";

const ROLE_LABEL = { drums: "Drums", bass: "Bass", keys: "Keys", lead: "Lead", pluck: "Pluck", texture: "Texture" };
const DRUM_ROWS = ["kick", "snare", "clap", "hat", "open"];
const MOODS = ["Drift", "Glow", "Tide", "Pulse", "Rush"];
const DEGREE_ROWS = [7, 6, 5, 4, 3, 2, 1, 0]; // scale degrees above the chord root, top to bottom
const DEGREE_NAMES = ["root", "2nd", "3rd", "4th", "5th", "6th", "7th", "oct"];
// A few sound controls per part; ids match the instrument params.
const SOUND = {
  drums: [["kick.tune", "Kick tune", 36, 70, 1], ["kick.decay", "Kick decay", 0.15, 0.9, 0.01], ["hat.decay", "Hat decay", 0.02, 0.2, 0.005], ["master.drive", "Drive", 0, 0.8, 0.01]],
  bass: [["filter.cutoff", "Cutoff", 120, 3000, 10], ["filter.emphasis", "Emphasis", 0, 12, 0.1], ["fenv.amount", "Env amount", 0, 3000, 10], ["glide", "Glide", 0, 0.15, 0.005]],
  keys: [["filter.cutoff", "Cutoff", 300, 8000, 10], ["aenv.attack", "Attack", 0.002, 2, 0.01], ["aenv.release", "Release", 0.1, 4, 0.05], ["chorus.mix", "Chorus", 0, 1, 0.01]],
  lead: [["filter.cutoff", "Cutoff", 500, 9000, 10], ["vibrato.depth", "Vibrato", 0, 40, 1], ["delay.send", "Delay", 0, 0.8, 0.01], ["portamento", "Glide", 0, 0.15, 0.005]],
  pluck: [["brightness", "Brightness", 0.1, 1, 0.01], ["decay", "Decay", 0.1, 4, 0.05], ["reverb.send", "Reverb", 0, 1, 0.01]],
  texture: [["fm.index", "FM depth", 0, 10, 0.1], ["lfo.rate", "LFO rate", 0.02, 2, 0.01], ["filter.cutoff", "Cutoff", 200, 6000, 10], ["reverb.send", "Reverb", 0, 1, 0.01]],
};

export class SongEditor {
  constructor(root, { onChange }) {
    this.root = root;
    this.onChange = onChange;
    this.song = null;
    this.role = "bass";
    this.bar = 0;
  }

  open(song) {
    this.song = structuredClone(song);
    this.song.author = this.song.author === "generator" ? "you" : this.song.author;
    this.render();
  }

  close() { this.song = null; this.root.innerHTML = ""; }

  _commit(rerender = true) {
    if (validateSong(this.song).length === 0) this.onChange(structuredClone(this.song));
    if (rerender) this.render();
  }

  render() {
    const s = this.song;
    if (!s) return;
    const t = s.tracks[this.role];
    const keyOpts = NOTE_NAMES.map((n, i) => `<option value="${i}"${i === s.key.root ? " selected" : ""}>${n}</option>`).join("");
    const modeOpts = Object.keys(MODES).map((m) => `<option value="${m}"${m === s.key.mode ? " selected" : ""}>${m.replace(/([A-Z])/g, " $1").toLowerCase()}</option>`).join("");
    const moodOpts = MOODS.map((m) => `<option${m === s.mood ? " selected" : ""}>${m}</option>`).join("");
    const prog = s.progression.map((d, bi) => `<select data-prog="${bi}" aria-label="Chord for bar ${bi + 1}">${
      [0, 1, 2, 3, 4, 5, 6].map((k) => `<option value="${k}"${k === d ? " selected" : ""}>${chordName(s.key, k)}</option>`).join("")}</select>`).join("");
    const tabs = ROLES.map((r) => `<button class="etab" data-role="${r}" aria-pressed="${r === this.role}">${ROLE_LABEL[r]}${s.tracks[r]?.level > 0 ? "" : " ·off"}</button>`).join("");
    const bars = this.role === "drums" ? "" : `<div class="ebars">${[0, 1, 2, 3].map((b) => `<button class="etab" data-bar="${b}" aria-pressed="${b === this.bar}">Bar ${b + 1}</button>`).join("")}
      <button class="btn small" data-act="copybar">Copy bar ${this.bar + 1} to all</button><button class="btn small" data-act="clearbar">Clear bar</button></div>`;
    const sound = (SOUND[this.role] || []).map(([id, name, lo, hi, stepv]) => {
      const v = t.params[id] ?? lo;
      return `<label class="eknob"><span>${name} <b data-out="${id}">${fmt(v)}</b></span><input type="range" min="${lo}" max="${hi}" step="${stepv}" value="${v}" data-param="${id}"></label>`;
    }).join("");
    this.root.innerHTML = `
      <div class="egrid">
        <label>Title<input data-f="title" value="${attr(s.title)}" maxlength="40"></label>
        <label>Mood<select data-f="mood">${moodOpts}</select></label>
        <label>Key<select data-f="root">${keyOpts}</select></label>
        <label>Mode<select data-f="mode">${modeOpts}</select></label>
        <label>Tempo<input data-f="bpm" type="number" min="40" max="220" value="${s.bpm}"></label>
      </div>
      <div class="eprog"><span>Chords</span>${prog}</div>
      <div class="etabs" role="group" aria-label="Part">${tabs}</div>
      <div class="epart">
        <label class="eknob"><span>${ROLE_INSTRUMENT[this.role]} level <b data-out="__level">${Math.round(t.level * 100)}</b></span>
          <input type="range" min="0" max="1" step="0.01" value="${t.level}" data-level></label>
        ${sound}
      </div>
      ${bars}
      <div class="esteps" role="grid" aria-label="${ROLE_LABEL[this.role]} steps">${this._grid()}</div>
      <p class="hint">Click cells to add or remove notes. Melodic rows are steps above the current chord's root, so a part fits any key.</p>`;
    this._wire();
  }

  _grid() {
    const s = this.song, role = this.role, t = s.tracks[role];
    const head = `<span class="rl"></span>${Array.from({ length: 16 }, (_, i) => `<span class="ch${i % 4 === 0 ? " beat" : ""}">${i % 4 === 0 ? i / 4 + 1 : ""}</span>`).join("")}`;
    let rows = "";
    if (role === "drums") {
      for (const v of DRUM_ROWS) {
        const arr = t.pattern[v] || Array(16).fill(0);
        rows += `<span class="rl">${v}</span>` + arr.map((x, i) => cell(x > 0, `${v}:${i}`, i, x)).join("");
      }
    } else if (role === "keys") {
      const bar = t.pattern[this.bar] || [];
      rows += `<span class="rl">chord</span>` + Array.from({ length: 16 }, (_, i) => cell(!!bar[i], `k:${i}`, i, bar[i]?.v)).join("");
    } else {
      const bar = t.pattern[this.bar] || [];
      for (const d of DEGREE_ROWS) {
        rows += `<span class="rl">${DEGREE_NAMES[d]}</span>` + Array.from({ length: 16 }, (_, i) => {
          const ev = bar[i];
          // Notes below the root or above the octave show on the edge rows.
          return cell(!!ev && Math.max(0, Math.min(7, ev.d)) === d, `${d}:${i}`, i, ev?.v);
        }).join("");
      }
    }
    return head + rows;
  }

  _wire() {
    const s = this.song, R = this.root;
    R.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", () => {
      const f = el.dataset.f;
      if (f === "title") s.title = el.value.trim() || "Untitled";
      if (f === "mood") s.mood = el.value;
      if (f === "root") s.key.root = +el.value;
      if (f === "mode") s.key.mode = el.value;
      if (f === "bpm") s.bpm = Math.max(40, Math.min(220, Math.round(+el.value || 100)));
      this._commit();
    }));
    R.querySelectorAll("[data-prog]").forEach((el) => el.addEventListener("change", () => { s.progression[+el.dataset.prog] = +el.value; this._commit(); }));
    R.querySelectorAll("[data-role]").forEach((el) => el.addEventListener("click", () => { this.role = el.dataset.role; this.render(); }));
    R.querySelectorAll("[data-bar]").forEach((el) => el.addEventListener("click", () => { this.bar = +el.dataset.bar; this.render(); }));
    const lvl = R.querySelector("[data-level]");
    lvl.addEventListener("input", () => {
      s.tracks[this.role].level = +lvl.value;
      R.querySelector('[data-out="__level"]').textContent = Math.round(lvl.value * 100);
      this._commit(false);
    });
    R.querySelectorAll("[data-param]").forEach((el) => el.addEventListener("input", () => {
      s.tracks[this.role].params[el.dataset.param] = +el.value;
      R.querySelector(`[data-out="${el.dataset.param}"]`).textContent = fmt(+el.value);
      this._commit(false);
    }));
    R.querySelector('[data-act="copybar"]')?.addEventListener("click", () => {
      const t = s.tracks[this.role];
      const src = structuredClone(t.pattern[this.bar] || Array(16).fill(null));
      t.pattern = [0, 1, 2, 3].map(() => structuredClone(src));
      this._commit();
    });
    R.querySelector('[data-act="clearbar"]')?.addEventListener("click", () => {
      s.tracks[this.role].pattern[this.bar] = Array(16).fill(null);
      this._commit();
    });
    R.querySelectorAll(".cell").forEach((el) => el.addEventListener("click", () => this._toggle(el.dataset.k)));
  }

  _toggle(k) {
    const s = this.song, role = this.role, t = s.tracks[role];
    const [a, b] = k.split(":");
    const i = +b;
    if (role === "drums") {
      t.pattern[a] ||= Array(16).fill(0);
      t.pattern[a][i] = t.pattern[a][i] > 0 ? 0 : (i % 4 === 0 ? 0.9 : 0.7);
    } else {
      t.pattern = [0, 1, 2, 3].map((n) => t.pattern[n] ? t.pattern[n].slice() : Array(16).fill(null)); // bars stop sharing one array
      const bar = t.pattern[this.bar];
      if (role === "keys") bar[i] = bar[i] ? null : { v: 0.7, g: 2 };
      else {
        const d = +a;
        const ev = bar[i];
        const same = ev && Math.max(0, Math.min(7, ev.d)) === d;
        bar[i] = same ? null : { d, o: 0, v: i % 4 === 0 ? 0.9 : 0.75, g: role === "bass" ? 2 : role === "texture" ? 16 : 1 };
      }
    }
    if (t.level === 0) t.level = 0.6; // adding notes to a silent part turns it on
    this._commit();
  }
}

function cell(on, key, i, v) {
  return `<button class="cell${on ? " on" : ""}${i % 4 === 0 ? " beat" : ""}" data-k="${key}" aria-pressed="${on}" style="${on ? `opacity:${0.45 + 0.55 * (v || 0.8)}` : ""}" aria-label="Step ${i + 1}"></button>`;
}
function fmt(v) { return v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2); }
function attr(s) { return String(s).replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" }[c])); }
