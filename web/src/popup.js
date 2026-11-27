// Pop-out windows on the website (the Jump / Move card, the flight card):
// one open at a time, popping open with a little overshoot and a swoosh,
// shrinking away on close. Frosted glass is CSS (.popwin in index.html).
// The app's twin is scripts/beacon/popup_fx.gd.

const SFX = { open: new URL("../sfx/ui_open.mp3", import.meta.url), close: new URL("../sfx/ui_close.mp3", import.meta.url) };
const VOLUME = 0.35; // under the music
let current = null;
const audio = {};

/** The swoosh for opening or closing (quietly does nothing if the browser won't play yet). */
export function swoosh(kind) {
  try {
    audio[kind] ??= new Audio(SFX[kind]);
    const a = audio[kind];
    a.volume = VOLUME;
    a.currentTime = 0;
    a.play()?.catch(() => {});
  } catch { /* no audio here */ }
}

export function isOpen(el) { return !!el && !el.hidden && el.dataset.closing !== "1"; }

/** Opens `el` (closing whichever window was open). `onClose` runs when something else closes it. */
export function openPopup(el, onClose = null) {
  if (current && current.el !== el) closePopup(current.el);
  const was = isOpen(el);
  current = { el, onClose };
  delete el.dataset.closing;
  el.hidden = false;
  el.classList.remove("pop-in");
  void el.offsetWidth; // restart the animation
  el.classList.add("pop-in");
  if (!was) swoosh("open");
}

/** Closes `el` with its animation; it's hidden when the animation ends. */
export function closePopup(el) {
  if (!isOpen(el)) return;
  if (current?.el === el) { const f = current.onClose; current = null; f?.(); }
  el.dataset.closing = "1";
  el.classList.remove("pop-in");
  el.classList.add("pop-out");
  swoosh("close");
  const done = () => { if (el.dataset.closing === "1") { el.hidden = true; delete el.dataset.closing; } el.classList.remove("pop-out"); };
  el.addEventListener("animationend", done, { once: true });
  setTimeout(done, 300); // in case animations are off
}
