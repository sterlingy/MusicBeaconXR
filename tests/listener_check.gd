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
	_check_xr()
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


func _check_xr() -> void:
	# No headset here: the rig's nodes are untracked, so the head sits at the origin.
	var li := ListenerInput.new()
	li.space = ListenerSpace.planar(Rect2(-250, -250, 500, 500), 55.0)
	add_child(li)
	li.set_process(false)
	var origin := XROrigin3D.new()
	add_child(origin)
	var cam := XRCamera3D.new()
	origin.add_child(cam)
	var right := XRController3D.new()
	origin.add_child(right)
	var src := XRLocomotionSource.new()
	src.require_interface = false
	src.origin = origin
	src.camera = cam
	src.right = right
	src.move_speed = 10.0
	li.add_child(src)
	origin.global_position = Vector3(20, 0, 30)
	li.tick(0.1)
	check(near(li.position, Vector2(20, 30)), "XR: the head's floor spot is the listener (got %s)" % li.position)
	li.set_target(Vector2(20, 0))
	for i in 40:
		li.tick(0.1) # 1 m per tick
	check(near(li.position, Vector2(20, 0)) and li.target == null, "XR: a walk target moves the play space (at %s)" % li.position)
	src.set_scale_index(1)
	check(origin.world_scale == 25.0 and near(src.to_pos.call(src._head_floor()), Vector2(20, 0)), "XR: tabletop scale keeps you on the same spot")
	src.set_scale_index(0)
	origin.global_position = Vector3(400, 0, 0)
	li.tick(0.1)
	check(near(li.position, Vector2(250, 0)) and absf(origin.global_position.x - 250.0) < 1e-3, "XR: the field's edge stops the play space")
	right.global_transform = Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-45)), Vector3(0, 1, 0))
	var hit: Variant = src.floor_hit()
	check(hit != null and absf(hit.y) < 1e-4 and absf(hit.z + 1.0) < 1e-3, "XR: the right hand's ray finds the floor (got %s)" % str(hit))
	li.wander = true
	var before := li.position
	for i in 30:
		li.tick(0.1)
	check(li.position != before and absf(li.position.x) <= 250.0, "XR: wander moves the play space")
	li.wander = false
	# Explore: a trigger tap selects, a hold asks where to go; Move glides, Jump teleports.
	var acts := []
	li.action.connect(func(n, a): acts.append(n))
	src._on_right("trigger_click")
	src._on_right_up("trigger_click")
	check(acts == ["select"] and li.target == null, "XR: a trigger tap selects without walking (%s)" % [acts])
	acts.clear()
	src._on_right("trigger_click")
	src.hold_tick(0.3)
	check(acts.is_empty(), "XR: not a hold yet")
	src.hold_tick(0.3)
	src._on_right_up("trigger_click")
	check(acts == ["point"], "XR: holding the trigger asks where to go (%s)" % [acts])
	origin.global_position = Vector3(0, 0, 0)
	li.tick(0.01)
	li.travel_to(Vector2(100, 0), 1.0)
	li.tick(0.5)
	check(li.position.x > 30.0 and li.position.x < 70.0, "XR: Move glides the play space (at %s)" % li.position)
	li.tick(0.6)
	check(near(li.position, Vector2(100, 0)) and not li.traveling(), "XR: Move arrives (at %s)" % li.position)
	src.teleport(Vector2(-50, 20))
	li.tick(0.01)
	check(near(li.position, Vector2(-50, 20)), "XR: Jump puts you there at once (at %s)" % li.position)
	var used := [false]
	src.intercept = func(_o, _d): used[0] = true; return true
	acts.clear()
	src._on_right("trigger_click")
	src._on_right_up("trigger_click")
	check(used[0] and acts.is_empty(), "XR: a floating card gets the trigger first")
	# The card: the ray finds its buttons.
	var card := XRTravelCard.new()
	add_child(card)
	card.open(Vector3(0, 0, 0), Vector3(0, 0.35, 2.0), "Test", "here")
	var face := card.global_transform * Vector3(0.11, -0.05, 0) # the Move button's centre
	check(card.hit(face + Vector3(0, 0, 1), Vector3(0, 0, -1)) == "move", "XR card: the ray hits Move")
	face = card.global_transform * Vector3(-0.11, -0.05, 0)
	check(card.hit(face + Vector3(0, 0, 1), Vector3(0, 0, -1)) == "jump", "XR card: the ray hits Jump")
	check(card.hit(Vector3(3, 0.35, 1), Vector3(0, 0, -1)) == "", "XR card: elsewhere misses")
	var picked := [""]
	card.chosen.connect(func(k): picked[0] = k)
	card.click(face + Vector3(0, 0, 1), Vector3(0, 0, -1))
	check(picked[0] == "jump" and not card.visible, "XR card: pulling the trigger on Jump chooses it")
	card.queue_free()
	li.queue_free()
	origin.queue_free()


class _FixedSource extends ListenerSource:
	var dir := Vector2.ZERO
	func move_intent(_li: ListenerInput, _delta: float) -> Vector2:
		return dir


class _HeadSource extends ListenerSource:
	func _init() -> void:
		drives_position = true
	func driven_position(_li: ListenerInput, _delta: float) -> Variant:
		return Vector2(3, 4)
