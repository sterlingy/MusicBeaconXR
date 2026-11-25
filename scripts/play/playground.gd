extends Node3D
## Instrument Table: every MusicInputKit object on one table, played on
## SynthKit's instruments. Mouse and touch on desktop and phones; reach out and
## play with your hands in OpenXR (PC VR, Quest).
##
## Desktop: click / tap to play, drag to slide, bend and strum, mouse wheel turns
## dials, right-drag to look around, wheel over empty space to zoom.
## XR: touch or hit objects with the controllers, grip to hold and twist, point
## and pull the trigger to play from a distance, right stick up/down moves the
## table, left menu button toggles passthrough.
##
## Dev: `-- --shot=<path> [--frames=N] [--demo] [--fake-xr]`; `--shot=none` only
## keeps the saved patches untouched (tests).

const PATCH_FILE := "user://music_input_patches.json"
const TABLE_Y := 0.8
const BG := Color("0b1016")

var kit: MusicInput
var bridge: SynthBridge
var pointer: PlayPointer
var rig: Node3D # the table and everything on it (moves up and down in XR)
var cam: Camera3D
var env: Environment
var floor_mesh: MeshInstance3D
var objects := {} # name -> Playable
var ui: CanvasLayer
var status: Label
var patch_box: VBoxContainer

# XR
var xr: XRInterface
var xr_active := false
var origin: XROrigin3D
var xr_camera: XRCamera3D
var xr_hands: PlayXRHands
var controllers: Array[XRController3D] = []
var passthrough := false

# Orbit camera (flat)
var _yaw := 0.0
var _pitch := deg_to_rad(-38.0)
var _dist := 1.45
var _orbiting := false

var _shot := ""
var _frames := 45
var _demo := false
var _saved_patches := []


func _ready() -> void:
	get_tree().quit_on_go_back = false # Android back returns to the field (see _notification)
	_parse_args()
	kit = MusicInput.new()
	kit.name = "MusicInput"
	add_child(kit)
	_load_patches()
	_build_world()
	_build_table()
	if not _saved_patches.is_empty():
		kit.patches.from_array(_saved_patches)
	kit.patches.changed.connect(_save_patches)
	bridge = SynthBridge.new(kit)
	bridge.name = "SynthBridge"
	add_child(bridge)
	cam = Camera3D.new()
	cam.fov = 50
	add_child(cam)
	cam.current = true
	_place_camera()
	pointer = PlayPointer.new()
	pointer.camera = cam
	add_child(pointer)
	_build_ui()
	kit.scale.changed.connect(_update_status)
	kit.source_moved.connect(func(_s, _v): pass)
	_update_status()

	xr = XRServer.find_interface("OpenXR")
	if xr != null and xr.is_initialized():
		_start_xr(true)
	elif "--fake-xr" in OS.get_cmdline_user_args():
		_start_xr(false)
	if _demo:
		_run_demo()


# ---------------------------------------------------------------- world

func _build_world() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = BG
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("4a5668")
	env.ambient_light_energy = 0.7
	env.glow_enabled = true
	env.glow_intensity = 0.7
	env.glow_bloom = 0.1
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-60, -25, 0)
	key.light_energy = 0.9
	key.shadow_enabled = true
	add_child(key)
	floor_mesh = MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(12, 12)
	floor_mesh.mesh = pm
	floor_mesh.material_override = Playable.mat(Color("121921"))
	add_child(floor_mesh)


