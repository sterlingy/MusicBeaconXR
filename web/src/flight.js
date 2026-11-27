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
/** A position report older than this (seconds) means the plane isn't being seen. */
export const STALE_S = 60;

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
    // From here on, ask for this aircraft only (its transponder code): a flight
    // number can match another plane, and a failed update must never switch planes.
    this.query = f.hex || query;
    this.fix = f;
    this.prev = null;
    this.lastPoll = this.now();
    this.lost = "";
    return f;
  }

  /** Follows a flight already found (a random one), polling it by `query` (its transponder code). */
  startWith(fix, query) {
    this.query = query;
    this.fix = fix;
    this.prev = null;
    this.lastPoll = this.now();
    this.lost = "";
    return fix;
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
      if (f?.found && this.fix.hex && f.hex && f.hex.toLowerCase() !== this.fix.hex.toLowerCase()) {
        this.lost = "a different aircraft answered"; // never switch planes: keep gliding on this one
        return false;
      }
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

  /** How old the plane's last position report is, in seconds. */
  dataAge(t = this.now()) { return this.fix ? Math.max(0, t - ((this.fix.at || t) - (this.fix.seen_pos || 0))) : Infinity; }

  /**
   * Whether we can see the plane: the last update worked and its position
   * report is under a minute old. Otherwise it glides on along its last course.
   */
  get tracked() { return !!this.fix && !this.lost && this.dataAge() < STALE_S; }

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

// ---------------------------------------------------------------- random flights and the info card

/** Asks the database for a random flight in the air (supabase/migrations/0005_flight_random.sql). */
export function supabaseFlightRandom({ url, key, fetchFn = globalThis.fetch }) {
  return async () => {
    const res = await fetchFn(`${url}/rest/v1/rpc/flight_random`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}",
    });
    if (!res.ok) throw new Error(`the flight lookup failed (${res.status})`);
    return res.json();
  };
}

/**
 * Finds a random flight in the air: asks up to `tries` times (a quiet hub
 * answers "retry", and the next ask tries another hub). Resolves to a fix.
 */
export async function randomFlight(random, { tries = 6, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await random();
    if (last?.found) return last;
    if (!last?.retry) break;
    await wait(1600);
  }
  throw new Error(last?.reason || "No flights found right now. Try again in a moment.");
}

const detailCache = new Map();

/**
 * The flight's airline, route and aircraft from adsbdb.com (cached; it
 * allows calls from web pages). Route data comes from published schedules
 * and can be stale for reused callsigns: flightSummary checks it.
 */
export async function flightDetails(fix, fetchFn = globalThis.fetch) {
  const key = `${fix.flight || ""}|${fix.hex || ""}`;
  if (detailCache.has(key)) return detailCache.get(key);
  const get = async (u) => { try { const r = await fetchFn(u); return r.ok ? (await r.json())?.response : null; } catch { return null; } };
  const out = {};
  if (fix.flight) { const r = await get(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(fix.flight)}`); if (r?.flightroute) out.route = r.flightroute; }
  const id = fix.reg || fix.hex;
  if (id) { const a = await get(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(id)}`); if (a?.aircraft) out.aircraft = a.aircraft; }
  detailCache.set(key, out);
  return out;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const kmBetween = (a1, o1, a2, o2) => {
  const D = Math.PI / 180, p1 = a1 * D, p2 = a2 * D;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((o2 - o1) * D) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};
const th = (x) => Math.round(x).toLocaleString("en-US");
const span = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

/**
 * What the info card shows, from the live fix and the details. Same rules as
 * FlightFollow.summary in the app. `now` is seconds since 1970.
 */
export function flightSummary(f, d = {}, now = Date.now() / 1000) {
  const route = d.route || {}, air = d.aircraft || {}, airline = route.airline || {};
  const call = f.flight || "";
  const out = { code: route.callsign_iata || call, callsign: call, airline: airline.name || "" };
  const o = route.origin, de = route.destination;
  const gs = (f.gs_kt || 0) * 1.852;
  if (o && de) {
    const total = kmBetween(o.latitude, o.longitude, de.latitude, de.longitude);
    const done = kmBetween(o.latitude, o.longitude, f.lat, f.lon), left = kmBetween(f.lat, f.lon, de.latitude, de.longitude);
    out.plausible = done + left < total * 1.25 + 150;
    // Near one end the distances fit either way: a plane heading well away
    // from the destination is on some other flight (arriving, not leaving).
    if (out.plausible && left > 300 && (f.gs_kt || 0) > 100) {
      const D = Math.PI / 180, p1 = f.lat * D, p2 = de.latitude * D, dl = (de.longitude - f.lon) * D;
      const brg = (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D + 360) % 360;
      out.plausible = Math.abs(((brg - (f.track || 0) + 540) % 360) - 180) < 100;
    }
    Object.assign(out, { oCode: o.iata_code || o.icao_code, dCode: de.iata_code || de.icao_code, oCity: o.municipality || o.name, dCity: de.municipality || de.name });
    if (!out.plausible) { out.code = call; out.airline = ""; } // that schedule is some other flight with this number
    else if (done + left > 0) {
      out.progress = Math.max(0, Math.min(1, done / (done + left)));
      out.flown = `${th(done)} km`;
      out.left = `${th(left)} km`;
      if (gs > 100) {
        const toGo = (left / gs) * 3600;
        out.toGo = span(toGo);
        out.lands = new Date((now + toGo) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        out.airborne = span((done / (gs * 0.9)) * 3600 + 1200);
      }
    }
  }
  const alt = f.alt_ft || 0;
  const climb = f.vrate != null && Math.abs(f.vrate) > 300 ? (f.vrate > 0 ? " · climbing" : " · descending") : "";
  out.alt = `${th(alt)} ft`;
  out.altM = `${th(alt * 0.3048)} m${climb}`;
  const kt = f.gs_kt || 0;
  out.speed = `${Math.round(kt)} kt`;
  out.speedAlt = `${Math.round(kt * 1.15078)} mph · ${Math.round(kt * 1.852)} km/h`;
  const tr = (((f.track || 0) % 360) + 360) % 360;
  out.heading = `${COMPASS[Math.floor((tr + 11.25) / 22.5) % 16]} ${Math.round(tr)}°`;
  if (f.mach != null) out.mach = f.mach.toFixed(2);
  if (f.oat != null) out.oat = `${Math.round(f.oat)} °C`;
  if (f.squawk) out.squawk = f.squawk;
  out.aircraft = [air.manufacturer, air.type].filter(Boolean).join(" ") || f.type || "";
  out.owner = [f.reg, air.registered_owner, air.registered_owner_country_name].filter(Boolean).join(" · ");
  return out;
}
