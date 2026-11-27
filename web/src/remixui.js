// The Remix panel on the website (the app's is scripts/beacon/remix_ui.gd):
// a switch, eight dials, every part's level and sound, Dice, Hold and Reset,
// saved flavours, and Place my version here. Settings are remembered
// (localStorage "beacon.remix"; flavours "beacon.remixFlavours"). The rules
// are in src/remix.js; the engine applies them (BeaconEngine.setRemix).

import * as R from "./remix.js";

const KEY = "beacon.remix", FLAVOURS = "beacon.remixFlavours";
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not kept */ } };

/** "wave:sine" -> "Sine synth", "sample:flute" -> "Flute", "model:bell" -> "Bell". */
export function swapLabel(sw) {
  if (sw === "own") return "Own sound";
  if (sw === "synth") return "Synth";
  const [kind, name] = sw.split(":");
  const n = name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return kind === "wave" ? `${n} synth` : n;
}

/** What a dial's value reads as. */
export function dialText(id, x) {
  if (!x) return "as written";
  if (id === "key") return `${x > 0 ? "+" : ""}${Math.round(x)} semitones`;
  if (id === "mood") { const n = Math.round(Math.abs(x) * 2); return `${x > 0 ? "brighter" : "darker"}, ${n} step${n === 1 ? "" : "s"}`; }
  if (id === "tempo") return `${x > 0 ? "+" : ""}${Math.round(x * 15)}%`;
  return `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;
}

/**
 * Builds the panel into `el` and wires it to the engine.
 * place(song) plants a song where you are (My beacons); placeMsg() reads its latest message.
 */
export function initRemix({ el, engine, place, placeMsg }) {
  let s = R.normalize(load(KEY, {}));
  s.hold = false;
  engine.setRemix(s);
  el.innerHTML = `
    <div class="rx-head">
      <label class="inline" for="rxOn" title="Your own settings over whatever is playing. Off: everything plays as written."><input id="rxOn" type="checkbox"> Remix</label>
      <button class="btn small" id="rxOpen" aria-expanded="false">Edit</button>
    </div>
    <div class="rx-body" id="rxBody" hidden>
      <p class="hint">Off: everything plays as written. On: your settings shape what you hear, wherever you go.</p>
      <div class="rx-grid" id="rxDials"></div>
      <h3 class="rx-h">Parts · level and sound</h3>
      <div class="rx-grid" id="rxParts"></div>
      <div class="rx-row">
        <button class="btn small" id="rxDice">🎲 Dice</button>
        <button class="btn small" id="rxReset">Reset</button>
        <button class="btn small" id="rxHold" aria-pressed="false" title="Freeze the blend: the music stops changing as you move">Hold</button>
      </div>
      <button class="btn" id="rxPlace" title="Plants what you hear as a new beacon where you are (needs your location)">Place my version here</button>
      <div class="msg" id="rxMsg"></div>
      <h3 class="rx-h">Flavours</h3>
      <div class="rx-row"><input id="rxName" type="text" maxlength="40" placeholder="Name this flavour"><button class="btn small" id="rxSave">Save</button></div>
      <div class="rx-row"><select id="rxFlavours" aria-label="Saved flavours"></select><button class="btn small" id="rxLoad">Load</button><button class="btn small" id="rxDelete">Delete</button></div>
    </div>`;
  const $ = (id) => el.querySelector("#" + id);
  const say = (t, err = false) => { const m = $("rxMsg"); m.textContent = t; m.classList.toggle("err", !!err); };

  // The dials.
  for (const [id, label, lo, hi, step] of R.DIALS) {
    $("rxDials").insertAdjacentHTML("beforeend",
      `<label for="rx-${id}">${label}</label><input id="rx-${id}" type="range" min="${lo}" max="${hi}" step="${step}" value="0"><span class="rx-v" id="rxv-${id}"></span>`);
    $(`rx-${id}`).addEventListener("input", (e) => { s[id] = +e.target.value; push(); });
  }
  // The parts.
  for (const p of R.PARTS) {
    const one = R.SWAPS[p].length <= 1;
    $("rxParts").insertAdjacentHTML("beforeend",
      `<label for="rxl-${p}">${p[0].toUpperCase() + p.slice(1)}</label><input id="rxl-${p}" type="range" min="0" max="${R.LEVEL_MAX}" step="0.05" value="1"><button class="btn small" id="rxs-${p}"${one ? " disabled" : ""} title="Swap sound: step through this part's other instruments">Own sound</button>`);
    $(`rxl-${p}`).addEventListener("input", (e) => { s.parts[p].level = +e.target.value; push(); });
    $(`rxs-${p}`).addEventListener("click", () => {
      s.parts[p].swap = (s.parts[p].swap + 1) % R.SWAPS[p].length;
      s.on = true; // changing the sound means you want to hear it
      push();
    });
  }

  function show() {
    $("rxOn").checked = s.on;
    $("rxHold").setAttribute("aria-pressed", String(!!s.hold));
    $("rxHold").classList.toggle("on", !!s.hold);
    for (const [id] of R.DIALS) { $(`rx-${id}`).value = s[id]; $(`rxv-${id}`).textContent = dialText(id, s[id]); }
    for (const p of R.PARTS) { $(`rxl-${p}`).value = s.parts[p].level; $(`rxs-${p}`).textContent = swapLabel(R.SWAPS[p][s.parts[p].swap]); }
  }
  function push() {
    s = R.normalize(s);
    engine.setRemix(s);
    keep(KEY, { ...s, hold: false });
    show();
  }
  function listFlavours() {
    const f = load(FLAVOURS, {}), names = Object.keys(f).sort();
    $("rxFlavours").innerHTML = names.length ? names.map((n) => `<option>${n.replace(/[<&>"]/g, "")}</option>`).join("") : "<option>No flavours saved yet</option>";
    $("rxFlavours").disabled = !names.length;
  }

  $("rxOn").addEventListener("change", (e) => { s.on = e.target.checked; push(); });
  $("rxOpen").addEventListener("click", () => {
    const open = $("rxBody").hidden;
    $("rxBody").hidden = !open;
    $("rxOpen").setAttribute("aria-expanded", String(open));
  });
  $("rxDice").addEventListener("click", () => { s = R.dice(s); s.on = true; push(); say("Rolled a new flavour. Keep turning, or Dice again."); });
  $("rxReset").addEventListener("click", () => { const on = s.on; s = R.defaults(); s.on = on; push(); say("Back to as written."); });
  $("rxHold").addEventListener("click", () => { s.hold = !s.hold; push(); });
  $("rxPlace").addEventListener("click", async () => {
    if (!s.on || R.isNeutral(s)) return say("Turn Remix on and change something first: then what you hear is yours to place.", true);
    const song = engine.remixedTop();
    if (!song) return say("Nothing is playing here to place.", true);
    say("Finding you…");
    await place(song);
    say(placeMsg() || "");
  });
  $("rxSave").addEventListener("click", () => {
    const n = $("rxName").value.trim().slice(0, 40);
    if (!n) return say("Give the flavour a name first.", true);
    const f = load(FLAVOURS, {});
    f[n] = { ...s, hold: false };
    keep(FLAVOURS, f);
    $("rxName").value = "";
    listFlavours();
    say(`Saved "${n}".`);
  });
  $("rxLoad").addEventListener("click", () => {
    if ($("rxFlavours").disabled) return;
    const n = $("rxFlavours").value, f = load(FLAVOURS, {});
    if (!f[n]) return;
    s = R.normalize({ ...f[n], on: true, hold: s.hold });
    push();
    say(`Playing your "${n}" flavour.`);
  });
  $("rxDelete").addEventListener("click", () => {
    if ($("rxFlavours").disabled) return;
    const n = $("rxFlavours").value, f = load(FLAVOURS, {});
    delete f[n];
    keep(FLAVOURS, f);
    listFlavours();
    say(`Deleted "${n}".`);
  });
  listFlavours();
  show();
  return { get settings() { return s; }, set(next) { s = R.normalize(next); push(); } };
}
