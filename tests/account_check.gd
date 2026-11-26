extends SceneTree
## Signing in and sharing from the app (BeaconAccount), against a fake server:
## the same calls as the website's (web/tests/submit.test.mjs).
##   godot --headless --path . -s res://tests/account_check.gd

var failures := 0
var calls := []
var _n := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


func fake(method: String, url: String, headers: Array, body: String) -> Dictionary:
	calls.append({"method": method, "url": url, "headers": headers, "body": JSON.parse_string(body) if body != "" else null})
	if url.ends_with("/auth/v1/verify"):
		var b = JSON.parse_string(body)
		if b.token != "123456":
			return {"code": 400, "data": {"msg": "Token has expired or is invalid"}}
		return {"code": 200, "data": {"access_token": "A1", "refresh_token": "R1", "expires_in": 3600, "user": {"id": "u1", "email": "a@b.c"}}}
	if url.contains("/rest/v1/consents?select"):
		return {"code": 200, "data": [{"terms": "x"}]}
	if url.contains("/rest/v1/grids") and method == "POST":
		return {"code": 400, "data": {"message": "daily limit reached: 5 grids a day"}}
	if url.contains("?select=id"):
		_n += 1
		return {"code": 201, "data": [{"id": "id-%d" % _n}]}
	return {"code": 200, "data": null}


func _init() -> void:
	var acc := BeaconAccount.new()
	acc.session_path = "user://account_check_session.json"
	acc.fake_http = fake
	root.add_child(acc)
	await process_frame
	var r := await acc.verify_code("a@b.c", "000000")
	check(not r.ok and r.error.contains("invalid"), "a wrong code is refused")
	r = await acc.verify_code(" a@b.c ", "123 456")
	check(r.ok and acc.signed_in() and acc.email() == "a@b.c", "signed in with the code")
	check(await acc.has_consent(), "consent read")
	check(calls[-1].headers.has("Authorization: Bearer A1"), "REST calls carry the token")

	var d := BeaconDrafts.new()
	d.path = ""
	var g := d.make_grid(30.2672, -97.7431, 1000)
	var pt: String = BeaconDrafts.grid_points(g.center, 1000)[3].id
	g.edited[pt] = SongGen.generate("edited")
	calls.clear()
	r = await acc.share_grid(g)
	check(not r.ok and r.error.contains("today's limit"), "the server's limit comes back in plain words: %s" % r.error)
	check(calls[0].url.contains("/rest/v1/songs") and calls[1].url.contains("/rest/v1/grids"), "edited songs go up first")
	check(calls[1].body.edited == {pt: "id-1"} and calls[1].body.tiles == ["30_-98"] and not calls[1].body.has("owner"), "grid row: %s" % calls[1].body)

	var p := d.plant_song(30.2672, -97.7431, SongGen.generate("plant"), 700.0)
	calls.clear()
	r = await acc.share_plant(p)
	check(r.ok and p.sharedId == "id-3", "planted song shared")
	check(calls[1].body.tile == "30_-98" and int(calls[1].body.range_m) == 700 and calls[1].body.song_id == "id-2", "plant row: %s" % calls[1].body)
	r = await acc.unshare("plants", p)
	check(r.ok and not p.has("sharedId") and calls[-1].method == "DELETE" and calls[-1].url.ends_with("plants?id=eq.id-3"), "unshare")

	var m := d.make_map("Lakeside walk")
	var b := d.add_map_beacon(m, 30.31, -97.76)
	calls.clear()
	r = await acc.share_map(m)
	check(r.ok and calls[0].body.beacons[0].seed == BeaconDrafts.map_seed(b), "map shared with seeds")

	r = await acc.report({"kind": "plant", "sharedId": "p9"}, "spam")
	check(calls[-1].body == {"target_kind": "plants", "target_id": "p9", "reason": "spam"}, "report row")
	r = await acc.delete_account()
	check(r.ok and not acc.signed_in() and calls[-1].url.ends_with("rpc/delete_my_account"), "delete account signs out")

	print("account_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
