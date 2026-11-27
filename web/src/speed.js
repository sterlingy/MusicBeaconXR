// Travel speed, the same as the app's (scripts/beacon/speed_ui.gd): a log
// slider from 1 m/s (walking) to 250 m/s (a jet cruising) that snaps to
// 1, 2, 5, 10, 25, 50, 100 and 250 m/s and names the ranges. It's the real
// speed on every map, the globe included: from the whole Earth even 100 m/s
// barely moves, so going far is Move or Jump.

export const MIN = 1;
export const MAX = 250;
export const MARKS = [1, 2, 5, 10, 25, 50, 100, 250];
/** Named ranges: [from m/s, short name, full name]. */
export const BANDS = [[1, "Walk", "Walk"], [2, "Jog", "Jog"], [4, "Run", "Run"], [8, "Bike", "Bike"],
  [15, "Drive", "Drive"], [35, "Train", "Train"], [60, "Bullet", "Bullet train"],
  [100, "Prop", "Prop plane"], [180, "Jet", "Jet"]];
/** How close (in slider travel, 0..1) snaps to a mark. */
export const SNAP = 0.035;
/** Metres in a degree of latitude: the globe walks in degrees. */
export const M_PER_DEG = 111320;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Slider travel (0..1) for a speed, and back. */
export const toT = (v) => Math.log(clamp(v, MIN, MAX) / MIN) / Math.log(MAX / MIN);
export const fromT = (t) => MIN * Math.pow(MAX / MIN, clamp(t, 0, 1));

/** The speed for a slider position, snapped to a mark when it's close to one. */
export function snappedSpeed(t) {
  for (const m of MARKS) if (Math.abs(toT(m) - t) < SNAP) return m;
  const v = fromT(t);
  return v >= 10 ? Math.round(v) : Math.round(v * 2) / 2;
}

export const label = (v) => (v >= 2 || Number.isInteger(v) ? `${Math.round(v)} m/s` : `${v.toFixed(1)} m/s`);

/** The named range a speed falls in ("Walk" … "Jet"). */
export function bandOf(v) {
  let name = BANDS[0][2];
  for (const b of BANDS) if (v >= b[0] - 0.001) name = b[2];
  return name;
}

/** "25 m/s · Drive · 90 km/h" */
export const describe = (v) => `${label(v)} · ${bandOf(v)} · ${Math.round(v * 3.6)} km/h`;
