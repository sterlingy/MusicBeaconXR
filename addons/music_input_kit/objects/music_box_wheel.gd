class_name MusicBoxWheel
extends Playable
## A music-box disc: tap a spot to place or remove a peg, flick the disc to spin
## it, and every peg that passes the comb (the bright bar at the front) plays
## its ring's note. Rings are steps of the scale, inner = low. Spin it faster
## for a faster tune; it slows down by itself unless the motor is on.

@export var radius := 0.13
@export var rings := 6
@export var slots := 16
@export var max_rps := 2.0
@export var friction := 0.25
## Turns per second the motor holds it at (0 = no motor, free spinning).
@export var motor_rps := 0.0
@export var note_length := 0.35

var rps := 0.0
var disc_node: Node3D
var pegs := {} # Vector2i(ring, slot) -> MeshInstance3D
var comb: MeshInstance3D
var _rot := 0.0
var _grab := {} # hand id -> {a, a0, t, v, moved, local}


func _init() -> void:
	part = "mallet"
	tint = Color("ffd166")


func _declare_sources() -> void:
	kit.patches.register(source_name("speed"), "Music box: speed")


func _build() -> void:
	box = AABB(Vector3(-radius, 0, -radius), Vector3(radius * 2, 0.06, radius * 2))
	disc_node = Node3D.new()
	disc_node.position.y = 0.02
	add_child(disc_node)
	var disc := CylinderMesh.new()
	disc.top_radius = radius
	disc.bottom_radius = radius
	disc.height = 0.01
	var d := MeshInstance3D.new()
	d.mesh = disc
	d.material_override = mat(Color("2a3644"), 0.05)
	disc_node.add_child(d)
	# Ring guides.
	var im := ImmediateMesh.new()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	for r in rings:
		var rr := _ring_radius(r)
		for k in 48:
			for a in [k * TAU / 48, (k + 1) * TAU / 48]:
				im.surface_set_color(Color(tint, 0.25))
				im.surface_add_vertex(Vector3(sin(a) * rr, 0.0055, cos(a) * rr))
	for k in slots:
		var a := k * TAU / slots
		im.surface_set_color(Color(1, 1, 1, 0.12))
		im.surface_add_vertex(Vector3(sin(a), 0, cos(a)) * _ring_radius(0) * 0.7 + Vector3(0, 0.0055, 0))
		im.surface_set_color(Color(1, 1, 1, 0.12))
		im.surface_add_vertex(Vector3(sin(a), 0, cos(a)) * radius * 0.98 + Vector3(0, 0.0055, 0))
	im.surface_end()
	var guides := MeshInstance3D.new()
	guides.mesh = im
	var gm := StandardMaterial3D.new()
	gm.vertex_color_use_as_albedo = true
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	guides.material_override = gm
	disc_node.add_child(guides)
	comb = add_box(Vector3(0.01, 0.02, radius - _ring_radius(0) + 0.02), Color.WHITE, Vector3(0, 0.035, (radius + _ring_radius(0)) / 2), 1.5)


func _ring_radius(r: int) -> float:
	return lerpf(radius * 0.3, radius * 0.9, float(r) / maxf(rings - 1, 1))


func note_of(ring: int) -> int:
	return kit.scale.step(kit.base_note, ring)


## Ring and slot under a point (in the object's space), at the current spin.
func cell_at(local: Vector3) -> Vector2i:
	var r := Vector2(local.x, local.z).length()
	var ring := clampi(roundi(inverse_lerp(radius * 0.3, radius * 0.9, r) * (rings - 1)), 0, rings - 1)
	var a := fposmod(atan2(local.x, local.z) - _rot, TAU)
	var slot := roundi(a / (TAU / slots)) % slots
	return Vector2i(ring, slot)


func toggle_peg(cell: Vector2i) -> bool:
	if pegs.has(cell):
		pegs[cell].queue_free()
		pegs.erase(cell)
		return false
	var s := SphereMesh.new()
	s.radius = 0.007
	s.height = 0.014
	var m := MeshInstance3D.new()
	m.mesh = s
	m.material_override = mat(tint.lerp(Color("ff8a3d"), float(cell.x) / rings), 0.8)
	var a := cell.y * TAU / slots
	m.position = Vector3(sin(a), 0, cos(a)) * _ring_radius(cell.x) + Vector3(0, 0.011, 0)
	disc_node.add_child(m)
	pegs[cell] = m
	return true


func spin(turns_per_second: float) -> void:
	rps = clampf(turns_per_second, -max_rps, max_rps)


func hand_down(hand: PlayHand) -> void:
	var l := local_of(hand)
	var a := atan2(l.x, l.z)
	_grab[hand.id] = {"a": a, "t": Time.get_ticks_usec(), "v": 0.0, "moved": 0.0, "local": l}
	touched.emit(hand, 0.3)


func hand_move(hand: PlayHand) -> void:
	if not _grab.has(hand.id):
		return
	var g: Dictionary = _grab[hand.id]
	var l := local_of(hand)
	var a := atan2(l.x, l.z)
	var now := Time.get_ticks_usec()
	var dt := maxf((now - g.t) / 1e6, 1e-3)
	var da := angle_difference(g.a, a)
	g.moved += absf(da)
	if g.moved > 0.15:
		_advance(da)
		g.v = lerpf(g.v, da / TAU / dt, 0.5)
		rps = g.v
	g.a = a
	g.t = now


func hand_up(hand: PlayHand) -> void:
	if not _grab.has(hand.id):
		return
	var g: Dictionary = _grab[hand.id]
	_grab.erase(hand.id)
	if g.moved <= 0.15:
		# A tap, not a flick: place or remove a peg.
		toggle_peg(cell_at(g.local))
		hand.pulse(0.3)
	else:
		spin(g.v)


func wheel(_hand: PlayHand, steps: float) -> void:
	spin(rps + steps * 0.1)


func _process(delta: float) -> void:
	if _grab.is_empty():
		if motor_rps != 0.0:
			rps = lerpf(rps, motor_rps, 1.0 - exp(-delta * 2.0))
		else:
			rps *= exp(-friction * delta)
			if absf(rps) < 0.01:
				rps = 0.0
		_advance(rps * TAU * delta)
	send("speed", clampf(absf(rps) / max_rps, 0.0, 1.0))


## Turns the disc by `da` radians and plays every peg that crosses the comb.
func _advance(da: float) -> void:
	if da == 0.0:
		return
	var before := _rot
	_rot += da
	disc_node.rotation.y = _rot
	var step := TAU / slots
	var crossed := false
	for cell in pegs:
		var off: float = cell.y * step
		if floori((before + off) / TAU) != floori((_rot + off) / TAU):
			kit.strike(part, note_of(cell.x), 0.75, note_length)
			flash(pegs[cell], 4.0, 0.3)
			crossed = true
	if crossed:
		flash(comb, 3.0, 0.15)
