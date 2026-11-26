class_name WalkMath
extends RefCounted
## The replay maths for walk recordings ("beacon-walk"), with no scene or
## audio: the app twin of web/src/walk.js frameAt, checked against it by
## tests/walk_check.gd. BeaconWalks (the panel) uses it.


## The walk at `t` seconds: {pos, active: [{id, w}]}, interpolated between samples.
static func frame_at(rec: Dictionary, t: float) -> Dictionary:
	var S: Array = rec.samples
	if S.is_empty():
		return {"pos": {}, "active": []}
	if t <= S[0].t:
		return {"pos": S[0].p, "active": S[0].a.map(func(x): return {"id": x[0], "w": float(x[1])})}
	if t >= S[-1].t:
		return {"pos": S[-1].p, "active": S[-1].a.map(func(x): return {"id": x[0], "w": float(x[1])})}
	var lo := 0
	var hi := S.size() - 1
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if S[mid].t <= t:
			lo = mid
		else:
			hi = mid
	var a: Dictionary = S[lo]
	var b: Dictionary = S[hi]
	var k: float = (t - a.t) / maxf(1e-9, b.t - a.t)
	var ws := {}
	var order := []
	for x in a.a:
		ws[x[0]] = float(x[1]) * (1.0 - k)
		order.append(x[0])
	for x in b.a:
		if not ws.has(x[0]):
			order.append(x[0])
		ws[x[0]] = ws.get(x[0], 0.0) + float(x[1]) * k
	var pos: Dictionary
	if a.p.has("x"):
		pos = {"x": a.p.x + (b.p.x - a.p.x) * k, "y": a.p.y + (b.p.y - a.p.y) * k}
	else:
		pos = {"lat": a.p.lat + (b.p.lat - a.p.lat) * k, "lon": a.p.lon + (fposmod(b.p.lon - a.p.lon + 180.0, 360.0) - 180.0) * k}
	var active := []
	for id in order:
		if ws[id] > 1e-5:
			active.append({"id": id, "w": ws[id]})
	active.sort_custom(func(x, y): return x.w > y.w)
	return {"pos": pos, "active": active}


static func clock_text(s: float) -> String:
	return "%d:%02d" % [int(s) / 60, int(s) % 60]


## Meters between stored positions ({x, y} or {lat, lon}).
static func moved(a: Dictionary, b: Dictionary) -> float:
	if a.is_empty() or b.is_empty():
		return INF
	if a.has("x"):
		return Vector2(a.x - b.x, a.y - b.y).length()
	var d_lat: float = (b.lat - a.lat) * 111195.0
	var d_lon: float = (fposmod(b.lon - a.lon + 180.0, 360.0) - 180.0) * 111195.0 * cos(deg_to_rad(a.lat))
	return sqrt(d_lat * d_lat + d_lon * d_lon)
