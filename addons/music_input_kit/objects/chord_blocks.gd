class_name ChordBlocks
extends Playable
## A row of blocks, one chord each, built on the steps of the scale (I, ii, iii...).
## Touch a block to hold its chord; keep holding and lift your hand above it to
## open the sound up (the "lift" source). With the lock off, the blocks are major
## chords a semitone apart.

@export var count := 7
@export var block := 0.08
@export var gap := 0.015
## Reach above the blocks that still counts as holding (lift range).
@export var reach := 0.3
## Add the 7th to every chord.
@export var sevenths := false

var blocks: Array[MeshInstance3D] = []
var labels: Array[Label3D] = []
var _held := {} # hand id -> {i, voices}


func _init() -> void:
	part = "keys"
	tint = Color("ffd166")


func _declare_sources() -> void:
	declare("lift", "Blocks: lift", part, "filter.cutoff", 0.3, 0.95)
	_relabel()


func _build() -> void:
	var w := count * block + (count - 1) * gap
	box = AABB(Vector3(-w / 2, 0, -block / 2), Vector3(w, block + reach, block))
	for i in count:
		var c := tint.lerp(Color("ff8a3d"), float(i) / count)
		var b := add_box(Vector3.ONE * block, c, Vector3(-w / 2 + block / 2 + i * (block + gap), block / 2, 0), 0.15)
		blocks.append(b)
		labels.append(add_label("", b.position + Vector3(0, block / 2 + 0.003, 0), 0.0009))
		labels[i].rotation_degrees = Vector3(-90, 0, 0)


func _on_scale_changed() -> void:
	_relabel()


func _relabel() -> void:
	if kit == null:
		return
	for i in labels.size():
		labels[i].text = kit.scale.chord_name(kit.base_note - 12, i)


func chord_of(i: int) -> Array:
	return kit.scale.chord(kit.base_note - 12, i, sevenths)


## Pointers hit the blocks themselves; the reach above them is for XR hands.
func pick_box() -> AABB:
	return AABB(box.position, Vector3(box.size.x, block + 0.01, box.size.z))


func block_at(local: Vector3) -> int:
	return clampi(int(frac(local, 0) * count), 0, count - 1)


## Pointers lift by dragging up a wall through the block.
func drag_plane(hit: Vector3) -> Array:
	return [hit, global_basis.z.normalized()]


func hand_down(hand: PlayHand) -> void:
	var local := local_of(hand)
	if hand.is_xr() and local.y > block + 0.015:
		return # a hand coming down from above only plays once it reaches a block
	var i := block_at(local)
	var s := hand.strike_strength(global_basis.y.normalized())
	var voices := []
	for n in chord_of(i):
		voices.append(kit.start_note(part, n, 0.45 + 0.45 * s))
	_held[hand.id] = {"i": i, "voices": voices, "y0": local.y}
	flash(blocks[i], 2.0, 0.4)
	hand.pulse(s * 0.5)
	touched.emit(hand, s)


func hand_move(hand: PlayHand) -> void:
	if not _held.has(hand.id):
		if hand.is_xr():
			hand_down(hand)
		return
	var h: Dictionary = _held[hand.id]
	var local := local_of(hand)
	# XR: height of the hand above the block. Pointer: how far you dragged up.
	var lift: float = (local.y - block) / reach if hand.is_xr() else (local.y - h.y0) / (reach * 0.6)
	lift = clampf(lift, 0.0, 1.0)
	send("lift", lift)
	blocks[h.i].position.y = block / 2 + lift * 0.03
	var i := block_at(local)
	if not hand.is_xr() and i != h.i and local.y - h.y0 < 0.02:
		# Slid sideways along the row: change chord.
		hand_up(hand)
		hand_down(hand)


func hand_up(hand: PlayHand) -> void:
	if not _held.has(hand.id):
		return
	var h: Dictionary = _held[hand.id]
	_held.erase(hand.id)
	for v in h.voices:
		kit.end_note(v)
	create_tween().tween_property(blocks[h.i], "position:y", block / 2, 0.2)