func _build_table() -> void:
	rig = Node3D.new()
	rig.name = "Table"
	rig.position.y = TABLE_Y
	add_child(rig)
	var top := MeshInstance3D.new()
	var tm := BoxMesh.new()
	tm.size = Vector3(2.0, 0.04, 1.0)
	top.mesh = tm
	top.material_override = Playable.mat(Color("1a2430"))
	top.position = Vector3(0, -0.02, 0)
	rig.add_child(top)
	for x in [-0.95, 0.95]:
		for z in [-0.45, 0.45]:
			var leg := MeshInstance3D.new()
			var lm := BoxMesh.new()
			lm.size = Vector3(0.05, TABLE_Y - 0.04, 0.05)
			leg.mesh = lm
			leg.material_override = Playable.mat(Color("141c25"))
			leg.position = Vector3(x, -TABLE_Y / 2 - 0.02, z)
			rig.add_child(leg)

	# Notes: back and middle rows. Shaping: the front row, nearest your hands.
	_add("Strings", LightStrings.new(), Vector3(-0.55, 0, -0.36))
	_add("Orb", ThereminOrb.new(), Vector3(0.0, 0, -0.32))
	_add("MusicBox", MusicBoxWheel.new(), Vector3(0.52, 0, -0.3))
	var sw := ScaleSwitch.new()
	_add("Scale", sw, Vector3(0.83, 0, -0.33))
	_add("Bars", ChimeBars.new(), Vector3(-0.55, 0, -0.02), true)
	_add("Blocks", ChordBlocks.new(), Vector3(0.08, 0, -0.02), true)
	_add("Pads", DrumPads.new(), Vector3(0.69, 0, -0.02), true)
	var ribbon := PitchRibbon.new()
	ribbon.length = 0.55
	_add("Ribbon", ribbon, Vector3(-0.64, 0, 0.3))

	var dial := TwistDial.new()
	dial.label = "Keys tone"
	dial.default_part = "keys"
	dial.default_param = "filter.cutoff"
	dial.start_value = 0.6
	_add("Dial", dial, Vector3(-0.22, 0, 0.3))
	var fader := SlideFader.new()
	fader.label = "Pad level"
	fader.default_part = "pad"
	fader.default_param = "@volume"
	fader.start_value = 0.6
	_add("Fader", fader, Vector3(-0.04, 0, 0.3))
	var whammy := SlideFader.new()
	whammy.label = "Lead bend"
	whammy.spring_back = true
	whammy.default_part = "lead"
	whammy.default_param = "@bend"
	whammy.tint = Color("ff4f9a")
	_add("Whammy", whammy, Vector3(0.1, 0, 0.3))
	var xy := XYPad.new()
	xy.label = "Bass filter"
	xy.default_part = "bass"
	xy.x_param = "filter.cutoff"
	xy.y_param = "filter.emphasis"
	_add("XY", xy, Vector3(0.32, 0, 0.3))
	var fw := Flywheel.new()
	fw.label = "Shimmer"
	_add("Flywheel", fw, Vector3(0.58, 0, 0.3))
	var tc := TiltCube.new()
	tc.label = "Lead tilt"
	_add("Tilt", tc, Vector3(0.83, 0, 0.3))


func _add(n: String, p: Playable, pos: Vector3, front_tag := false) -> void:
	p.name = n
	p.kit = kit
	p.position = pos
	rig.add_child(p)
	objects[n] = p
	# Names over each object so people know what they're looking at.
	var tag := Label3D.new()
	tag.text = _title_of(p)
	tag.pixel_size = 0.0008
	tag.font_size = 32
	tag.outline_size = 10
	tag.outline_modulate = BG
	tag.modulate = Color(p.tint, 0.95)
	if front_tag:
		# Middle row: the name lies on the table in front, clear of the back row.
		tag.pixel_size = 0.0006
		tag.rotation_degrees = Vector3(-90, 0, 0)
		tag.position = Vector3(0, 0.002, p.box.end.z + 0.022)
	else:
		tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		tag.position = Vector3(0, p.box.end.y + 0.045, p.box.position.z)
		tag.no_depth_test = true
	p.add_child(tag)


func _title_of(p: Playable) -> String:
	if p is ChimeBars: return "Chime bars · %s" % p.part
	if p is LightStrings: return "Light strings · %s" % p.part
	if p is ThereminOrb: return "Orb · %s" % p.part
	if p is PitchRibbon: return "Ribbon · %s" % p.part
	if p is DrumPads: return "Drum pads"
	if p is ChordBlocks: return "Chord blocks · %s" % p.part
	if p is MusicBoxWheel: return "Music box · %s" % p.part
	if p is ScaleSwitch: return "Scale"
	return ""


# ---------------------------------------------------------------- flat camera

