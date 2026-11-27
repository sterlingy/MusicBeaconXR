class_name XRLocomotionSource
extends ListenerSource
## OpenXR locomotion for a ListenerInput: the headset is the listener.
##
## The head's floor position (mapped by `to_pos`) is the listener position, so
## walking around the room moves you through the field. On top of that:
##   left stick       glide (head-relative)            right stick x   snap turn
##   right trigger    tap: "select" where it points; hold (long_press s): "point"
##                    ({pos, world}) so the host can offer to Jump or Move there
##                    (in "walk" mode a tap walks there instead)
##   right grip       toggle tabletop scale (see `scales`)
##   A / X            toggle_play       B / Y   toggle_wander     menu   switch_scene
## Walk targets and wander from the ListenerInput move the play space, so they
## work in XR the same as on a screen.
##
## Uses the default OpenXR action map names (primary, trigger_click, grip_click,
## ax_button, by_button, menu_button).

signal scale_changed(world_scale: float)

var origin: XROrigin3D
var camera: XRCamera3D
var left: XRController3D
var right: XRController3D
## Floor height in world units.
var floor_y := 0.0
## Glide speed in meters per second at life size (scaled with the world).
var move_speed := 12.0
var snap_degrees := 30.0
## World scales the grip cycles through: 1 = life size; 25 = the field as a tabletop.
var scales: Array[float] = [1.0, 25.0]
## World (x, z) of the head -> listener position, and back.
var to_pos := func(v: Vector3) -> Vector2: return Vector2(v.x, v.z)
var from_pos := func(p: Vector2) -> Vector3: return Vector3(p.x, 0.0, p.y)
## Tests set this false to run the logic without a headset.
var require_interface := true
## Optional laser line from the right controller (a MeshInstance3D is made if null).
var show_ray := true
## "explore" (tap selects, hold asks where to go) or "walk" (tap walks there).
var mode := "explore"
var long_press := 0.5
## func(origin: Vector3, dir: Vector3) -> bool: gets trigger presses first (a
## floating card's buttons); true means it used the press.
var intercept := Callable()

var _trigger_t := -1.0 # seconds the trigger has been held, -1 = up
var _trigger_hit: Variant = null

var _scale_i := 0
var _snapped := false
var _ray: MeshInstance3D


func _init() -> void:
	name = "XRLocomotionSource"
	drives_position = true


func _ready() -> void:
	if right:
		right.button_pressed.connect(_on_right)
		right.button_released.connect(_on_right_up)
		if show_ray:
			_ray = MeshInstance3D.new()
			_ray.name = "Ray"
			var box := BoxMesh.new()
			box.size = Vector3(0.004, 0.004, 1.0)
			_ray.mesh = box
			var m := StandardMaterial3D.new()
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.albedo_color = Color(1.0, 0.71, 0.28, 0.8)
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			_ray.material_override = m
			right.add_child(_ray)
	if left:
		left.button_pressed.connect(_on_left)


func world_scale() -> float:
	return origin.world_scale if origin else 1.0


func set_scale_index(i: int) -> void:
	if origin == null or scales.is_empty():
		return
	_scale_i = posmod(i, scales.size())
	# Keep the head over the same floor spot while the world shrinks or grows.
	var head := _head_floor()
	origin.world_scale = scales[_scale_i]
	_place_head_at(head)
	scale_changed.emit(origin.world_scale)


func _head_floor() -> Vector3:
	var h := camera.global_position if camera else origin.global_position
	return Vector3(h.x, floor_y, h.z)


## Moves the origin so the head is over `p` (world, y ignored).
func _place_head_at(p: Vector3) -> void:
	var h := _head_floor()
	origin.global_position += Vector3(p.x - h.x, 0.0, p.z - h.z)


func _on_right(action: String) -> void:
	var li := listener()
	if li == null or not enabled:
		return
	match action:
		"trigger_click":
			if intercept.is_valid() and intercept.call(right.global_position, -right.global_transform.basis.z.normalized()):
				return
			var hit: Variant = floor_hit()
			if hit == null:
				return
			if mode == "walk":
				var p: Vector2 = to_pos.call(hit)
				li.set_target(p)
				li.send_action("select", p)
			else:
				_trigger_t = 0.0
				_trigger_hit = hit
		"grip_click":
			set_scale_index(_scale_i + 1)
		"ax_button":
			li.send_action("toggle_play")
		"by_button":
			li.send_action("toggle_wander")


