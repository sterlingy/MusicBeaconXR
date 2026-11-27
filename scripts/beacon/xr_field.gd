extends "res://scripts/beacon/field_scene.gd"
## The beacon field in OpenXR (PC VR through SteamVR / Oculus / WMR, and Quest).
## You are the listener: walk the room, glide with the left stick, snap-turn with
## the right; tap the right trigger on a beacon, or hold it on any spot, and a
## card offers to Jump or Move there (point at a button and pull the trigger);
## grip switches between life size and a tabletop field. A / X play, B / Y auto-walk.
## On headsets with passthrough (Quest 3, Pro) the tabletop field floats in your
## room; the left menu button toggles passthrough.
##
## Run on PC VR:  godot --path . --xr-mode on res://scenes/xr_field.tscn
## Without a headset it falls back to the flat overhead view, so it can still be
## tried (and tested) on a desktop.

var xr: XRInterface
var origin: XROrigin3D
var xr_camera: XRCamera3D
var left_hand: XRController3D
var right_hand: XRController3D
var loco: XRLocomotionSource
var panel: Label3D
var card: XRTravelCard
var passthrough := false
var xr_active := false


func _ready() -> void:
	super._ready()
	hud.title_text = "MUSIC BEACON XR"
	xr = XRServer.find_interface("OpenXR")
	if xr != null and xr.is_initialized():
		_start_xr()
	elif "--fake-xr" in OS.get_cmdline_user_args():
		# Dev: build the whole rig without a headset and look through its camera, to test the XR path.
		_start_xr(false)
	else:
		print("xr_field: no OpenXR headset, showing the flat view (run with --xr-mode on and a headset connected)")


func _start_xr(real := true) -> void:
	xr_active = true
	if real:
		get_viewport().use_xr = true
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED) # the headset paces frames
	origin = XROrigin3D.new()
	origin.name = "XROrigin3D"
	add_child(origin)
	xr_camera = XRCamera3D.new()
	xr_camera.far = 4000
	origin.add_child(xr_camera)
	xr_camera.current = true
	left_hand = _controller("left_hand")
	right_hand = _controller("right_hand")
	# Start standing where the flat view's listener was.
	origin.global_position = Vector3(player.pos.x, 0, player.pos.y)

	loco = XRLocomotionSource.new()
	loco.require_interface = real
	loco.origin = origin
	loco.camera = xr_camera
	loco.left = left_hand
	loco.right = right_hand
	loco.scale_changed.connect(func(_s): _apply_look())
	input.add_child(loco)
	input.move_child(loco, 0)
	# The mouse can't aim in a headset; keys stay for debugging from the desk.
	var ptr := input.get_node_or_null("PointerSource")
	if ptr:
		ptr.enabled = false
	left_hand.button_pressed.connect(_on_left_button)
	card = XRTravelCard.new()
	card.pointer = right_hand
	add_child(card)
	card.chosen.connect(func(k: String): _go(k, travel.pos))
	card.closed.connect(func(): _marker.visible = false)
	loco.intercept = func(o: Vector3, d: Vector3) -> bool: return card.click(o, d)

	panel = Label3D.new()
	panel.font_size = 32
	panel.pixel_size = 0.0008
	panel.outline_size = 8
	panel.outline_modulate = Color("0b1016")
	panel.position = Vector3(0, 0.08, -0.05)
	panel.rotation_degrees = Vector3(-50, 0, 0)
	panel.no_depth_test = true
	left_hand.add_child(panel)
	# Most people want the whole field in view first: start at tabletop scale.
	loco.set_scale_index(1)
	if not real:
		_fake_pose()
	_apply_look()


## --fake-xr: untracked nodes sit at the origin, so pose the head and hands by hand
## (scaled with the world, as real tracking would be).
func _fake_pose() -> void:
	var k := loco.world_scale()
	xr_camera.position = Vector3(0, 1.6, 0.9) * k
	xr_camera.rotation_degrees = Vector3(-50, 0, 0)
	left_hand.position = Vector3(-0.12, 1.3, 0.55) * k
	left_hand.rotation_degrees = Vector3(30, 0, 0)
	right_hand.position = Vector3(0.2, 1.2, 0.6) * k
	right_hand.rotation_degrees = Vector3(-40, 0, 0)


