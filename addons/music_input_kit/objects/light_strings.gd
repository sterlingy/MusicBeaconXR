class_name LightStrings
extends Playable
## A standing frame of glowing strings, like a small harp. Touch a string to
## pluck it, keep holding and pull it to bend the note up, sweep across the
## strings to strum. The pull also comes out as the "pull" source.

@export var count := 7
@export var width := 0.42
@export var height := 0.36
## Most a pull bends, in semitones.
@export var max_bend := 2.0

var strings: Array[MeshInstance3D] = []
var labels: Array[Label3D] = []
var _wobble := [] # per string: amplitude


func _init() -> void:
	part = "harp"
	tint = Color("7ad7ff")


func _declare_sources() -> void:
	declare("pull", "Strings: pull", part, "model.brightness", 0.35, 1.0)
	_relabel()


func _build() -> void:
	box = AABB(Vector3(-width / 2, 0.03, -0.05), Vector3(width, height, 0.1))
	var frame := Color("3a4a5c")
	add_box(Vector3(width + 0.04, 0.03, 0.06), frame, Vector3(0, 0.015, 0))
	add_box(Vector3(width + 0.04, 0.02, 0.04), frame, Vector3(0, height + 0.04, 0))
	add_box(Vector3(0.02, height + 0.04, 0.04), frame, Vector3(-width / 2 - 0.01, height / 2 + 0.02, 0))
	add_box(Vector3(0.02, height + 0.04, 0.04), frame, Vector3(width / 2 + 0.01, height / 2 + 0.02, 0))
	for i in count:
		var x := box.position.x + width * (i + 0.5) / count
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.0025
		cyl.bottom_radius = 0.0025
		cyl.height = height
		cyl.radial_segments = 6
		var s := add_mesh(cyl, tint.lerp(Color.WHITE, float(i) / count * 0.5), Vector3(x, height / 2 + 0.03, 0), 0.6)
		strings.append(s)
		_wobble.append(0.0)
		labels.append(add_label("", Vector3(x, 0.05, 0.035), 0.0008, false))


func _on_scale_changed() -> void:
	_relabel()


func _relabel() -> void:
	if kit == null:
		return
	for i in labels.size():
		labels[i].text = ScaleLock.note_name(note_of(i), false)


func note_of(i: int) -> int:
	return kit.scale.step(kit.base_note, i)


func string_at(local: Vector3) -> int:
	return clampi(int(frac(local, 0) * count), 0, count - 1)


## Pointers drag on the frame's face.
func drag_plane(hit: Vector3) -> Array:
	return [hit, global_basis.z.normalized()]


func hand_down(hand: PlayHand) -> void:
	var local := local_of(hand)
	_pluck(hand, string_at(local), local)


func hand_move(hand: PlayHand) -> void:
	if not holds.has(hand.id):
		return
	var h: Dictionary = holds[hand.id]
	var local := local_of(hand)
	var i := string_at(local)
	if i != h.string:
		# Swept onto another string: strum it.
		kit.end_note(h.voice)
		_pluck(hand, i, local)
		return
	var d: Vector3 = local - h.start
	# XR pulls the string out of the frame (z); a pointer drags along it (y).
	var pull := absf(d.z) * 25.0 if hand.is_xr() else absf(d.y) * 8.0
	pull = clampf(pull, 0.0, 1.0)
	kit.move_note(h.voice, note_of(i) + pull * max_bend)
	send("pull", pull)
	_wobble[i] = maxf(_wobble[i], pull * 0.01)


func hand_up(hand: PlayHand) -> void:
	if holds.has(hand.id):
		var h: Dictionary = holds[hand.id]
		holds.erase(hand.id)
		# A plucked string rings on after you let go.
		get_tree().create_timer(1.2).timeout.connect(kit.end_note.bind(h.voice))
		send("pull", 0.0)


func _pluck(hand: PlayHand, i: int, local: Vector3) -> void:
	var s := hand.strike_strength(global_basis.z.normalized())
	var v := kit.start_note(part, note_of(i), s)
	holds[hand.id] = {"voice": v, "string": i, "start": local}
	_wobble[i] = 0.006 * (0.5 + s)
	flash(strings[i], 3.0, 0.6)
	hand.pulse(s * 0.4)
	touched.emit(hand, s)


func _process(delta: float) -> void:
	var t := Time.get_ticks_msec() / 1000.0
	for i in strings.size():
		if _wobble[i] > 0.0001:
			_wobble[i] *= exp(-delta * 4.0)
			strings[i].position.z = sin(t * 90.0 + i) * _wobble[i]
		elif strings[i].position.z != 0.0:
			strings[i].position.z = 0.0
