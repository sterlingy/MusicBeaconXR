class_name FlightFollow
extends Node
## Following a flight in the app: a real aircraft, found by tail number or
## flight number, drives the listener on the globe. The app twin of
## web/src/flight.js (same dead reckoning and easing), except that the app
## asks adsb.lol directly (the website has to go through the database,
## because adsb.lol doesn't allow calls from web pages). Data: adsb.lol, ODbL 1.0.

## Ticket flight numbers use two-letter IATA airline codes (DL934); planes
## broadcast the three-letter ICAO code (DAL934). Same table as
## supabase/migrations/0004_airline_codes.sql.
const AIRLINE_ICAO := {"AA": "AAL", "DL": "DAL", "UA": "UAL", "WN": "SWA", "B6": "JBU", "AS": "ASA", "NK": "NKS", "F9": "FFT", "G4": "AAY", "HA": "HAL", "SY": "SCX", "MX": "MXY", "XP": "VXP", "QX": "QXE", "OO": "SKW", "YX": "RPA", "9E": "EDV", "MQ": "ENY", "OH": "JIA", "PT": "PDT", "ZW": "AWI", "C5": "UCA", "G7": "GJS", "YV": "ASH", "AC": "ACA", "WS": "WJA", "TS": "TSC", "PD": "POE", "F8": "FLE", "WG": "SWG", "FX": "FDX", "5X": "UPS", "5Y": "GTI", "K4": "CKS", "3S": "PAC", "AM": "AMX", "Y4": "VOI", "VB": "VIV", "CM": "CMP", "AV": "AVA", "LA": "LAN", "JJ": "TAM", "G3": "GLO", "AD": "AZU", "AR": "ARG", "H2": "SKU", "B7": "UIA", "BA": "BAW", "VS": "VIR", "U2": "EZY", "FR": "RYR", "LH": "DLH", "AF": "AFR", "KL": "KLM", "IB": "IBE", "VY": "VLG", "LX": "SWR", "OS": "AUA", "SN": "BEL", "SK": "SAS", "AY": "FIN", "DY": "NOZ", "D8": "IBK", "EI": "EIN", "TP": "TAP", "AZ": "ITY", "LO": "LOT", "W6": "WZZ", "EW": "EWG", "DE": "CFG", "TK": "THY", "PC": "PGT", "A3": "AEE", "FI": "ICE", "BT": "BTI", "OU": "CTN", "JU": "ASL", "EK": "UAE", "QR": "QTR", "EY": "ETD", "SV": "SVA", "GF": "GFA", "WY": "OMA", "RJ": "RJA", "LY": "ELY", "MS": "MSR", "ET": "ETH", "KQ": "KQA", "SA": "SAA", "AT": "RAM", "FZ": "FDB", "SQ": "SIA", "CX": "CPA", "JL": "JAL", "NH": "ANA", "KE": "KAL", "OZ": "AAR", "CI": "CAL", "BR": "EVA", "CA": "CCA", "MU": "CES", "CZ": "CSN", "HU": "CHH", "TG": "THA", "MH": "MAS", "GA": "GIA", "PR": "PAL", "VN": "HVN", "AI": "AIC", "6E": "IGO", "UK": "VTI", "QF": "QFA", "VA": "VOZ", "NZ": "ANZ", "JQ": "JST", "TR": "TGW", "AK": "AXM", "5J": "CEB", "MM": "APJ", "GK": "JJP", "HX": "CRK", "UO": "HKE", "7C": "JJA"}
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
	if qn.begins_with("HEX:"): # a random flight is followed by its transponder code
		return await _fetch("hex", qn.trim_prefix("HEX:").to_lower(), qn.trim_prefix("HEX:"))
	var clean := ""
	for c in qn:
		if (c >= "A" and c <= "Z") or (c >= "0" and c <= "9") or c == "-":
			clean += c
	if clean.length() < 2 or clean.length() > 10:
		return {"found": false, "reason": "Type a tail number (like N733YX) or a flight number (like DAL934 or DL934)."}
	# What to ask for, in order: [kind, value].
	var tries := []
	var ticket := RegEx.create_from_string("^([A-Z0-9]{2})([0-9]{1,4}[A-Z]?)$").search(clean)
	if ticket and AIRLINE_ICAO.has(ticket.get_string(1)):
		var num := ticket.get_string(2)
		var trimmed := num.lstrip("0")
		tries.append(["callsign", AIRLINE_ICAO[ticket.get_string(1)] + trimmed])
		if trimmed != num:
			tries.append(["callsign", AIRLINE_ICAO[ticket.get_string(1)] + num])
		tries.append(["reg", clean])
	elif RegEx.create_from_string("^[A-Z]{3}[0-9]{1,4}[A-Z]?$").search(clean):
		tries = [["callsign", clean], ["reg", clean]]
	else:
		tries = [["reg", clean], ["callsign", clean]]
	var last := {}
	for tr in tries:
		var kind: String = tr[0]
		var value: String = tr[1]
		var http := HTTPRequest.new()
		http.timeout = 10.0
		add_child(http)
		if http.request("https://api.adsb.lol/v2/%s/%s" % [kind, value], ["User-Agent: MusicBeaconXR"]) != OK:
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
			last = {"found": false, "reason": "%s%s isn't sending its position right now: it may be on the ground, out of coverage, or not flying today." % [clean, (" (%s)" % value) if value != clean else ""]}
			continue
		return parse_aircraft(best, float(body.get("now", now_s() * 1000.0)) / 1000.0)
	return last


