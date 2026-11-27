class_name ListenerSpace
extends RefCounted
## Where a listener can stand, and how a walk step moves them. ListenerKit only
## knows positions as Vector2; the space decides what the numbers mean.
##
## A move direction is always (right, forward): x = east / screen-right,
## y = north / away from the viewer. Each space turns that into its own units.
##
##   ListenerSpace.planar(Rect2(-250, -250, 500, 500))   # meters, +y is south (Godot +z)
##   ListenerSpace.geo()                                   # (lon, lat) degrees

enum Kind { PLANAR, GEO }

var kind := Kind.PLANAR
## Planar: the walkable area. Geo: ignored (the whole sphere).
var bounds := Rect2(-250, -250, 500, 500)
## Planar: true when +y on the map is south (Godot's +z, screen-down). The grid scenes use this.
var y_down := true
## Default walking speed in space units per second (m/s planar, degrees/s geo).
var walk_speed := 55.0
## Wander turns back when it gets this close to the edge (planar) or above this |latitude| (geo).
var wander_margin := 20.0


static func planar(p_bounds: Rect2, p_speed := 55.0, p_y_down := true) -> ListenerSpace:
	var s := ListenerSpace.new()
	s.kind = Kind.PLANAR
	s.bounds = p_bounds
	s.walk_speed = p_speed
	s.y_down = p_y_down
	s.wander_margin = minf(p_bounds.size.x, p_bounds.size.y) * 0.04
	return s


static func geo(p_speed := 6.0) -> ListenerSpace:
	var s := ListenerSpace.new()
	s.kind = Kind.GEO
	s.walk_speed = p_speed
	s.wander_margin = 80.0
	return s


func clamp_pos(p: Vector2) -> Vector2:
	if kind == Kind.GEO:
		return Vector2(fposmod(p.x + 180.0, 360.0) - 180.0, clampf(p.y, -90.0, 90.0))
	return Vector2(clampf(p.x, bounds.position.x, bounds.end.x), clampf(p.y, bounds.position.y, bounds.end.y))


## Moves `p` by `dist` units along `dir` = (right, forward).
func step(p: Vector2, dir: Vector2, dist: float) -> Vector2:
	if dir == Vector2.ZERO or dist == 0.0:
		return p
	if dir.length() > 1.0:
		dir = dir.normalized()
	if kind == Kind.GEO:
		# A degree of longitude shrinks toward the poles; keep the walking speed even.
		var k := minf(4.0, 1.0 / maxf(0.15, cos(deg_to_rad(p.y))))
		return clamp_pos(Vector2(p.x + dir.x * dist * k, p.y + dir.y * dist))
	return clamp_pos(p + Vector2(dir.x, -dir.y if y_down else dir.y) * dist)


## The (right, forward) direction from `a` toward `b`, and the distance in walk units.
func toward(a: Vector2, b: Vector2) -> Dictionary:
	if kind == Kind.GEO:
		var d_lon := fposmod(b.x - a.x + 540.0, 360.0) - 180.0
		var k := minf(4.0, 1.0 / maxf(0.15, cos(deg_to_rad(a.y))))
		var v := Vector2(d_lon / k, b.y - a.y)
		return {"dir": v.normalized() if v.length() > 0.0 else Vector2.ZERO, "dist": v.length()}
	var d := b - a
	var f := Vector2(d.x, -d.y if y_down else d.y)
	return {"dir": f.normalized() if f.length() > 0.0 else Vector2.ZERO, "dist": f.length()}


## The point a fraction `t` (0..1) of the way from `a` to `b`: a straight line
## on a floor, the great circle on the globe (the way a plane flies).
func interp(a: Vector2, b: Vector2, t: float) -> Vector2:
	if kind == Kind.GEO:
		var va := _unit(a)
		var vb := _unit(b)
		var ang := va.angle_to(vb)
		if ang < 1e-6:
			return b
		var v := (va * sin((1.0 - t) * ang) + vb * sin(t * ang)) / sin(ang)
		v = v.normalized()
		return clamp_pos(Vector2(rad_to_deg(atan2(v.x, v.z)), rad_to_deg(asin(clampf(v.y, -1.0, 1.0)))))
	return clamp_pos(a.lerp(b, t))


## How far `a` is from `b`: kilometers along the great circle on the globe,
## space units (meters) on a floor.
func distance(a: Vector2, b: Vector2) -> float:
	if kind == Kind.GEO:
		return _unit(a).angle_to(_unit(b)) * 6371.0
	return a.distance_to(b)


static func _unit(p: Vector2) -> Vector3:
	var lat := deg_to_rad(p.y)
	var lon := deg_to_rad(p.x)
	return Vector3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon))


## Wander heading after one step: turns back from the edges. Heading is radians in (right, forward).
func bounce(p: Vector2, heading: float) -> float:
	var dir := Vector2(cos(heading), sin(heading))
	if kind == Kind.GEO:
		if absf(p.y) > wander_margin and signf(dir.y) == signf(p.y):
			return -heading
		return heading
	var fwd := -dir.y if y_down else dir.y # forward in map y
	if (p.x < bounds.position.x + wander_margin and dir.x < 0) or (p.x > bounds.end.x - wander_margin and dir.x > 0):
		heading = PI - heading
	if (p.y < bounds.position.y + wander_margin and fwd < 0) or (p.y > bounds.end.y - wander_margin and fwd > 0):
		heading = -heading
	return heading
