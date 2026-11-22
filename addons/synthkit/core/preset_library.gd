class_name PresetLibrary
extends RefCounted
## Factory presets (res://addons/synthkit/presets/factory/<Instrument>/*.json, read-only) and
## user presets (user://presets/<Instrument>/*.json). A preset is
## {format, instrument, name, description, author, params}; `params` lists
## only values that differ from the defaults (Tangle adds "patch").
##
## Share codes: "JAM1:" + base64url(deflate(json)), small enough for a QR code.

const FACTORY_DIR := "res://addons/synthkit/presets/factory"
const USER_DIR := "user://presets"
const CODE_PREFIX := "JAM1:"


static func list(instrument: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for p in _read_dir(FACTORY_DIR.path_join(instrument)):
		p["factory"] = true
		out.append(p)
	out.sort_custom(func(a, b): return a.get("order", 0) < b.get("order", 0))
	var user: Array[Dictionary] = []
	for p in _read_dir(USER_DIR.path_join(instrument)):
		p["factory"] = false
		user.append(p)
	user.sort_custom(func(a, b): return String(a.name).naturalnocasecmp_to(b.name) < 0)
	out.append_array(user)
	return out


static func apply(synth: JamSynth, preset: Dictionary) -> bool:
	if preset.get("instrument", "") != synth.instrument:
		push_warning("Preset '%s' is for %s, not %s" % [preset.get("name"), preset.get("instrument"), synth.instrument])
		return false
	synth.reset_params()
	var params: Dictionary = preset.get("params", {})
	if synth.instrument == "Tangle" and not params.has("patch"):
		synth.tangle_load_default()
	synth.set_params(params)
	return true


## Captures the synth's current sound as a preset (only non-default values).
static func capture(synth: JamSynth, name: String, description := "", author := "") -> Dictionary:
	var params := {}
	for p in synth.get_param_list():
		if not is_equal_approx(float(p.value), float(p.default)):
			params[p.id] = p.value
	if synth.instrument == "Tangle":
		params["patch"] = _patch_to_json(synth.tangle_get_patch())
	return {"format": 1, "instrument": synth.instrument, "name": name, "description": description,
		"author": author, "params": params}


static func save_user(preset: Dictionary) -> String:
	var dir := USER_DIR.path_join(preset.instrument)
	DirAccess.make_dir_recursive_absolute(dir)
	var path := dir.path_join(_slug(preset.name) + ".json")
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("Could not save preset to %s" % path)
		return ""
	f.store_string(JSON.stringify(preset, " "))
	return path


static func delete_user(preset: Dictionary) -> bool:
	if preset.get("factory", true) or not preset.has("path"):
		return false
	return DirAccess.remove_absolute(preset.path) == OK


static func to_code(preset: Dictionary) -> String:
	var clean := preset.duplicate(true)
	clean.erase("path")
	clean.erase("factory")
	var raw := JSON.stringify(clean).to_utf8_buffer()
	var packed := raw.compress(FileAccess.COMPRESSION_DEFLATE)
	var size := PackedByteArray()
	size.resize(4)
	size.encode_u32(0, raw.size())
	var b64 := Marshalls.raw_to_base64(size + packed)
	return CODE_PREFIX + b64.replace("+", "-").replace("/", "_").replace("=", "")


static func from_code(code: String) -> Dictionary:
	code = code.strip_edges()
	if not code.begins_with(CODE_PREFIX):
		return {}
	var b64 := code.substr(CODE_PREFIX.length())
	var valid := RegEx.create_from_string("^[A-Za-z0-9_-]+$")
	if valid.search(b64) == null:
		return {}
	b64 = b64.replace("-", "+").replace("_", "/")
	while b64.length() % 4 != 0:
		b64 += "="
	var bytes := Marshalls.base64_to_raw(b64)
	if bytes.size() < 5:
		return {}
	var raw_size := bytes.decode_u32(0)
	if raw_size > 1 << 20:
		return {}
	var raw := bytes.slice(4).decompress(raw_size, FileAccess.COMPRESSION_DEFLATE)
	var data = JSON.parse_string(raw.get_string_from_utf8())
	if typeof(data) != TYPE_DICTIONARY or not data.has("instrument") or not data.has("params"):
		return {}
	return data


static func _read_dir(dir: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var d := DirAccess.open(dir)
	if d == null:
		return out
	for f in d.get_files():
		if not f.ends_with(".json"):
			continue
		var path := dir.path_join(f)
		var data = JSON.parse_string(FileAccess.get_file_as_string(path))
		if typeof(data) == TYPE_DICTIONARY and data.has("params"):
			data["path"] = path
			# JSON has no Vector2: patch positions come back as arrays, which set_patch accepts.
			out.append(_fix_patch(data))
	return out


static func _fix_patch(data: Dictionary) -> Dictionary:
	var params: Dictionary = data.get("params", {})
	if params.has("patch"):
		for m in params.patch.get("modules", []):
			var pos = m.get("position", [0, 0])
			if pos is Array and pos.size() >= 2:
				m["position"] = Vector2(pos[0], pos[1])
	return data


static func _patch_to_json(patch: Dictionary) -> Dictionary:
	var out := patch.duplicate(true)
	for m in out.get("modules", []):
		var pos: Vector2 = m.get("position", Vector2())
		m["position"] = [pos.x, pos.y]
	return out


static func _slug(name: String) -> String:
	var s := ""
	for c in name.to_lower():
		s += c if (c >= "a" and c <= "z") or (c >= "0" and c <= "9") else "_"
	return s.strip_edges().trim_prefix("_").trim_suffix("_")
