class_name BeaconDrafts
extends RefCounted
## The user's own beacons (beacon database, step 1): grids, planted songs and
## custom maps, kept on this device. The app twin of web/src/drafts.js: same
## rules, same lattice ids, same "beacon-drafts" file format, so export and
## import work across platforms. tests/fixtures/drafts.json (written by
## web/tools/export_songs.mjs) holds the website's answers, and
## tests/drafts_check.gd checks this file against them.
## The design is docs/beacon-database-plan.md.
##
##   var drafts := BeaconDrafts.load_file()          # user://beacon_drafts.json
##   drafts.doc.grids.append(drafts.make_grid(lat, lon, 1000))
##   drafts.changed()                                # rebuild the pool, save
##   var layer := drafts.user_layer(lat, lon)        # {u, active: [{entry, d, w}]}

const EARTH_RADIUS_KM := 6371.0088
const M_PER_DEG := EARTH_RADIUS_KM * 1000.0 * PI / 180.0
const LATTICE_M := 100
const GRID_POINTS := 21
const SPACINGS_M := [100, 200, 500, 1000, 2000, 5000]
const PLANT_RANGE_M := 500
const MIN_RANGE_M := 100
const MAX_RANGE_M := 10000
const MAX_SONGS_PER_POINT := 20
const MAX_FIX_ACCURACY_M := 250.0
const FULL_REACH := 0.75
const PLAY_MODES := ["random", "favorite", "owned", "original", "latest"]
const PLAY_MODE_LABEL := {"random": "Random (changes daily)", "favorite": "My favorite", "owned": "Mine", "original": "Original (first planted)", "latest": "Latest"}
const TINTS := ["#5ad1ff", "#c18cff", "#7ee081", "#ff9f6e", "#ffd166", "#ff7aa8", "#4fd1b5", "#a3b5ff"]
const PLANT_TINT := "#ffb547"
const FORMAT := "beacon-drafts"
const VERSION := 1
const PATH := "user://beacon_drafts.json"

## The lower 48 United States, a coarse outline (lon, lat): the same points as web/src/drafts.js.
const LOWER_48 := [
	[-124.8, 48.4], [-123.0, 48.3], [-123.3, 49.0], [-95.15, 49.0], [-95.15, 49.38], [-94.8, 49.3], [-94.6, 48.7],
	[-93.0, 48.6], [-91.0, 48.2], [-89.5, 48.0], [-88.0, 48.3], [-84.6, 46.7], [-84.4, 46.5], [-83.5, 46.0],
	[-82.4, 43.0], [-83.1, 42.3], [-82.7, 41.7], [-79.0, 42.8], [-79.0, 43.3], [-76.3, 44.2], [-74.7, 45.0],
	[-71.5, 45.0], [-71.1, 45.3], [-70.3, 45.9], [-70.0, 46.7], [-69.2, 47.45], [-68.2, 47.35], [-67.8, 47.07],
	[-67.8, 45.7], [-67.4, 45.2], [-67.0, 44.8], [-69.0, 43.8], [-70.7, 43.0], [-70.8, 42.2], [-69.9, 42.0],
	[-69.9, 41.3], [-71.5, 41.2], [-71.9, 41.0], [-73.9, 40.5], [-74.0, 39.6], [-74.9, 38.9], [-75.1, 38.3],
	[-75.7, 37.0], [-75.5, 35.2], [-76.5, 34.6], [-78.0, 33.8], [-79.2, 33.1], [-80.8, 32.0], [-81.4, 30.7],
	[-80.6, 28.4], [-80.0, 26.7], [-80.1, 25.3], [-80.3, 24.9], [-81.2, 24.5], [-82.0, 24.45], [-81.9, 24.75],
	[-81.3, 25.8], [-82.8, 27.8], [-82.7, 29.0], [-83.7, 29.9], [-84.4, 29.9], [-85.4, 29.7], [-86.5, 30.4],
	[-88.0, 30.2], [-89.4, 30.1], [-89.2, 29.1], [-90.5, 29.0], [-92.0, 29.5], [-93.8, 29.7], [-94.8, 29.3],
	[-96.4, 28.3], [-97.2, 27.6], [-97.4, 26.0], [-97.2, 25.9], [-98.2, 26.1], [-99.1, 26.5], [-99.5, 27.5],
	[-100.3, 28.3], [-100.8, 29.3], [-101.4, 29.8], [-102.4, 29.8], [-103.0, 29.0], [-103.3, 29.0], [-104.5, 29.6],
	[-104.9, 30.6], [-106.5, 31.8], [-108.2, 31.8], [-108.2, 31.33], [-111.1, 31.33], [-114.8, 32.5], [-114.7, 32.72],
	[-117.1, 32.53], [-117.3, 33.2], [-118.4, 33.7], [-119.5, 34.4], [-120.6, 34.5], [-121.9, 36.3], [-122.5, 37.5],
	[-123.0, 38.0], [-123.8, 39.8], [-124.4, 40.4], [-124.2, 42.0], [-124.6, 42.8], [-123.9, 46.2], [-124.1, 47.0],
	[-124.7, 48.0],
]
const DIRS := {"N": [1, 0], "S": [-1, 0], "E": [0, 1], "W": [0, -1], "NE": [1, 1], "NW": [1, -1], "SE": [-1, 1], "SW": [-1, -1]}

