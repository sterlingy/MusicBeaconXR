class_name ListenerInput
extends Node
## One listener position fed by any number of input sources (keyboard and gamepad,
## pointer, wander, XR locomotion, scripted jumps). Knows nothing about music:
## connect `moved` to whatever uses the position (a BeaconPlayer, an audio
## listener, a minimap).
##
##   var li := ListenerInput.new()
##   li.space = ListenerSpace.planar(Rect2(-250, -250, 500, 500))
##   li.add_child(KeyboardSource.new())
##   li.add_child(WanderSource.new())
##   add_child(li)
##   li.moved.connect(func(p): player.set_position(p))
##   li.action.connect(func(name, arg): ...)   # "toggle_play", "toggle_wander", "jump", ...
##
## Each frame the sources are asked for a move intent in child order. The first
## non-zero intent wins, then an active walk target, then wander. A source
## with `drives_position` (XR head tracking) sets the position outright instead.

## The position changed (by any source or by set_position / jump_to).
signal moved(pos: Vector2)
## A discrete command from a source: "toggle_play", "toggle_wander", "switch_scene",
## "jump" (arg: index), "zoom" (arg: factor), "select" (arg: position), or your own.
signal action(name: String, arg: Variant)
## Wander was switched on or off.
signal wander_changed(on: bool)
## A travel (travel_to) reached its destination.
signal travel_finished()
## jump_to teleported the listener (trails break here).
signal jumped(from: Vector2, to: Vector2)

var space := ListenerSpace.planar(Rect2(-250, -250, 500, 500))
var position := Vector2.ZERO
## Multiplies the space's walk speed.
var speed_scale := 1.0
## Where the listener is walking to, or null.
var target: Variant = null
var wander := false:
	set(v):
		if v != wander:
			wander = v
			wander_changed.emit(v)
## Wander speed as a fraction of walking speed.
var wander_pace := 0.6
var heading := randf() * TAU
## Set false to freeze movement (menus, cut-scenes); actions still fire.
var enabled := true
## A glide in progress (travel_to): {from, to, t (seconds so far), dur}.
var _travel := {}


func set_position(p: Vector2, emit := true) -> void:
	var c := space.clamp_pos(p)
	if c == position:
		return
	position = c
	if emit:
		moved.emit(position)


## Teleports and cancels any walk target or travel.
func jump_to(p: Vector2) -> void:
	target = null
	_travel = {}
	var from := position
	set_position(p)
	jumped.emit(from, position)


func set_target(p: Variant) -> void:
	_travel = {}
	target = null if p == null else space.clamp_pos(p)


## Glides to `p` over `seconds`, easing in and out, along the space's own path
## (great circles on the globe). Walking (keys, stick) or a jump cancels it.
func travel_to(p: Vector2, seconds: float) -> void:
	target = null
	_travel = {"from": position, "to": space.clamp_pos(p), "t": 0.0, "dur": maxf(0.05, seconds)}


func traveling() -> bool:
	return not _travel.is_empty()


## Advances a travel by `delta` seconds and returns where the listener is now
## (sources that drive the position, like XR, move the play space there).
func travel_step(delta: float) -> Vector2:
	if _travel.is_empty():
		return position
	_travel.t += delta
	var u := clampf(_travel.t / _travel.dur, 0.0, 1.0)
	var to: Vector2 = _travel.to
	var p := space.interp(_travel.from, to, u * u * (3.0 - 2.0 * u))
	if u >= 1.0:
		_travel = {}
		travel_finished.emit()
	return p


## Stops a travel where the listener is now.
func stop_travel() -> void:
	_travel = {}


## How long a Move should take: a few seconds for a short hop, longer across
## the world (globe, kilometers) or across the floor (planar, `span` units wide).
static func travel_seconds(p_space: ListenerSpace, a: Vector2, b: Vector2, span := 500.0) -> float:
	var d := p_space.distance(a, b)
	if p_space.kind == ListenerSpace.Kind.GEO:
		return 3.0 + 9.0 * clampf((log(1.0 + d) / log(10.0) - 1.0) / 3.3, 0.0, 1.0) # 10 km: 3 s, 1,000 km: 8.5 s, the far side: 12 s
	return 1.5 + 4.5 * clampf(d / maxf(1.0, span), 0.0, 1.0)


func send_action(name: String, arg: Variant = null) -> void:
	if name == "toggle_wander":
		wander = not wander
	action.emit(name, arg)


func sources() -> Array[ListenerSource]:
	var out: Array[ListenerSource] = []
	for c in get_children():
		if c is ListenerSource and c.enabled:
			out.append(c)
	return out


func _process(delta: float) -> void:
	if not enabled:
		return
	tick(delta)


## One movement update. Public so tests (and fixed-step hosts) can drive it.
func tick(delta: float) -> void:
	var srcs := sources()
	for s in srcs:
		if s.drives_position:
			var p: Variant = s.driven_position(self, delta)
			if p != null:
				set_position(p)
				return
	var dist := space.walk_speed * speed_scale * delta
	for s in srcs:
		var dir: Vector2 = s.move_intent(self, delta)
		if dir != Vector2.ZERO:
			target = null
			_travel = {}
			# Analog sticks walk slower when pushed part way; keys are always full speed.
			set_position(space.step(position, dir.normalized(), dist * minf(1.0, dir.length())))
			return
	if not _travel.is_empty():
		set_position(travel_step(delta))
		return
	if target != null:
		var t := space.toward(position, target)
		if t.dist <= dist:
			set_position(target)
			target = null
		else:
			set_position(space.step(position, t.dir, dist))
		return
	if wander:
		heading += randf_range(-1.1, 1.1) * delta
		heading = space.bounce(position, heading)
		set_position(space.step(position, Vector2(cos(heading), sin(heading)), dist * wander_pace))
