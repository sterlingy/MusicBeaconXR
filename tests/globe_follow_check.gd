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
	# Following a flight: the plane moves you, but the globe still turns and zooms.
	scene.mine.flight.fix = {"found": true, "lat": 40.0, "lon": -100.0, "gs_kt": 450.0, "track": 90.0, "at": FlightFollow.now_s(), "seen_pos": 0.0, "alt_ft": 35000.0, "flight": "TST1"}
	await get_tree().process_frame
	await get_tree().process_frame
	check(scene.plane.visible and not scene.listener.visible, "following a flight shows the plane")
	var alt0: float = scene.altitude
	scene.input.send_action("orbit", Vector2(-120, 40))
	scene.input.send_action("zoom", 0.5)
	await get_tree().process_frame
	check(scene._free and scene.altitude < alt0, "while following, the globe still turns and zooms")
	var ptr: PointerSource = scene.input.get_node("PointerSource")
	check(ptr.enabled and ptr.can_process(), "the pointer keeps working while the plane drives")
	scene.mine.flight.stop()
	print("globe_follow_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
