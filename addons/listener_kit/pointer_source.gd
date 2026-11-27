class_name PointerSource
extends ListenerSource
## Click or tap the world to walk there; drag to keep steering; pinch to zoom.
## Works with the mouse and with touch screens (phones, tablets).
##
## mode "explore" instead leaves the listener alone: one finger (or the left
## mouse button) dragging sends "orbit" (arg: the screen movement, Vector2) so
## the host turns the globe or pans the map, and "orbit_end" (arg: the release
## velocity in px/s, for a flick); a tap sends "select" (arg: position); a long
## press or a right-click sends "point" (arg: {pos, screen}) so the host can
## offer to Jump or Move there.
##
## `pick` turns a camera ray into a listener position (or null for a miss). Use
## PointerSource.ground_picker() for a flat floor or sphere_picker() for a globe.

var camera: Camera3D
## func(origin: Vector3, dir: Vector3) -> Variant (Vector2 position or null)
var pick: Callable
## Dragging further than this many pixels steers instead of selecting.
var drag_px := 8.0
## Taps also send "select" (arg: position) so the host can snap to a beacon.
var send_select := true
## "walk" (press to walk, drag to steer) or "explore" (drag turns the view; see above).
var mode := "walk"
## Explore: holding still this long (seconds) is a long press.
var long_press := 0.5

var _down := false
var _down_at := Vector2.ZERO
## Two-finger pinch on touch screens, tracked from the raw touches (Android
## sends no magnify gesture for them): finger index -> position.
var _touches := {}
var _pinch_d := 0.0
var _pinching := false # from the second finger down until every finger is up
# Explore: the current press.
var _down_t := 0.0 # seconds held
var _moved := false # dragged past drag_px: an orbit, not a tap
var _pointed := false # the long press already fired
var _vel := Vector2.ZERO # px/s while dragging
var _last_move_ms := 0


func _init() -> void:
	name = "PointerSource"


## Floor at height `y`; world (x, z) is the listener position.
static func ground_picker(y := 0.0) -> Callable:
	return func(origin: Vector3, dir: Vector3) -> Variant:
		if absf(dir.y) < 1e-4:
			return null
		var t := (y - origin.y) / dir.y
		if t < 0.0:
			return null
		var hit := origin + dir * t
		return Vector2(hit.x, hit.z)


## Sphere at the origin; `to_pos` maps a unit surface vector to a listener position.
static func sphere_picker(radius: float, to_pos: Callable) -> Callable:
	return func(origin: Vector3, dir: Vector3) -> Variant:
		var b := origin.dot(dir)
		var c := origin.length_squared() - radius * radius
		var disc := b * b - c
		if disc < 0.0:
			return null
		var t := -b - sqrt(disc)
		if t < 0.0:
			return null
		return to_pos.call((origin + dir * t).normalized())


## (lon, lat) degrees for a unit vector, matching y-up, lon 0 at +z.
static func unit_to_lonlat(v: Vector3) -> Vector2:
	return Vector2(rad_to_deg(atan2(v.x, v.z)), rad_to_deg(asin(clampf(v.y, -1.0, 1.0))))


func _pick_at(screen: Vector2) -> Variant:
	if camera == null or not pick.is_valid():
		return null
	return pick.call(camera.project_ray_origin(screen), camera.project_ray_normal(screen))


## Two fingers zoom: spreading them zooms in, pinching zooms out. The walk the
## first finger started stops where the listener is. Returns true if it used the event.
func _track_pinch(event: InputEvent, li: ListenerInput) -> bool:
	if event is InputEventScreenTouch:
		if event.pressed:
			_touches[event.index] = event.position
		else:
			_touches.erase(event.index)
		if _touches.size() >= 2:
			if not _pinching:
				_pinching = true
				_down = false
				li.set_target(null)
			_pinch_d = _pinch_distance()
			return true
		if _touches.is_empty() and _pinching:
			_pinching = false
			return true
		return _pinching
	if event is InputEventScreenDrag and _touches.has(event.index):
		_touches[event.index] = event.position
		if _touches.size() >= 2:
			var d := _pinch_distance()
			if _pinch_d > 1.0 and d > 1.0:
				li.send_action("zoom", _pinch_d / d)
			_pinch_d = d
			return true
		return _pinching
	return false


