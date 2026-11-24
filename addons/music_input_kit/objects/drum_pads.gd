class_name DrumPads
extends Playable
## Eight round pads to hit, two rows of four. Hit harder for louder. Hit the
## middle of a pad for its darker tone and the rim for a brighter one: the pad
## turns its own voice's tone knob (`<voice>.tone`) as you hit it.

## [note, label, voice-name prefix of its knobs]
const PADS := [
	[36, "Kick", "kick"], [38, "Snare", "snare"], [39, "Clap", "clap"], [42, "Hat", "chat"],
	[45, "Low tom", "ltom"], [50, "High tom", "htom"], [46, "Open hat", "ohat"], [49, "Cymbal", "cymbal"],
]
const COLS := 4

@export var pad_size := 0.13

var pads: Array[MeshInstance3D] = []
## Rim hits brighten the tone; turn off to keep the tone knobs where they are.
var rim_tone := true


func _init() -> void:
	part = "drums"
	tint = Color("ff8a3d")


func _build() -> void:
	var rows := ceili(PADS.size() / float(COLS))
	var w := COLS * pad_size
	var d := rows * pad_size
	box = AABB(Vector3(-w / 2, 0, -d / 2), Vector3(w, 0.07, d))
	add_box(Vector3(w + 0.02, 0.02, d + 0.02), Color("2a3644"), Vector3(0, 0.01, 0))
	for i in PADS.size():
		var cyl := CylinderMesh.new()
		cyl.top_radius = pad_size * 0.42
		cyl.bottom_radius = pad_size * 0.44
		cyl.height = 0.025
		var c := tint.lerp(Color("ff4f9a"), float(i) / PADS.size())
		var p := add_mesh(cyl, c, _center(i) + Vector3(0, 0.032, 0), 0.15)
		pads.append(p)
		add_label(PADS[i][1], _center(i) + Vector3(0, 0.046, pad_size * 0.2), 0.0007)


func _center(i: int) -> Vector3:
	var col := i % COLS
	var row := i / COLS
	return Vector3(box.position.x + pad_size * (col + 0.5), 0, box.position.z + pad_size * (row + 0.5))


func pad_at(local: Vector3) -> int:
	var col := clampi(int(frac(local, 0) * COLS), 0, COLS - 1)
	var row := clampi(int(frac(local, 2) * ceili(PADS.size() / float(COLS))), 0, 1)
	return mini(row * COLS + col, PADS.size() - 1)


func hand_down(hand: PlayHand) -> void:
	var local := local_of(hand)
	var i := pad_at(local)
	holds[hand.id] = i
	var c := _center(i)
	var edge := clampf(Vector2(local.x - c.x, local.z - c.z).length() / (pad_size * 0.42), 0.0, 1.0)
	if rim_tone:
		kit.set_knob(part, "%s.tone" % PADS[i][2], lerpf(0.3, 0.85, edge))
	var s := hand.strike_strength(global_basis.y.normalized(), 2.5)
	kit.strike(part, PADS[i][0], s, 0.1, false)
	flash(pads[i], 3.0, 0.15)
	var p := pads[i]
	p.scale = Vector3(1.0, 0.5, 1.0)
	create_tween().tween_property(p, "scale", Vector3.ONE, 0.1)
	hand.pulse(s)
	touched.emit(hand, s)


func hand_move(hand: PlayHand) -> void:
	# Pointers: a drag onto another pad hits it (rolls on touch screens).
	if hand.is_xr() or not holds.has(hand.id):
		return
	var i := pad_at(local_of(hand))
	if i != holds[hand.id]:
		hand_down(hand)


func hand_up(hand: PlayHand) -> void:
	holds.erase(hand.id)
