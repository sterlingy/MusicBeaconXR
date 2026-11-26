// Song editor: change a beacon's song with controls instead of JSON.
// Every change goes to the engine right away, so you hear it while you stand
// near the beacon.

import { MODES, NOTE_NAMES, ROLES, ROLE_INSTRUMENT, chordName, romanName, isBorrowed, validateSong } from "./song.js";

// Borrowed chords the picker offers (modal mixture), as {d, m}: degree d of mode m on the key's root.
const BORROWABLE = [
  { d: 6, m: "mixolydian" }, { d: 2, m: "minor" }, { d: 3, m: "minor" }, { d: 4, m: "minor" }, { d: 5, m: "minor" },
  { d: 1, m: "lydian" }, { d: 1, m: "phrygian" }, { d: 3, m: "dorian" }, { d: 4, m: "harmonicMinor" }, { d: 0, m: "major" },
];
const chordValue = (c) => (isBorrowed(c) ? `${c.m}:${c.d}` : String(c));
const parseChord = (v) => (v.includes(":") ? { m: v.split(":")[0], d: +v.split(":")[1] } : +v);
import { formToText, parseForm, lengthSeconds, clock, totalBars, SECTION_LABEL, SECTION_COLOR, entryLayers } from "./form.js";

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
    this.material = "A"; // which patterns the grid edits: A = verse, B = chorus
    this.chordSection = "verse";
    this.formError = "";
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

  /** The pattern the grid edits (verse or chorus material). */
  _pat(t) {
    if (this.material === "B") {
      if (!t.patternB) t.patternB = structuredClone(t.pattern); // start the chorus from the verse
      return t.patternB;
    }
    return t.pattern;
  }
  _setPat(t, v) { if (this.material === "B") t.patternB = v; else t.pattern = v; }

  /** The chords being edited: the song's own (verse) or a section's. */
  _prog() {
    const s = this.song, k = this.chordSection;
    if (k === "verse") return s.progression;
    s.sections ||= {};
    s.sections[k] ||= {};
    s.sections[k].progression ||= s.progression.slice();
    return s.sections[k].progression;
  }

  render() {
    const s = this.song;
    if (!s) return;
    const t = s.tracks[this.role];
    const keyOpts = NOTE_NAMES.map((n, i) => `<option value="${i}"${i === s.key.root ? " selected" : ""}>${n}</option>`).join("");
    const modeOpts = Object.keys(MODES).map((m) => `<option value="${m}"${m === s.key.mode ? " selected" : ""}>${m.replace(/([A-Z])/g, " $1").toLowerCase()}</option>`).join("");
    const moodOpts = MOODS.map((m) => `<option${m === s.mood ? " selected" : ""}>${m}</option>`).join("");
    const used = s.form ? [...new Set(s.form.map((f) => f.section))].filter((x) => ["verse", "pre", "chorus", "bridge"].includes(x)) : [];
    if (!used.includes(this.chordSection)) this.chordSection = "verse";
    const secOpts = (used.length ? used : ["verse"]).map((k) => `<option value="${k}"${k === this.chordSection ? " selected" : ""}>${SECTION_LABEL[k]}</option>`).join("");
    // Diatonic chords, then borrowed ones (shown with their roman name), skipping duplicates of a diatonic chord.
    const diatonic = [0, 1, 2, 3, 4, 5, 6].map((k) => ({ c: k, name: chordName(s.key, k) }));
    const names = new Set(diatonic.map((x) => x.name));
    const borrowed = BORROWABLE.map((c) => ({ c, name: chordName(s.key, c) })).filter((x) => !names.has(x.name) && (names.add(x.name), true));
    const prog = this._prog().map((d, bi) => {
      const cur = chordValue(d);
      const opts = [...diatonic, ...borrowed];
      if (!opts.some((x) => chordValue(x.c) === cur)) opts.push({ c: d, name: chordName(s.key, d) });
      return `<select data-prog="${bi}" aria-label="Chord for bar ${bi + 1}">${opts.map((x) =>
        `<option value="${chordValue(x.c)}"${chordValue(x.c) === cur ? " selected" : ""}>${x.name}${isBorrowed(x.c) ? ` (${romanName(s.key, x.c)})` : ""}</option>`).join("")}</select>`;
    }).join("");
    const tabs = ROLES.map((r) => `<button class="etab" data-role="${r}" aria-pressed="${r === this.role}">${ROLE_LABEL[r]}${s.tracks[r]?.level > 0 ? "" : " ·off"}</button>`).join("");
    const mat = s.form ? `<div class="etabs" role="group" aria-label="Material"><button class="etab" data-mat="A" aria-pressed="${this.material === "A"}">Verse material</button><button class="etab" data-mat="B" aria-pressed="${this.material === "B"}">Chorus material</button></div>` : "";
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
      <label class="eform">Form <span class="hint">${clock(lengthSeconds(s))} · ${totalBars(s)} bars</span>
        <input data-f="form" value="${attr(formToText(s.form))}" placeholder="intro 8, verse 16, chorus 8, verse 16, chorus 8, bridge 8, chorus 8, outro 8" spellcheck="false"></label>
      ${this.formError ? `<p class="hint" style="color:var(--accent)">${attr(this.formError)}</p>` : ""}
      ${this._arrangement()}
      <div class="eprog"><span>Chords</span>${used.length > 1 ? `<select data-chordsec aria-label="Which section's chords">${secOpts}</select>` : ""}${prog}</div>
      <div class="etabs" role="group" aria-label="Part">${tabs}</div>
      <div class="epart">
        <label class="eknob"><span>${ROLE_INSTRUMENT[this.role]} level <b data-out="__level">${Math.round(t.level * 100)}</b></span>
          <input type="range" min="0" max="1" step="0.01" value="${t.level}" data-level></label>
        ${sound}
      </div>
      ${mat}
      ${bars}
      <div class="esteps" role="grid" aria-label="${ROLE_LABEL[this.role]} steps">${this._grid()}</div>
      <p class="hint">Click cells to add or remove notes. Melodic rows are steps above the current chord's root, so a part fits any key.${s.form ? " Verse material plays in the intro, verses, pre-chorus and bridge; chorus material in the choruses and outro. Sections also decide which parts play and how busy the drums are." : ""}</p>`;
    this._wire();
  }

  /** Sections down, parts across: which instruments play in each section. */
  _arrangement() {
    const s = this.song;
    if (!s.form) return "";
    const counts = {}, seen = {};
    for (const f of s.form) counts[f.section] = (counts[f.section] || 0) + 1;
    const head = `<span></span>${ROLES.map((r) => `<span class="ah${s.tracks[r]?.level > 0 ? "" : " off"}" title="${s.tracks[r]?.level > 0 ? "" : "This part is off for the whole song (its level is 0)"}">${ROLE_LABEL[r]}</span>`).join("")}`;
    const rows = s.form.map((f, i) => {
      seen[f.section] = (seen[f.section] || 0) + 1;
      const name = SECTION_LABEL[f.section] + (counts[f.section] > 1 ? ` ${seen[f.section]}` : "");
      const lay = entryLayers(s, f);
      return `<span class="an" style="border-color:${SECTION_COLOR[f.section]}">${name} <small>${f.bars}</small></span>` + ROLES.map((r) => {
        const on = lay[r] > 0, enter = f.enter?.[r];
        return `<button class="acell${on ? " on" : ""}" data-arr="${i}:${r}" aria-pressed="${on}" aria-label="${ROLE_LABEL[r]} in ${name}" title="${on && enter ? `Comes in ${Math.round(enter * 100)}% of the way through` : ""}">${on && enter ? "↗" : ""}</button>`;
      }).join("");
    }).join("");
    return `<div class="earr"><span class="hint">Arrangement · click to choose which parts play in each section</span><div class="agrid">${head}${rows}</div></div>`;
  }

  _grid() {
    const s = this.song, role = this.role, t = s.tracks[role];
    const head = `<span class="rl"></span>${Array.from({ length: 16 }, (_, i) => `<span class="ch${i % 4 === 0 ? " beat" : ""}">${i % 4 === 0 ? i / 4 + 1 : ""}</span>`).join("")}`;
    let rows = "";
    const pat = this._pat(t);
    if (role === "drums") {
      for (const v of DRUM_ROWS) {
        const arr = pat[v] || Array(16).fill(0);
        rows += `<span class="rl">${v}</span>` + arr.map((x, i) => cell(x > 0, `${v}:${i}`, i, x)).join("");
      }
    } else if (role === "keys") {
      const bar = pat[this.bar] || [];
      rows += `<span class="rl">chord</span>` + Array.from({ length: 16 }, (_, i) => cell(!!bar[i], `k:${i}`, i, bar[i]?.v)).join("");
    } else {
      const bar = pat[this.bar] || [];
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
      if (f === "form") {
        if (!el.value.trim()) { delete s.form; this.formError = ""; }
        else {
          try {
            // Keep each section's lineup where the section is still there.
            const old = s.form || [];
            s.form = parseForm(el.value).map((f, i) => {
              const was = old[i]?.section === f.section ? old[i] : old.find((g) => g.section === f.section);
              return was ? { ...f, ...(was.layers ? { layers: { ...was.layers } } : {}), ...(was.enter ? { enter: { ...was.enter } } : {}) } : f;
            });
            s.version = 2; this.formError = "";
          }
          catch (err) { this.formError = `Form not changed: ${err.message}.`; this.render(); return; }
        }
      }
      this._commit();
    }));
    R.querySelectorAll("[data-prog]").forEach((el) => el.addEventListener("change", () => { this._prog()[+el.dataset.prog] = parseChord(el.value); this._commit(); }));
    R.querySelector("[data-chordsec]")?.addEventListener("change", (e) => { this.chordSection = e.target.value; this.render(); });
    R.querySelectorAll("[data-arr]").forEach((el) => el.addEventListener("click", () => {
      const [i, role] = el.dataset.arr.split(":");
      const f = s.form[+i];
      const lay = entryLayers(s, f);
      const on = !(lay[role] > 0);
      f.layers = { ...lay, [role]: on ? 1 : 0 };
      if (f.enter) { delete f.enter[role]; if (!Object.keys(f.enter).length) delete f.enter; }
      if (on && !(s.tracks[role].level > 0)) s.tracks[role].level = 0.6; // turning a part on somewhere brings it into the song
      this._commit();
    }));
    R.querySelectorAll("[data-mat]").forEach((el) => el.addEventListener("click", () => { this.material = el.dataset.mat; this.render(); }));
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
      const src = structuredClone(this._pat(t)[this.bar] || Array(16).fill(null));
      this._setPat(t, [0, 1, 2, 3].map(() => structuredClone(src)));
      this._commit();
    });
    R.querySelector('[data-act="clearbar"]')?.addEventListener("click", () => {
      this._pat(s.tracks[this.role])[this.bar] = Array(16).fill(null);
      this._commit();
    });
    R.querySelectorAll(".cell").forEach((el) => el.addEventListener("click", () => this._toggle(el.dataset.k)));
  }

  _toggle(k) {
    const s = this.song, role = this.role, t = s.tracks[role];
    const [a, b] = k.split(":");
    const i = +b;
    if (role === "drums") {
      const pat = this._pat(t);
      pat[a] = pat[a] ? pat[a].slice() : Array(16).fill(0);
      pat[a][i] = pat[a][i] > 0 ? 0 : (i % 4 === 0 ? 0.9 : 0.7);
    } else {
      const old = this._pat(t);
      this._setPat(t, [0, 1, 2, 3].map((n) => old[n] ? old[n].slice() : Array(16).fill(null))); // bars stop sharing one array
      const bar = this._pat(t)[this.bar];
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
