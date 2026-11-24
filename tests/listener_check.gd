extends Node
## Headless check of ListenerKit (addons/listener_kit): spaces, walking, targets,
## wander bounds and actions. No audio, no SynthKit.
## godot --headless --path . res://tests/listener_check.tscn

var failures := 0


func check(ok: bool, msg: String) -> void:
	if not ok:
		failures += 1
		printerr("FAIL: ", msg)


func near(a: Vector2, b: Vector2, eps := 1e-3) -> bool:
	return a.distance_to(b) < eps


func _ready() -> void:
	_check_planar()
	_check_geo()
	_check_input()
	print("listener_check: %s (%d failure(s))" % ["OK" if failures == 0 else "FAILED", failures])
	get_tree().quit(0 if failures == 0 else 1)


func _check_planar() -> void:
	var s := ListenerSpace.planar(Rect2(-250, -250, 500, 500), 55.0)
	check(near(s.step(Vector2.ZERO, Vector2(0, 1), 10), Vector2(0, -10)), "forward is -y (north, screen up) when y_down")
	check(near(s.step(Vector2.ZERO, Vector2(1, 0), 10), Vector2(10, 0)), "right is +x")
	check(near(s.step(Vector2(245, 0), Vector2(1, 0), 10), Vector2(250, 0)), "clamped to bounds")
	var t := s.toward(Vector2.ZERO, Vector2(30, -40))
	check(absf(t.dist - 50.0) < 1e-3 and near(t.dir, Vector2(0.6, 0.8)), "toward gives (right, forward) and distance")
	var up := ListenerSpace.planar(Rect2(-10, -10, 20, 20), 1.0, false)
	check(near(up.step(Vector2.ZERO, Vector2(0, 1), 1), Vector2(0, 1)), "forward is +y when not y_down")


func _check_geo() -> void:
	var g := ListenerSpace.geo(6.0)
	check(near(g.step(Vector2(0, 0), Vector2(0, 1), 5), Vector2(0, 5)), "geo forward is north")
	check(near(g.step(Vector2(178, 0), Vector2(1, 0), 5), Vector2(-177, 0)), "geo wraps the date line")
	var east60 := g.step(Vector2(0, 60), Vector2(1, 0), 5)
	check(absf(east60.x - 10.0) < 1e-3, "longitude steps stretch with latitude (got %s)" % east60)
	check(near(g.clamp_pos(Vector2(0, 95)), Vector2(0, 90)), "latitude clamps at the pole")
	var t := g.toward(Vector2(170, 0), Vector2(-170, 0))
	check(t.dir.x > 0.99 and absf(t.dist - 20.0) < 1e-3, "toward takes the short way across the date line")


func _check_input() -> void:
	var li := ListenerInput.new()
	li.space = ListenerSpace.planar(Rect2(-250, -250, 500, 500), 50.0)
	add_child(li)
	li.set_process(false)
	var seen := []
	li.moved.connect(func(p): seen.append(p))
	li.jump_to(Vector2(10, 10))
	check(seen.size() == 1 and near(seen[0], Vector2(10, 10)), "jump_to emits moved")
	li.set_target(Vector2(10, -40))
	for i in 10:
		li.tick(0.1) # 5 m per tick
	check(near(li.position, Vector2(10, -40)) and li.target == null, "walks to the target and stops (at %s)" % li.position)
	var src := _FixedSource.new()
	li.add_child(src)
	src.dir = Vector2(1, 0)
	li.set_target(Vector2(-200, 0))
	li.tick(0.1)
	check(near(li.position, Vector2(15, -40)) and li.target == null, "a source's intent beats the target and clears it")
	src.dir = Vector2(0.5, 0)
	li.tick(0.1)
	check(near(li.position, Vector2(17.5, -40)), "half-pushed stick walks at half speed")
	src.enabled = false
	var actions := []
	li.action.connect(func(n, a): actions.append([n, a]))
	li.send_action("toggle_wander")
	check(li.wander and actions.size() == 1, "toggle_wander flips wander and is forwarded")
	li.jump_to(Vector2.ZERO)
	var worst := 0.0
	for i in 4000:
		li.tick(1.0 / 30.0)
		worst = maxf(worst, maxf(absf(li.position.x), absf(li.position.y)))
	check(worst <= 250.0, "wander stays on the field (max %s)" % worst)
	check(li.position.length() > 0.0, "wander moves")
	var head := _HeadSource.new()
	li.add_child(head)
	li.move_child(head, 0)
	li.tick(0.1)
	check(near(li.position, Vector2(3, 4)), "a drives_position source sets the position outright")
	li.queue_free()


class _FixedSource extends ListenerSource:
	var dir := Vector2.ZERO
	func move_intent(_li: ListenerInput, _delta: float) -> Vector2:
		return dir


class _HeadSource extends ListenerSource:
	func _init() -> void:
		drives_position = true
	func driven_position(_li: ListenerInput, _delta: float) -> Variant:
		return Vector2(3, 4)
