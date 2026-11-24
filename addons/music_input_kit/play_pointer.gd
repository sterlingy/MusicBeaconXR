class_name PlayPointer
extends Node
## Mouse and touch driver: every finger (and the mouse) becomes a PlayHand.
## Pressing casts a ray from the camera into the playables; dragging moves the
## hand along the plane the object asked for (Playable.drag_plane), so you
## can slide a fader or sweep a ribbon past its edge. Several fingers play
## several objects at once on touch screens. Part of MusicInputKit.

var camera: Camera3D
var enabled := true
## Playables to consider; empty = everything in the "playables" group.
var only: Array[Playable] = []

var _hands := {} # key -> {hand, obj, plane_p, plane_n, last, t}


func _unhandled_input(event: InputEvent) -> void:
	if not enabled or camera == null:
		return
	# Godot can copy touches into mouse events and back; read each thing once.
	if event.device == InputEvent.DEVICE_ID_EMULATION:
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			if down("t%d" % event.index, event.position, "touch", event.index + 1):
				get_viewport().set_input_as_handled()
		else:
			up("t%d" % event.index)
	elif event is InputEventScreenDrag:
		move("t%d" % event.index, event.position)
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				if down("m", event.position, "mouse", 0):
					get_viewport().set_input_as_handled()
			else:
				up("m")
		elif event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			var hit := pick(event.position)
			if not hit.is_empty():
				var h := PlayHand.new("mouse", 0)
				h.position = hit.point
				hit.obj.wheel(h, 1.0 if event.button_index == MOUSE_BUTTON_WHEEL_UP else -1.0)
				get_viewport().set_input_as_handled()
	elif event is InputEventMouseMotion:
		move("m", event.position)


## The nearest playable under a screen point: {obj, point, dist}, or {}.
func pick(screen: Vector2) -> Dictionary:
	return pick_ray(camera.project_ray_origin(screen), camera.project_ray_normal(screen))


func pick_ray(origin: Vector3, dir: Vector3) -> Dictionary:
	var best := {}
	var list: Array = only if not only.is_empty() else get_tree().get_nodes_in_group("playables")
	for o in list:
		var p := o as Playable
		if p == null or not p.is_visible_in_tree():
			continue
		var d := p.hit_ray(origin, dir)
		if d >= 0.0 and (best.is_empty() or d < best.dist):
			best = {"obj": p, "point": origin + dir * d, "dist": d}
	return best


## Presses at a screen point. Returns true if it landed on a playable.
func down(key: String, screen: Vector2, kind := "mouse", id := 0) -> bool:
	if _hands.has(key):
		up(key)
	var hit := pick(screen)
	if hit.is_empty():
		return false
	var h := PlayHand.new(kind, id)
	h.ray_origin = camera.project_ray_origin(screen)
	h.ray_dir = camera.project_ray_normal(screen)
	h.position = hit.point
	h.pressed = true
	h.squeeze = 1.0
	var plane: Array = hit.obj.drag_plane(hit.point)
	_hands[key] = {"hand": h, "obj": hit.obj, "plane_p": plane[0], "plane_n": plane[1], "last": hit.point, "t": Time.get_ticks_usec()}
	hit.obj.hand_down(h)
	return true


func move(key: String, screen: Vector2) -> void:
	if not _hands.has(key):
		return
	var st: Dictionary = _hands[key]
	var o := camera.project_ray_origin(screen)
	var d := camera.project_ray_normal(screen)
	var hit: Variant = Plane(st.plane_n, st.plane_p).intersects_ray(o, d)
	if hit == null:
		return
	var h: PlayHand = st.hand
	var now := Time.get_ticks_usec()
	var dt := maxf((now - st.t) / 1e6, 1e-3)
	h.velocity = h.velocity.lerp(((hit as Vector3) - st.last) / dt, 0.5)
	h.position = hit
	h.ray_origin = o
	h.ray_dir = d
	st.last = hit
	st.t = now
	if is_instance_valid(st.obj):
		st.obj.hand_move(h)


func up(key: String) -> void:
	if not _hands.has(key):
		return
	var st: Dictionary = _hands[key]
	_hands.erase(key)
	var h: PlayHand = st.hand
	h.pressed = false
	h.squeeze = 0.0
	if is_instance_valid(st.obj):
		st.obj.hand_up(h)


func release_all() -> void:
	for k in _hands.keys():
		up(k)
