extends Node
## The globe follows the device's location when "Follow my location" is on:
## the first fix jumps there and zooms in, later fixes move the listener.
##   godot --headless --path . res://tests/globe_follow_check.tscn

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func _ready() -> void:
	var was_following := FieldPrefs.follow()
	FieldPrefs.set_value("follow", true)
	var scene: Node = load("res://scenes/globe_field.tscn").instantiate()
	add_child(scene)
	await get_tree().process_frame
	await get_tree().process_frame
	var alt_before: float = scene.altitude
	scene.mine.geo.located.emit(48.8566, 2.3522, 12.0) # Paris
	await get_tree().process_frame
	check(scene.input.position.distance_to(Vector2(2.3522, 48.8566)) < 0.01, "first fix: at the device's location (%s)" % scene.input.position)
	check(scene.altitude < alt_before, "first fix zooms in (%.1f -> %.1f)" % [alt_before, scene.altitude])
	scene.mine.geo.located.emit(48.86, 2.36, 12.0)
	await get_tree().process_frame
	check(scene.input.position.distance_to(Vector2(2.36, 48.86)) < 0.01, "later fixes move the listener")
	FieldPrefs.set_value("follow", false)
	scene.mine.geo.located.emit(40.0, -74.0, 12.0)
	await get_tree().process_frame
	check(scene.input.position.distance_to(Vector2(2.36, 48.86)) < 0.01, "not following: fixes are ignored")
	FieldPrefs.set_value("follow", was_following)
	print("globe_follow_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
