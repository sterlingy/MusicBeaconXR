class_name PlayXRHands
extends Node
## XR driver: each controller (or tracked hand) is a PlayHand whose tip touches
## the objects. Reach in and hit or touch an object to play it, the way you
## would a real one; how fast your hand moves sets how hard you hit. Grip while
## touching to hold on (turn a dial with your wrist, tilt the cube). Out of
## reach, point and pull the trigger to play from a distance, like a pointer.
## Part of MusicInputKit.

## Controllers to drive (XRController3D nodes).
var controllers: Array[XRController3D] = []
## Where the touching tip sits, in the controller's space (a little ahead of the grip).
var tip_offset := Vector3(0, -0.01, -0.07)
## Extra room around an object before a touch lets go (stops chatter at the edges).
var release_margin := 0.025
var ray_reach := 4.0
var enabled := true

var _state := {} # controller instance id -> state


func add_controller(c: XRController3D) -> void:
	controllers.append(c)


## The hand for a controller (made on first use), e.g. to show its tip.
func hand_of(c: XRController3D) -> PlayHand:
	return _st(c).hand


func tip_of(c: XRController3D) -> Vector3:
	return c.global_transform * tip_offset


func _st(c: XRController3D) -> Dictionary:
	var k := c.get_instance_id()
	if not _state.has(k):
		var h := PlayHand.new("xr", 100 + controllers.find(c))
		h.buzz = func(s: float) -> void: c.trigger_haptic_pulse("haptic", 0.0, s, 0.05, 0.0)
		_state[k] = {"hand": h, "mode": "", "obj": null, "plane": Plane(), "last": tip_of(c), "was": false}
	return _state[k]


## Trigger and grip, from the action map, or from metadata "fake_trigger" /
## "fake_grip" (tests and the --fake-xr preview).
func _inputs(c: XRController3D) -> Vector2:
	var trig: float = c.get_meta("fake_trigger") if c.has_meta("fake_trigger") else c.get_float("trigger")
	var grip: float = c.get_meta("fake_grip") if c.has_meta("fake_grip") else maxf(c.get_float("grip"), 1.0 if c.is_button_pressed("grip_click") else 0.0)
	return Vector2(trig, grip)


func _process(delta: float) -> void:
	if enabled:
		tick(delta)


## One update (called every frame; tests call it directly).
func tick(delta: float) -> void:
	for c in controllers:
		if is_instance_valid(c):
			_update(c, delta)


func _update(c: XRController3D, delta: float) -> void:
	var st := _st(c)
	var h: PlayHand = st.hand
	var tip := tip_of(c)
	if delta > 0.0:
		h.velocity = h.velocity.lerp((tip - st.last) / delta, 0.6)
	st.last = tip
	h.basis = c.global_basis.orthonormalized()
	h.ray_origin = c.global_position
	h.ray_dir = -c.global_basis.z.normalized()
	var inp := _inputs(c)
	h.squeeze = inp.x
	h.grip = inp.y > 0.6
	var pressing := inp.x > 0.6 or h.grip
	match st.mode:
		"":
			var obj := _touching(tip)
			if obj:
				h.position = tip
				h.pressed = true
				st.mode = "touch"
				st.obj = obj
				obj.hand_down(h)
			elif pressing and not st.was:
				var hit := _ray_pick(h.ray_origin, h.ray_dir)
				if not hit.is_empty():
					var plane: Array = hit.obj.drag_plane(hit.point)
					st.plane = Plane(plane[1], plane[0])
					h.position = hit.point
					h.pressed = true
					st.mode = "ray"
					st.obj = hit.obj
					hit.obj.hand_down(h)
		"touch":
			h.position = tip
			var obj: Playable = st.obj
			# Gripping holds on even outside the object (turning, tilting).
			if is_instance_valid(obj) and (obj.contains(tip, release_margin) or h.grip):
				obj.hand_move(h)
			else:
				_let_go(st)
		"ray":
			var obj: Playable = st.obj
			if pressing and is_instance_valid(obj):
				var hit: Variant = st.plane.intersects_ray(h.ray_origin, h.ray_dir)
				if hit != null:
					h.position = hit
					obj.hand_move(h)
			else:
				_let_go(st)
	st.was = pressing


func _let_go(st: Dictionary) -> void:
	var h: PlayHand = st.hand
	h.pressed = false
	if is_instance_valid(st.obj):
		st.obj.hand_up(h)
	st.mode = ""
	st.obj = null


func _touching(tip: Vector3) -> Playable:
	var best: Playable = null
	var best_d := INF
	for o in get_tree().get_nodes_in_group("playables"):
		var p := o as Playable
		if p and p.is_visible_in_tree() and p.contains(tip):
			var d := tip.distance_to(p.global_position)
			if d < best_d:
				best_d = d
				best = p
	return best


func _ray_pick(origin: Vector3, dir: Vector3) -> Dictionary:
	var best := {}
	for o in get_tree().get_nodes_in_group("playables"):
		var p := o as Playable
		if p == null or not p.is_visible_in_tree():
			continue
		var d := p.hit_ray(origin, dir)
		if d >= 0.0 and d <= ray_reach and (best.is_empty() or d < best.dist):
			best = {"obj": p, "point": origin + dir * d, "dist": d}
	return best


## What a controller is touching or holding right now (or null).
func holding(c: XRController3D) -> Playable:
	return _st(c).obj


func release_all() -> void:
	for k in _state:
		if _state[k].mode != "":
			_let_go(_state[k])
