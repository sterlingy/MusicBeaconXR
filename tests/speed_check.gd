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
	check(absf(SpeedUi.from_t(0.0) - 1.0) < 1e-4 and absf(SpeedUi.from_t(1.0) - 250.0) < 1e-3, "the slider runs 1 to 250 m/s (a jet cruising)")
	check(absf(SpeedUi.from_t(0.5) - sqrt(250.0)) < 1e-3, "log scale: the middle is about 16 m/s")
	for c in [[1.4, "Walk"], [3.0, "Jog"], [6.0, "Run"], [10.0, "Bike"], [25.0, "Drive"], [45.0, "Train"], [83.0, "Bullet train"], [140.0, "Prop plane"], [250.0, "Jet"]]:
		check(SpeedUi.band_of(c[0]) == c[1], "%s m/s is %s (got %s)" % [c[0], c[1], SpeedUi.band_of(c[0])])
	check(SpeedUi.describe(25.0) == "25 m/s · Drive · 90 km/h", "described: " + SpeedUi.describe(25.0))
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
	# Move on a grid goes at the walking speed: 50 m at 5 m/s takes 10 s.
	check(is_equal_approx(ListenerInput.travel_seconds(g.input.space, Vector2.ZERO, Vector2(50, 0), 500.0, 5.0), 10.0), "a Move on a grid goes at the walking speed")
	check(TravelUi.duration(40.0) == "40 s" and TravelUi.duration(720.0) == "12 min" and TravelUi.duration(7500.0) == "2 h 5 min", "travel times read well")
	g.speed.set_open(true)
	await get_tree().create_timer(0.1).timeout
	g.menu.set_open(true)
	await get_tree().create_timer(0.1).timeout
	check(not PopupFx.is_open(g.speed._panel), "opening Options closes the speed pop-up")
	g.queue_free()
	await get_tree().process_frame
	# The globe: real metres per second too.
	var gl: Node = load("res://scenes/globe_field.tscn").instantiate()
	add_child(gl)
	await get_tree().create_timer(0.3).timeout
	gl.speed.set_speed(10.0)
	await get_tree().process_frame
	var p0: Vector2 = gl.input.position
	gl.input.set_target(p0 + Vector2(0, 1.0)) # a degree north
	for i in 100:
		gl.input.tick(0.1)
	var moved_m: float = (gl.input._y - p0.y) * 111194.9 # metres north, from the exact position
	check(absf(moved_m - 100.0) < 5.0, "10 s at 10 m/s on the globe moves about 100 m (%.1f m)" % moved_m)
	check(is_equal_approx(gl.input.wander_pace, 1.0), "auto-walk goes at the chosen speed")
	# 1 m/s in real 60 fps frames: each step is far below what a 32-bit degree holds.
	gl.speed.set_speed(1.0)
	var y0: float = gl.input._y
	gl.input.set_target(gl.input.position + Vector2(0, 1.0))
	for i in 600:
		gl.input.tick(1.0 / 60.0)
	var slow_m: float = (gl.input._y - y0) * 111194.9
	check(absf(slow_m - 10.0) < 0.5, "10 s at 1 m/s moves 10 m, frame by frame (%.2f m)" % slow_m)
	gl.speed.set_speed(was)
	print("speed_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)
