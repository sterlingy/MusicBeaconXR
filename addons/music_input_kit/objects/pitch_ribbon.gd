class_name PitchRibbon
extends Playable
## A long strip you slide along: press anywhere to start a note, slide to glide
## the pitch, lift to stop. Wiggle for vibrato. Where you are across its width
## is the "across" source; in XR, pressing down into it is "press".

@export var length := 0.7
@export var width := 0.07
@export var octaves := 2.0
@export var low_offset := -24

var strip: MeshInstance3D
var glow: MeshInstance3D
var ticks: MeshInstance3D
var _voices := {} # hand id -> voice


func _init() -> void:
	part = "bass"
	tint = Color("2ec4b6")


func _declare_sources() -> void:
	declare("across", "Ribbon: across", part, "filter.cutoff", 0.15, 0.7)
	declare("press", "Ribbon: press", part, "filter.emphasis", 0.1, 0.8)
	_draw_ticks()


func _build() -> void:
	box = AABB(Vector3(-length / 2, 0, -width / 2), Vector3(length, 0.06, width))
	strip = add_box(Vector3(length, 0.015, width), tint.darkened(0.5), Vector3(0, 0.008, 0), 0.2)
	glow = add_box(Vector3(0.02, 0.018, width), Color.WHITE, Vector3(0, 0.01, 0), 3.0)
	glow.visible = false
	ticks = MeshInstance3D.new()
	add_child(ticks)


func _on_scale_changed() -> void:
	_draw_ticks()


func _draw_ticks() -> void:
	var im := ImmediateMesh.new()
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	var lo := kit.base_note + low_offset
	for n in range(lo, lo + int(octaves * 12) + 1):
		var on := kit.scale.in_scale(n) if kit.scale.enabled else posmod(n, 12) in [0, 2, 4, 5, 7, 9, 11]
		if not on:
			continue
		var x := box.position.x + (n - lo) / (octaves * 12.0) * length
		var tonic := posmod(n - kit.scale.root, 12) == 0
		var c := Color(1, 1, 1, 0.9 if tonic else 0.3)
		im.surface_set_color(c)
		im.surface_add_vertex(Vector3(x, 0.017, -width / 2))
		im.surface_set_color(c)
		im.surface_add_vertex(Vector3(x, 0.017, width / 2 if tonic else 0.0))
	im.surface_end()
	ticks.mesh = im
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	ticks.material_override = m


func pitch_at(local: Vector3) -> float:
	return kit.base_note + low_offset + frac(local, 0) * octaves * 12.0


func hand_down(hand: PlayHand) -> void:
	var local := local_of(hand)
	var s := hand.strike_strength(global_basis.y.normalized())
	_voices[hand.id] = kit.start_note(part, pitch_at(local), 0.5 + 0.5 * s)
	glow.visible = true
	_shape(local)
	touched.emit(hand, s)


func hand_move(hand: PlayHand) -> void:
	if not _voices.has(hand.id):
		return
	var local := local_of(hand)
	kit.move_note(_voices[hand.id], pitch_at(local))
	_shape(local)


func hand_up(hand: PlayHand) -> void:
	if _voices.has(hand.id):
		kit.end_note(_voices[hand.id])
		_voices.erase(hand.id)
	glow.visible = not _voices.is_empty()


func _shape(local: Vector3) -> void:
	send("across", frac(local, 2))
	send("press", 1.0 - frac(local, 1))
	glow.position.x = clampf(local.x, box.position.x, box.end.x)
