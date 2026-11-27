extends SceneTree
## Two-finger pinch on touch screens (PointerSource tracks raw touches, since
## Android sends no magnify gesture): spreading zooms in, pinching zooms out,
## and the second finger stops the walk the first one started.
##   godot --headless --path . -s res://tests/pinch_check.gd

var failures := 0
var zooms: Array = []


func check(ok: bool, what: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: " + what)


func touch(ptr: PointerSource, i: int, at: Vector2, down: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = i
	e.position = at
	e.pressed = down
	ptr._unhandled_input(e)


func drag(ptr: PointerSource, i: int, at: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = i
	e.position = at
	ptr._unhandled_input(e)


func _init() -> void:
	var li := ListenerInput.new()
	var ptr := PointerSource.new()
	li.add_child(ptr)
	root.add_child(li)
	li.action.connect(func(n, a): if n == "zoom": zooms.append(a))
	li.set_target(Vector2(5, 5)) # as if the first finger had started a walk
	touch(ptr, 0, Vector2(100, 100), true)
	touch(ptr, 1, Vector2(200, 100), true)
	check(li.target == null, "second finger stops the walk")
	drag(ptr, 1, Vector2(300, 100)) # spread: 100 -> 200 px
	check(zooms.size() == 1 and absf(zooms[0] - 0.5) < 1e-4, "spreading zooms in (factor %s)" % [zooms])
	drag(ptr, 1, Vector2(150, 100)) # pinch: 200 -> 50 px
	check(zooms.size() == 2 and absf(zooms[1] - 4.0) < 1e-4, "pinching zooms out (factor %s)" % [zooms])
	# The first finger's emulated mouse is ignored while pinching.
	var m := InputEventMouseButton.new()
	m.button_index = MOUSE_BUTTON_LEFT
	m.pressed = true
	ptr._unhandled_input(m)
	check(li.target == null, "no walking during a pinch")
	touch(ptr, 1, Vector2(150, 100), false)
	touch(ptr, 0, Vector2(100, 100), false)
	check(not ptr._pinching, "pinch ends when the fingers lift")
	print("pinch_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	quit(0 if failures == 0 else 1)
