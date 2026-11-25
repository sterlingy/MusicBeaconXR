extends SceneTree
## The app's local grid (BeaconField.make_local) must match the browser's
## (web/src/beacons.js makeLocalGridField): same shape, beacon ids, labels and
## places, and the same weights for a listener anywhere on it.
## Fixture: tests/fixtures/local_grid.json (web/tools/export_songs.mjs).
##   godot --headless --path . -s res://tests/local_grid_check.gd

var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


func _init() -> void:
	var grids: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/local_grid.json"))
	for g in grids:
		var f := BeaconField.make_local(g.center.lat, g.center.lon, g.km, g.sp)
		var name := "%s,%s %skm/%s" % [g.center.lat, g.center.lon, g.km, g.sp]
		check(f.n == int(g.n) and f.steps == int(g.steps) and f.band == int(g.band) and is_equal_approx(f.spacing, g.spacing), "%s: shape" % name)
		check(absf(f.center_lat - g.middle.lat) < 1e-9 and absf(f.center_lon - g.middle.lon) < 1e-9, "%s: middle" % name)
		check(f.beacons.size() == int(g.n) * int(g.n), "%s: %d beacons" % [name, f.beacons.size()])
		for b in g.beacons:
			var mine: Dictionary = f.beacons[int(b.index)]
			check(mine.id == b.id, "%s: beacon %d id %s vs %s" % [name, b.index, mine.id, b.id])
			check(mine.label == b.label, "%s: beacon %s label '%s' vs '%s'" % [name, b.id, mine.label, b.label])
			check(absf(mine.lat - b.pos.lat) < 1e-9 and absf(mine.lon - b.pos.lon) < 1e-9, "%s: beacon %s place" % [name, b.id])
		for pt in g.pts:
			var p := f.from_lat_lon(pt.pos.lat, pt.pos.lon)
			var w := f.weigh(p)
			check(w.size() == pt.w.size(), "%s: %d weights" % [name, w.size()])
			for i in mini(w.size(), pt.w.size()):
				# Positions are meters in a Vector2 (32-bit), so weights agree to ~1e-4.
				check(w[i].id == pt.w[i][0] and absf(w[i].w - pt.w[i][1]) < 1e-3,
					"%s: weight %d %s %.6f vs %s %.6f" % [name, i, w[i].id, w[i].w, pt.w[i][0], pt.w[i][1]])
			var back := f.to_lat_lon(p)
			check(absf(back.lat - pt.pos.lat) < 1e-6 and absf(back.lon - pt.pos.lon) < 1e-6, "%s: round trip (%s)" % [name, back])
	print("local_grid_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