func _pinch_distance() -> float:
	var pts: Array = _touches.values()
	return (pts[0] as Vector2).distance_to(pts[1])


func _unhandled_input(event: InputEvent) -> void:
	var li := listener()
	if li == null or not enabled:
		return
	# Pinch (touch screens, trackpads) zooms like the mouse wheel.
	if event is InputEventMagnifyGesture and event.factor > 0.0:
		li.send_action("zoom", 1.0 / event.factor)
		return
	if _track_pinch(event, li):
		return
	# While pinching, the first finger's emulated mouse must not walk or select.
	if _pinching and (event is InputEventMouseButton or event is InputEventMouseMotion):
		return
	# Godot turns touches into mouse events by default; only read raw touches when that's off.
	if (event is InputEventScreenTouch or event is InputEventScreenDrag) and ProjectSettings.get_setting("input_devices/pointing/emulate_mouse_from_touch", true):
		return
	if mode == "explore":
		_explore_input(event, li)
		return
	var pressed_btn: bool = (event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT) or event is InputEventScreenTouch
	if pressed_btn:
		if event.pressed:
			_down = true
			_down_at = event.position
			var p: Variant = _pick_at(event.position)
			if p != null:
				li.set_target(p)
		else:
			if _down and send_select and event.position.distance_to(_down_at) < drag_px:
				var p: Variant = _pick_at(event.position)
				if p != null:
					li.send_action("select", p)
			_down = false
	elif _down and (event is InputEventMouseMotion or event is InputEventScreenDrag):
		var p: Variant = _pick_at(event.position)
		if p != null:
			li.set_target(p)


# ---------------------------------------------------------------- explore mode

func _explore_input(event: InputEvent, li: ListenerInput) -> void:
	# Right-click: the Jump / Move choice at once.
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_RIGHT and event.pressed:
		_point(event.position, li)
		return
	var pressed_btn: bool = (event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT) or event is InputEventScreenTouch
	if pressed_btn:
		if event.pressed:
			_down = true
			_down_at = event.position
			_down_t = 0.0
			_moved = false
			_pointed = false
			_vel = Vector2.ZERO
			_last_move_ms = Time.get_ticks_msec()
		elif _down:
			_down = false
			if _moved:
				# A flick keeps turning; a drag that stopped before letting go doesn't.
				var still := Time.get_ticks_msec() - _last_move_ms > 120
				li.send_action("orbit_end", Vector2.ZERO if still else _vel)
			elif not _pointed and send_select:
				var p: Variant = _pick_at(event.position)
				if p != null:
					li.send_action("select", p)
	elif _down and (event is InputEventMouseMotion or event is InputEventScreenDrag):
		if not _moved and event.position.distance_to(_down_at) >= drag_px and not _pointed:
			_moved = true
		if _moved:
			var rel: Vector2 = event.relative
			var now := Time.get_ticks_msec()
			var dt := maxf(0.008, (now - _last_move_ms) / 1000.0)
			_vel = _vel.lerp(rel / dt, 0.5)
			_last_move_ms = now
			li.send_action("orbit", rel)


func _point(screen: Vector2, li: ListenerInput) -> void:
	var p: Variant = _pick_at(screen)
	if p != null:
		li.send_action("point", {"pos": p, "screen": screen})


func _process(delta: float) -> void:
	if mode != "explore" or not _down or _moved or _pointed or _pinching:
		return
	_down_t += delta
	if _down_t >= long_press:
		_pointed = true
		var li := listener()
		if li and enabled:
			_point(_down_at, li)
