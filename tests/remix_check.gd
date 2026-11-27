extends SceneTree
## The app's Remix (scripts/beacon/remix.gd) must transform songs exactly as the
## website's (web/src/remix.js): its answers are in tests/fixtures/remix.json
## (node web/tools/export_remix.mjs).
##   godot --headless --path . -s res://tests/remix_check.gd

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


## Deep equality, numbers within a hair (JSON makes every number a float).
func same(a: Variant, b: Variant, path: String) -> String:
	var na := typeof(a) in [TYPE_FLOAT, TYPE_INT]
	var nb := typeof(b) in [TYPE_FLOAT, TYPE_INT]
	if na and nb:
		return "" if absf(float(a) - float(b)) < 1e-6 else "%s: %s vs %s" % [path, a, b]
	if typeof(a) != typeof(b):
		return "%s: %s vs %s" % [path, type_string(typeof(a)), type_string(typeof(b))]
	if a is Dictionary:
		var ka: Array = a.keys()
		var kb: Array = b.keys()
		ka.sort()
		kb.sort()
		if ka != kb:
			return "%s: keys %s vs %s" % [path, ka, kb]
		for k in ka:
			var d := same(a[k], b[k], "%s.%s" % [path, k])
			if d != "":
				return d
		return ""
	if a is Array:
		if a.size() != b.size():
			return "%s: %d vs %d items" % [path, a.size(), b.size()]
		for i in a.size():
			var d := same(a[i], b[i], "%s[%d]" % [path, i])
			if d != "":
				return d
		return ""
	return "" if a == b else "%s: %s vs %s" % [path, a, b]


func _init() -> void:
	var fx: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/remix.json"))
	var n := 0
	for c in fx.cases:
		var s := Remix.normalize(c.settings)
		var got := Remix.remix_song(c.song, s)
		var diff := same(got, c.out, "case %d" % n)
		check(diff == "", diff)
		n += 1
	for m in fx.moods:
		check(Remix.mood_mode(m.mode, m.mood) == m.out, "mood %s %s -> %s (got %s)" % [m.mode, m.mood, m.out, Remix.mood_mode(m.mode, m.mood)])
	var bake := Remix.bake(fx.cases[0].song, Remix.normalize(fx.cases[3].settings))
	var bd := same(bake, fx.bake, "bake")
	check(bd == "", bd)
	# At rest it changes nothing; dice stays in range; normalize makes junk safe.
	var rest := Remix.defaults()
	check(same(Remix.remix_song(fx.cases[0].song, rest), fx.cases[0].song, "rest") == "" and Remix.is_neutral(rest), "at rest nothing changes")
	for i in 20:
		var d := Remix.dice(rest)
		for dial in Remix.DIALS:
			check(float(d[dial[0]]) >= dial[2] and float(d[dial[0]]) <= dial[3], "dice %s in range" % dial[0])
	var j := Remix.normalize({"on": true, "key": 99, "energy": "x", "parts": {"lead": {"swap": 999, "level": -3}}})
	check(j.key == 6.0 and j.energy == 0.0 and j.parts.lead.swap == Remix.SWAPS.lead.size() - 1 and j.parts.lead.level == 0.0, "normalize makes junk safe")
	print("remix_check: %s (%d cases, %d failure(s))" % ["OK" if failures == 0 else "FAILED", n, failures])
	quit(0 if failures == 0 else 1)
