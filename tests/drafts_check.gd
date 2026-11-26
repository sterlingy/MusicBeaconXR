extends SceneTree
## The app's beacon drafts (BeaconDrafts) must agree with the website's
## (web/src/drafts.js): lattice ids, the lower-48 outline, grid points, seeds,
## play modes, the user layer's weights and the status line, and the shared
## map's tiles and how shared beacons blend in (step 2).
## Fixture: tests/fixtures/drafts.json (node web/tools/export_drafts.mjs).
##   godot --headless --path . -s res://tests/drafts_check.gd

var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		if failures < 40:
			printerr("FAIL: ", msg)


func _init() -> void:
	var fx: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/drafts.json"))
	for s in fx.snaps:
		var got: String = BeaconDrafts.snap_point(s.lat, s.lon, int(s.step)).id
		check(got == s.id, "snap %s,%s/%d: %s vs %s" % [s.lat, s.lon, s.step, got, s.id])
		check(BeaconDrafts.parse_point(s.id).id == s.id, "parse %s" % s.id)
	for p in fx.lower48:
		check(BeaconDrafts.in_lower_48(p.lat, p.lon) == p.inside, "lower 48 at %s,%s" % [p.lat, p.lon])
	for r in fx.reach:
		check(absf(BeaconDrafts.reach(r[0], 1000.0) - r[1]) < 1e-12, "reach %s" % r[0])

	var d := BeaconDrafts.new()
	d.path = ""
	check(BeaconDrafts.validate_doc(fx.doc).is_empty(), "fixture doc validates: %s" % BeaconDrafts.validate_doc(fx.doc))
	d.doc = BeaconDrafts.normalize_doc(fx.doc)
	for gp in fx.gridPoints:
		var g: Dictionary = d.doc.grids.filter(func(x): return x.id == gp.id)[0]
		var pts := BeaconDrafts.grid_points(g.center, int(g.spacingM))
		var mine := []
		for i in pts.size():
			if i % 37 == 0 or i == 440:
				mine.append(pts[i].id)
		check(mine == gp.points, "grid %s points: %s vs %s" % [gp.id, mine.slice(0, 3), gp.points.slice(0, 3)])
	for s in fx.seeds:
		var g: Dictionary = d.doc.grids.filter(func(x): return x.id == s.grid)[0]
		check(BeaconDrafts.seed_for(g, s.point) == s.seed, "seed %s vs %s" % [BeaconDrafts.seed_for(g, s.point), s.seed])
	for i in fx.mapSeeds.size():
		check(BeaconDrafts.map_seed(d.doc.maps[0].beacons[i]) == fx.mapSeeds[i], "map seed %d" % i)

	for t in fx.tiles.keys:
		check(SharedMap.tile_key(t.lat, t.lon) == t.key, "tile key %s,%s" % [t.lat, t.lon])
		var around := SharedMap.tiles_around(t.lat, t.lon)
		around.sort()
		var want_around: Array = t.around.duplicate()
		want_around.sort()
		check(around == want_around, "tiles around %s,%s: %s vs %s" % [t.lat, t.lon, around, want_around])
	for tg in fx.tiles.grids:
		var g: Dictionary = d.doc.grids.filter(func(x): return x.id == tg.id)[0]
		check(SharedMap.tiles_for_grid(g) == tg.tiles, "tiles for %s: %s vs %s" % [tg.id, SharedMap.tiles_for_grid(g), tg.tiles])
	var shared_doc := BeaconDrafts.rows_to_doc([fx.sharedRows])
	check(shared_doc.grids.size() == 1 and shared_doc.plants.size() == 2 and shared_doc.grids[0].createdAt == 1795168800000.0,
		"rows to doc (%s)" % (shared_doc.grids[0].createdAt if not shared_doc.grids.is_empty() else "none"))

	for case in fx.modes:
		var dd := BeaconDrafts.new()
		dd.path = ""
		dd.doc = BeaconDrafts.normalize_doc(fx.doc)
		dd.doc.prefs.playMode = case.mode
		dd.doc.maps[0].exclusive = case.exclusive
		if case.get("withShared", false):
			var songs: Dictionary = fx.sharedSongs
			dd.shared = {"doc": shared_doc, "song": func(id): return songs.get(id, {}), "mine": {}}
		dd.changed(false, int(fx.day))
		var name := "%s%s%s" % [case.mode, " exclusive" if case.exclusive else "", " shared" if case.get("withShared", false) else ""]
		var playing: Array = dd.pool.playing.map(func(e): return e.key)
		playing.sort()
		check(playing == case.playing, "%s: playing (%d vs %d)" % [name, playing.size(), case.playing.size()])
		var at_spot = null
		for e in dd.pool.playing:
			if e.point == fx.spot:
				at_spot = e.key
		check(at_spot == case.atSpot, "%s: song at the shared spot %s vs %s" % [name, at_spot, case.atSpot])
		for i in fx.pts.size():
			var p: Dictionary = fx.pts[i]
			var want: Dictionary = case.layers[i]
			var L := dd.user_layer(p.lat, p.lon)
			var sh := BeaconDrafts.layer_shares(L, dd.pool.exclusive)
			var names: Array = dd.pool.exclusive.map(func(x): return x.name)
			check(absf(L.u - want.u) < 1e-9, "%s pt %d: u %.6f vs %.6f" % [name, i, L.u, want.u])
			check(L.active.size() == want.active.size(), "%s pt %d: %d active vs %d" % [name, i, L.active.size(), want.active.size()])
			for k in mini(L.active.size(), want.active.size()):
				check(L.active[k].entry.key == want.active[k][0] and absf(L.active[k].w - want.active[k][1]) < 1e-9,
					"%s pt %d: #%d %s %.6f vs %s %.6f" % [name, i, k, L.active[k].entry.key, L.active[k].w, want.active[k][0], want.active[k][1]])
			check(BeaconDrafts.status_line(sh, names) == want.status, "%s pt %d: '%s' vs '%s'" % [name, i, BeaconDrafts.status_line(sh, names), want.status])

	var od := BeaconDrafts.new()
	od.path = ""
	od.doc = BeaconDrafts.normalize_doc(fx.doc)
	for o in fx.offers:
		var got := od.more_grid_offer(o.lat, o.lon)
		if o.offer == null:
			check(got.is_empty(), "offer at %s,%s: expected none, got %s" % [o.lat, o.lon, got.get("dir")])
		else:
			check(not got.is_empty() and got.from.id == o.offer.from and got.dir == o.offer.dir and got.center == o.offer.center,
				"offer at %s,%s: %s %s vs %s %s" % [o.lat, o.lon, got.get("dir"), got.get("center"), o.offer.dir, o.offer.center])

	# Save, load and import round trips.
	var tmp := "user://drafts_check.json"
	od.path = tmp
	od.changed(true)
	var back := BeaconDrafts.load_file(tmp)
	check(back.doc.grids.size() == 2 and back.doc.maps.size() == 1 and back.doc.plants.size() == 2, "save and load")
	var n := back.merge_doc(fx.doc)
	check(n.grids == 2 and back.doc.grids.size() == 4 and back.doc.grids[2].id != back.doc.grids[0].id, "import as copies")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(tmp))
	var fix := {"lat": 30.27, "lon": -97.74, "accuracy": 12.0}
	check(BeaconDrafts.fix_problem(fix) == "", "Austin fix is fine")
	check(BeaconDrafts.fix_problem({"lat": 51.5, "lon": 0.0, "accuracy": 5.0}).contains("lower 48"), "London is refused")
	check(BeaconDrafts.fix_problem({"lat": 30.27, "lon": -97.74, "accuracy": 900.0}).contains("accurate"), "a vague fix is refused")

	print("drafts_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
