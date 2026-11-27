extends Node
## Walking speed: the slider runs 1-100 m/s on a log scale and snaps to the
## marks; the speed sets how fast the listener walks on the grids (m/s), and
## the pop-up is one of the windows.
##   godot --headless --path . res://tests/speed_check.tscn

var failures := 0


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func _ready() -> void:
	check(absf(SpeedUi.from_t(0.0) - 1.0) < 1e-4 and absf(SpeedUi.from_t(1.0) - 100.0) < 1e-3, "the slider runs 1 to 100 m/s")
	check(absf(SpeedUi.from_t(0.5) - 10.0) < 1e-3, "10 m/s is the middle (log scale)")
	for m in SpeedUi.MARKS:
		check(is_equal_approx(SpeedUi.snapped_speed(SpeedUi.to_t(m) + 0.02), m), "snaps to %d m/s" % m)
	check(not is_equal_approx(SpeedUi.snapped_speed(SpeedUi.to_t(15.0)), 10.0) and absf(SpeedUi.snapped_speed(SpeedUi.to_t(15.0)) - 15.0) < 1.0, "between marks it's free (15 m/s)")
	var was := SpeedUi.saved()
	var g: Node = load("res://scenes/beacon_field.tscn").instantiate()
	add_child(g)
	await get_tree().create_timer(0.3).timeout
	g.speed.set_speed(5.0)
	check(is_equal_approx(g.input.space.walk_speed, 5.0) and is_equal_approx(SpeedUi.saved(), 5.0), "5 m/s: the grid walks at 5 m/s and it's remembered")
	var start: Vector2 = g.input.position
	g.input.set_target(start + Vector2(100, 0))
	for i in 10:
		g.input.tick(0.1)
	check(absf(g.input.position.x - start.x - 5.0) < 0.5, "one second walks 5 m (%.2f)" % (g.input.position.x - start.x))
	g.speed.set_open(true)
	await get_tree().create_timer(0.1).timeout
	g.menu.set_open(true)
	await get_tree().create_timer(0.1).timeout
	check(not PopupFx.is_open(g.speed._panel), "opening Fields closes the speed pop-up")
	g.speed.set_speed(was)
	print("speed_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