## The stored document (the same JSON as the website's).
var doc: Dictionary = empty_doc()
## The playing pool, rebuilt by changed(): {entries, groups, playing, exclusive}.
var pool: Dictionary = {}
var by_key := {} # entry key -> entry
var _buckets := {}
var _song_memo := {}
var _uid := 0
## Where saves go (tests point it elsewhere, or "" to not save).
var path := PATH


# ---------------------------------------------------------------- lattice

static func _band(v: float) -> int:
	return clampi(v, -85, 85)


static func _cos_band(band: int) -> float:
	return cos(deg_to_rad(float(band)))


## Math.round for the lattice (halves round up), as JavaScript does.
static func _round_to(v: float, m: int) -> int:
	return int(floorf(v / m + 0.5)) * m


static func _wrap180(d: float) -> float:
	return fposmod(d + 180.0, 360.0) - 180.0


static func point_at(I: int, J: int, band: int) -> Dictionary:
	return {"id": "g%d_%d_%d" % [band, I, J], "I": I, "J": J, "band": band, "lat": I / M_PER_DEG, "lon": J / (_cos_band(band) * M_PER_DEG)}


## The lattice point (100 m) nearest lat/lon, or the nearest on a coarser `step_m` lattice.
static func snap_point(lat: float, lon: float, step_m := LATTICE_M) -> Dictionary:
	var I := _round_to(lat * M_PER_DEG, step_m)
	var band := _band(int(floorf(I / M_PER_DEG + 0.5)))
	var J := _round_to(_wrap180(lon) * _cos_band(band) * M_PER_DEG, step_m)
	return point_at(I, J, band)


static func parse_point(id: String) -> Dictionary:
	var re := RegEx.create_from_string("^g(-?\\d+)_(-?\\d+)_(-?\\d+)$")
	var m := re.search(id)
	if m == null:
		return {}
	return point_at(int(m.get_string(2)), int(m.get_string(3)), int(m.get_string(1)))


## Distance in meters between two lat/lon points (haversine).
static func meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
	var d_lat := deg_to_rad(lat2 - lat1)
	var d_lon := deg_to_rad(_wrap180(lon2 - lon1))
	var h := pow(sin(d_lat / 2.0), 2) + cos(deg_to_rad(lat1)) * cos(deg_to_rad(lat2)) * pow(sin(d_lon / 2.0), 2)
	return 2.0 * EARTH_RADIUS_KM * 1000.0 * asin(minf(1.0, sqrt(h)))


# ---------------------------------------------------------------- where beacons may be made