func _place_camera() -> void:
	var center := Vector3(0, TABLE_Y, 0)
	var dir := Vector3(sin(_yaw) * cos(_pitch), -sin(_pitch), cos(_yaw) * cos(_pitch))
	cam.look_at_from_position(center + dir * _dist, center)


func _unhandled_input(event: InputEvent) -> void:
	if xr_active:
		return
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_RIGHT:
			_orbiting = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_dist = maxf(0.5, _dist * 0.92)
			_place_camera()
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_dist = minf(3.5, _dist / 0.92)
			_place_camera()
	elif event is InputEventMouseMotion and _orbiting:
		_yaw -= event.relative.x * 0.006
		_pitch = clampf(_pitch - event.relative.y * 0.006, deg_to_rad(-85), deg_to_rad(-8))
		_place_camera()
	elif event is InputEventMagnifyGesture:
		_dist = clampf(_dist / event.factor, 0.5, 3.5)
		_place_camera()
	elif event is InputEventPanGesture:
		_yaw -= event.delta.x * 0.03
		_place_camera()
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_L:
				kit.send_action("lock")
			KEY_P:
				_toggle_patches()
			KEY_G:
				_back_to_field()
			KEY_R:
				_yaw = 0.0
				_pitch = deg_to_rad(-38.0)
				_dist = 1.45
				_place_camera()


# ---------------------------------------------------------------- UI

func _build_ui() -> void:
	ui = CanvasLayer.new()
	add_child(ui)
	var panel := PanelContainer.new()
	panel.position = Vector2(12, 12)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.08, 0.11, 0.15, 0.88)
	sb.border_color = Color("2a3644")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(12)
	panel.add_theme_stylebox_override("panel", sb)
	ui.add_child(panel)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 6)
	panel.add_child(col)
	var title := Label.new()
	title.text = "INSTRUMENT TABLE"
	title.add_theme_color_override("font_color", Color("ffb547"))
	col.add_child(title)

	var row := HBoxContainer.new()
	col.add_child(row)
	var lock := CheckButton.new()
	lock.text = "Keep notes in key"
	lock.button_pressed = kit.scale.enabled
	lock.toggled.connect(func(on): kit.send_action("lock", on))
	kit.scale.changed.connect(func(): lock.set_pressed_no_signal(kit.scale.enabled))
	row.add_child(lock)

	var row2 := HBoxContainer.new()
	col.add_child(row2)
	var key := OptionButton.new()
	for n in ScaleLock.NAMES:
		key.add_item(n)
	key.selected = kit.scale.root
	key.item_selected.connect(func(i): kit.scale.root = i)
	kit.scale.changed.connect(func(): key.select(kit.scale.root))
	row2.add_child(key)
	var sc := OptionButton.new()
	var names := ScaleLock.SCALES.keys()
	names.erase("chromatic")
	for n in names:
		sc.add_item(n)
	sc.selected = names.find(kit.scale.scale)
	sc.item_selected.connect(func(i): kit.scale.scale = names[i])
	kit.scale.changed.connect(func(): sc.select(names.find(kit.scale.scale)))
	row2.add_child(sc)
	var pb := Button.new()
	pb.text = "Patches ▸"
	pb.pressed.connect(_toggle_patches)
	row2.add_child(pb)
	var back := Button.new()
	back.text = "Map"
	back.pressed.connect(_back_to_field)
	row2.add_child(back)

	patch_box = VBoxContainer.new()
	patch_box.visible = false
	col.add_child(patch_box)

	status = Label.new()
	status.add_theme_color_override("font_color", Color("8d9aab"))
	status.add_theme_font_size_override("font_size", 13)
	col.add_child(status)


func _toggle_patches() -> void:
	patch_box.visible = not patch_box.visible
	if patch_box.visible:
		_fill_patches()


