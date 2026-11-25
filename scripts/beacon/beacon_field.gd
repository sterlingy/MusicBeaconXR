class_name BeaconField
extends RefCounted
## Beacon layouts and listener weighting (GDScript port of web/src/beacons.js).
##
## Positions are Vector2: (x, y) meters on the test grid, (lon, lat) degrees on
## the globe, and on a local grid (x, y) meters from the grid's middle, x east
## and y south (as on the test grid, where row A is the far one). Everything
## above this class only uses ids, distances and weights, so the fields are
## interchangeable.

const EARTH_RADIUS_KM := 6371.0088
const M_PER_DEG := EARTH_RADIUS_KM * 1000.0 * PI / 180.0
## Most spacings along one side of a local grid (so at most 151 x 151 beacons).
const MAX_LOCAL_STEPS := 150

var kind := "grid"
var spacing := 100.0
var beacons: Array[Dictionary] = [] # {id, label, pos: Vector2}
var _step := 10.0
var _rows: Array = [] # globe: beacons per latitude row index
# Local grid (make_local): its middle, lattice band and size.
var center_lat := 0.0
var center_lon := 0.0
var band := 0
var _cos_b := 1.0
var n := 0
var steps := 0
var side_m := 0.0
var size_km := 0.0
var spacing_km := 0.0
var capped := false


static func make_grid(n := 5, p_spacing := 100.0) -> BeaconField:
	var f := BeaconField.new()
	f.kind = "grid"
	f.spacing = p_spacing
	var half := (n - 1) / 2.0
	for row in n:
		for col in n:
			f.beacons.append({"id": "g%d%d" % [row, col], "label": "%s%d" % [char(65 + row), col + 1],
				"pos": Vector2((col - half) * p_spacing, (row - half) * p_spacing)})
	return f


static func make_globe(step := 10.0) -> BeaconField:
	var f := BeaconField.new()
	f.kind = "globe"
	f._step = step
	f.spacing = deg_to_rad(step) * EARTH_RADIUS_KM
	var rows := roundi(180.0 / step)
	var cols := roundi(360.0 / step)
	f.beacons.append({"id": "pS", "label": "90°S", "pos": Vector2(0, -90)})
	for i in range(1, rows):
		var lat := -90 + i * step
		for j in cols:
			var lon := -180 + j * step
			f.beacons.append({"id": "l%d_%d" % [lat, lon], "label": "%s %s" % [_fmt(lat, "S", "N"), _fmt(lon, "W", "E")], "pos": Vector2(lon, lat)})
	f.beacons.append({"id": "pN", "label": "90°N", "pos": Vector2(0, 90)})
	f._rows.resize(rows + 1)
	for r in rows + 1:
		f._rows[r] = []
	for b in f.beacons:
		f._rows[roundi((b.pos.y + 90.0) / step)].append(b)
	return f


## A local grid, as web/src/beacons.js makeLocalGridField: `size_km` a side
## around (lat, lon), a beacon every `spacing_km` (rounded to the meter, at
## least 10 m, at most MAX_LOCAL_STEPS spacings a side). Every local grid sits
## on one worldwide 1 m lattice, so a place always has the same beacon ids,
## and so the same songs, whatever the size, spacing or where it was centered.
static func make_local(lat: float, lon: float, p_size_km := 50.0, p_spacing_km := 1.0) -> BeaconField:
	var f := BeaconField.new()
	f.kind = "local"
	var unit := maxi(10, int(SongGen.js_round(p_spacing_km * 1000.0)))
	var want := maxi(1, int(SongGen.js_round(p_size_km * 1000.0 / unit)))
	f.steps = mini(MAX_LOCAL_STEPS, want)
	f.capped = want > f.steps
	f.spacing = unit
	f.spacing_km = unit / 1000.0
	f.side_m = f.steps * unit
	f.size_km = f.side_m / 1000.0
	var half := f.steps / 2.0
	f.n = f.steps + 1
	f.band = clampi(int(SongGen.js_round(lat)), -85, 85)
	f._cos_b = cos(deg_to_rad(f.band))
	var m_lat := 1.0 / M_PER_DEG
	var m_lon := m_lat / f._cos_b
	var i_lo := int(SongGen.js_round(lat / (unit * m_lat) - half))
	var j_lo := int(SongGen.js_round(lon / (unit * m_lon) - half))
	var i_hi := i_lo + f.steps
	var i0 := i_lo + int(floorf(half))
	var j0 := j_lo + int(floorf(half))
	f.center_lat = (i_lo + half) * unit * m_lat
	f.center_lon = (j_lo + half) * unit * m_lon
	for r in f.n:
		for k in f.n:
			var i := i_hi - r
			var j := j_lo + k
			var di := (i - i0) * unit
			var dj := (j - j0) * unit
			var big_i := i * unit
			var big_j := j * unit
			var label := "Center"
			if di != 0 or dj != 0:
				var parts := []
				if di != 0:
					parts.append(_km(di) + ("N" if di > 0 else "S"))
				if dj != 0:
					parts.append(_km(dj) + ("E" if dj > 0 else "W"))
				label = " ".join(parts)
			var b_lat := big_i * m_lat
			var b_lon := big_j * m_lon
			f.beacons.append({"id": "g%d_%d_%d" % [f.band, big_i, big_j], "label": label, "lat": b_lat, "lon": b_lon,
				"pos": f.from_lat_lon(b_lat, b_lon), "row": r, "col": k})
	return f