## One adsb.lol aircraft record as a fix: position and motion, plus what the
## info card shows (squawk, climb rate, Mach, outside air temperature).
static func parse_aircraft(a: Dictionary, at: float) -> Dictionary:
	var alt = a.get("alt_baro", 0)
	return {"found": true, "reg": a.get("r", ""), "flight": String(a.get("flight", "")).strip_edges(), "type": a.get("t", ""),
		"hex": a.get("hex", ""), "lat": float(a.lat), "lon": float(a.lon), "alt_ft": 0.0 if alt is String else float(alt),
		"gs_kt": float(a.get("gs", 0.0)), "track": float(a.get("track", 0.0)), "seen_pos": float(a.get("seen_pos", 0.0)),
		"squawk": String(a.get("squawk", "")), "vrate": _num(a, "baro_rate"), "mach": _num(a, "mach"), "oat": _num(a, "oat"),
		"category": String(a.get("category", "")), "at": at}


static func _num(a: Dictionary, k: String) -> Variant:
	return float(a[k]) if a.has(k) and (a[k] is float or a[k] is int) else null


## One adsb.lol request for a single aircraft (kind: hex, reg or callsign).
func _fetch(kind: String, value: String, label: String) -> Dictionary:
	var body = await _http_get("https://api.adsb.lol/v2/%s/%s" % [kind, value])
	if body is String:
		return {"found": false, "reason": body}
	var best = null
	for a in body.get("ac", []):
		if a.has("lat") and (best == null or float(a.get("seen_pos", 99)) < float(best.get("seen_pos", 99))):
			best = a
	if best == null:
		return {"found": false, "reason": "%s isn't sending its position right now." % label}
	return parse_aircraft(best, float(body.get("now", now_s() * 1000.0)) / 1000.0)


## GETs JSON; returns the parsed body, or a String saying what went wrong.
func _http_get(url: String) -> Variant:
	var http := HTTPRequest.new()
	http.timeout = 12.0
	add_child(http)
	if http.request(url, ["User-Agent: MusicBeaconXR"]) != OK:
		http.queue_free()
		return "Couldn't reach the flight data service."
	var res: Array = await http.request_completed
	http.queue_free()
	if res[0] != HTTPRequest.RESULT_SUCCESS:
		return "Couldn't reach the flight data service."
	if res[1] != 200:
		return "The flight data service is busy (%s). Try again later." % res[1]
	var body = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	return body if body is Dictionary else "The flight data service sent something unreadable."


# ---------------------------------------------------------------- a random flight

