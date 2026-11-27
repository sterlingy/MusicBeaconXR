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
	# Auto-walk: the Wander pop-up switch, kept in step with T, ended by Jump / Move.
	scene.menu.set_open(true, false)
	await get_tree().process_frame
	scene.speed._wander.button_pressed = true
	check(scene.input.wander, "the Auto-walk switch starts wandering")
	scene.input.send_action("toggle_wander") # T
	await get_tree().process_frame
	await get_tree().process_frame
	check(not scene.input.wander and not scene.speed._wander.button_pressed, "T turns it off and the switch follows")
	scene.input.wander = true
	scene._go("jump", Vector2(10, 45))
	check(not scene.input.wander, "a Jump ends auto-walk")
	scene.menu.set_open(false, false)
	# Following a flight: the plane moves you, but the globe still turns and zooms.
	scene.mine.flight._last_poll = FlightFollow.now_s() # no real update during the test
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
	# White while seen, red when the data goes stale.
	for i in 30:
		await get_tree().process_frame
	var c0: Color = scene._plane_mat.albedo_color
	check(c0.r > 0.9 and c0.g > 0.6 and c0.g < 0.8 and c0.b < 0.4, "a fresh plane is amber (%s)" % c0)
	scene.mine.flight.fix.at = FlightFollow.now_s() - 120.0
	scene.mine.flight._last_poll = FlightFollow.now_s() # no update attempt during the test
	for i in 60:
		await get_tree().process_frame
	check(scene._plane_mat.albedo_color.r > 0.8 and scene._plane_mat.albedo_color.g < 0.5, "an untracked plane turns red (%s)" % scene._plane_mat.albedo_color)
	# Only one thing drives at a time: wander, a flight, or your location.
	for i in 3:
		await get_tree().process_frame
	var at_plane: Vector2 = scene.player.pos
	scene.input.wander = true
	await get_tree().process_frame
	check(not scene.mine.flight.active(), "wandering stops following the flight")
	for i in 20:
		await get_tree().process_frame
	check(scene.input.wander and scene.input.enabled, "and wanders")
	check(scene.player.pos.distance_to(at_plane) < 0.05 and scene.input.position.distance_to(at_plane) < 0.05,
		"from where the plane was (%s, now %s)" % [at_plane, scene.input.position])
	scene.mine.flight._last_poll = FlightFollow.now_s()
	scene.mine.flight.fix = {"found": true, "lat": 40.0, "lon": -100.0, "gs_kt": 450.0, "track": 90.0, "at": FlightFollow.now_s(), "seen_pos": 0.0, "alt_ft": 35000.0, "flight": "TST1"}
	scene.input.wander = true
	scene.mine._plane_drives()
	check(not scene.input.wander, "a flight stops wandering")
	FieldPrefs.set_value("follow", false)
	scene.menu.set_follow(false)
	scene.menu._follow.button_pressed = true # Follow my location
	await get_tree().process_frame
	check(not scene.mine.flight.active() and not scene.input.wander, "following your location stops the flight and wandering")
	scene.input.wander = true
	await get_tree().process_frame
	check(not FieldPrefs.follow() and not scene.menu._follow.button_pressed, "wandering stops following your location")
	scene.input.wander = false
	scene.menu._follow.button_pressed = true
	check(FieldPrefs.follow(), "following your location again")
	scene.mine._plane_drives()
	check(not FieldPrefs.follow() and not scene.menu._follow.button_pressed, "a flight stops following your location")
	FieldPrefs.set_value("follow", was_following)
	scene.mine.flight.stop()
	print("globe_follow_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
