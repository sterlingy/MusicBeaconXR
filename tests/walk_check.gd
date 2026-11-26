extends SceneTree
## The app's walk replay (WalkMath.frame_at) must match the website's
## (web/src/walk.js frameAt) on walks the website recorded, so recordings
## replay the same on both. Fixture: tests/fixtures/walk.json
## (node web/tools/export_walk.mjs).
##   godot --headless --path . -s res://tests/walk_check.gd

var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		if failures < 30:
			printerr("FAIL: ", msg)


func _init() -> void:
	var fx: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/walk.json"))
	for w in fx:
		var rec: Dictionary = w.rec
		for f in w.frames:
			var got := WalkMath.frame_at(rec, f.t)
			var name := "%s t=%.2f" % [rec.field.kind, f.t]
			check(got.active.size() == f.active.size(), "%s: %d vs %d beacons" % [name, got.active.size(), f.active.size()])
			for i in mini(got.active.size(), f.active.size()):
				check(got.active[i].id == f.active[i].id and absf(got.active[i].w - f.active[i].w) < 1e-9,
					"%s: #%d %s %.6f vs %s %.6f" % [name, i, got.active[i].id, got.active[i].w, f.active[i].id, f.active[i].w])
			for k in f.pos:
				check(absf(float(got.pos[k]) - float(f.pos[k])) < 1e-9, "%s: %s %s vs %s" % [name, k, got.pos[k], f.pos[k]])
	check(WalkMath.clock_text(187.0) == "3:07", "clock text")
	check(absf(WalkMath.moved({"x": 0.0, "y": 0.0}, {"x": 3.0, "y": 4.0}) - 5.0) < 1e-9, "flat distance")
	print("walk_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
