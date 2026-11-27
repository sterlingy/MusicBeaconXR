// Jump / Move: the card a long press, right-click or tap on a beacon opens on
// the map (flat and 3D), and the "Back to me" button. The website's twin of the
// app's TravelUi (scripts/beacon/travel_ui.gd).

/**
 * `wrap` is the element the card is positioned in (the map's container).
 * Returns {open(clientX, clientY, {title, detail}, onChoose(kind)), close(),
 * isOpen, setBack(visible)}; `onBack()` runs when Back to me is pressed.
 */
export function initTravelCard({ wrap, card, title, detail, back, onBack = () => {} }) {
  let choose = null;
  const close = () => {
    if (card.hidden) return;
    card.hidden = true;
    choose = null;
  };
  for (const b of card.querySelectorAll("[data-go]")) {
    b.addEventListener("click", () => { const f = choose; close(); f?.(b.dataset.go); });
  }
  // A press anywhere else closes it (after the press that opened it).
  document.addEventListener("pointerdown", (e) => { if (!card.hidden && !card.contains(e.target)) close(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  back.addEventListener("click", () => onBack());
  return {
    get isOpen() { return !card.hidden; },
    close,
    open(clientX, clientY, info, onChoose) {
      title.textContent = info.title;
      detail.textContent = info.detail;
      choose = onChoose;
      card.hidden = false;
      // Above the finger (so it doesn't hide the card), kept inside the map.
      const r = wrap.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
      let x = clientX - r.left - w / 2, y = clientY - r.top - h - 22;
      if (y < 8) y = clientY - r.top + 22;
      card.style.left = `${Math.max(8, Math.min(r.width - w - 8, x))}px`;
      card.style.top = `${Math.max(8, Math.min(r.height - h - 8, y))}px`;
      card.querySelector("[data-go]")?.focus({ preventScroll: true });
    },
    setBack(visible) { if (back.hidden === visible) back.hidden = !visible; },
  };
}

/** The card's words for a place: {title, detail}. `beacon` is the beacon there (or null). */
export function describePlace({ beacon, song, pos, kind, meters, seconds }) {
  let title;
  if (beacon) title = song?.title ? `${song.title} · ${beacon.label}` : beacon.label;
  else if (kind === "globe") title = `${Math.abs(pos.lat).toFixed(1)}°${pos.lat >= 0 ? "N" : "S"} ${Math.abs(pos.lon).toFixed(1)}°${pos.lon >= 0 ? "E" : "W"}`;
  else title = "This spot";
  const far = meters < 1000 ? `${Math.round(meters)} m away` : meters < 10000 ? `${(meters / 1000).toFixed(1)} km away` : `${Math.round(meters / 1000).toLocaleString("en-US")} km away`;
  return { title, detail: `${far} · Move takes ${Math.round(seconds)} s` };
}
