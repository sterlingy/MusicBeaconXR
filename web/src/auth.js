// Sign-in for sharing beacons (beacon database, step 3): email, with no
// password. Supabase sends one email holding a link (comes back to this
// page) and a 6-digit code (type it here; the app does the same). Talks to
// Supabase's auth REST API directly, no library. Listening never needs it.
//
// The session (access and refresh tokens) is kept in this browser's
// localStorage; signing out forgets it.

const STORE_KEY = "beacon.session";

export class Auth {
  constructor({ url, key, fetchFn = globalThis.fetch, storage = globalThis.localStorage }) {
    this.url = url;
    this.key = key;
    this.fetch = fetchFn;
    this.storage = storage;
    this.session = null;
    try { this.session = JSON.parse(storage?.getItem(STORE_KEY) || "null"); } catch { this.session = null; }
    this.listeners = new Set();
  }

  get user() { return this.session?.user || null; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _set(s) {
    this.session = s;
    try { s ? this.storage?.setItem(STORE_KEY, JSON.stringify(s)) : this.storage?.removeItem(STORE_KEY); } catch {}
    for (const fn of this.listeners) fn(this.user);
  }

  async _auth(path, body, token = null) {
    const res = await this.fetch(`${this.url}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: this.key, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.msg || data.error_description || data.message || `sign-in failed (${res.status})`);
    return data;
  }

  _fromTokens(d) {
    return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (+d.expires_in || 3600) * 1000, user: { id: d.user?.id, email: d.user?.email } };
  }

  /** Sends the sign-in email. `redirectTo`: where its link comes back to (this page). */
  async sendEmail(email, redirectTo) {
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
    await this._auth(`otp${q}`, { email: String(email).trim(), create_user: true });
  }

  /** Signs in with the 6-digit code from the email. */
  async verifyCode(email, code) {
    const d = await this._auth("verify", { type: "email", email: String(email).trim(), token: String(code).replace(/\s/g, "") });
    this._set(this._fromTokens(d));
    return this.user;
  }

  /**
   * Signs in from the email's link: it comes back with the tokens in the
   * address (#access_token=...). Clears them from the address either way.
   */
  async fromUrl(loc = globalThis.location, history = globalThis.history) {
    const h = new URLSearchParams((loc?.hash || "").replace(/^#/, ""));
    if (!h.get("access_token") && !h.get("error_description")) return null;
    history?.replaceState(null, "", loc.pathname + loc.search);
    if (h.get("error_description")) throw new Error(h.get("error_description"));
    const access = h.get("access_token");
    const res = await this.fetch(`${this.url}/auth/v1/user`, { headers: { apikey: this.key, Authorization: `Bearer ${access}` } });
    const user = await res.json();
    if (!res.ok) throw new Error(user.msg || "the sign-in link didn't work");
    this._set(this._fromTokens({ access_token: access, refresh_token: h.get("refresh_token"), expires_in: h.get("expires_in"), user }));
    return this.user;
  }

  /** A valid access token (refreshed when it's about to run out), or null when signed out. */
  async token() {
    const s = this.session;
    if (!s) return null;
    if (Date.now() < s.expires_at - 60000) return s.access_token;
    try {
      const d = await this._auth("token?grant_type=refresh_token", { refresh_token: s.refresh_token });
      this._set(this._fromTokens(d));
      return this.session.access_token;
    } catch {
      this._set(null); // the session ended; sign in again
      return null;
    }
  }

  async signOut() {
    const t = this.session?.access_token;
    this._set(null);
    if (t) await this._auth("logout", {}, t).catch(() => {});
  }

  /**
   * The REST API as the signed-in person: rest("POST", "grids", row) etc.
   * Resolves to the parsed response (rows), or throws with the server's reason.
   */
  async rest(method, path, body = undefined, { prefer = "return=representation" } = {}) {
    const t = await this.token();
    if (!t) throw new Error("sign in to share beacons");
    const res = await this.fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers: { apikey: this.key, Authorization: `Bearer ${t}`, "Content-Type": "application/json", Accept: "application/json", Prefer: prefer },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(friendly(data?.message || `${res.status}`));
    return data;
  }
}

/** The server's reasons, in plain words. */
export function friendly(m) {
  if (/daily limit/.test(m)) return m.replace("daily limit reached:", "That's today's limit:") + ". Try again tomorrow.";
  if (/accept the terms/.test(m)) return "Accept the sharing terms first.";
  if (/lower 48/.test(m)) return "For now, beacons can only be shared in the lower 48 United States.";
  if (/JWT|jwt/.test(m)) return "Your sign-in ran out. Sign in again.";
  if (/duplicate key/.test(m)) return "You already did that.";
  return m;
}