static func in_lower_48(lat: float, lon: float) -> bool:
	var inside := false
	var j := LOWER_48.size() - 1
	for i in LOWER_48.size():
		var xi: float = LOWER_48[i][0]
		var yi: float = LOWER_48[i][1]
		var xj: float = LOWER_48[j][0]
		var yj: float = LOWER_48[j][1]
		if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
			inside = not inside
		j = i
	return inside


## Why a location fix can't make beacons, or "" when it can.
static func fix_problem(fix) -> String:
	if fix == null or typeof(fix) != TYPE_DICTIONARY or fix.is_empty():
		return "Making beacons needs your location (GPS): beacons can only be made where you are."
	if not in_lower_48(fix.lat, fix.lon):
		return "For now, beacons can only be made in the lower 48 United States. The globe still plays everywhere."
	if not (float(fix.get("accuracy", INF)) <= MAX_FIX_ACCURACY_M):
		return "Your location is only accurate to %d m; making beacons needs %d m or better. Try outdoors, or with GPS on." % [roundi(fix.accuracy), MAX_FIX_ACCURACY_M]
	return ""


static func place_problem(lat: float, lon: float) -> String:
	return "" if in_lower_48(lat, lon) else "For now, map beacons can only go in the lower 48 United States."


# ---------------------------------------------------------------- the document

static func empty_doc() -> Dictionary:
	return {"format": FORMAT, "version": VERSION, "grids": [], "maps": [], "plants": [], "prefs": {"playMode": "latest", "favorites": {}, "plantsOn": true}, "nextNumber": 1}


static func validate_doc(d) -> PackedStringArray:
	var errs := PackedStringArray()
	if typeof(d) != TYPE_DICTIONARY or d.get("format") != FORMAT:
		errs.append("not a beacon-drafts document")
		return errs
	if int(d.get("version", 0)) != VERSION:
		errs.append("version %s isn't supported (expected %d)" % [d.get("version"), VERSION])
	for g in d.get("grids", []):
		if not g.has("id") or not SPACINGS_M.has(int(g.get("spacingM", 0))) or parse_point(str(g.get("center", ""))).is_empty():
			errs.append("grid %s is malformed" % g.get("name", g.get("id", "?")))
		for pt in g.get("edited", {}):
			if not BeaconMixer.validate(g.edited[pt]).is_empty():
				errs.append("grid %s: the edited song at %s is invalid" % [g.get("name", g.get("id")), pt])
	for p in d.get("plants", []):
		if parse_point(str(p.get("point", ""))).is_empty():
			errs.append("planted song %s has no lattice point" % p.get("id", "?"))
		var se := BeaconMixer.validate(p.get("song"))
		if not se.is_empty():
			errs.append("planted song %s: %s" % [p.get("id", "?"), se[0]])
	for m in d.get("maps", []):
		if not m.has("id") or typeof(m.get("beacons")) != TYPE_ARRAY:
			errs.append("map %s is malformed" % m.get("name", m.get("id", "?")))
			continue
		for b in m.beacons:
			if typeof(b.get("lat")) != TYPE_FLOAT and typeof(b.get("lat")) != TYPE_INT:
				errs.append("map %s: a beacon has no position" % m.get("name", m.id))
			if b.has("song") and not BeaconMixer.validate(b.song).is_empty():
				errs.append("map %s: a song is invalid" % m.get("name", m.id))
	return errs


