// Following a flight: the listener rides along with a real aircraft, found
// by tail number (registration), flight number (callsign) or transponder
// code. No DOM. Positions come from adsb.lol (ODbL 1.0) through the
// database's flight_lookup function (supabase/migrations/0003_flights.sql),
// because adsb.lol doesn't allow calls from web pages. The app calls
// adsb.lol directly (scripts/beacon/flight_follow.gd), with the same maths.
//
// A fix arrives every POLL_S seconds; in between, the plane is carried
// along its ground speed and track (dead reckoning), and each new fix is
// eased in over a few seconds, so the music glides instead of jumping.

const R_M = 6371008.8;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const POLL_S = 20;
/** No dead reckoning beyond this many seconds after a fix (the plane may have turned). */
export const MAX_AHEAD_S = 90;
/** A new fix is eased in over this many seconds. */
export const EASE_S = 4;

/** The point `m` meters from lat/lon on bearing `deg` (great circle). */
export function destination(lat, lon, deg, m) {
  const d = m / R_M, b = deg * D2R, la = lat * D2R, lo = lon * D2R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { lat: la2 * R2D, lon: ((((lo2 * R2D) % 360) + 540) % 360) - 180 };
}

/** Where a fix says the plane is at time `t` (seconds since 1970): carried along its speed and track. */
export function project(fix, t) {
  const seenAt = fix.at - (fix.seen_pos || 0);
  const dt = Math.max(0, Math.min(MAX_AHEAD_S, t - seenAt));
  if (!fix.gs_kt || !Number.isFinite(fix.track)) return { lat: fix.lat, lon: fix.lon };
  return destination(fix.lat, fix.lon, fix.track, fix.gs_kt * 0.514444 * dt);
}

/** "N733YX · RPA3457 · E75L · 2,300 ft · 197 kt" */
export function describe(fix) {
  const parts = [fix.reg, fix.flight && fix.flight !== fix.reg ? fix.flight : null, fix.type].filter(Boolean);
  const alt = fix.alt_ft > 0 ? `${Math.round(fix.alt_ft).toLocaleString()} ft` : "on the ground";
  return `${parts.join(" · ")} · ${alt}${fix.gs_kt ? ` · ${Math.round(fix.gs_kt)} kt` : ""}`;
}

/** Asks the database for a flight (with the public key). */
export function supabaseFlightLookup({ url, key, fetchFn = globalThis.fetch }) {
  return async (query) => {
    const res = await fetchFn(`${url}/rest/v1/rpc/flight_lookup`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`the flight lookup failed (${res.status})`);
    return res.json();
  };
}

export class FlightTracker {
  /** `lookup(query)` resolves to a fix ({found, lat, lon, gs_kt, track, at, seen_pos, ...}); `now()` is seconds since 1970. */
  constructor({ lookup, now = () => Date.now() / 1000 }) {
    this.lookup = lookup;
    this.now = now;
    this.query = "";
    this.fix = null;
    this.prev = null; // the fix before, for easing
    this.easeFrom = 0;
    this.lastPoll = 0;
    this.polling = false;
    this.lost = ""; // why the latest update failed (it keeps gliding on the last fix)
  }

  get active() { return !!this.fix; }

  /** Finds the flight; resolves to the first fix, or throws with the reason. */
  async start(query) {
    const f = await this.lookup(query);
    if (!f || !f.found) throw new Error(f?.reason || "That flight wasn't found.");
    this.query = query;
    this.fix = f;
    this.prev = null;
    this.lastPoll = this.now();
    this.lost = "";
    return f;
  }

  stop() { this.fix = null; this.prev = null; this.query = ""; }

  /** Call often: fetches a new fix every POLL_S seconds. Resolves true when one arrived. */
  async poll() {
    if (!this.fix || this.polling || this.now() - this.lastPoll < POLL_S) return false;
    this.polling = true;
    this.lastPoll = this.now();
    try {
      const f = await this.lookup(this.query);
      if (!this.fix) return false; // stopped meanwhile
      if (f?.found) {
        this.prev = this.fix;
        this.fix = f;
        this.easeFrom = this.now();
        this.lost = "";
        return true;
      }
      this.lost = f?.reason || "no update";
      return false;
    } catch (err) {
      this.lost = err.message;
      return false;
    } finally { this.polling = false; }
  }

  /** Where the listener should be now. */
  position(t = this.now()) {
    if (!this.fix) return null;
    const p = project(this.fix, t);
    if (!this.prev) return p;
    const k = Math.min(1, (t - this.easeFrom) / EASE_S);
    if (k >= 1) { this.prev = null; return p; }
    const q = project(this.prev, t);
    const s = k * k * (3 - 2 * k);
    return { lat: q.lat + (p.lat - q.lat) * s, lon: q.lon + (((((p.lon - q.lon) % 360) + 540) % 360) - 180) * s };
  }
}
