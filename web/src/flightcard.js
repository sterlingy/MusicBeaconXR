// The flight you're riding along with, as a card: tap the plane. The
// website's twin of the app's FlightCard (scripts/beacon/flight_card.gd):
// airline and flight number, the route as big airport codes joined by a
// progress track, time to go / landing / time in the air, live numbers, the
// aircraft, and Stop. Live numbers refresh while it's open.

import { flightDetails, flightSummary } from "./flight.js";
import { openPopup, closePopup, isOpen } from "./popup.js";

const ago = (s) => (s < 120 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function initFlightCard({ el, flight, onStop }) {
  let details = null, timer = 0;
  const tile = (cap, val, sub) => `<div class="fc-tile"><i>${esc(cap)}</i><b>${esc(val || "–")}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`;
  function render() {
    if (!flight.active) return close();
    const f = flight.fix, s = flightSummary(f, details || {});
    const sub = [s.callsign !== s.code ? s.callsign : "", f.type].filter(Boolean).join(" · ");
    let route = "";
    if (s.oCode) {
      const p = s.progress ?? -1;
      route = `<div class="fc-route"><div class="fc-ap"><b>${esc(s.oCode)}</b><span>${esc(s.oCity)}</span></div>
        <div class="fc-track">${p >= 0 ? `<div class="done" style="width:calc(${(p * 100).toFixed(1)}% - 8px)"></div><div class="plane" style="left:calc(4px + ${(p * 100).toFixed(1)}% - ${(p * 8).toFixed(1)}px)">✈</div>` : ""}</div>
        <div class="fc-ap to"><b>${esc(s.dCode)}</b><span>${esc(s.dCity)}</span></div></div>`;
    }
    const note = !s.oCode ? (details ? "Route not known for this flight" : "Loading the route…")
      : s.plausible === false ? "Route unconfirmed: the plane isn't on the scheduled route (a reused flight number?)"
      : s.flown ? `${s.flown} flown · ${s.left} to go` : "";
    const times = s.toGo ? `<div class="fc-tiles">${tile("To go", s.toGo)}${tile("Lands (your time)", s.lands)}${tile("In the air", s.airborne)}</div>` : "";
    el.innerHTML = `<div class="fc-head"><span class="fc-airline">${esc(s.airline || "In the air")}</span><button class="fc-x" data-x aria-label="Close">✕</button></div>
      <div class="fc-title"><span class="fc-code">${esc(s.code || f.flight || f.reg)}</span><span class="fc-sub">${esc(sub)}</span></div>
      <div class="fc-status ${flight.tracked ? "live" : "lost"}">${flight.tracked ? "● Live" : `● Signal lost · gliding on its last course (last seen ${ago(flight.dataAge())} ago)`}</div>
      ${route}${note ? `<div class="fc-note">${esc(note)}</div>` : ""}${times}
      <div class="fc-tiles">${tile("Altitude", s.alt, s.altM)}${tile("Speed", s.speed, s.speedAlt)}${tile("Heading", s.heading)}${tile("Mach", s.mach)}${tile("Outside", s.oat)}${tile("Squawk", s.squawk)}</div>
      ${s.aircraft ? `<div class="fc-plane">${esc(s.aircraft)}</div>` : ""}${s.owner ? `<div class="fc-owner">${esc(s.owner)}</div>` : ""}
      <div class="fc-foot"><span>Live: adsb.lol (ODbL) · route and aircraft: adsbdb.com<br>Times are estimates from distance and speed</span><button class="btn" data-stop>■ Stop following</button></div>`;
  }
  function close() { clearInterval(timer); closePopup(el); }
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-x]")) close();
    else if (e.target.closest("[data-stop]")) { close(); onStop(); }
  });
  document.addEventListener("pointerdown", (e) => { if (isOpen(el) && !el.contains(e.target)) close(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  return {
    get isOpen() { return isOpen(el); },
    close,
    async open() {
      if (!flight.active) return;
      details = null;
      openPopup(el, () => clearInterval(timer));
      render();
      clearInterval(timer);
      timer = setInterval(render, 4000);
      const f = flight.fix;
      details = await flightDetails(f);
      if (isOpen(el) && flight.active) render();
    },
  };
}