## Fills in anything an older or hand-made document left out, and turns JSON's floats back into ints.
static func normalize_doc(d: Dictionary) -> Dictionary:
	var e := empty_doc()
	var out := e.duplicate(true)
	for k in d:
		out[k] = d[k]
	var prefs: Dictionary = e.prefs.duplicate(true)
	for k in d.get("prefs", {}):
		prefs[k] = d.prefs[k]
	if not PLAY_MODES.has(prefs.playMode):
		prefs.playMode = "latest"
	out.prefs = prefs
	out.nextNumber = int(out.get("nextNumber", 1))
	var grids := []
	for g in d.get("grids", []):
		var n := {"on": true, "variant": 0, "variants": {}, "edited": {}}
		for k in g:
			n[k] = g[k]
		n.spacingM = int(n.spacingM)
		n.variant = int(n.variant)
		n.createdAt = float(n.get("createdAt", 0))
		var vs := {}
		for k in n.variants:
			vs[k] = int(n.variants[k])
		n.variants = vs
		grids.append(n)
	out.grids = grids
	var maps := []
	for m in d.get("maps", []):
		var n := {"on": true, "exclusive": false}
		for k in m:
			n[k] = m[k]
		n.beacons = []
		for b in m.get("beacons", []):
			var nb: Dictionary = b.duplicate()
			nb.variant = int(nb.get("variant", 0))
			nb.rangeM = int(nb.get("rangeM", PLANT_RANGE_M))
			n.beacons.append(nb)
		maps.append(n)
	out.maps = maps
	var plants := []
	for p in d.get("plants", []):
		var n: Dictionary = p.duplicate()
		n.rangeM = int(n.get("rangeM", PLANT_RANGE_M))
		plants.append(n)
	out.plants = plants
	return out


func _new_id(prefix: String) -> String:
	_uid += 1
	return "%s%s%s" % [prefix, _base36(int(Time.get_unix_time_from_system() * 1000.0)), _base36(_uid % 1296).lpad(2, "0")]


static func _base36(n: int) -> String:
	const D := "0123456789abcdefghijklmnopqrstuvwxyz"
	if n == 0:
		return "0"
	var s := ""
	while n > 0:
		s = D[n % 36] + s
		n /= 36
	return s


func _next_number() -> int:
	var n := int(doc.get("nextNumber", 1))
	doc.nextNumber = n + 1
	return n


static func now_ms() -> float:
	return floorf(Time.get_unix_time_from_system() * 1000.0)


# ---------------------------------------------------------------- grids

static func grid_points(center_id: String, spacing_m: int) -> Array:
	var c := parse_point(center_id)
	var half := (GRID_POINTS - 1) / 2
	var out := []
	for r in range(-half, half + 1):
		var I: int = c.I + r * spacing_m
		var band := _band(int(floorf(I / M_PER_DEG + 0.5)))
		for k in range(-half, half + 1):
			var lon: float = (c.J + k * spacing_m) / (_cos_band(c.band) * M_PER_DEG)
			out.append(point_at(I, _round_to(lon * _cos_band(band) * M_PER_DEG, spacing_m), band))
	return out


static func _half_side(grid: Dictionary) -> float:
	return ((GRID_POINTS - 1) / 2.0 + 0.5) * int(grid.spacingM)


## Meters north (y) and east (x) of the grid's center, in 64-bit floats.
static func offset_m(grid: Dictionary, lat: float, lon: float) -> Array:
	var c := parse_point(grid.center)
	return [lat * M_PER_DEG - c.I, _wrap180(lon - c.lon) * _cos_band(c.band) * M_PER_DEG]


static func grid_outline(grid: Dictionary) -> Array:
	var c := parse_point(grid.center)
	var h := _half_side(grid)
	var out := []
	for corner in [[h, -h], [h, h], [-h, h], [-h, -h]]:
		out.append({"lat": (c.I + corner[0]) / M_PER_DEG, "lon": (c.J + corner[1]) / (_cos_band(c.band) * M_PER_DEG)})
	return out


static func in_grid(grid: Dictionary, lat: float, lon: float) -> bool:
	var o := offset_m(grid, lat, lon)
	var h := _half_side(grid)
	return absf(o[0]) <= h and absf(o[1]) <= h


static func exit_direction(grid: Dictionary, lat: float, lon: float) -> String:
	var o := offset_m(grid, lat, lon)
	var h := _half_side(grid)
	var dir := ("N" if o[0] > h else "S" if o[0] < -h else "") + ("E" if o[1] > h else "W" if o[1] < -h else "")
	return dir


func make_grid(lat: float, lon: float, spacing_m: int, center := "") -> Dictionary:
	assert(SPACINGS_M.has(spacing_m))
	var n := _next_number()
	return {
		"id": _new_id("grid-"), "name": "Grid %d" % n, "number": n, "tint": TINTS[(n - 1) % TINTS.size()],
		"spacingM": spacing_m, "center": center if center != "" else snap_point(lat, lon, spacing_m).id, "createdAt": now_ms(),
		"on": true, "variant": 0, "variants": {}, "edited": {},
	}


