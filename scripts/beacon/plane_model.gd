class_name PlaneModel
extends RefCounted
## A smooth little airliner, built in code (no model file): a rounded fuselage
## that tapers to a raised tail, swept and tapered wings with a slight upward
## angle, two engines under the wings, a tailplane and a fin. Every part is
## lofted through rounded cross-sections and smooth-shaded. Nose along -z, up +y,
## wings along x; about 2.3 units long.
##
##   var mesh := PlaneModel.build()

const SIDES := 18 # around the fuselage and engines
const FOIL := 14 # around a wing section


## The whole plane as one mesh.
static func build() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_smooth_group(0)
	_fuselage(st)
	for s in [-1.0, 1.0]:
		# Main wing: root chord 0.62 at the fuselage, tip chord 0.2, swept back.
		_wing(st, Vector3(0.12 * s, -0.05, -0.12), 0.62, Vector3(1.25 * s, 0.06, 0.38), 0.2, 0.07)
		# Tailplane.
		_wing(st, Vector3(0.05 * s, 0.05, 0.86), 0.3, Vector3(0.48 * s, 0.09, 1.06), 0.12, 0.035)
		# Engine under the wing.
		_engine(st, Vector3(0.45 * s, -0.17, -0.2))
	# Fin: a wing standing up.
	_fin(st)
	st.generate_normals()
	return st.commit()


## Adds quads between consecutive rings (each ring the same size, closed) and
## caps both ends. Rings run front to back; each ring goes the same way round.
static func _loft(st: SurfaceTool, rings: Array, cap := true) -> void:
	var n: int = rings[0].size()
	for r in rings.size() - 1:
		var a: PackedVector3Array = rings[r]
		var b: PackedVector3Array = rings[r + 1]
		for i in n:
			var j := (i + 1) % n
			_tri(st, a[i], b[i], b[j])
			_tri(st, a[i], b[j], a[j])
	if cap:
		for end in [0, rings.size() - 1]:
			var ring: PackedVector3Array = rings[end]
			var c := Vector3.ZERO
			for p in ring:
				c += p
			c /= ring.size()
			for i in n:
				var j := (i + 1) % n
				if end == 0:
					_tri(st, c, ring[j], ring[i])
				else:
					_tri(st, c, ring[i], ring[j])


static func _tri(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3) -> void:
	st.add_vertex(a)
	st.add_vertex(b)
	st.add_vertex(c)


## A circle of radius r (and squash ry/r upright) around a point, facing along z.
static func _circle(center: Vector3, r: float, ry: float) -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in SIDES:
		var t := TAU * i / SIDES
		out.append(center + Vector3(cos(t) * r, sin(t) * ry, 0.0))
	return out


static func _fuselage(st: SurfaceTool) -> void:
	var rings := []
	var n := 26
	for k in n + 1:
		var t := float(k) / n # 0 = nose tip, 1 = tail tip
		var z := lerpf(-1.25, 1.12, t)
		var r: float
		if t < 0.16:
			r = 0.17 * sqrt(sin(t / 0.16 * PI * 0.5)) # rounded nose
		elif t < 0.62:
			r = 0.17
		else:
			r = lerpf(0.17, 0.035, smoothstep(0.62, 1.0, t)) # tapering tail cone
		r = maxf(r, 0.004)
		var lift := 0.09 * smoothstep(0.6, 1.0, t) # the tail sweeps up
		rings.append(_circle(Vector3(0, lift, z), r, r * 1.04))
	_loft(st, rings)


## A section of a wing: a rounded, slim airfoil of `chord` (along z) and
## `thick` (along y), its leading edge at `lead`.
static func _foil(lead: Vector3, chord: float, thick: float, upright := false) -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in FOIL:
		var t := TAU * i / FOIL
		var x := 0.5 - 0.5 * cos(t) # 0 at the leading edge, 1 at the trailing edge
		# Thickest a third of the way back, thin at the trailing edge.
		var h := thick * sin(t) * (1.0 - 0.55 * x)
		var along := x * chord
		if upright:
			out.append(lead + Vector3(h, 0.0, along))
		else:
			out.append(lead + Vector3(0.0, h, along))
	return out


static func _wing(st: SurfaceTool, root: Vector3, root_chord: float, tip: Vector3, tip_chord: float, thick: float) -> void:
	var rings := []
	var steps := 6
	for k in steps + 1:
		var t := float(k) / steps
		var lead := root.lerp(tip, t)
		var chord := lerpf(root_chord, tip_chord, t)
		# Rounded tip: the last section shrinks to a sliver.
		var th := thick * lerpf(1.0, 0.55, t) * (0.35 if k == steps else 1.0)
		rings.append(_foil(lead, chord, th))
	_loft(st, rings)


static func _fin(st: SurfaceTool) -> void:
	var rings := []
	var steps := 5
	for k in steps + 1:
		var t := float(k) / steps
		var lead := Vector3(0, 0.12, 0.66).lerp(Vector3(0, 0.62, 0.98), t)
		var chord := lerpf(0.42, 0.16, t)
		var th := 0.035 * lerpf(1.0, 0.6, t) * (0.35 if k == steps else 1.0)
		var ring := _foil(lead, chord, th, true)
		rings.append(ring)
	_loft(st, rings)


static func _engine(st: SurfaceTool, front: Vector3) -> void:
	var rings := []
	var n := 8
	for k in n + 1:
		var t := float(k) / n
		var r := 0.085 * (0.82 + 0.18 * sin(t * PI)) # a little fuller in the middle
		if k == 0 or k == n:
			r *= 0.8
		rings.append(_circle(front + Vector3(0, 0, 0.42 * t), r, r))
	_loft(st, rings)
	# A pylon up into the wing.
	var py := []
	for k in 3:
		py.append(_foil(front + Vector3(0, 0.07 + 0.05 * k, 0.06), 0.26, 0.018, true))
	_loft(st, py)
