extends SceneTree
## Exploring the globe and grids: one finger turns the view without moving the
## listener, a tap selects, a long press or right-click asks where to go, and
## Move glides there along the space's own path (great circles on the globe).
##   godot --headless --path . -s res://tests/explore_check.gd

var failures := 0
var acts: Array = []


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func press(ptr: PointerSource, at: Vector2, down: bool, button := MOUSE_BUTTON_LEFT) -> void:
	var e := InputEventMouseButton.new()
	e.button_index = button
	e.position = at
	e.pressed = down
	ptr._unhandled_input(e)


func motion(ptr: PointerSource, at: Vector2, rel: Vector2) -> void:
	var e := InputEventMouseMotion.new()
	e.position = at
	e.relative = rel
	ptr._unhandled_input(e)


func names() -> Array:
	return acts.map(func(a): return a[0])


func _init() -> void:
	# Great circles: London to New York.
	var geo := ListenerSpace.geo()
	var lon := Vector2(-0.13, 51.51)
	var ny := Vector2(-74.0, 40.71)
	var km := geo.distance(lon, ny)
	check(absf(km - 5570.0) < 30.0, "London-New York is about 5,570 km (got %.0f)" % km)
	var mid := geo.interp(lon, ny, 0.5)
	check(mid.y > 51.5 and mid.x < -30.0 and mid.x > -45.0, "the great circle bows north over the Atlantic (midpoint %s)" % mid)
	check(geo.interp(lon, ny, 0.0).distance_to(lon) < 1e-3 and geo.interp(lon, ny, 1.0).distance_to(ny) < 1e-3, "ends where it should")
	var flat := ListenerSpace.planar(Rect2(-100, -100, 200, 200))
	check(flat.interp(Vector2(0, 0), Vector2(10, 20), 0.5) == Vector2(5, 10) and flat.distance(Vector2.ZERO, Vector2(3, 4)) == 5.0, "floors: straight lines")
	var short := ListenerInput.travel_seconds(geo, lon, Vector2(0.0, 51.6))
	var far := ListenerInput.travel_seconds(geo, lon, Vector2(150, -30))
	check(short >= 3.0 and short < 4.0 and far > 10.0 and far <= 12.0, "Move takes ~3 s nearby, ~12 s across the world (%.1f, %.1f)" % [short, far])

	# Move: a glide that eases in and out and arrives on time.
	var li := ListenerInput.new()
	li.space = geo
	li.position = lon
	var done := [false]
	li.travel_finished.connect(func(): done[0] = true)
	li.travel_to(ny, 2.0)
	check(li.traveling(), "travelling")
	li.tick(0.2)
	var early := geo.distance(lon, li.position)
	li.tick(0.8)
	check(early < km * 0.1 and absf(geo.distance(lon, li.position) - km * 0.5) < km * 0.05, "eases in, halfway at half time")
	li.tick(1.1)
	check(done[0] and li.position.distance_to(ny) < 1e-3 and not li.traveling(), "arrives and says so")
	li.travel_to(lon, 2.0)
	li.tick(0.5)
	li.jump_to(Vector2(10, 10))
	li.tick(0.5)
	check(li.position == Vector2(10, 10) and not li.traveling(), "a jump cancels a Move")

	# Explore mode: the listener stays put.
	var li2 := ListenerInput.new()
	li2.space = flat
	var ptr := PointerSource.new()
	ptr.mode = "explore"
	ptr.pick = func(_o, _d): return Vector2(7, 7)
	ptr.camera = Camera3D.new()
	li2.add_child(ptr)
	root.add_child(li2)
	li2.add_child(ptr.camera)
	li2.action.connect(func(n, a): acts.append([n, a]))
	press(ptr, Vector2(100, 100), true)
	motion(ptr, Vector2(130, 100), Vector2(30, 0))
	motion(ptr, Vector2(160, 110), Vector2(30, 10))
	press(ptr, Vector2(160, 110), false)
	check(names().count("orbit") == 2 and acts[0][1] == Vector2(30, 0), "a drag turns the view (%s)" % [names()])
	check("orbit_end" in names() and not ("select" in names()), "a drag ends without a tap")
	check(li2.target == null and li2.position == Vector2.ZERO, "dragging never moves the listener")
	acts.clear()
	press(ptr, Vector2(50, 50), true)
	press(ptr, Vector2(51, 50), false)
	check(names() == ["select"] and acts[0][1] == Vector2(7, 7), "a tap selects (%s)" % [names()])
	check(li2.target == null, "a tap doesn't walk")
	acts.clear()
	press(ptr, Vector2(60, 60), true)
	ptr._process(0.3)
	check(acts.is_empty(), "not a long press yet")
	ptr._process(0.3)
	check(names() == ["point"] and acts[0][1].pos == Vector2(7, 7) and acts[0][1].screen == Vector2(60, 60), "a long press asks where to go (%s)" % [acts])
	press(ptr, Vector2(60, 60), false)
	check(names() == ["point"], "letting go after a long press isn't a tap")
	acts.clear()
	press(ptr, Vector2(70, 70), true, MOUSE_BUTTON_RIGHT)
	check(names() == ["point"], "a right-click asks where to go")
	# Walk mode is unchanged: press to walk there.
	ptr.mode = "walk"
	press(ptr, Vector2(80, 80), true)
	check(li2.target == Vector2(7, 7), "walk mode still walks")
	press(ptr, Vector2(80, 80), false)

	print("explore_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