## Busy airspace on every continent: a random flight is picked near one of these.
const HUBS := [[33.64, -84.43], [41.98, -87.9], [32.9, -97.04], [39.86, -104.67], [33.94, -118.4], [40.64, -73.78],
	[47.45, -122.31], [25.79, -80.29], [43.68, -79.63], [19.44, -99.07], [61.17, -150.0], [21.32, -157.92],
	[4.7, -74.15], [-12.02, -77.11], [-33.39, -70.79], [-34.82, -58.54], [-23.43, -46.47], [-22.81, -43.25],
	[51.47, -0.45], [50.03, 8.57], [52.31, 4.76], [49.01, 2.55], [40.47, -3.56], [41.8, 12.25], [41.26, 28.74],
	[55.97, 37.41], [30.12, 31.41], [6.58, 3.32], [-1.32, 36.93], [-26.14, 28.24], [25.25, 55.36], [25.27, 51.61],
	[28.56, 77.1], [19.09, 72.87], [13.69, 100.75], [2.75, 101.71], [1.36, 103.99], [-6.13, 106.66], [22.31, 113.91],
	[31.14, 121.81], [40.08, 116.6], [37.46, 126.44], [35.55, 139.78], [-33.94, 151.18], [-37.67, 144.84], [-37.0, 174.79]]


## Airborne, cruising, moving and named: a flight worth riding along with.
static func is_cruising(a: Dictionary) -> bool:
	var alt = a.get("alt_baro", 0)
	if not a.has("lat") or not (alt is float or alt is int):
		return false
	return float(alt) >= 18000.0 and float(a.get("gs", 0.0)) >= 250.0 and String(a.get("flight", "")).strip_edges().length() >= 3 and float(a.get("seen_pos", 99.0)) < 30.0


## The hubs in the order to try: where it's daytime now first (most flights in
## the air), shuffled within, so a quiet night here still finds a plane over
## the other side of the world.
static func hub_order(now: float) -> Array:
	var utc_h := fposmod(now / 3600.0, 24.0)
	var day := []
	var night := []
	for h in HUBS:
		var local := fposmod(utc_h + float(h[1]) / 15.0, 24.0)
		(day if local >= 7.0 and local <= 22.0 else night).append(h)
	day.shuffle()
	night.shuffle()
	return day + night


## Starts following a random flight in the air anywhere in the world. Returns "" or why it couldn't.
func start_random() -> String:
	var why := "No flights found right now. Try again in a moment."
	var tries := 0
	for h in hub_order(now_s()):
		tries += 1
		if tries > 8:
			break
		var body = await _http_get("https://api.adsb.lol/v2/point/%s/%s/250" % [h[0], h[1]])
		if body is String:
			why = body
			continue
		var pool: Array = body.get("ac", []).filter(func(a): return is_cruising(a))
		if pool.is_empty():
			continue
		# Airliners first (large and heavy categories), small planes only if that's all there is.
		var big := pool.filter(func(a): return String(a.get("category", "")) in ["A3", "A4", "A5"])
		if not big.is_empty():
			pool = big
		var a: Dictionary = pool.pick_random()
		query = "hex:" + String(a.hex)
		fix = parse_aircraft(a, float(body.get("now", now_s() * 1000.0)) / 1000.0)
		prev = {}
		lost = ""
		_last_poll = now_s()
		return ""
	return why


# ---------------------------------------------------------------- details for the info card

var _details := {} # callsign|hex -> {route, aircraft}


## The flight's airline, route and aircraft from adsbdb.com (cached). Route
## data comes from published schedules and can be stale for reused callsigns.
func details(f: Dictionary) -> Dictionary:
	var key := "%s|%s" % [f.get("flight", ""), f.get("hex", "")]
	if _details.has(key):
		return _details[key]
	var out := {}
	if String(f.get("flight", "")) != "":
		var r = await _http_get("https://api.adsbdb.com/v0/callsign/%s" % String(f.flight).uri_encode())
		if r is Dictionary and r.get("response") is Dictionary:
			out["route"] = r.response.get("flightroute", {})
	var id := String(f.get("reg", "")) if String(f.get("reg", "")) != "" else String(f.get("hex", ""))
	if id != "":
		var a = await _http_get("https://api.adsbdb.com/v0/aircraft/%s" % id.uri_encode())
		if a is Dictionary and a.get("response") is Dictionary:
			out["aircraft"] = a.response.get("aircraft", {})
	_details[key] = out
	return out