static func adjacent_center(grid: Dictionary, dir: String) -> String:
	var c := parse_point(grid.center)
	var dy: int = DIRS[dir][0]
	var dx: int = DIRS[dir][1]
	var step := GRID_POINTS * int(grid.spacingM)
	return snap_point((c.I + dy * step) / M_PER_DEG, (c.J + dx * step) / (_cos_band(c.band) * M_PER_DEG), int(grid.spacingM)).id


## "Generate more": the next grid to offer someone at lat/lon who walked out of their grids, or {}.
func more_grid_offer(lat: float, lon: float) -> Dictionary:
	var on: Array = doc.grids.filter(func(g): return g.on)
	if on.is_empty() or on.any(func(g): return in_grid(g, lat, lon)):
		return {}
	var best: Dictionary = {}
	var best_out := INF
	for g in on:
		var o := offset_m(g, lat, lon)
		var h := _half_side(g)
		var out := maxf(absf(o[0]) - h, absf(o[1]) - h)
		if out < best_out:
			best_out = out
			best = g
	if best_out > 2.0 * _half_side(best):
		return {}
	var dir := exit_direction(best, lat, lon)
	var center := adjacent_center(best, dir)
	for g in doc.grids:
		if g.center == center and int(g.spacingM) == int(best.spacingM):
			return {}
	return {"from": best, "dir": dir, "center": center, "spacingM": int(best.spacingM)}


static func seed_for(grid: Dictionary, point_id: String) -> String:
	var v := int(grid.get("variant", 0))
	var pv := int(grid.get("variants", {}).get(point_id, 0))
	return "local:%s" % point_id if v == 0 and pv == 0 else "local:%s:%d.%d" % [point_id, v, pv]


static func regenerate_all(grid: Dictionary) -> void:
	grid.variant = int(grid.get("variant", 0)) + 1
	grid.variants = {}


static func regenerate_one(grid: Dictionary, point_id: String) -> void:
	grid.variants[point_id] = int(grid.variants.get(point_id, 0)) + 1
	grid.edited.erase(point_id)


# ---------------------------------------------------------------- planted songs and maps

static func clamp_range(m: float) -> int:
	return clampi(roundi(m if m > 0 else PLANT_RANGE_M), MIN_RANGE_M, MAX_RANGE_M)


## Plants `song` on the lattice point nearest lat/lon. Returns the plant, or {} with `error` set.
func plant_song(lat: float, lon: float, song: Dictionary, range_m := float(PLANT_RANGE_M)) -> Dictionary:
	var errs := BeaconMixer.validate(song)
	if not errs.is_empty():
		return {"error": "the song isn't valid: " + errs[0]}
	var pt := snap_point(lat, lon)
	var here: int = doc.plants.filter(func(x): return x.point == pt.id).size() + 1
	if here >= MAX_SONGS_PER_POINT:
		return {"error": "this spot already holds %d songs, the most one 100 m point can hold" % MAX_SONGS_PER_POINT}
	var p := {"id": _new_id("plant-"), "point": pt.id, "rangeM": clamp_range(range_m), "song": song.duplicate(true), "createdAt": now_ms()}
	doc.plants.append(p)
	return p


func make_map(map_name: String) -> Dictionary:
	var n := _next_number()
	return {"id": _new_id("map-"), "name": map_name.strip_edges() if map_name.strip_edges() != "" else "Map %d" % n, "number": n,
		"tint": TINTS[(n - 1) % TINTS.size()], "createdAt": now_ms(), "on": true, "exclusive": false, "beacons": []}


func add_map_beacon(map: Dictionary, lat: float, lon: float, range_m := float(PLANT_RANGE_M), song := {}) -> Dictionary:
	var b := {"id": _new_id("mb-"), "lat": lat, "lon": lon, "rangeM": clamp_range(range_m), "createdAt": now_ms(), "variant": 0}
	if not song.is_empty():
		b.song = song.duplicate(true)
	map.beacons.append(b)
	return b


