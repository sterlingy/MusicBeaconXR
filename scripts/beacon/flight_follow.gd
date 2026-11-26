class_name FlightFollow
extends Node
## Following a flight in the app: a real aircraft, found by tail number or
## flight number, drives the listener on the globe. The app twin of
## web/src/flight.js (same dead reckoning and easing), except that the app
## asks adsb.lol directly (the website has to go through the database,
## because adsb.lol doesn't allow calls from web pages). Data: adsb.lol, ODbL 1.0.

const POLL_S := 20.0
const MAX_AHEAD_S := 90.0
const EASE_S := 4.0
const R_M := 6371008.8

var query := ""
var fix := {}
var prev := {}
var lost := ""
var _ease_from := 0.0
var _last_poll := 0.0
var _polling := false


static func now_s() -> float:
	return Time.get_unix_time_from_system()


func active() -> bool:
	return not fix.is_empty()


## The point `m` meters from lat/lon on bearing `deg`.
static func destination(lat: float, lon: float, deg: float, m: float) -> Dictionary:
	var d := m / R_M
	var b := deg_to_rad(deg)
	var la := deg_to_rad(lat)
	var la2 := asin(sin(la) * cos(d) + cos(la) * sin(d) * cos(b))
	var lo2 := deg_to_rad(lon) + atan2(sin(b) * sin(d) * cos(la), cos(d) - sin(la) * sin(la2))
	return {"lat": rad_to_deg(la2), "lon": fposmod(rad_to_deg(lo2) + 180.0, 360.0) - 180.0}


static func project(f: Dictionary, t: float) -> Dictionary:
	var dt := clampf(t - (float(f.at) - float(f.get("seen_pos", 0.0))), 0.0, MAX_AHEAD_S)
	if float(f.get("gs_kt", 0.0)) <= 0.0:
		return {"lat": f.lat, "lon": f.lon}
	return destination(f.lat, f.lon, f.track, f.gs_kt * 0.514444 * dt)


static func describe(f: Dictionary) -> String:
	var parts := PackedStringArray()
	for k in ["reg", "flight", "type"]:
		if String(f.get(k, "")) != "" and not (k == "flight" and f.flight == f.get("reg", "")):
			parts.append(String(f[k]))
	var alt := ("%s ft" % String.num_int64(roundi(f.alt_ft))) if float(f.alt_ft) > 0.0 else "on the ground"
	return "%s · %s · %d kt" % [" · ".join(parts), alt, roundi(float(f.get("gs_kt", 0.0)))]


## Finds the flight. Returns "" when found, else the reason.
func start(q: String) -> String:
	var f := await lookup(q)
	if not f.get("found", false):
		return String(f.get("reason", "That flight wasn't found."))
	query = q
	fix = f
	prev = {}
	lost = ""
	_last_poll = now_s()
	return ""


func stop() -> void:
	fix = {}
	prev = {}
	query = ""


## Where the listener should be now ({} when not following).
func position() -> Dictionary:
	if fix.is_empty():
		return {}
	var t := now_s()
	_poll()
	var p := project(fix, t)
	if prev.is_empty():
		return p
	var k := minf(1.0, (t - _ease_from) / EASE_S)
	if k >= 1.0:
		prev = {}
		return p
	var q := project(prev, t)
	var s := k * k * (3.0 - 2.0 * k)
	return {"lat": q.lat + (p.lat - q.lat) * s, "lon": q.lon + (fposmod(p.lon - q.lon + 180.0, 360.0) - 180.0) * s}


func _poll() -> void:
	if _polling or now_s() - _last_poll < POLL_S:
		return
	_polling = true
	_last_poll = now_s()
	var f := await lookup(query)
	_polling = false
	if fix.is_empty():
		return
	if f.get("found", false):
		prev = fix
		fix = f
		_ease_from = now_s()
		lost = ""
	else:
		lost = String(f.get("reason", "no update"))


## Asks adsb.lol by registration, then by callsign (or the other way round for flight numbers).
func lookup(q: String) -> Dictionary:
	var qn := q.to_upper().strip_edges()
	var clean := ""
	for c in qn:
		if (c >= "A" and c <= "Z") or (c >= "0" and c <= "9") or c == "-":
			clean += c
	if clean.length() < 2 or clean.length() > 10:
		return {"found": false, "reason": "Type a tail number (like N733YX) or a flight number (like UAL123)."}
	var re := RegEx.create_from_string("^[A-Z]{3}[0-9]{1,4}[A-Z]?$")
	var kinds := ["callsign", "reg"] if re.search(clean) else ["reg", "callsign"]
	var last := {}
	for kind in kinds:
		var http := HTTPRequest.new()
		http.timeout = 10.0
		add_child(http)
		if http.request("https://api.adsb.lol/v2/%s/%s" % [kind, clean], ["User-Agent: MusicBeaconXR"]) != OK:
			http.queue_free()
			return {"found": false, "reason": "Couldn't reach the flight data service."}
		var res: Array = await http.request_completed
		http.queue_free()
		if res[0] != HTTPRequest.RESULT_SUCCESS or res[1] != 200:
			return {"found": false, "reason": "The flight data service is busy (%s). Try again later." % res[1]}
		var body = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
		var best = null
		for a in (body.get("ac", []) if body is Dictionary else []):
			if a.has("lat") and (best == null or float(a.get("seen_pos", 99)) < float(best.get("seen_pos", 99))):
				best = a
		if best == null:
			last = {"found": false, "reason": "%s isn't sending its position right now (on the ground, out of coverage, or not found)." % clean}
			continue
		var alt = best.get("alt_baro", 0)
		return {"found": true, "reg": best.get("r", ""), "flight": String(best.get("flight", "")).strip_edges(), "type": best.get("t", ""),
			"hex": best.get("hex", ""), "lat": float(best.lat), "lon": float(best.lon), "alt_ft": 0.0 if alt is String else float(alt),
			"gs_kt": float(best.get("gs", 0.0)), "track": float(best.get("track", 0.0)), "seen_pos": float(best.get("seen_pos", 0.0)),
			"at": float(body.get("now", now_s() * 1000.0)) / 1000.0}
	return last
