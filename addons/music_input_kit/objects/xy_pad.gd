class_name XYPad
extends Playable
## A square with a puck: slide the puck to move two knobs at once, left-right
## ("x") and near-far ("y"). Good for filter cutoff against resonance.

@export var size := 0.18
@export var label := "XY"
@export var default_part := "keys"
@export var x_param := "filter.cutoff"
@export var y_param := "filter.resonance"

var x := 0.5
var y := 0.5
var puck: MeshInstance3D
var cross: MeshInstance3D
var title: Label3D


func _init() -> void:
	tint = Color("7ad7ff")


func _declare_sources() -> void:
	declare("x", "%s: x" % label, default_part, x_param)
	declare("y", "%s: y" % label, default_part, y_param, 0.0, 0.7)
	_update_title()
	kit.patches.changed.connect(_update_title)
	send("x", x)
	send("y", y)


func _build() -> void:
	box = AABB(Vector3(-size / 2, 0, -size / 2), Vector3(size, 0.06, size))
	add_box(Vector3(size, 0.012, size), Color("1b2a38"), Vector3(0, 0.006, 0), 0.1)
	var grid := ImmediateMesh.new()
	grid.surface_begin(Mesh.PRIMITIVE_LINES)
	for i in 5:
		var t := -size / 2 + size * i / 4.0
		for v in [Vector3(t, 0.013, -size / 2), Vector3(t, 0.013, size / 2), Vector3(-size / 2, 0.013, t), Vector3(size / 2, 0.013, t)]:
			grid.surface_set_color(Color(tint, 0.25))
			grid.surface_add_vertex(v)
	grid.surface_end()
	var gm := MeshInstance3D.new()
	gm.mesh = grid
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	gm.material_override = m
	add_child(gm)
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.016
	cyl.bottom_radius = 0.018
	cyl.height = 0.02
	puck = add_mesh(cyl, tint, Vector3(0, 0.022, 0), 0.8)
	title = add_label(label, Vector3(0, 0.014, size / 2 + 0.03), 0.00065)
	_show()


func _update_title() -> void:
	var tx := kit.patches.targets_of(source_name("x"))
	var ty := kit.patches.targets_of(source_name("y"))
	title.text = "%s\n↔ %s\n↕ %s" % [label, tx[0].param if not tx.is_empty() else "-", ty[0].param if not ty.is_empty() else "-"]


func set_xy(nx: float, ny: float) -> void:
	x = clampf(nx, 0.0, 1.0)
	y = clampf(ny, 0.0, 1.0)
	send("x", x)
	send("y", y)
	_show()


func _show() -> void:
	puck.position.x = -size / 2 + x * size
	puck.position.z = size / 2 - y * size


func hand_down(hand: PlayHand) -> void:
	hand_move(hand)
	hand.pulse(0.2)
	touched.emit(hand, 0.3)


func hand_move(hand: PlayHand) -> void:
	var l := local_of(hand)
	set_xy(frac(l, 0), 1.0 - frac(l, 2))


func hand_up(_hand: PlayHand) -> void:
	pass