static func map_seed(b: Dictionary) -> String:
	var base: String = b.get("seed", "map:%s" % b.id)
	return "%s:%d" % [base, int(b.variant)] if int(b.get("variant", 0)) != 0 else base


func duplicate_item(item: Dictionary) -> Dictionary:
	var copy: Dictionary = item.duplicate(true)
	var is_map := item.has("beacons")
	var n := _next_number()
	copy.id = _new_id("map-" if is_map else "grid-")
	copy.number = n
	copy.name = "%s copy" % item.name
	copy.tint = TINTS[(n - 1) % TINTS.size()]
	copy.createdAt = now_ms()
	if is_map:
		for b in copy.beacons:
			if not b.has("song") and not b.has("seed"):
				b.seed = "map:%s" % b.id
			b.id = _new_id("mb-")
	return copy


## Adds another document's grids, maps and planted songs, all as copies.
func merge_doc(other: Dictionary) -> Dictionary:
	var src := normalize_doc(other)
	var count := {"grids": 0, "maps": 0, "plants": 0}
	for g in src.grids:
		var c := duplicate_item(g)
		c.name = g.name
		c.createdAt = g.createdAt
		doc.grids.append(c)
		count.grids += 1
	for m in src.maps:
		var c := duplicate_item(m)
		c.name = m.name
		c.createdAt = m.get("createdAt", 0)
		doc.maps.append(c)
		count.maps += 1
	for p in src.plants:
		var c: Dictionary = p.duplicate(true)
		c.id = _new_id("plant-")
		doc.plants.append(c)
		count.plants += 1
	return count


# ---------------------------------------------------------------- the pool

## Every beacon that's on, as entries (see web/src/drafts.js poolEntries).
func pool_entries() -> Array:
	var out := []
	var half := (GRID_POINTS - 1) / 2
	for g in doc.grids:
		if not g.on:
			continue
		var source := {"id": g.id, "name": g.name, "kind": "grid", "exclusive": false}
		var pts := grid_points(g.center, int(g.spacingM))
		for i in pts.size():
			var pt: Dictionary = pts[i]
			var edited: bool = g.edited.has(pt.id)
			out.append({"key": "%s/%s" % [g.id, pt.id], "source": source, "point": pt.id, "lat": pt.lat, "lon": pt.lon,
				"rangeM": int(g.spacingM), "kind": "edited" if edited else "gen", "createdAt": float(g.createdAt), "tint": g.tint,
				"seed": "" if edited else seed_for(g, pt.id), "north": half - i / GRID_POINTS, "east": i % GRID_POINTS - half,
				"spacingM": int(g.spacingM), "grid": g})
	if doc.prefs.get("plantsOn", true):
		var source := {"id": "plants", "name": "Planted songs", "kind": "plants", "exclusive": false}
		for p in doc.plants:
			var pt := parse_point(p.point)
			out.append({"key": p.id, "source": source, "point": p.point, "lat": pt.lat, "lon": pt.lon, "rangeM": int(p.rangeM),
				"kind": "plant", "createdAt": float(p.createdAt), "tint": PLANT_TINT, "seed": "", "plant": p})
	for m in doc.maps:
		if not m.on:
			continue
		var source := {"id": m.id, "name": m.name, "kind": "map", "exclusive": bool(m.exclusive)}
		for b in m.beacons:
			out.append({"key": b.id, "source": source, "point": b.id, "lat": float(b.lat), "lon": float(b.lon), "rangeM": int(b.rangeM),
				"kind": "map", "createdAt": float(b.createdAt), "tint": m.tint, "seed": "" if b.has("song") else map_seed(b), "map_beacon": b})
	return out


