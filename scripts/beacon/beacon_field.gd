class_name BeaconField
extends RefCounted
## Beacon layouts and listener weighting (GDScript port of web/src/beacons.js).
##
## Positions are Vector2: (x, y) meters on the test grid, (lon, lat) degrees on
## the globe. Everything above this class only uses ids, distances and weights,
## so the grid and the globe are interchangeable.

const EARTH_RADIUS_KM := 6371.0088

var kind := "grid"
var spacing := 100.0
var beacons: Array[Dictionary] = [] # {id, label, pos: Vector2}
var _step := 10.0
var _rows: Array = [] # globe: beacons per latitude row index


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


static func _fmt(v: float, neg: String, pos: String) -> String:
	return "%d°%s" % [absi(int(v)), neg if v < 0 else (pos if v > 0 else "")]


## Great-circle distance in km between (lon, lat) points.
static func great_circle_km(a: Vector2, b: Vector2) -> float:
	var d_lat := deg_to_rad(b.y - a.y)
	var d_lon := deg_to_rad(b.x - a.x)
	var h := pow(sin(d_lat / 2), 2) + cos(deg_to_rad(a.y)) * cos(deg_to_rad(b.y)) * pow(sin(d_lon / 2), 2)
	return 2.0 * EARTH_RADIUS_KM * asin(minf(1.0, sqrt(h)))


func distance(a: Vector2, b: Vector2) -> float:
	return a.distance_to(b) if kind == "grid" else great_circle_km(a, b)


func clamp_pos(p: Vector2) -> Vector2:
	if kind == "grid":
		var n := sqrt(beacons.size())
		var m := (n - 1) / 2.0 * spacing + spacing * 0.5
		return Vector2(clampf(p.x, -m, m), clampf(p.y, -m, m))
	return Vector2(fposmod(p.x + 180.0, 360.0) - 180.0, clampf(p.y, -90.0, 90.0))


func _candidates(p: Vector2) -> Array:
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