func _controller(tracker: String) -> XRController3D:
	var c := XRController3D.new()
	c.name = tracker.capitalize().replace(" ", "")
	c.tracker = tracker
	origin.add_child(c)
	var m := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.04, 0.03, 0.12)
	m.mesh = box
	var mat := StandardMaterial3D.new()
	mat.albedo_color = ACCENT
	mat.emission_enabled = true
	mat.emission = ACCENT
	mat.emission_energy_multiplier = 0.3
	m.material_override = mat
	c.add_child(m)
	return c


func _on_left_button(a: String) -> void:
	match a:
		"menu_button":
			_toggle_passthrough()
		"primary_click":
			# Press the left stick: over to the Instrument Table.
			get_tree().change_scene_to_file("res://scenes/instrument_table.tscn")


## In the headset the card floats over the spot instead of popping up on a screen.
func _offer(pos: Vector2, snap: float, beacon_only: bool, screen := Vector2(-1, -1)) -> void:
	if not xr_active:
		super._offer(pos, snap, beacon_only, screen)
		return
	var d := TravelUi.describe(player, pos, maxf(snap, 0.6 * player.field.spacing) if beacon_only else snap)
	if beacon_only and d.pos == pos:
		return
	travel.pos = d.pos # the chosen place, read back when a button is pulled
	var at: Vector3 = loco.from_pos.call(d.pos)
	_marker.position = at + Vector3(0, 0.02, 0)
	_marker.visible = true
	var secs := ListenerInput.travel_seconds(input.space, player.pos, d.pos, input.space.bounds.size.x, speed.mps)
	card.world_scale = loco.world_scale()
	card.open(at, xr_camera.global_position, d.title, "%s · Move takes %s" % [d.detail, TravelUi.duration(secs)])


func _go(kind_: String, pos: Vector2) -> void:
	if not xr_active:
		super._go(kind_, pos)
		return
	_marker.visible = false
	if kind_ == "jump":
		input.stop_travel()
		loco.teleport(pos)
	else:
		input.travel_to(pos, ListenerInput.travel_seconds(input.space, player.pos, pos, input.space.bounds.size.x, speed.mps))


func _on_action(name: String, arg: Variant) -> void:
	# In the headset the menu button is passthrough, not a jump to the flat globe.
	if xr_active and name == "switch_scene":
		return
	super._on_action(name, arg)


## Passthrough (if the headset has it): clear background, no floor, the field floats in the room.
func _toggle_passthrough() -> void:
	if xr == null:
		return
	var modes: Array = xr.get_supported_environment_blend_modes()
	if not modes.has(XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND):
		return
	passthrough = not passthrough
	xr.environment_blend_mode = XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND if passthrough else XRInterface.XR_ENV_BLEND_MODE_OPAQUE
	get_viewport().transparent_bg = passthrough
	_apply_look()


func _apply_look() -> void:
	env.background_mode = Environment.BG_CLEAR_COLOR if passthrough else Environment.BG_COLOR
	RenderingServer.set_default_clear_color(Color(0, 0, 0, 0) if passthrough else Color("0b1016"))
	env.fog_enabled = not passthrough
	ground.visible = not passthrough
	# At life size you are the listener; at tabletop scale the marker shows where you stand.
	listener.visible = loco == null or loco.world_scale() > 1.5
	# Tracking scales with the world but node sizes don't: grow the hands and panel to match.
	if loco:
		var k := loco.world_scale()
		for hand in [left_hand, right_hand]:
			for c in hand.get_children():
				if c is MeshInstance3D and c.name != "Ray":
					c.scale = Vector3.ONE * k
		panel.scale = Vector3.ONE * k
		panel.position = Vector3(0, 0.08, -0.05) * k


func _process(delta: float) -> void:
	if not xr_active:
		super._process(delta)
		return
	_update_world(delta)
	listener.visible = loco.world_scale() > 1.5
	_update_panel()
	_check_shot()


func help_text() -> String:
	if not xr_active:
		return "No headset: flat view. " + super.help_text()
	return "XR: stick glide · trigger a beacon, or hold it anywhere: Jump or Move · grip tabletop · A play · B auto-walk · left stick click: instruments%s" % (" (on)" if input.wander else "")


func _update_panel() -> void:
	if panel == null or player.active.is_empty():
		return
	var lines := ["%s   %s" % ["▶" if Transport.running else "■", player.harmony.song.get("title", "")]]
	for a in player.active:
		lines.append("%s  %s  %d%%" % [a.beacon.label, a.song.title, roundi(a.w * 100)])
	lines.append("A play · B wander · grip scale")
	panel.text = "\n".join(lines)