## An entry's song: generated from its seed (cached), or its stored one.
func song_of(e: Dictionary) -> Dictionary:
	match e.kind:
		"plant":
			return e.plant.song
		"edited":
			return e.grid.edited[e.point]
		"map":
			if e.map_beacon.has("song"):
				return e.map_beacon.song
	var s: Dictionary = _song_memo.get(e.seed, {})
	if s.is_empty():
		s = SongGen.generate(e.seed)
		_song_memo[e.seed] = s
		if _song_memo.size() > 4000:
			_song_memo.erase(_song_memo.keys()[0])
	return s


static func day_number(t_ms := -1.0) -> int:
	if t_ms < 0:
		t_ms = now_ms()
	return int(floorf(t_ms / 86400000.0))


## The songs at one point, oldest first; generated beacons with the same seed count once.
static func songs_at_point(entries: Array) -> Array:
	var seen := {}
	var out := []
	for e in entries:
		var k: String = ("seed:" + e.seed) if e.seed != "" else e.key
		if seen.has(k):
			continue
		seen[k] = true
		out.append(e)
	out.sort_custom(func(a, b): return a.createdAt < b.createdAt or (a.createdAt == b.createdAt and a.key < b.key))
	return out


## FNV-1a as a signed 32-bit int (JavaScript's `h | 0`).
static func _str_hash(s: String) -> int:
	var h := SongGen.hash_string(s)
	return h - 4294967296 if h >= 2147483648 else h


static func pick_at_point(entries: Array, mode: String, favorites: Dictionary, day: int) -> Dictionary:
	var list := songs_at_point(entries)
	if list.size() == 1 or mode == "original":
		return list[0]
	if mode == "random":
		return list[int(floorf(BeaconMixer.hash01(_str_hash(list[0].point), day, list.size()) * list.size()))]
	if mode == "favorite":
		var want: String = favorites.get(list[0].point, "")
		for e in list:
			if e.key == want:
				return e
	return list[list.size() - 1]


## Rebuilds the pool (call after any change to `doc`), and saves unless told not to.
func changed(save := true, day := -1) -> void:
	if day < 0:
		day = day_number()
	var entries := pool_entries()
	var exclusive := {}
	for e in entries:
		if e.source.exclusive:
			exclusive[e.source.id] = e.source
	for m in doc.maps:
		if m.on and m.exclusive and not exclusive.has(m.id):
			exclusive[m.id] = {"id": m.id, "name": m.name, "kind": "map", "exclusive": true}
	if not exclusive.is_empty():
		entries = entries.filter(func(e): return e.source.exclusive)
	var groups := {}
	for e in entries:
		if not groups.has(e.point):
			groups[e.point] = []
		groups[e.point].append(e)
	var playing := []
	for k in groups:
		playing.append(pick_at_point(groups[k], doc.prefs.playMode, doc.prefs.favorites, day))
	by_key.clear()
	for e in entries:
		by_key[e.key] = e
	_buckets.clear()
	var cell := MAX_RANGE_M / M_PER_DEG
	for e in playing:
		var row := int(floorf(e.lat / cell))
		for r in [row - 1, row, row + 1]:
			var k := "%d,%d" % [r, int(floorf(_wrap180(e.lon) / _col_w(r)))]
			if not _buckets.has(k):
				_buckets[k] = []
			_buckets[k].append(e)
	pool = {"entries": entries, "groups": groups, "playing": playing, "exclusive": exclusive.values()}
	if save and path != "":
		save_file()


static func _col_w(row: int) -> float:
	var cell := MAX_RANGE_M / M_PER_DEG
	return cell / maxf(0.05, cos(deg_to_rad((row + 0.5) * cell)))


func near(lat: float, lon: float) -> Array:
	var cell := MAX_RANGE_M / M_PER_DEG
	var row := int(floorf(lat / cell))
	var col := int(floorf(_wrap180(lon) / _col_w(row)))
	var seen := {}
	var out := []
	for b in range(col - 1, col + 2):
		for e in _buckets.get("%d,%d" % [row, b], []):
			if not seen.has(e.key):
				seen[e.key] = true
				out.append(e)
	return out


# ---------------------------------------------------------------- the user layer

