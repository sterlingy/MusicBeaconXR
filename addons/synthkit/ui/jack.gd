class_name Jack
extends Control
## A patch socket. Outputs have a filled ring so they read differently from inputs.

signal pressed

var output := false
var accent := Color.WHITE


func _ready() -> void:
	custom_minimum_size = Vector2(20, 20)
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		pressed.emit()
		accept_event()


func _draw() -> void:
	var c := size * 0.5
	draw_circle(c, 9.0, Color(accent, 0.9) if output else Color(0.55, 0.57, 0.62))
	draw_circle(c, 6.5, Color(0.05, 0.05, 0.07))
	draw_circle(c, 3.0, Color(0.25, 0.26, 0.3))
