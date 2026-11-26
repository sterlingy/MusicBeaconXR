class_name BeaconAccount
extends Node
## Signing in and sharing beacons from the app (beacon database, step 3).
## The app twin of web/src/auth.js and web/src/submit.js: email sign-in with
## the 6-digit code from the email (the app can't open the email's link),
## then the same REST calls to the Supabase project. The server re-checks
## everything (supabase/migrations/0002_submit.sql).
##
## Every call is awaited and returns {ok: bool, data, error: String}.
## The session is kept in user://beacon_session.json; signing out forgets it.

signal signed_in_changed(email: String)

const SESSION_PATH := "user://beacon_session.json"
const TERMS_VERSION := "2026-11-26 CC BY 4.0"
const TERMS_TEXT := "Songs you share are published under Creative Commons Attribution 4.0 (CC BY 4.0): anyone may play, copy and remix them, with credit.\n\nA shared beacon shows a place: grids and planted songs are made where you stand, so sharing one shows that you were there. The date is kept, rounded to the day; your name and account are never shown with it.\n\nAnyone can report a beacon; after reports from 3 people it's hidden until it's reviewed.\n\nYou can unshare anything, or delete your account and everything you shared, at any time."
const REPORT_REASONS := ["offensive", "spam", "unsafe place", "private place", "other"]

var session := {}
## Where the session is kept (tests use another file).
var session_path := SESSION_PATH
## Tests set this: func(method, url, headers, body) -> {code, data}.
var fake_http := Callable()


func _ready() -> void:
	if FileAccess.file_exists(session_path):
		var s = JSON.parse_string(FileAccess.get_file_as_string(session_path))
		if typeof(s) == TYPE_DICTIONARY:
			session = s


func email() -> String:
	return String(session.get("user", {}).get("email", "")) if not session.is_empty() else ""


func signed_in() -> bool:
	return not session.is_empty()


func _save(s: Dictionary) -> void:
	session = s
	if s.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(session_path))
	else:
		var f := FileAccess.open(session_path, FileAccess.WRITE)
		if f:
			f.store_string(JSON.stringify(s))
	signed_in_changed.emit(email())


static func _from_tokens(d: Dictionary) -> Dictionary:
	return {"access_token": d.access_token, "refresh_token": d.refresh_token,
		"expires_at": Time.get_unix_time_from_system() + float(d.get("expires_in", 3600)),
		"user": {"id": d.get("user", {}).get("id", ""), "email": d.get("user", {}).get("email", "")}}


# ---------------------------------------------------------------- sign-in

func send_email(address: String) -> Dictionary:
	return await _call("POST", "/auth/v1/otp", {"email": address.strip_edges(), "create_user": true})


func verify_code(address: String, code: String) -> Dictionary:
	var r := await _call("POST", "/auth/v1/verify", {"type": "email", "email": address.strip_edges(), "token": code.replace(" ", "")})
	if r.ok:
		_save(_from_tokens(r.data))
	return r


func token() -> String:
	if session.is_empty():
		return ""
	if Time.get_unix_time_from_system() < float(session.expires_at) - 60.0:
		return session.access_token
	var r := await _call("POST", "/auth/v1/token?grant_type=refresh_token", {"refresh_token": session.refresh_token})
	if not r.ok:
		_save({})
		return ""
	_save(_from_tokens(r.data))
	return session.access_token


func sign_out() -> void:
	var t: String = session.get("access_token", "")
	_save({})
	if t != "":
		await _call("POST", "/auth/v1/logout", {}, t)


## The REST API as the signed-in person.
func rest(method: String, path: String, body: Variant = null, prefer := "return=representation") -> Dictionary:
	var t := await token()
	if t == "":
		return {"ok": false, "data": null, "error": "sign in to share beacons"}
	return await _call(method, "/rest/v1/" + path, body, t, prefer)


# ---------------------------------------------------------------- sharing

func has_consent() -> bool:
	var r := await rest("GET", "consents?select=terms")
	return r.ok and r.data is Array and not r.data.is_empty()


func accept_terms() -> Dictionary:
	return await rest("POST", "consents", {"terms": TERMS_VERSION}, "return=minimal")


func _upload_song(song: Dictionary) -> String:
	var r := await rest("POST", "songs?select=id", {"body": song})
	return r.data[0].id if r.ok else ""


## Shares a grid (edited songs first). Sets grid.sharedId on success.
func share_grid(grid: Dictionary) -> Dictionary:
	var edited := {}
	for pt in grid.edited:
		var id := await _upload_song(grid.edited[pt])
		if id == "":
			return {"ok": false, "error": "couldn't upload an edited song"}
		edited[pt] = id
	var r := await rest("POST", "grids?select=id", {"center": grid.center, "spacing_m": int(grid.spacingM), "variant": int(grid.variant),
		"variants": grid.variants, "edited": edited, "tiles": SharedMap.tiles_for_grid(grid)})
	if r.ok:
		grid.sharedId = r.data[0].id
	return r


