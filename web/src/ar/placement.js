// Where the field sits in an XR floor space: an anchor point, a heading and a
// scale (real meters per field meter). Pure math, shared by the AR page and tests.
// Field positions are {x, y} meters with +y south (the map's down); world is
// WebXR's: x right, y up, z toward the viewer.

/** Real meters per field meter for each choice. 1:50 puts the 500 m grid in a 10 m room. */
export const SCALES = [1, 1 / 10, 1 / 25, 1 / 50, 1 / 100, 1 / 200];

/** World point [x, y, z] for field position `p`, `y` meters above the floor. */
export function worldOf(s, p, y = 0) {
  const c = Math.cos(s.theta), sn = Math.sin(s.theta);
  return [s.anchor.x + s.scale * (c * p.x + sn * p.y), s.anchor.y + y, s.anchor.z + s.scale * (-sn * p.x + c * p.y)];
}

/** Field position for a world floor point. */
export function fieldOf(s, wx, wz) {
  const c = Math.cos(s.theta), sn = Math.sin(s.theta);
  const dx = (wx - s.anchor.x) / s.scale, dz = (wz - s.anchor.z) / s.scale;
  return { x: c * dx - sn * dz, y: sn * dx + c * dz };
}

/**
 * Lays the field so field position `p` is under the viewer at world (hx, hz)
 * and the field's north (the map's up) points the way they face (fwdX, fwdZ).
 */
export function placeAt(s, p, hx, floorY, hz, fwdX, fwdZ) {
  s.theta = Math.atan2(-fwdX, -fwdZ);
  s.anchor = { x: 0, y: floorY, z: 0 };
  const w = worldOf(s, p, 0);
  s.anchor = { x: hx - w[0], y: floorY, z: hz - w[2] };
}
