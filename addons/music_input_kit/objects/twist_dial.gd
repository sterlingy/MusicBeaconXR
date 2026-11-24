class_name TwistDial
extends Playable
## A big knob. Drag around it (mouse, finger), scroll over it, or grab it and
## twist your wrist (XR). Sends "turn", 0..1 over 270 degrees, to whatever knob
## it's patched to.

@export var radius := 0.06
@export var label := "Dial"
@export var start_value := 0.5
## Patch on first use (leave param empty for none): part, param, lo, hi.
@export var default_part := "keys"
@export var default_param := "filter.cutoff"

const SWEEP := deg_to_rad(270.0)

var value := 0.5
var knob: Node3D
var title: Label3D
var _grab := {} # hand id -> {angle or roll at grab, value at grab}


func _init() -> void:
	tint = Color("9b7bff")


func _declare_sources() -> void:
	declare("turn", "%s: turn" % label, default_part, default_param)
	_update_title()
	kit.patches.changed.connect(_update_title)
	send("turn", value)


func _build() -> void:
	value = start_value
	box = AABB(Vector3(-radius, 0, -radius), Vector3(radius * 2, 0.07, radius * 2))
	var ring := CylinderMesh.new()
	ring.top_radius = radius * 1.15
	ring.bottom_radius = radius * 1.2
	ring.height = 0.01
	add_mesh(ring, Color("2a3644"), Vector3(0, 0.005, 0))
	knob = Node3D.new()
	knob.position.y = 0.01
	add_child(knob)
	var cyl := CylinderMesh.new()
	cyl.top_radius = radius * 0.9
	cyl.bottom_radius = radius
	cyl.height = 0.045
	var body := MeshInstance3D.new()
	body.mesh = cyl
	body.material_override = mat(tint, 0.2)
	body.position.y = 0.0225
	knob.add_child(body)
	var pointer := MeshInstance3D.new()
	var pm := BoxMesh.new()
	pm.size = Vector3(0.008, 0.006, radius * 0.8)
	pointer.mesh = pm
	pointer.material_override = mat(Color.WHITE, 2.0)
	pointer.position = Vector3(0, 0.047, -radius * 0.45)
	knob.add_child(pointer)
	title = add_label(label, Vector3(0, 0.012, radius * 1.45), 0.00065)
	_show()


func _update_title() -> void:
	var t := kit.patches.targets_of(source_name("turn"))
	title.text = label + ("\n→ " + t[0].param if not t.is_empty() else "\n(unpatched)")


func set_value(v: float) -> void:
	value = clampf(v, 0.0, 1.0)
	send("turn", value)
	_show()


func _show() -> void:
	knob.rotation.y = SWEEP / 2 - value * SWEEP


func _angle(local: Vector3) -> float:
	return atan2(-local.x, -local.z)


func hand_down(hand: PlayHand) -> void:
	_grab[hand.id] = {"a": _angle(local_of(hand)), "roll": _roll(hand), "v": value, "grip": hand.grip}
	hand.pulse(0.2)
	touched.emit(hand, 0.3)


func _roll(hand: PlayHand) -> float:
	return hand.basis.get_euler().z


func hand_move(hand: PlayHand) -> void:
	if not _grab.has(hand.id):
		return
	var g: Dictionary = _grab[hand.id]
	if hand.grip != g.grip:
		# Grip pressed or let go mid-touch: measure the twist from here.
		g.merge({"a": _angle(local_of(hand)), "roll": _roll(hand), "v": value, "grip": hand.grip}, true)
	if hand.is_xr() and hand.grip:
		# Wrist twist since the grab; clockwise (negative roll) turns it up.
		set_value(g.v - angle_difference(g.roll, _roll(hand)) / SWEEP)
	else:
		# Drag around the knob; clockwise seen from above turns it up.
		var a := _angle(local_of(hand))
		set_value(value - angle_difference(g.a, a) / SWEEP)
		g.a = a


func hand_up(hand: PlayHand) -> void:
	_grab.erase(hand.id)


func wheel(_hand: PlayHand, steps: float) -> void:
	set_value(value + steps * 0.03)