static func reach(d: float, r: float) -> float:
	var x := d / r
	if x <= FULL_REACH:
		return 1.0
	if x >= 1.0:
		return 0.0
	var t := (1.0 - x) / (1.0 - FULL_REACH)
	return t * t * (3.0 - 2.0 * t)


## The user layer at lat/lon: {u, active: [{entry, d, w}]} (see web/src/drafts.js userLayer).
func user_layer(lat: float, lon: float, active := 3, sharpness := 1.5) -> Dictionary:
	var cand := []
	var u := 0.0
	for e in near(lat, lon):
		var d := meters(lat, lon, e.lat, e.lon)
		var f := reach(d, e.rangeM)
		if f <= 0.0:
			continue
		u = maxf(u, f)
		cand.append({"entry": e, "d": d, "e": INF if d < 0.01 else f / d})
	if cand.is_empty():
		return {"u": 0.0, "active": []}
	cand.sort_custom(func(a, b): return a.e > b.e or (a.e == b.e and a.entry.key < b.entry.key))
	var top := cand.slice(0, active)
	var out := []
	if is_inf(top[0].e):
		for i in top.size():
			out.append({"entry": top[i].entry, "d": top[i].d, "w": 1.0 if i == 0 else 0.0})
		return {"u": u, "active": out}
	var ref: float = cand[active].e if cand.size() > active else 0.0
	var raw := []
	var sum := 0.0
	for c in top:
		var v := pow(maxf(0.0, c.e - ref), sharpness)
		raw.append(v)
		sum += v
	if sum <= 1e-12:
		raw = top.map(func(_c): return 1.0)
		sum = top.size()
	for i in top.size():
		out.append({"entry": top[i].entry, "d": top[i].d, "w": raw[i] / sum})
	return {"u": u, "active": out}


static func layer_shares(layer: Dictionary, exclusive: Array) -> Dictionary:
	var ex := not exclusive.is_empty()
	var globe := 0.0 if ex else 1.0 - float(layer.u)
	var by_source := {}
	var order := []
	for a in layer.active:
		var s: Dictionary = a.entry.source
		var nm: String = s.name if s.kind == "map" else "User"
		if not by_source.has(nm):
			order.append(nm)
		by_source[nm] = by_source.get(nm, 0.0) + a.w * layer.u
	var status := []
	for nm in order:
		if by_source[nm] >= 0.005:
			status.append({"name": nm, "share": by_source[nm]})
	if globe >= 0.005:
		status.append({"name": "Global", "share": globe})
	# Stable, largest first (JavaScript's sort is stable too).
	var indexed := []
	for i in status.size():
		indexed.append([status[i], i])
	indexed.sort_custom(func(a, b): return a[0].share > b[0].share or (a[0].share == b[0].share and a[1] < b[1]))
	return {"globeShare": globe, "userShare": layer.u, "exclusive": ex, "status": indexed.map(func(x): return x[0])}


static func status_line(shares: Dictionary, exclusive_names: Array) -> String:
	var parts := PackedStringArray()
	for x in shares.status:
		parts.append("%s %d%%" % [x.name, int(floorf(x.share * 100.0 + 0.5))])
	if shares.exclusive:
		if parts.is_empty():
			return "%s (exclusive) · outside" % ", ".join(PackedStringArray(exclusive_names))
		return "%s (exclusive)" % " · ".join(parts)
	return " · ".join(parts) if not parts.is_empty() else "Global 100%"


# ---------------------------------------------------------------- the file

static func load_file(p := PATH) -> BeaconDrafts:
	var d := BeaconDrafts.new()
	d.path = p
	if p != "" and FileAccess.file_exists(p):
		var data = JSON.parse_string(FileAccess.get_file_as_string(p))
		if validate_doc(data).is_empty():
			d.doc = normalize_doc(data)
		else:
			push_warning("BeaconDrafts: %s couldn't be read: %s" % [p, validate_doc(data)])
	d.changed(false)
	return d


func save_file() -> bool:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		push_error("BeaconDrafts: can't write %s" % path)
		return false
	f.store_string(JSON.stringify(doc))
	return true