## Trigger let go before the long press: a tap.
func _on_right_up(action: String) -> void:
	if action != "trigger_click" or _trigger_t < 0.0:
		return
	_trigger_t = -1.0
	var li := listener()
	if li and enabled and _trigger_hit != null:
		li.send_action("select", to_pos.call(_trigger_hit))


## Counts a held trigger; fires "point" once it's a long press.
func hold_tick(delta: float) -> void:
	if _trigger_t < 0.0:
		return
	_trigger_t += delta
	if _trigger_t >= long_press:
		_trigger_t = -1.0
		var li := listener()
		if li and enabled and _trigger_hit != null:
			li.send_action("point", {"pos": to_pos.call(_trigger_hit), "world": _trigger_hit})


## Puts the head at listener position `p` at once (Jump).
func teleport(p: Vector2) -> void:
	if origin:
		_place_head_at(from_pos.call(p))


func _on_left(action: String) -> void:
	var li := listener()
	if li == null or not enabled:
		return
	match action:
		"ax_button":
			li.send_action("toggle_play")
		"by_button":
			li.send_action("toggle_wander")
		"menu_button":
			li.send_action("switch_scene")


## Where the right controller points on the floor (world), or null.
func floor_hit() -> Variant:
	if right == null:
		return null
	var o := right.global_position
	var d := -right.global_transform.basis.z.normalized()
	if d.y > -1e-3:
		return null
	return o + d * ((floor_y - o.y) / d.y)


func driven_position(li: ListenerInput, delta: float) -> Variant:
	if origin == null or camera == null:
		return null
	if require_interface and (not XRServer.primary_interface or not XRServer.primary_interface.is_initialized()):
		return null
	var speed := move_speed * world_scale() * delta
	# Head yaw: glide relative to where you look, ignoring pitch.
	var fwd := -camera.global_transform.basis.z
	fwd.y = 0.0
	fwd = fwd.normalized() if fwd.length() > 1e-3 else Vector3.FORWARD
	var rgt := fwd.cross(Vector3.UP)
	hold_tick(delta)
	var stick := left.get_vector2("primary") if left else Vector2.ZERO
	if stick.length() > 0.15:
		li.target = null
		li.stop_travel()
		origin.global_position += (rgt * stick.x + fwd * stick.y) * speed * minf(1.0, stick.length())
	elif li.traveling():
		_place_head_at(from_pos.call(li.travel_step(delta))) # Move: glide the play space along
	elif li.target != null:
		var goal: Vector3 = from_pos.call(li.target)
		var h := _head_floor()
		var d := Vector3(goal.x - h.x, 0.0, goal.z - h.z)
		if d.length() <= speed:
			_place_head_at(goal)
			li.target = null
		else:
			origin.global_position += d.normalized() * speed
	elif li.wander:
		li.heading += randf_range(-1.1, 1.1) * delta
		li.heading = li.space.bounce(li.position, li.heading)
		var next := li.space.step(li.position, Vector2(cos(li.heading), sin(li.heading)), speed * li.wander_pace)
		_place_head_at(from_pos.call(next))
	# Snap turn on the right stick, around the head.
	var turn := right.get_vector2("primary").x if right else 0.0
	if absf(turn) > 0.7 and not _snapped:
		_snapped = true
		var pivot := _head_floor()
		var t := Transform3D(Basis(Vector3.UP, deg_to_rad(-snap_degrees * signf(turn))), Vector3.ZERO)
		origin.global_transform = Transform3D.IDENTITY.translated(pivot) * t * Transform3D.IDENTITY.translated(-pivot) * origin.global_transform
	elif absf(turn) < 0.3:
		_snapped = false
	# Keep the head inside the space: walk into an edge and the world stops with you.
	var p: Vector2 = to_pos.call(_head_floor())
	var c := li.space.clamp_pos(p)
	if c != p:
		_place_head_at(from_pos.call(c))
		p = c
	_update_ray()
	return p


func _update_ray() -> void:
	if _ray == null:
		return
	var hit: Variant = floor_hit()
	var length := 2.0 * world_scale()
	if hit != null:
		length = minf(right.global_position.distance_to(hit), 60.0 * world_scale())
	_ray.scale = Vector3(world_scale(), world_scale(), length)
	_ray.position = Vector3(0, 0, -length * 0.5)
	_ray.visible = right.get_is_active() if require_interface else true