## Kilometers as the browser prints them: up to 3 decimals, no trailing zeros.
static func _km(meters: int) -> String:
	var s := "%.3f" % (absi(meters) / 1000.0)
	s = s.rstrip("0").rstrip(".")
	return s


## A local-grid position (meters east, meters south of the middle) as
## {lat, lon} (full precision: a Vector2 would lose half a meter).
func to_lat_lon(p: Vector2) -> Dictionary:
	var lat := center_lat - p.y / M_PER_DEG
	var lon := center_lon + p.x / (_cos_b * M_PER_DEG)
	return {"lat": clampf(lat, -90.0, 90.0), "lon": fposmod(lon + 180.0, 360.0) - 180.0}


## (lat, lon) as a local-grid position: meters east, meters south of the middle.
func from_lat_lon(lat: float, lon: float) -> Vector2:
	var wrapped := center_lon + fposmod(lon - center_lon + 540.0, 360.0) - 180.0
	return Vector2((wrapped - center_lon) * _cos_b * M_PER_DEG, -(lat - center_lat) * M_PER_DEG)


static func _fmt(v: float, neg: String, pos: String) -> String:
	return "%d°%s" % [absi(int(v)), neg if v < 0 else (pos if v > 0 else "")]


## Great-circle distance in km between (lon, lat) points.
static func great_circle_km(a: Vector2, b: Vector2) -> float:
	var d_lat := deg_to_rad(b.y - a.y)
	var d_lon := deg_to_rad(b.x - a.x)
	var h := pow(sin(d_lat / 2), 2) + cos(deg_to_rad(a.y)) * cos(deg_to_rad(b.y)) * pow(sin(d_lon / 2), 2)
	return 2.0 * EARTH_RADIUS_KM * asin(minf(1.0, sqrt(h)))


func distance(a: Vector2, b: Vector2) -> float:
	return great_circle_km(a, b) if kind == "globe" else a.distance_to(b)


func clamp_pos(p: Vector2) -> Vector2:
	if kind == "grid":
		var n := sqrt(beacons.size())
		var m := (n - 1) / 2.0 * spacing + spacing * 0.5
		return Vector2(clampf(p.x, -m, m), clampf(p.y, -m, m))
	if kind == "local":
		var edge := (steps / 2.0 + 0.5) * spacing
		return Vector2(clampf(p.x, -edge, edge), clampf(p.y, -edge, edge))
	return Vector2(fposmod(p.x + 180.0, 360.0) - 180.0, clampf(p.y, -90.0, 90.0))


func _candidates(p: Vector2) -> Array:
	if kind == "local":
		# The 4 nearest beacons on a square lattice are within 2 rows and columns.
		var half := steps / 2.0
		var r := clampi(int(SongGen.js_round(half + p.y / spacing)), 0, n - 1)
		var k := clampi(int(SongGen.js_round(half + p.x / spacing)), 0, n - 1)
		var near := []
		for a in range(maxi(0, r - 2), mini(n - 1, r + 2) + 1):
			for b in range(maxi(0, k - 2), mini(n - 1, k + 2) + 1):
				near.append(beacons[a * n + b])
		return near
	if kind != "globe":
		return beacons
	var r := roundi((p.y + 90.0) / _step)
	var out := []
	for k in range(maxi(0, r - 2), mini(_rows.size() - 1, r + 2) + 1):
		out.append_array(_rows[k])
	return out


## The `count` nearest beacons, sorted, as [{beacon, d}].
func nearest(p: Vector2, count := 4) -> Array:
	var best := []
	for b in _candidates(p):
		var d := distance(p, b.pos)
		if best.size() == count and not _closer(d, b, best[count - 1]):
			continue
		var i := best.size()
		while i > 0 and _closer(d, b, best[i - 1]):
			i -= 1
		best.insert(i, {"beacon": b, "d": d})
		if best.size() > count:
			best.pop_back()
	return best


static func _closer(d: float, b: Dictionary, other: Dictionary) -> bool:
	return d < other.d or (d == other.d and String(b.id) < String(other.beacon.id))


## Weights for the `active` closest beacons, summing to 1: w = (1/d - 1/d4)^sharpness.
## A beacon fades to exactly 0 as it swaps with the 4th closest; standing on one gives it 100%.
func weigh(p: Vector2, active := 3, sharpness := 1.5) -> Array:
	var near := nearest(p, active + 1)
	var ref: float = near[active].d if near.size() > active else near[-1].d * 1.5 + 1e-9
	var eps := spacing * 1e-6
	var out := []
	if near[0].d <= eps:
		for i in mini(active, near.size()):
			out.append({"id": near[i].beacon.id, "beacon": near[i].beacon, "d": near[i].d, "w": 1.0 if i == 0 else 0.0})
		return out
	var sum := 0.0
	for i in mini(active, near.size()):
		var raw := pow(maxf(0.0, 1.0 / near[i].d - 1.0 / ref), sharpness)
		out.append({"id": near[i].beacon.id, "beacon": near[i].beacon, "d": near[i].d, "w": raw})
		sum += raw
	if sum <= 1e-12:
		for o in out:
			o.w = 1.0
		sum = out.size()
	for o in out:
		o.w /= sum
	return out
