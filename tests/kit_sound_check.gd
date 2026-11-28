extends SceneTree
## The app's SynthKit song sounds (scripts/beacon/kit_sounds.gd and
## BeaconMixer.kit_shares / choose_kit) must answer exactly as the website's
## (web/src/kitsounds.js, web/src/mixer.js): tests/fixtures/kit_sounds.json,
## written by web/tools/export_kit.mjs. Every listed preset must exist in
## SynthKit's factory library for its instrument.
##   godot --headless --path . -s tests/kit_sound_check.gd

var fails := 0


func _init() -> void:
	var f := FileAccess.open("res://tests/fixtures/kit_sounds.json", FileAccess.READ)
	var fx: Dictionary = JSON.parse_string(f.get_as_text())
	_same("reads", KitSounds.KIT_READS, fx.reads)
	_same("trims", KitSounds.KIT_TRIM, fx.trims)
	_same("sounds", KitSounds.KIT_SOUNDS, fx.sounds)
	for c in fx.params:
		var got := KitSounds.kit_params(c.instrument, c.base, c.tune)
		_same("%s %s %s" % [c.instrument, c.base, c.tune], got, c.out)
	var active := []
	for i in fx.songs.size():
		active.append({"id": "s%d" % i, "w": [0.5, 0.3, 0.2][i], "song": fx.songs[i]})
	for b in fx.shares:
		var kits := BeaconMixer.kit_shares(active, b.role, b.sources)
		_same(b.role + " kits", kits, b.kits)
		for k in b.keep:
			var pick = BeaconMixer.choose_kit(kits, k[0])
			_same("%s keeps %s" % [b.role, k[0]], pick.preset if pick != null else null, k[1])
	for role in KitSounds.KIT_SOUNDS:
		var names := []
		for p in PresetLibrary.list(KitSounds.KIT_INSTRUMENT[role]):
			names.append(p.name)
		for s in KitSounds.KIT_SOUNDS[role]:
			if not names.has(s[0]):
				_fail("%s preset %s / %s is not in SynthKit's library" % [role, KitSounds.KIT_INSTRUMENT[role], s[0]])
	# Songs choose from the list, with the notes the same as before kits.
	var song := SongGen.generate("kit:1")
	for role in song.tracks:
		if not song.tracks[role].has("kit") or not KitSounds.has_sound(role, song.tracks[role].kit.preset):
			_fail("%s has no listed kit" % role)
	print("kit sound check: ", "OK" if fails == 0 else "%d FAILED" % fails)
	quit(1 if fails else 0)


func _same(what: String, a: Variant, b: Variant) -> void:
	if not _eq(a, b):
		_fail("%s: app %s vs web %s" % [what, JSON.stringify(a), JSON.stringify(b)])


func _eq(a: Variant, b: Variant) -> bool:
	if (a is int or a is float) and (b is int or b is float):
		return absf(float(a) - float(b)) <= 1e-6 * maxf(1.0, absf(float(b)))
	if a is Dictionary and b is Dictionary:
		if a.size() != b.size():
			return false
		for k in a:
			if not b.has(k) or not _eq(a[k], b[k]):
				return false
		return true
	if a is Array and b is Array:
		if a.size() != b.size():
			return false
		for i in a.size():
			if not _eq(a[i], b[i]):
				return false
		return true
	return a == b


func _fail(msg: String) -> void:
	fails += 1
	if fails <= 20:
		printerr("FAIL ", msg)
