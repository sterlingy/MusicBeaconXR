class_name KeyboardSource
extends ListenerSource
## Keyboard and gamepad: walk, plus the shared commands. Uses InputMap actions
## (created on first use if the project doesn't define them), so they can be
## rebound in Project Settings.
##
##   Walk     WASD / arrows / left stick / d-pad
##   Space  / A (bottom)      toggle_play
##   T      / Y (top)         toggle_wander
##   G      / Back            switch_scene
##   1..9                     jump (arg 0..8)
##   wheel  / LB, RB          zoom (arg 0.9 in, 1.1 out)

const ACTIONS := {
	"lk_left": [KEY_A, KEY_LEFT],
	"lk_right": [KEY_D, KEY_RIGHT],
	"lk_forward": [KEY_W, KEY_UP],
	"lk_back": [KEY_S, KEY_DOWN],
	"lk_toggle_play": [KEY_SPACE],
	"lk_toggle_wander": [KEY_T],
	"lk_switch_scene": [KEY_G],
}
const PAD_AXES := {"lk_left": [JOY_AXIS_LEFT_X, -1.0], "lk_right": [JOY_AXIS_LEFT_X, 1.0], "lk_forward": [JOY_AXIS_LEFT_Y, -1.0], "lk_back": [JOY_AXIS_LEFT_Y, 1.0]}
const PAD_BUTTONS := {"lk_left": JOY_BUTTON_DPAD_LEFT, "lk_right": JOY_BUTTON_DPAD_RIGHT, "lk_forward": JOY_BUTTON_DPAD_UP, "lk_back": JOY_BUTTON_DPAD_DOWN,
	"lk_toggle_play": JOY_BUTTON_A, "lk_toggle_wander": JOY_BUTTON_Y, "lk_switch_scene": JOY_BUTTON_BACK,
	"lk_zoom_in": JOY_BUTTON_LEFT_SHOULDER, "lk_zoom_out": JOY_BUTTON_RIGHT_SHOULDER}

## Jump keys 1-9 send "jump" actions.
var jump_keys := true
## Mouse wheel and shoulder buttons send "zoom".
var zoom_input := true


func _init() -> void:
	name = "KeyboardSource"


func _ready() -> void:
	ensure_actions()


## Adds the lk_* actions to the InputMap if the project hasn't defined them.
static func ensure_actions() -> void:
	for a in ACTIONS.keys() + ["lk_zoom_in", "lk_zoom_out"]:
		if InputMap.has_action(a):
			continue
		InputMap.add_action(a, 0.25)
		for k in ACTIONS.get(a, []):
			var e := InputEventKey.new()
			e.physical_keycode = k
			InputMap.action_add_event(a, e)
		if PAD_AXES.has(a):
			var m := InputEventJoypadMotion.new()
			m.axis = PAD_AXES[a][0]
			m.axis_value = PAD_AXES[a][1]
			InputMap.action_add_event(a, m)
		if PAD_BUTTONS.has(a):
			var b := InputEventJoypadButton.new()
			b.button_index = PAD_BUTTONS[a]
			InputMap.action_add_event(a, b)


func move_intent(_li: ListenerInput, _delta: float) -> Vector2:
	var v := Vector2(Input.get_axis("lk_left", "lk_right"), Input.get_axis("lk_back", "lk_forward"))
	return v.limit_length(1.0)


func _unhandled_input(event: InputEvent) -> void:
	var li := listener()
	if li == null or not enabled:
		return
	if event.is_echo():
		return
	if event.is_action_pressed("lk_toggle_play"):
		li.send_action("toggle_play")
	elif event.is_action_pressed("lk_toggle_wander"):
		li.send_action("toggle_wander")
	elif event.is_action_pressed("lk_switch_scene"):
		li.send_action("switch_scene")
	elif zoom_input and event.is_action_pressed("lk_zoom_in"):
		li.send_action("zoom", 0.9)
	elif zoom_input and event.is_action_pressed("lk_zoom_out"):
		li.send_action("zoom", 1.1)
	elif jump_keys and event is InputEventKey and event.pressed and event.physical_keycode >= KEY_1 and event.physical_keycode <= KEY_9:
		li.send_action("jump", event.physical_keycode - KEY_1)
	elif zoom_input and event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			li.send_action("zoom", 0.9)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			li.send_action("zoom", 1.1)
