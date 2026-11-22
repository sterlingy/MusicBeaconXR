class_name Knob
extends Control
## Rotary knob for synth parameters. Drag up/down (Shift = fine), mouse wheel,
## double-click to reset. Right-click opens the MIDI-learn menu (via signal).

signal value_changed(value: float)
signal context_requested(at: Vector2)

@export var min_value := 0.0
@export var max_value := 1.0
@export var default_value := 0.0
@export var log_scale := false
@export var integer := false
@export var label := ""
@export var unit := ""
@export var accent := Color("2ec4b6")

var value := 0.0:
	set(v):
		v = clampf(v, min_value, max_value)
		if integer:
			v = roundf(v)
		if v == value:
			return
		value = v
		queue_redraw()
var mapped := false: # MIDI-learned
	set(v):
		mapped = v
		queue_redraw()
var learning := false:
	set(v):
		learning = v
		queue_redraw()

var _dragging := false
var _drag_t := 0.0


func _ready() -> void:
	custom_minimum_size = Vector2(78, 82)
	mouse_default_cursor_shape = Control.CURSOR_VSIZE
	tooltip_text = label


func set_value_silently(v: float) -> void:
	value = v


func _to_t(v: float) -> float:
	if log_scale and min_value > 0.0:
		return log(v / min_value) / log(max_value / min_value)
	return (v - min_value) / maxf(1e-9, max_value - min_value)


func _from_t(t: float) -> float:
	t = clampf(t, 0.0, 1.0)
	if log_scale and min_value > 0.0:
		return min_value * pow(max_value / min_value, t)
	return min_value + (max_value - min_value) * t


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.double_click:
				_set_and_emit(default_value)
			_dragging = mb.pressed
			_drag_t = _to_t(value)
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed:
			context_requested.emit(get_global_mouse_position())
			accept_event()
		elif mb.pressed and (mb.button_index == MOUSE_BUTTON_WHEEL_UP or mb.button_index == MOUSE_BUTTON_WHEEL_DOWN):
			var step := 1.0 if integer else 0.0
			var dir := 1.0 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1.0
			if integer:
				_set_and_emit(value + dir * step)
			else:
				_set_and_emit(_from_t(_to_t(value) + dir * (0.005 if mb.shift_pressed else 0.02)))
			accept_event()
	elif event is InputEventMouseMotion and _dragging:
		var mm := event as InputEventMouseMotion
		var speed := 0.0015 if mm.shift_pressed else 0.006
		_drag_t = clampf(_drag_t - mm.relative.y * speed, 0.0, 1.0)
		_set_and_emit(_from_t(_drag_t))
		accept_event()


func _set_and_emit(v: float) -> void:
	var old := value
	value = v
	if value != old:
		value_changed.emit(value)


func format_value() -> String:
	var v := value
	if integer:
		return "%d%s" % [int(v), (" " + unit) if unit != "" else ""]
	var s: String
	if unit == "Hz" and v >= 1000.0:
		s = "%.2f kHz" % (v / 1000.0)
		return s
	if unit == "s" and v < 1.0:
		return "%d ms" % int(round(v * 1000.0))
	if absf(v) >= 100.0:
		s = "%d" % int(round(v))
	elif absf(v) >= 10.0:
		s = "%.1f" % v
	else:
		s = "%.2f" % v
	return s + ((" " + unit) if unit != "" else "")


func _draw() -> void:
	var font := get_theme_default_font()
	var fs := 11 if label.length() <= 12 else 10
	var r := minf(size.x, size.y - 30.0) * 0.5 - 4.0
	var c := Vector2(size.x * 0.5, r + 6.0)
	var a0 := deg_to_rad(135.0)
	var a1 := deg_to_rad(405.0)
	var t := _to_t(value)
	var bipolar := min_value < 0.0 and max_value > 0.0
	# Track
	draw_arc(c, r, a0, a1, 40, Color(1, 1, 1, 0.12), 4.0, true)
	# Value arc
	var start_t := _to_t(0.0) if bipolar else 0.0
	var from_a := lerpf(a0, a1, minf(start_t, t))
	var to_a := lerpf(a0, a1, maxf(start_t, t))
	if to_a - from_a > 0.001:
		draw_arc(c, r, from_a, to_a, 40, accent, 4.0, true)
	# Cap
	draw_circle(c, r - 7.0, Color(0.16, 0.17, 0.2))
	draw_arc(c, r - 7.0, 0.0, TAU, 32, Color(1, 1, 1, 0.08), 1.5, true)
	var ang := lerpf(a0, a1, t)
	draw_line(c + Vector2.from_angle(ang) * (r * 0.2), c + Vector2.from_angle(ang) * (r - 9.0), Color.WHITE, 2.5, true)
	if mapped or learning:
		var dot := Color("ffd166") if learning else Color(accent, 0.9)
		draw_circle(c + Vector2(r, -r) * 0.8, 3.5, dot)
	# Text
	var name_y := c.y + r + 14.0
	draw_string(font, Vector2(0, name_y), label, HORIZONTAL_ALIGNMENT_CENTER, size.x, fs, Color(1, 1, 1, 0.85))
	draw_string(font, Vector2(0, name_y + 13.0), format_value(), HORIZONTAL_ALIGNMENT_CENTER, size.x, fs - 1, Color(accent, 0.95))
