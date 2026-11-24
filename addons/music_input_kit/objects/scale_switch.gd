class_name ScaleSwitch
extends Playable
## Three buttons for the scale lock, so it can be changed without leaving the
## headset: LOCK turns keeping notes in key on and off, KEY moves the key up a
## semitone, SCALE steps through the scales.

const BUTTONS := ["lock", "key", "scale"]

@export var button := 0.07

var caps: Array[MeshInstance3D] = []
var labels: Array[Label3D] = []


func _init() -> void:
	tint = Color("ffb547")


func _declare_sources() -> void:
	_relabel()


func _build() -> void:
	var w := BUTTONS.size() * button + (BUTTONS.size() - 1) * 0.012
	box = AABB(Vector3(-w / 2, 0, -button / 2), Vector3(w, 0.05, button))
	for i in BUTTONS.size():
		var x := -w / 2 + button / 2 + i * (button + 0.012)
		add_box(Vector3(button, 0.01, button), Color("2a3644"), Vector3(x, 0.005, 0))
		caps.append(add_box(Vector3(button * 0.85, 0.018, button * 0.85), tint, Vector3(x, 0.018, 0), 0.2))
		labels.append(add_label("", Vector3(x, 0.03, 0), 0.0008))
		labels[i].rotation_degrees = Vector3(-90, 0, 0)


func _on_scale_changed() -> void:
	_relabel()


func _relabel() -> void:
	if kit == null:
		return
	var sc := kit.scale
	labels[0].text = "LOCK\n%s" % ("ON" if sc.enabled else "OFF")
	labels[1].text = "KEY\n%s" % ScaleLock.NAMES[sc.root]
	labels[2].text = "SCALE\n%s" % sc.scale.replace(" ", "\n")
	var m := caps[0].material_override as StandardMaterial3D
	m.albedo_color = tint if sc.enabled else Color("5b6878")


func hand_down(hand: PlayHand) -> void:
	var i := clampi(int(frac(local_of(hand), 0) * BUTTONS.size()), 0, BUTTONS.size() - 1)
	holds[hand.id] = i
	press(BUTTONS[i])
	flash(caps[i], 2.0, 0.2)
	caps[i].position.y = 0.012
	hand.pulse(0.4)
	touched.emit(hand, 0.4)


func hand_up(hand: PlayHand) -> void:
	if holds.has(hand.id):
		caps[holds[hand.id]].position.y = 0.018
		holds.erase(hand.id)


func press(what: String) -> void:
	var sc := kit.scale
	match what:
		"lock":
			kit.send_action("lock")
		"key":
			sc.root = sc.root + 1
		"scale":
			var names := ScaleLock.SCALES.keys()
			names.erase("chromatic")
			sc.scale = names[(names.find(sc.scale) + 1) % names.size()]
	kit.send_action("scale_changed", kit.scale.describe())
