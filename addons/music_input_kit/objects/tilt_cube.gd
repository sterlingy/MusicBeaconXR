class_name TiltCube
extends Playable
## A cube on a ball joint. Grab it and tip it: forward-back is "pitch",
## left-right is "roll", each 0..1 with level in the middle (0.5). In XR it
## follows your hand's tilt while you grip; with a pointer, drag it the way
## you want it to lean. Let go and it stays (or springs level with `spring_back`).

@export var cube := 0.09
@export var max_tilt := deg_to_rad(40.0)
@export var spring_back := false
@export var label := "Tilt"
@export var default_part := "lead"
@export var pitch_param := "delay.mix"
@export var roll_param := "filter.resonance"

var pitch := 0.0 # radians, + leans away
var roll := 0.0 # radians, + leans right
var pivot: Node3D
var title: Label3D
var _grab := {} # hand id -> {basis, pitch, roll, local}


func _init() -> void:
	tint = Color("ff4f9a")


func _declare_sources() -> void:
	declare("pitch", "%s: pitch" % label, default_part, pitch_param, 0.0, 0.8)
	declare("roll", "%s: roll" % label, default_part, roll_param, 0.0, 0.8)
	_update_title()
	kit.patches.changed.connect(_update_title)
	_send()


func _build() -> void:
	box = AABB(Vector3(-cube * 0.8, 0, -cube * 0.8), Vector3(cube * 1.6, cube * 1.6, cube * 1.6))
	var base := SphereMesh.new()
	base.radius = 0.02
	base.height = 0.04
	add_mesh(base, Color("3a4a5c"), Vector3(0, 0.02, 0))
	pivot = Node3D.new()
	pivot.position.y = 0.03
	add_child(pivot)
	var b := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3.ONE * cube
	b.mesh = bm
	b.material_override = mat(tint, 0.3)
	b.position.y = cube / 2 + 0.01
	pivot.add_child(b)
	var top := MeshInstance3D.new()
	var tm := BoxMesh.new()
	tm.size = Vector3(cube * 0.4, 0.004, cube * 0.4)
	top.mesh = tm
	top.material_override = mat(Color.WHITE, 1.5)
	top.position.y = cube + 0.012
	pivot.add_child(top)
	title = add_label(label, Vector3(0, 0.01, cube * 0.8 + 0.03), 0.00065)


func _update_title() -> void:
	var p := kit.patches.targets_of(source_name("pitch"))
	var r := kit.patches.targets_of(source_name("roll"))
	title.text = "%s\n⇅ %s\n⇄ %s" % [label, p[0].param if not p.is_empty() else "-", r[0].param if not r.is_empty() else "-"]


func set_tilt(p: float, r: float) -> void:
	pitch = clampf(p, -max_tilt, max_tilt)
	roll = clampf(r, -max_tilt, max_tilt)
	pivot.rotation = Vector3(-pitch, 0, -roll)
	_send()


func _send() -> void:
	send("pitch", 0.5 + 0.5 * pitch / max_tilt)
	send("roll", 0.5 + 0.5 * roll / max_tilt)


## Pointers drag on a wall facing them, through the cube.
func drag_plane(hit: Vector3) -> Array:
	return [hit, global_basis.z.normalized()]


func hand_down(hand: PlayHand) -> void:
	_grab[hand.id] = {"basis": hand.basis, "pitch": pitch, "roll": roll, "local": local_of(hand), "grip": hand.grip}
	hand.pulse(0.2)
	touched.emit(hand, 0.3)


func hand_move(hand: PlayHand) -> void:
	if not _grab.has(hand.id):
		return
	var g: Dictionary = _grab[hand.id]
	if hand.grip != g.grip:
		g.merge({"basis": hand.basis, "pitch": pitch, "roll": roll, "local": local_of(hand), "grip": hand.grip}, true)
	if hand.is_xr() and hand.grip:
		# Follow the hand's own rotation since the grab, in the cube's space.
		var rel: Basis = global_basis.inverse() * (hand.basis * (g.basis as Basis).inverse()) * global_basis
		var e := rel.get_euler()
		set_tilt(g.pitch - e.x, g.roll - e.z)
	else:
		# Drag: up leans it away, sideways leans it that way.
		var d: Vector3 = local_of(hand) - g.local
		set_tilt(g.pitch + d.y / 0.12 * max_tilt, g.roll + d.x / 0.12 * max_tilt)


func hand_up(hand: PlayHand) -> void:
	_grab.erase(hand.id)


func _process(delta: float) -> void:
	if spring_back and _grab.is_empty() and (absf(pitch) > 0.001 or absf(roll) > 0.001):
		var k := exp(-delta * 8.0)
		set_tilt(pitch * k, roll * k)