func share_plant(plant: Dictionary) -> Dictionary:
	var sid := await _upload_song(plant.song)
	if sid == "":
		return {"ok": false, "error": "couldn't upload the song"}
	var pt := BeaconDrafts.parse_point(plant.point)
	var r := await rest("POST", "plants?select=id", {"point": plant.point, "tile": SharedMap.tile_key(pt.lat, pt.lon), "range_m": int(plant.rangeM), "song_id": sid})
	if r.ok:
		plant.sharedId = r.data[0].id
	return r


func share_map(map: Dictionary) -> Dictionary:
	if map.beacons.is_empty():
		return {"ok": false, "error": "put at least one beacon on the map first"}
	var beacons := []
	for b in map.beacons:
		var out := {"id": b.id, "lat": float(b.lat), "lon": float(b.lon), "range_m": int(b.rangeM)}
		if b.has("song"):
			var sid := await _upload_song(b.song)
			if sid == "":
				return {"ok": false, "error": "couldn't upload a song"}
			out.song_id = sid
		else:
			out.seed = BeaconDrafts.map_seed(b)
		beacons.append(out)
	var r := await rest("POST", "maps?select=id", {"name": map.name, "exclusive": bool(map.exclusive), "beacons": beacons})
	if r.ok:
		map.sharedId = r.data[0].id
	return r


func unshare(table: String, item: Dictionary) -> Dictionary:
	if not item.has("sharedId"):
		return {"ok": true}
	var r := await rest("DELETE", "%s?id=eq.%s" % [table, String(item.sharedId).uri_encode()], null, "return=minimal")
	if r.ok:
		item.erase("sharedId")
	return r


func report(entry: Dictionary, reason: String) -> Dictionary:
	return await rest("POST", "reports", {"target_kind": "plants" if entry.kind == "plant" else "grids", "target_id": entry.sharedId, "reason": reason}, "return=minimal")


func delete_account() -> Dictionary:
	var r := await rest("POST", "rpc/delete_my_account", {}, "return=minimal")
	if r.ok:
		_save({})
	return r


# ---------------------------------------------------------------- plumbing

func _call(method: String, path: String, body: Variant, bearer := "", prefer := "") -> Dictionary:
	var headers := ["apikey: " + SharedMap.SUPABASE_KEY, "Content-Type: application/json", "Accept: application/json"]
	if bearer != "":
		headers.append("Authorization: Bearer " + bearer)
	if prefer != "":
		headers.append("Prefer: " + prefer)
	var url := SharedMap.SUPABASE_URL + path
	var text := "" if body == null else JSON.stringify(body)
	var code := 0
	var data: Variant = null
	if fake_http.is_valid():
		var res: Dictionary = fake_http.call(method, url, headers, text)
		code = res.code
		data = res.data
	else:
		var http := HTTPRequest.new()
		http.timeout = 20.0
		add_child(http)
		var m: int = {"GET": HTTPClient.METHOD_GET, "POST": HTTPClient.METHOD_POST, "DELETE": HTTPClient.METHOD_DELETE}[method]
		if http.request(url, headers, m, text) != OK:
			http.queue_free()
			return {"ok": false, "data": null, "error": "couldn't reach the server"}
		var res: Array = await http.request_completed
		http.queue_free()
		if res[0] != HTTPRequest.RESULT_SUCCESS:
			return {"ok": false, "data": null, "error": "couldn't reach the server"}
		code = res[1]
		var s := (res[3] as PackedByteArray).get_string_from_utf8()
		data = JSON.parse_string(s) if s != "" else null
	if code >= 200 and code < 300:
		return {"ok": true, "data": data, "error": ""}
	var msg := ""
	if typeof(data) == TYPE_DICTIONARY:
		msg = String(data.get("msg", data.get("message", data.get("error_description", ""))))
	return {"ok": false, "data": data, "error": friendly(msg if msg != "" else "error %d" % code)}


## The server's reasons, in plain words (as web/src/auth.js friendly).
static func friendly(m: String) -> String:
	if m.contains("daily limit"):
		return m.replace("daily limit reached:", "That's today's limit:") + ". Try again tomorrow."
	if m.contains("accept the terms"):
		return "Accept the sharing terms first."
	if m.contains("lower 48"):
		return "For now, beacons can only be shared in the lower 48 United States."
	if m.to_lower().contains("jwt"):
		return "Your sign-in ran out. Sign in again."
	if m.contains("duplicate key"):
		return "You already did that."
	return m
