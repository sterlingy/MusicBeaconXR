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


func set_position(p: Vector2, emit := true) -> void:
	var c := space.clamp_pos(p)
	if c == position:
		return
	position = c
	if emit:
		moved.emit(position)


## Teleports and cancels any walk target.
func jump_to(p: Vector2) -> void:
	target = null
	set_position(p)


func set_target(p: Variant) -> void:
	target = null if p == null else space.clamp_pos(p)


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
			# Analog sticks walk slower when pushed part way; keys are always full speed.
			set_position(space.step(position, dir.normalized(), dist * minf(1.0, dir.length())))
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
