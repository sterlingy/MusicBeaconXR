class_name FieldPrefs
extends RefCounted
## Which field the app opens on, and the local grid's settings, kept between
## launches (user://field.cfg). The first launch opens the local grid; after
## that, the field used last.

const PATH := "user://field.cfg"
const SCENES := {"grid": "res://scenes/beacon_field.tscn", "local": "res://scenes/beacon_field.tscn", "globe": "res://scenes/globe_field.tscn"}
const SIDES_KM := [1.0, 5.0, 10.0, 50.0, 100.0]
const SPACINGS_KM := [0.1, 0.25, 0.5, 1.0, 2.0, 5.0]
## Where the local grid sits until the device reports a location (as the website).
const DEFAULT_LAT := 51.5074
const DEFAULT_LON := -0.1278

static var _cfg: ConfigFile


static func _load() -> ConfigFile:
	if _cfg == null:
		_cfg = ConfigFile.new()
		_cfg.load(PATH)
	return _cfg


static func get_value(key: String, default: Variant) -> Variant:
	return _load().get_value("field", key, default)


static func set_value(key: String, value: Variant) -> void:
	_load().set_value("field", key, value)
	_cfg.save(PATH)


## "local" on the very first launch, then the last field used.
static func field() -> String:
	var f: String = get_value("field", "local")
	return f if SCENES.has(f) else "local"


static func set_field(kind: String) -> void:
	set_value("field", kind)


static func scene_for(kind: String) -> String:
	return SCENES.get(kind, SCENES.local)


static func local_km() -> float:
	return float(get_value("local_km", 10.0))


static func spacing_km() -> float:
	return float(get_value("spacing_km", 1.0))


static func follow() -> bool:
	return bool(get_value("follow", true))


## The last local grid's place; London before the first fix.
static func last_lat() -> float:
	return float(get_value("lat", DEFAULT_LAT))


static func last_lon() -> float:
	return float(get_value("lon", DEFAULT_LON))


static func set_place(lat: float, lon: float) -> void:
	_load().set_value("field", "lat", lat)
	_cfg.set_value("field", "lon", lon)
	_cfg.save(PATH)