## Great-circle km between two lat/lon points.
static func km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
	var p1 := deg_to_rad(lat1)
	var p2 := deg_to_rad(lat2)
	var h := pow(sin((p2 - p1) / 2.0), 2) + cos(p1) * cos(p2) * pow(sin(deg_to_rad(lon2 - lon1) / 2.0), 2)
	return 2.0 * 6371.0 * asin(minf(1.0, sqrt(h)))


## Initial great-circle bearing (degrees from north) from one point to another.
static func bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
	var p1 := deg_to_rad(lat1)
	var p2 := deg_to_rad(lat2)
	var dl := deg_to_rad(lon2 - lon1)
	return fposmod(rad_to_deg(atan2(sin(dl) * cos(p2), cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl))), 360.0)


const COMPASS := ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


static func _s(d: Dictionary, k: String) -> String:
	return String(d[k]) if d.get(k) != null else ""


## What the info card says, worked out from the live fix and the details
## (pure: tests call it). `now` is unix seconds; `tz_offset_s` is your clock's
## offset from UTC. Returns {title, from, to, progress, lines: [...]}.
static func summary(f: Dictionary, d: Dictionary, now: float, tz_offset_s := 0.0) -> Dictionary:
	var lines := []
	var out := {"lines": lines}
	var route: Dictionary = d.get("route", {}) if d.get("route") is Dictionary else {}
	var air: Dictionary = d.get("aircraft", {}) if d.get("aircraft") is Dictionary else {}
	var airline: Dictionary = route.get("airline", {}) if route.get("airline") is Dictionary else {}
	var call := String(f.get("flight", ""))
	var iata := _s(route, "callsign_iata")
	out["title"] = "✈ %s%s" % [iata if iata != "" else call, (" · " + _s(airline, "name")) if _s(airline, "name") != "" else ""]
	# Fields for the card's layout (the lines say the same in words).
	out["code"] = iata if iata != "" else call
	out["callsign"] = call
	out["airline"] = _s(airline, "name")
	var o: Dictionary = route.get("origin", {}) if route.get("origin") is Dictionary else {}
	var de: Dictionary = route.get("destination", {}) if route.get("destination") is Dictionary else {}
	var gs := float(f.get("gs_kt", 0.0)) * 1.852 # km/h
	if not o.is_empty() and not de.is_empty():
		var total := km(float(o.latitude), float(o.longitude), float(de.latitude), float(de.longitude))
		var done := km(float(o.latitude), float(o.longitude), float(f.lat), float(f.lon))
		var left := km(float(f.lat), float(f.lon), float(de.latitude), float(de.longitude))
		# A route from schedules that the plane isn't actually flying (a reused callsign).
		var plausible := done + left < total * 1.25 + 150.0
		# Near one end the distances fit either way: a plane heading well away
		# from the destination is on some other flight (arriving, not leaving).
		if plausible and left > 300.0 and float(f.get("gs_kt", 0.0)) > 100.0:
			var off := absf(fposmod(bearing(float(f.lat), float(f.lon), float(de.latitude), float(de.longitude)) - float(f.get("track", 0.0)) + 180.0, 360.0) - 180.0)
			plausible = off < 100.0
		var oname := _s(o, "municipality") if _s(o, "municipality") != "" else _s(o, "name")
		var dname := _s(de, "municipality") if _s(de, "municipality") != "" else _s(de, "name")
		out["from"] = "%s (%s)" % [oname, _s(o, "iata_code") if _s(o, "iata_code") != "" else _s(o, "icao_code")]
		out["to"] = "%s (%s)" % [dname, _s(de, "iata_code") if _s(de, "iata_code") != "" else _s(de, "icao_code")]
		lines.append("%s → %s%s" % [out.from, out.to, "" if plausible else "  (route unconfirmed)"])
		out["o_code"] = _s(o, "iata_code") if _s(o, "iata_code") != "" else _s(o, "icao_code")
		out["d_code"] = _s(de, "iata_code") if _s(de, "iata_code") != "" else _s(de, "icao_code")
		out["o_city"] = oname
		out["d_city"] = dname
		out["plausible"] = plausible
		if not plausible:
			# The schedule is for some other flight that used this number: don't name its airline.
			out["code"] = call
			out["airline"] = ""
			out["title"] = "✈ " + call
		if plausible and done + left > 0.0:
			out["progress"] = clampf(done / (done + left), 0.0, 1.0)
			lines.append("%s km flown · %s km to go · %d%%" % [_thousands(done), _thousands(left), roundi(out.progress * 100.0)])
			if gs > 100.0:
				var to_go := left / gs * 3600.0
				var eta := int(now + to_go + tz_offset_s)
				out["to_go"] = _span(to_go)
				out["lands"] = Time.get_time_string_from_unix_time(eta).substr(0, 5)
				out["airborne"] = _span(done / (gs * 0.9) * 3600.0 + 1200.0)
				out["flown"] = "%s km" % _thousands(done)
				out["left"] = "%s km" % _thousands(left)
				lines.append("About %s to go · lands about %s your time (estimated)" % [out.to_go, out.lands])
				lines.append("In the air about %s so far (estimated)" % out.airborne)
	elif call != "":
		lines.append("Route not known for %s" % call)
	var alt := float(f.get("alt_ft", 0.0))
	var climb := ""
	if f.get("vrate") != null and absf(float(f.vrate)) > 300.0:
		climb = " · climbing" if float(f.vrate) > 0.0 else " · descending"
	lines.append("%s ft (%s m)%s" % [_thousands(alt), _thousands(alt * 0.3048), climb])
	out["alt"] = "%s ft" % _thousands(alt)
	out["alt_m"] = "%s m%s" % [_thousands(alt * 0.3048), climb]
	var kt := float(f.get("gs_kt", 0.0))
	var heading: String = COMPASS[int(fposmod(float(f.get("track", 0.0)) + 11.25, 360.0) / 22.5) % 16]
	var spd := "%d kt · %d mph · %d km/h · heading %s" % [roundi(kt), roundi(kt * 1.15078), roundi(kt * 1.852), heading]
	if f.get("mach") != null:
		spd += " · Mach %.2f" % float(f.mach)
		out["mach"] = "%.2f" % float(f.mach)
	lines.append(spd)
	out["speed"] = "%d kt" % roundi(kt)
	out["speed_alt"] = "%d mph · %d km/h" % [roundi(kt * 1.15078), roundi(kt * 1.852)]
	out["heading"] = "%s %d°" % [heading, roundi(fposmod(float(f.get("track", 0.0)), 360.0))]
	var plane := PackedStringArray()
	for k in ["manufacturer", "type"]:
		if _s(air, k) != "":
			plane.append(_s(air, k))
	if plane.is_empty() and String(f.get("type", "")) != "":
		plane.append(String(f.type))
	var who := PackedStringArray()
	if String(f.get("reg", "")) != "":
		who.append(String(f.reg))
	for k in ["registered_owner", "registered_owner_country_name"]:
		if _s(air, k) != "":
			who.append(_s(air, k))
	if not plane.is_empty() or not who.is_empty():
		lines.append("%s%s" % [" ".join(plane), (" · " + " · ".join(who)) if not who.is_empty() else ""])
	out["aircraft"] = " ".join(plane)
	out["owner"] = " · ".join(who)
	var extra := PackedStringArray()
	if f.get("oat") != null:
		extra.append("Outside %d °C" % roundi(float(f.oat)))
		out["oat"] = "%d °C" % roundi(float(f.oat))
	if String(f.get("squawk", "")) != "":
		extra.append("Squawk %s" % f.squawk)
		out["squawk"] = String(f.squawk)
	if not extra.is_empty():
		lines.append(" · ".join(extra))
	return out


static func _span(s: float) -> String:
	var m := roundi(s / 60.0)
	return "%d min" % m if m < 60 else "%d h %d min" % [m / 60, m % 60]


static func _thousands(x: float) -> String:
	var n := str(roundi(x))
	var neg := n.begins_with("-")
	n = n.trim_prefix("-")
	var out := ""
	while n.length() > 3:
		out = "," + n.substr(n.length() - 3) + out
		n = n.substr(0, n.length() - 3)
	return ("-" if neg else "") + n + out

