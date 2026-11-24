class_name Flywheel
extends Playable
## A wheel you flick to spin. It keeps spinning and slows down by itself; how
## fast it spins is the "speed" source (0 still, 1 at `max_rps` turns a second).
## Patched to a tremolo or vibrato, the sound shimmers and settles as it slows.
## Touch it to brake it.

@export var radius := 0.08
@export var max_rps := 3.0
## How quickly it slows down (per second); smaller spins longer.
@export var friction := 0.35
@export var label := "Flywheel"
@export var default_part := "mallet"
@export var default_param := "perf.tremolo"

## Turns per second (signed: negative spins the other way).
var rps := 0.0
var wheel_node: Node3D
var title: Label3D
var _grab := {} # hand id -> {a, t}
var _last_sent := -1.0


func _init() -> void:
	tint = Color("2ec4b6")


func _declare_sources() -> void:
	declare("speed", "%s: speed" % label, default_part, default_param)
	_update_title()
	kit.patches.changed.connect(_update_title)
	send("speed", 0.0)


func _build() -> void:
	box = AABB(Vector3(-radius, 0, -radius), Vector3(radius * 2, 0.06, radius * 2))
	add_box(Vector3(0.02, 0.02, 0.02), Color("2a3644"), Vector3(0, 0.01, 0))
	wheel_node = Node3D.new()
	wheel_node.position.y = 0.025
	add_child(wheel_node)
	var disc := CylinderMesh.new()
	disc.top_radius = radius
	disc.bottom_radius = radius
	disc.height = 0.012
	var d := MeshInstance3D.new()
	d.mesh = disc
	d.material_override = mat(tint.darkened(0.3), 0.15)
	wheel_node.add_child(d)
	for k in 6:
		var spoke := MeshInstance3D.new()
		var sm := BoxMesh.new()
		sm.size = Vector3(0.008, 0.004, radius * 0.9)
		spoke.mesh = sm
		spoke.material_override = mat(tint if k > 0 else Color.WHITE, 1.2)
		spoke.position.y = 0.008
		spoke.rotation.y = k * TAU / 6
		spoke.position += Vector3(sin(spoke.rotation.y), 0, cos(spoke.rotation.y)) * radius * 0.45
		wheel_node.add_child(spoke)
	title = add_label(label, Vector3(0, 0.012, radius + 0.035), 0.00065)


func _update_title() -> void:
	var t := kit.patches.targets_of(source_name("speed"))
	title.text = label + ("\n→ " + t[0].param if not t.is_empty() else "\n(unpatched)")


func _angle(local: Vector3) -> float:
	return atan2(local.x, local.z)


func hand_down(hand: PlayHand) -> void:
	_grab[hand.id] = {"a": _angle(local_of(hand)), "t": Time.get_ticks_usec(), "v": 0.0}
	touched.emit(hand, 0.3)


func hand_move(hand: PlayHand) -> void:
	if not _grab.has(hand.id):
		return
	var g: Dictionary = _grab[hand.id]
	var a := _angle(local_of(hand))
	var now := Time.get_ticks_usec()
	var dt := maxf((now - g.t) / 1e6, 1e-3)
	var da := angle_difference(g.a, a)
	wheel_node.rotation.y += da
	# Turns per second, smoothed so the flick speed is the last few moves.
	g.v = lerpf(g.v, da / TAU / dt, 0.5)
	rps = g.v
	g.a = a
	g.t = now


func hand_up(hand: PlayHand) -> void:
	if _grab.has(hand.id):
		rps = clampf(_grab[hand.id].v, -max_rps, max_rps)
		_grab.erase(hand.id)
		hand.pulse(absf(rps) / max_rps)


## Spin it from code (or a test): turns per second.
func spin(turns_per_second: float) -> void:
	rps = clampf(turns_per_second, -max_rps, max_rps)


func wheel(_hand: PlayHand, steps: float) -> void:
	spin(rps + steps * 0.3)


func _process(delta: float) -> void:
	if _grab.is_empty():
		rps *= exp(-friction * delta)
		if absf(rps) < 0.02:
			rps = 0.0
		wheel_node.rotation.y += rps * TAU * delta
	var s := clampf(absf(rps) / max_rps, 0.0, 1.0)
	if absf(s - _last_sent) > 0.004 or (s == 0.0 and _last_sent != 0.0):
		_last_sent = s
		send("speed", s)
