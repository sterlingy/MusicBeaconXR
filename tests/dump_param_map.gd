extends SceneTree
## Writes tests/fixtures/param_map.json: ParamMap.to_synth for each part of the
## grid songs and every 8th globe song. web/tests/kit.test.mjs checks that the
## browser's port (web/src/kit/parammap.js) gives the same values.
## Re-run after changing param_map.gd:
##   godot --headless --path . -s res://tests/dump_param_map.gd

const ROLES := ["drums", "bass", "keys", "lead", "pluck", "texture"]


func _init() -> void:
	var cases := []
	for pack in ["res://songs/grid.json", "res://songs/globe.json"]:
		var songs: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(pack)).songs
		var i := 0
		for id in songs:
			i += 1
			if pack.ends_with("globe.json") and i % 8 != 0:
				continue
			for role in ROLES:
				var t: Dictionary = songs[id].tracks.get(role, {})
				if t.has("params"):
					cases.append({"song": id, "role": role, "params": t.params, "synth": ParamMap.to_synth(role, t.params)})
	var f := FileAccess.open("res://tests/fixtures/param_map.json", FileAccess.WRITE)
	f.store_string(JSON.stringify({"cases": cases}))
	print("dump_param_map: %d cases" % cases.size())
	quit()
