class_name ChimeBars
extends Playable
## A row of bars to strike, like a marimba lying on the table. Each bar is one
## step of the scale (or one semitone with the lock off). Hit harder for louder;
## hit near the end of a bar instead of the middle for a different tone (the
## "spot" source). Drag or sweep across the bars for a glissando.

@export var count := 8
@export var width := 0.56
@export var depth := 0.24
## Steps up from the kit's base note for the first bar (12 = an octave up).
@export var first_step := 0
@export var note_length := 0.6

var bars: Array[MeshInstance3D] = []
var labels: Array[Label3D] = []


func _init() -> void:
	part = "mallet"
	tint = Color("9ccc65")


func _declare_sources() -> void:
	# Where along the bar you hit: middle 0, ends 1. Patched to where a real mallet hits.
	declare("spot", "Bars: hit spot", part, "model.position", 0.15, 0.85)
	_relabel()


func _build() -> void:
	box = AABB(Vector3(-width / 2, 0, -depth / 2), Vector3(width, 0.09, depth))
	add_box(Vector3(width + 0.02, 0.02, depth * 0.55), Color("2a3644"), Vector3(0, 0.01, 0))
	var w := width / count
	for i in count:
		var length := depth * lerpf(1.0, 0.62, float(i) / maxf(count - 1, 1))
		var c := tint.lerp(Color("ffd166"), float(i) / maxf(count - 1, 1))
		var b := add_box(Vector3(w * 0.82, 0.025, length), c, Vector3(box.position.x + w * (i + 0.5), 0.04, 0), 0.15)
		bars.append(b)
		labels.append(add_label("", Vector3(b.position.x, 0.056, length / 2 - 0.02), 0.0009))


func _on_scale_changed() -> void:
	_relabel()


func _relabel() -> void:
	if kit == null:
		return
	for i in labels.size():
		labels[i].text = ScaleLock.note_name(note_of(i), false)


func note_of(i: int) -> int:
	return kit.scale.step(kit.base_note, first_step + i)


func bar_at(local: Vector3) -> int:
	return clampi(int(frac(local, 0) * count), 0, count - 1)


func hand_down(hand: PlayHand) -> void:
	var local := local_of(hand)
	var i := bar_at(local)
	holds[hand.id] = i
	_strike(hand, i, local)


func hand_move(hand: PlayHand) -> void:
	if not holds.has(hand.id):
		return
	var local := local_of(hand)
	var i := bar_at(local)
	if i != holds[hand.id]:
		holds[hand.id] = i
		_strike(hand, i, local)


func hand_up(hand: PlayHand) -> void:
	holds.erase(hand.id)


func _strike(hand: PlayHand, i: int, local: Vector3) -> void:
	var s := hand.strike_strength(global_basis.y.normalized())
	var length := bars[i].mesh.size.z as float
	var spot := clampf(absf(local.z - bars[i].position.z) / (length * 0.5), 0.0, 1.0)
	send("spot", spot)
	kit.strike(part, note_of(i), s, note_length)
	flash(bars[i])
	var b := bars[i]
	b.position.y = 0.032
	create_tween().tween_property(b, "position:y", 0.04, 0.12)
	hand.pulse(s * 0.6)
	touched.emit(hand, s)
