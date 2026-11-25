extends SceneTree
## The app's song generator (SongGen) must make exactly the songs the browser
## makes: tests/fixtures/song_gen.json (web/tools/export_songs.mjs) holds
## browser-generated songs, local-grid ones included.
##   godot --headless --path . -s res://tests/song_gen_check.gd

var failures := 0


func _init() -> void:
	var cases: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/song_gen.json"))
	var t0 := Time.get_ticks_usec()
	for c in cases:
		var got := SongGen.generate(c.seed)
		var diff := _diff(c.song, got, "")
		if diff != "":
			failures += 1
			printerr("FAIL: %s: %s" % [c.seed, diff])
	print("  %d songs in %.1f ms each" % [cases.size(), (Time.get_ticks_usec() - t0) / 1000.0 / cases.size()])
	# The packs the app ships were made by the browser too: spot-check them.
	for pack in ["res://songs/grid.json", "res://songs/globe.json"]:
		var data: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(pack))
		var kind: String = data.field
		var k := 0
		for id in data.songs:
			k += 1
			if k % 37 != 1:
				continue
			var diff := _diff(data.songs[id], SongGen.generate("%s:%s" % [kind, id]), "")
			if diff != "":
				failures += 1
				printerr("FAIL: %s:%s: %s" % [kind, id, diff])
	print("song_gen_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)


## The first difference between two JSON-like values, or "".
func _diff(want: Variant, got: Variant, path: String) -> String:
	if want == null or got == null:
		return "" if want == got else "%s: %s vs %s" % [path, want, got]
	if (want is float or want is int) and (got is float or got is int):
		var a := float(want)
		var b := float(got)
		return "" if absf(a - b) <= 1e-9 * maxf(1.0, absf(a)) else "%s: %s vs %s" % [path, a, b]
	if want is Array and got is Array:
		if want.size() != got.size():
			return "%s: %d items vs %d" % [path, want.size(), got.size()]
		for i in want.size():
			var d := _diff(want[i], got[i], "%s[%d]" % [path, i])
			if d != "":
				return d
		return ""
	if want is Dictionary and got is Dictionary:
		for k in want:
			if not got.has(k):
				return "%s.%s missing" % [path, k]
			var d := _diff(want[k], got[k], "%s.%s" % [path, k])
			if d != "":
				return d
		for k in got:
			if not want.has(k):
				return "%s.%s extra" % [path, k]
		return ""
	if typeof(want) == typeof(got) and want == got:
		return ""
	return "%s: %s vs %s" % [path, want, got]