## One row per moving part: what it is, which part it shapes, which knob.
func _fill_patches() -> void:
	for c in patch_box.get_children():
		c.queue_free()
	var by_part := {}
	for t in bridge.targets():
		by_part.get_or_add(t[0], []).append(t[1])
	var parts: Array = by_part.keys()
	var sources: Array = kit.patches.sources.keys()
	sources.sort()
	var grid := GridContainer.new()
	grid.columns = 3
	patch_box.add_child(grid)
	for s in sources:
		var l := Label.new()
		l.text = kit.patches.sources[s]
		l.custom_minimum_size.x = 150
		grid.add_child(l)
		var cur := kit.patches.targets_of(s)
		var part_btn := OptionButton.new()
		part_btn.add_item("—")
		for p in parts:
			part_btn.add_item(p)
		var param_btn := OptionButton.new()
		param_btn.custom_minimum_size.x = 170
		var fill_params := func(part: String, sel: String) -> void:
			param_btn.clear()
			for id in by_part.get(part, []):
				param_btn.add_item(id)
				if id == sel:
					param_btn.select(param_btn.item_count - 1)
		if not cur.is_empty():
			part_btn.select(parts.find(cur[0].part) + 1)
			fill_params.call(cur[0].part, cur[0].param)
		part_btn.item_selected.connect(func(i):
			if i == 0:
				kit.patches.remove(s)
				param_btn.clear()
				return
			var part: String = parts[i - 1]
			fill_params.call(part, "")
			param_btn.select(0)
			kit.patches.set_patch(s, part, param_btn.get_item_text(0))
			kit.resend())
		param_btn.item_selected.connect(func(i):
			var pi := part_btn.selected
			if pi <= 0:
				return
			kit.patches.set_patch(s, parts[pi - 1], param_btn.get_item_text(i))
			kit.resend())
		grid.add_child(part_btn)
		grid.add_child(param_btn)
	var reset := Button.new()
	reset.text = "Reset patches"
	reset.pressed.connect(func():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(PATCH_FILE))
		get_tree().reload_current_scene())
	patch_box.add_child(reset)


func _update_status() -> void:
	if status == null:
		return
	var how := "XR: touch or hit to play · grip to hold and twist · trigger to play from afar · right stick moves the table · left stick click: beacon field" if xr_active \
		else "Click or tap to play · drag to slide, bend, strum · wheel turns dials · right-drag looks around · L lock · P patches · G beacon field"
	status.text = "Scale: %s\n%s" % [kit.scale.describe(), how]


# ---------------------------------------------------------------- patches on disk

func _load_patches() -> void:
	if not FileAccess.file_exists(PATCH_FILE):
		return
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATCH_FILE))
	if data is Dictionary:
		_saved_patches = data.get("patches", [])
		kit.scale.enabled = data.get("lock", true)
		kit.scale.root = int(data.get("root", 0))
		kit.scale.scale = data.get("scale", "major")


func _save_patches() -> void:
	if _shot != "":
		return # screenshots and tests leave the player's layout alone
	var f := FileAccess.open(PATCH_FILE, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify({"patches": kit.patches.to_array(), "lock": kit.scale.enabled, "root": kit.scale.root, "scale": kit.scale.scale}, " "))


# ---------------------------------------------------------------- XR

func _start_xr(real: bool) -> void:
	xr_active = true
	if real:
		get_viewport().use_xr = true
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	pointer.enabled = false
	ui.visible = false
	origin = XROrigin3D.new()
	add_child(origin)
	# Stand at the front edge of the table, facing it.
	origin.position = Vector3(0, 0, 0.75)
	xr_camera = XRCamera3D.new()
	origin.add_child(xr_camera)
	xr_camera.current = true
	xr_hands = PlayXRHands.new()
	add_child(xr_hands)
	for t in ["left_hand", "right_hand"]:
		var c := XRController3D.new()
		c.tracker = t
		c.name = t.capitalize().replace(" ", "")
		origin.add_child(c)
		var tip := MeshInstance3D.new()
		var s := SphereMesh.new()
		s.radius = 0.012
		s.height = 0.024
		tip.mesh = s
		tip.material_override = Playable.mat(Color("ffb547"), 1.5)
		tip.position = xr_hands.tip_offset
		c.add_child(tip)
		var body := MeshInstance3D.new()
		var b := BoxMesh.new()
		b.size = Vector3(0.035, 0.03, 0.1)
		body.mesh = b
		body.material_override = Playable.mat(Color("3a4a5c"))
		body.position = Vector3(0, 0, 0.02)
		c.add_child(body)
		controllers.append(c)
		xr_hands.add_controller(c)
	controllers[0].button_pressed.connect(func(a):
		if a == "menu_button":
			_toggle_passthrough()
		elif a == "primary_click":
			get_tree().change_scene_to_file("res://scenes/xr_field.tscn"))
	if not real:
		xr_hands.enabled = true
		xr_camera.position = Vector3(0, 1.45, 0)
		xr_camera.rotation_degrees = Vector3(-42, 0, 0)
		controllers[0].position = Vector3(-0.3, 0.95, -0.55)
		controllers[0].rotation_degrees = Vector3(-30, 10, 0)
		controllers[1].position = Vector3(0.2, 0.92, -0.62)
		controllers[1].rotation_degrees = Vector3(-50, -15, 0)
	_update_status()


