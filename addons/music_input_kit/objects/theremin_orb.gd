class_name ThereminOrb
extends Playable
## A glowing field you play without touching anything solid, like a theremin.
## Put a hand in (or press and drag on it): left to right is pitch over two
## octaves, height is the "height" source, near to far the "depth" source.
## With the lock on, the pitch steps through the scale; off, it slides freely.

@export var size := Vector3(0.44, 0.36, 0.3)
@export var octaves := 2.0
## Steps down from the base note for the left edge.
@export var low_offset := -12

var orb: MeshInstance3D
var marker: MeshInstance3D
var rungs: MeshInstance3D
var _voice := 0
var _hand_id := -1
var _glow := 0.0


func _init() -> void:
	part = "lead"
	tint = Color("ff4f9a")


func _declare_sources() -> void:
	declare("height", "Orb: height", part, "filter.cutoff", 0.25, 0.9)
	declare("depth", "Orb: depth", part, "vibrato.depth", 0.0, 0.6)
	_draw_rungs()


func _build() -> void:
	box = AABB(Vector3(-size.x / 2, 0.06, -size.z / 2), size)
	add_box(Vector3(size.x, 0.03, size.z), Color("2a3644"), Vector3(0, 0.015, 0))
	var sph := SphereMesh.new()
	sph.radius = 0.5
	sph.height = 1.0
	orb = add_mesh(sph, tint, Vector3(0, 0.06 + size.y / 2, 0), 0.12, 0.08)
	orb.scale = size
	var dot := SphereMesh.new()
	dot.radius = 0.018
	dot.height = 0.036
	marker = add_mesh(dot, Color.WHITE, Vector3.ZERO, 3.0)
	marker.visible = false
	rungs = MeshInstance3D.new()
	add_child(rungs)


func _on_scale_changed() -> void:
	_draw_rungs()


## Thin lines across the floor of the field at each allowed note, so you can aim.
func _draw_rungs() -> void:
	var im := ImmediateMesh.new()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	var lo := kit.base_note + low_offset
	for n in range(lo, lo + int(octaves * 12) + 1):
		if not kit.scale.enabled or kit.scale.in_scale(n):
			var x := box.position.x + (n - lo) / (octaves * 12.0) * size.x
			var tonic := posmod(n - kit.scale.root, 12) == 0
			im.surface_set_color(Color(tint, 0.9 if tonic else 0.35))
			im.surface_add_vertex(Vector3(x, 0.032, -size.z / 2))
			im.surface_set_color(Color(tint, 0.9 if tonic else 0.35))
			im.surface_add_vertex(Vector3(x, 0.032, size.z / 2))
	im.surface_end()
	rungs.mesh = im
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rungs.material_override = m


func pitch_at(local: Vector3) -> float:
	return kit.base_note + low_offset + frac(local, 0) * octaves * 12.0


## Pointers move across the field's face (x and height).
func drag_plane(hit: Vector3) -> Array:
	return [global_transform * Vector3(0, 0, 0), global_basis.z.normalized()]


func hand_down(hand: PlayHand) -> void:
	if _hand_id != -1:
		return # one hand plays the orb; a second is ignored
	_hand_id = hand.id
	var local := local_of(hand)
	_voice = kit.start_note(part, pitch_at(local), 0.4 + 0.5 * hand.strike_strength())
	marker.visible = true
	_shape(local)
	touched.emit(hand, 0.5)


func hand_move(hand: PlayHand) -> void:
	if hand.id != _hand_id:
		return
	var local := local_of(hand)
	kit.move_note(_voice, pitch_at(local))
	_shape(local)


func hand_up(hand: PlayHand) -> void:
	if hand.id != _hand_id:
		return
	_hand_id = -1
	kit.end_note(_voice)
	_voice = 0
	marker.visible = false


func _shape(local: Vector3) -> void:
	send("height", frac(local, 1))
	send("depth", 1.0 - frac(local, 2))
	marker.position = box.position + box.size * Vector3(frac(local, 0), frac(local, 1), frac(local, 2))
	_glow = 0.2 + frac(local, 1) * 1.2


func _process(delta: float) -> void:
	var m := orb.material_override as StandardMaterial3D
	var target := _glow if _hand_id != -1 else 0.12
	m.emission_energy_multiplier = lerpf(m.emission_energy_multiplier, target, 1.0 - exp(-delta * 10.0))
