// The beacons driving the music glow by how much each one drives it (as the
// app's globe): a soft halo in the beacon's colour that grows and brightens
// with its share. Drawn under the beacon, blended normally so it shows on the
// light theme as well as the dark.

/**
 * A share-of-the-music glow at (x, y). `across` is its full width in canvas
 * pixels at the beacon's strongest; `w` its share (0..1); `lead` adds a touch
 * for the beacon setting the key.
 */
export function shareGlow(g, x, y, across, color, w, lead = false) {
  if (!(w > 0.01)) return;
  const r = Math.max(2, (across / 2) * (0.35 + 0.65 * Math.min(1, w)));
  const a = Math.min(1, 0.3 + 0.7 * w + (lead ? 0.1 : 0));
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color);
  gr.addColorStop(0.25, color);
  gr.addColorStop(1, clear(color)); // fades to its own colour, not to black
  g.globalAlpha = a * 0.5;
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
}

/** The same colour, fully transparent ("#5ad1c4" -> "rgba(90,209,196,0)"). */
function clear(color) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color || "");
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0)` : "rgba(0,0,0,0)";
}
