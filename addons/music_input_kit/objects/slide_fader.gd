class_name SlideFader
extends Playable
## A fader on the table: push the cap away from you to turn up. With
## `spring_back` it's a lever that returns to `rest` when let go: a whammy bar
## patched to "@bend" bends the part's notes and springs back to pitch.

@export var length := 0.22
@export var label := "Fader"
@export var start_value := 0.5
@export var spring_back := false
## Where a spring lever rests (0.5 = middle).
@export var rest := 0.5
@export var default_part := "keys"
@export var default_param := "reverb.mix"

var value := 0.5
var cap: MeshInstance3D
var title: Label3D
var _held := 0


func _init() -> void:
	tint = Color("ffb547")


func _declare_sources() -> void:
	declare("slide", "%s: slide" % label, default_part, default_param)
	_update_title()
	kit.patches.changed.connect(_update_title)
	send("slide", value)


func _build() -> void:
	value = rest if spring_back else start_value
	box = AABB(Vector3(-0.04, 0, -length / 2 - 0.02), Vector3(0.08, 0.08, length + 0.04))
	add_box(Vector3(0.05, 0.012, length + 0.03), Color("2a3644"), Vector3(0, 0.006, 0))
	add_box(Vector3(0.006, 0.014, length), Color("0b1016"), Vector3(0, 0.008, 0))
	if spring_back:
		add_box(Vector3(0.05, 0.016, 0.004), Color(1, 1, 1, 0.6), Vector3(0, 0.008, _z_of(rest)))
	cap = add_box(Vector3(0.05, 0.03, 0.025), tint, Vector3(0, 0.028, 0), 0.25)
	title = add_label(label, Vector3(0.0, 0.014, length / 2 + 0.04), 0.00065)
	_show()


func _update_title() -> void:
	var t := kit.patches.targets_of(source_name("slide"))
	title.text = label + ("\n→ " + t[0].param if not t.is_empty() else "\n(unpatched)")


func _z_of(v: float) -> float:
	return length / 2 - v * length


func set_value(v: float) -> void:
	value = clampf(v, 0.0, 1.0)
	send("slide", value)
	_show()


func _show() -> void:
	cap.position.z = _z_of(value)


func hand_down(hand: PlayHand) -> void:
	_held += 1
	hand_move(hand)
	hand.pulse(0.2)
	touched.emit(hand, 0.3)


func hand_move(hand: PlayHand) -> void:
	set_value((length / 2 - local_of(hand).z) / length)


func hand_up(_hand: PlayHand) -> void:
	_held = maxi(0, _held - 1)


func wheel(_hand: PlayHand, steps: float) -> void:
	set_value(value + steps * 0.04)


func _process(delta: float) -> void:
	if spring_back and _held == 0 and absf(value - rest) > 0.001:
		set_value(lerpf(value, rest, 1.0 - exp(-delta * 14.0)))
		if absf(value - rest) < 0.004:
			set_value(rest)
