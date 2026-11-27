class_name SharedMap
extends Node
## The shared map (beacon database, step 2): beacons other people submitted,
## read in 1 degree tiles as you travel, cached on the device. The app twin of
## web/src/shared.js: same tiles, same rules, same server (the Supabase
## project's REST API with its public key; only live rows are readable, and
## never who made them).
##
## The 3 x 3 tiles around the listener are kept loaded. A tile fetched within
## the last hour is fresh; older ones still play while a new copy loads;
## offline, whatever is cached plays. Song bodies load only when a beacon is
## near (BeaconDrafts asks through song()).
##
## Cache: user://shared/tiles/<tile>.json and user://shared/songs/<id>.json.

## Something playable changed (tiles arrived, or a song did).
signal changed

const SUPABASE_URL := "https://oegvbjizvbpltfrzqvba.supabase.co"
const SUPABASE_KEY := "sb_publishable_RjUT2cwZ5jYCuNwe2naItw_aw85jVhc" # public by design (see web/src/config.js)
const FRESH_MS := 60.0 * 60.0 * 1000.0
const CACHE := "user://shared"

var tiles := {} # key -> {at, grids, plants}
var songs := {} # song id -> body
var offline := false
var last_error := ""
var _wanted: Array = []
var _loading := {}
var _song_loading := {}
var _doc := {}
## Tests set this to read from a fake server: func(path) -> Array (rows), or null on failure.
var fake_get := Callable()


static func _wrap180(d: float) -> float:
	return fposmod(d + 180.0, 360.0) - 180.0


static func tile_key(lat: float, lon: float) -> String:
	return "%d_%d" % [floori(lat), floori(_wrap180(lon))]


static func tiles_around(lat: float, lon: float) -> Array:
	var out := []
	var la := floori(lat)
	var lo := floori(_wrap180(lon))
	for a in range(la - 1, la + 2):
		if a < -90 or a > 89:
			continue
		for b in range(lo - 1, lo + 2):
			out.append("%d_%d" % [a, int(_wrap180(b + 0.5) - 0.5)])
	return out


static func tiles_for_grid(grid: Dictionary) -> Array:
	var corners := BeaconDrafts.grid_outline(grid)
	var lats: Array = corners.map(func(c): return c.lat)
	var lons: Array = corners.map(func(c): return _wrap180(c.lon))
	var out := {}
	var lon0: float = lons.min()
	var lon1: float = lons.max()
	var spans := [[lon1, 180.0], [-180.0, lon0]] if lon1 - lon0 > 180.0 else [[lon0, lon1]]
	for a in range(floori(lats.min()), floori(lats.max()) + 1):
		for sp in spans:
			for b in range(floori(sp[0]), floori(minf(sp[1], 179.999999)) + 1):
				out["%d_%d" % [a, b]] = true
	var keys := out.keys()
	keys.sort()
	return keys


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(CACHE + "/tiles")
	DirAccess.make_dir_recursive_absolute(CACHE + "/songs")


## Loads the tiles around lat/lon: from the cache first, then the server when stale.
func update(lat: float, lon: float) -> void:
	_wanted = tiles_around(lat, lon)
	var any := false
	for k in _wanted:
		if not tiles.has(k):
			var c = _read_json("%s/tiles/%s.json" % [CACHE, k])
			if typeof(c) == TYPE_DICTIONARY:
				tiles[k] = c
				any = true
		var t: Dictionary = tiles.get(k, {})
		if (not t.is_empty() and _now() - float(t.at) < FRESH_MS) or _loading.has(k):
			continue
		_fetch_tile(k)
	for k in tiles.keys():
		if not _wanted.has(k) and tiles.size() > 36:
			tiles.erase(k)
	if any:
		_doc = {}
		changed.emit()


func _fetch_tile(k: String) -> void:
	_loading[k] = true
	var enc := k.uri_encode()
	var grids = await _rest_get("grids?select=id,center,spacing_m,half,variant,variants,edited,created_at&status=eq.live&tiles=cs.%s" % ("{%s}" % k).uri_encode())
	var plants = await _rest_get("plants?select=id,point,range_m,song_id,created_at&status=eq.live&tile=eq.%s" % enc)
	_loading.erase(k)
	if grids == null or plants == null:
		offline = true
		return
	offline = false
	var v := {"at": _now(), "grids": grids, "plants": plants}
	tiles[k] = v
	_write_json("%s/tiles/%s.json" % [CACHE, k], v)
	_doc = {}
	changed.emit()


## The loaded tiles as a beacon-drafts-shaped document {grids, plants}.
func doc() -> Dictionary:
	if _doc.is_empty():
		var ts := []
		for k in _wanted:
			if tiles.has(k):
				ts.append(tiles[k])
		_doc = BeaconDrafts.rows_to_doc(ts)
	return _doc


## A song body if it's here, else {} (and starts loading it).
func song(id: String) -> Dictionary:
	if songs.has(id):
		return songs[id]
	if not _song_loading.has(id):
		_song_loading[id] = true
		_load_song(id)
	return {}


func _load_song(id: String) -> void:
	var path := "%s/songs/%s.json" % [CACHE, id.validate_filename()]
	var body = _read_json(path)
	if typeof(body) != TYPE_DICTIONARY:
		var rows = await _rest_get("songs?select=body&status=eq.live&id=eq.%s" % id.uri_encode())
		body = rows[0].body if rows is Array and not rows.is_empty() else null
		if typeof(body) == TYPE_DICTIONARY:
			_write_json(path, body)
		elif rows == null:
			offline = true
	_song_loading.erase(id)
	if typeof(body) == TYPE_DICTIONARY and BeaconMixer.validate(body).is_empty():
		songs[id] = body
		changed.emit()


## For the panel.
func stats() -> Dictionary:
	var d := doc()
	var updated := 0.0
	for k in tiles:
		updated = maxf(updated, float(tiles[k].at))
	return {"tiles": tiles.size(), "grids": d.grids.size(), "plants": d.plants.size(), "updated": updated, "offline": offline}


# ---------------------------------------------------------------- plumbing

func _rest_get(path: String) -> Variant:
	if fake_get.is_valid():
		return fake_get.call(path)
	var http := HTTPRequest.new()
	http.timeout = 20.0
	add_child(http)
	var err := http.request("%s/rest/v1/%s" % [SUPABASE_URL, path], ["apikey: " + SUPABASE_KEY, "Accept: application/json"])
	if err != OK:
		http.queue_free()
		last_error = "request failed (%d)" % err
		return null
	var res: Array = await http.request_completed
	http.queue_free()
	if res[0] != HTTPRequest.RESULT_SUCCESS or res[1] != 200:
		last_error = "HTTP %s / %s" % [res[1], res[0]]
		return null
	var data = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	return data if data is Array else null


static func _now() -> float:
	return Time.get_unix_time_from_system() * 1000.0


static func _read_json(path: String) -> Variant:
	if not FileAccess.file_exists(path):
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(path))


static func _write_json(path: String, v: Variant) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(v))
