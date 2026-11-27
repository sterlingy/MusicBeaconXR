// The followed plane, drawn to look 3D (like the app's smooth model): a soft
// shadow under it, swept wings and tailplane, two engines, a rounded fuselage
// lit from the top left with a highlight along it, and cockpit windows. Nose
// up before rotating; about 46 units long at scale 1.

/** Draws the plane at (x, y), turned by `angle` (radians, 0 = nose up), `scale` canvas px per unit, in `color` (hex). */
export function drawPlane3D(g, x, y, angle, scale, color) {
  const light = shade(color, 0.45), mid = color, dark = shade(color, -0.35), deep = shade(color, -0.55);
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(scale, scale);
  g.lineJoin = "round";

  // Shadow on the ground below, offset away from the light.
  g.save();
  g.translate(5, 7);
  g.globalAlpha = 0.28;
  g.fillStyle = "#000";
  silhouette(g);
  g.fill();
  g.restore();

  // Engines first: seen from above, the wings hide all but their fronts.
  for (const s of [-1, 1]) {
    const ex = 9.2 * s;
    const eg = g.createLinearGradient(ex - 2.2, 0, ex + 2.2, 0);
    eg.addColorStop(0, light); eg.addColorStop(0.5, mid); eg.addColorStop(1, deep);
    g.fillStyle = eg;
    g.strokeStyle = shade(color, -0.7);
    g.lineWidth = 0.8;
    g.beginPath();
    roundRect(g, ex - 2.2, -6.5, 4.4, 8, 2.1);
    g.fill(); g.stroke();
    g.fillStyle = shade(color, -0.75); // intake
    g.beginPath(); g.ellipse(ex, -6.2, 1.5, 0.7, 0, 0, Math.PI * 2); g.fill();
  }
  // Wings, then tailplane (behind the fuselage).
  for (const s of [-1, 1]) {
    wing(g, s, [[3, -6], [21, 4], [21, 7.5], [3.5, 3]], light, dark, deep);
    wing(g, s, [[2.2, 13], [9, 18.5], [9, 20.5], [2.2, 17.5]], light, dark, deep);
  }
  // Fuselage: round across, lit from the left.
  const fg = g.createLinearGradient(-4, 0, 4, 0);
  fg.addColorStop(0, light);
  fg.addColorStop(0.45, mid);
  fg.addColorStop(1, deep);
  g.fillStyle = fg;
  g.strokeStyle = shade(color, -0.7);
  g.lineWidth = 0.9;
  body(g);
  g.fill(); g.stroke();
  // Highlight along the top.
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 1.1;
  g.lineCap = "round";
  g.beginPath(); g.moveTo(-1.3, -18); g.quadraticCurveTo(-1.8, 0, -1.1, 14); g.stroke();
  // Fin, seen from above: a thin ridge at the tail.
  g.strokeStyle = deep;
  g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(0, 12); g.lineTo(0, 21.5); g.stroke();
  // Cockpit windows.
  g.fillStyle = "rgba(10,16,28,0.85)";
  g.beginPath(); g.moveTo(-2.4, -18.5); g.quadraticCurveTo(0, -20.5, 2.4, -18.5); g.lineTo(2.1, -17.2); g.quadraticCurveTo(0, -18.6, -2.1, -17.2); g.closePath(); g.fill();
  g.restore();
}

/** The fuselage outline: a rounded nose, a long body, a tail that tapers. */
function body(g) {
  g.beginPath();
  g.moveTo(0, -24);
  g.bezierCurveTo(2.6, -24, 3.6, -20, 3.6, -16);
  g.lineTo(3.6, 8);
  g.bezierCurveTo(3.6, 14, 2, 19, 0.9, 22);
  g.lineTo(-0.9, 22);
  g.bezierCurveTo(-2, 19, -3.6, 14, -3.6, 8);
  g.lineTo(-3.6, -16);
  g.bezierCurveTo(-3.6, -20, -2.6, -24, 0, -24);
  g.closePath();
}

/** The whole plane's outline, for its shadow. */
function silhouette(g) {
  body(g);
  for (const s of [-1, 1]) {
    for (const pts of [[[3, -6], [21, 4], [21, 7.5], [3.5, 3]], [[2.2, 13], [9, 18.5], [9, 20.5], [2.2, 17.5]]]) {
      g.moveTo(pts[0][0] * s, pts[0][1]);
      for (const [px, py] of pts.slice(1)) g.lineTo(px * s, py);
      g.closePath();
    }
  }
}

/** A wing (or half tailplane) on side `s`: lighter at the root, darker at the tip and trailing edge. */
function wing(g, s, pts, light, dark, deep) {
  const wg = g.createLinearGradient(pts[0][0] * s, pts[0][1], pts[1][0] * s, pts[2][1]);
  wg.addColorStop(0, light);
  wg.addColorStop(1, dark);
  g.fillStyle = wg;
  g.strokeStyle = deep;
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(pts[0][0] * s, pts[0][1]);
  // A gently curved leading edge.
  g.quadraticCurveTo((pts[0][0] + pts[1][0]) * 0.5 * s, (pts[0][1] + pts[1][1]) * 0.5 - 1.2, pts[1][0] * s, pts[1][1]);
  for (const [px, py] of pts.slice(2)) g.lineTo(px * s, py);
  g.closePath();
  g.fill(); g.stroke();
}

function roundRect(g, x, y, w, h, r) {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A hex colour lightened (k > 0, toward white) or darkened (k < 0, toward black). */
export function shade(hex, k) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "");
  if (!m) return hex;
  const c = [1, 2, 3].map((i) => parseInt(m[i], 16));
  const t = k >= 0 ? 255 : 0, f = Math.abs(k);
  const o = c.map((v) => Math.round(v + (t - v) * f));
  return `#${o.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