func _toggle_passthrough() -> void:
	if xr == null or not xr.get_supported_environment_blend_modes().has(XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND):
		return
	passthrough = not passthrough
	xr.environment_blend_mode = XRInterface.XR_ENV_BLEND_MODE_ALPHA_BLEND if passthrough else XRInterface.XR_ENV_BLEND_MODE_OPAQUE
	get_viewport().transparent_bg = passthrough
	env.background_mode = Environment.BG_CLEAR_COLOR if passthrough else Environment.BG_COLOR
	RenderingServer.set_default_clear_color(Color(0, 0, 0, 0) if passthrough else BG)
	floor_mesh.visible = not passthrough


func _process(delta: float) -> void:
	if xr_active and controllers.size() == 2:
		# Right stick up/down raises or lowers the table (sitting, standing, kids).
		var stick := controllers[1].get_vector2("primary")
		if absf(stick.y) > 0.3:
			rig.position.y = clampf(rig.position.y + stick.y * 0.3 * delta, 0.4, 1.4)
	if _shot != "" and _shot != "none":
		_frames -= 1
		if _frames <= 0:
			var img := get_viewport().get_texture().get_image()
			DirAccess.make_dir_recursive_absolute(_shot.get_base_dir())
			img.save_png(_shot)
			print("screenshot: ", _shot)
			get_tree().quit()


# ---------------------------------------------------------------- dev

func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot = a.trim_prefix("--shot=")
		elif a.begins_with("--frames="):
			_frames = int(a.trim_prefix("--frames="))
		elif a == "--demo":
			_demo = true


## Holds a few things down at once so a screenshot shows the objects in use.
func _run_demo() -> void:
	var press := func(n: String, local: Vector3, id: int) -> void:
		var p: Playable = objects[n]
		var h := PlayHand.new("mouse", id)
		h.position = p.global_transform * local
		h.pressed = true
		p.hand_down(h)
		h.position = p.global_transform * (local + Vector3(0, 0.06, 0.0))
		p.hand_move(h)
	press.call("Orb", Vector3(0.05, 0.2, 0), 1)
	press.call("Blocks", Vector3(-0.1, 0.04, 0), 2)
	press.call("Ribbon", Vector3(0.1, 0.01, 0), 3)
	(objects["Flywheel"] as Flywheel).spin(2.0)
	var mb := objects["MusicBox"] as MusicBoxWheel
	for c in [Vector2i(0, 0), Vector2i(2, 4), Vector2i(4, 8), Vector2i(1, 12), Vector2i(5, 2), Vector2i(3, 10)]:
		mb.toggle_peg(c)
	mb.spin(0.4)
	(objects["Tilt"] as TiltCube).set_tilt(0.3, -0.2)
	(objects["XY"] as XYPad).set_xy(0.7, 0.3)


## Back to the field the player came from (Map button, G, Android's back gesture).
func _back_to_field() -> void:
	get_tree().quit_on_go_back = true
	get_tree().change_scene_to_file(FieldPrefs.scene_for(FieldPrefs.field()))


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST:
		_back_to_field()
