extends Node3D
## 3D beacon field: the 5x5 test grid as pillars on a plane, a listener you
## walk around, and the blend playing on SynthKit. The starting point for the
## XR version (scenes/xr_field.tscn).
##
## Controls: WASD / arrows walk, click the ground to walk there, Space play/stop,
## T auto-walk, mouse wheel zoom.
## Dev: `-- --shot=<path> [--frames=N] [--pos=x,y] [--play]` saves a screenshot and quits.

const MOOD_COLOR := {"Drift": Color("8fa7ff"), "Glow": Color("f5c04a"), "Tide": Color("2ec4b6"), "Pulse": Color("ff4f9a"), "Rush": Color("ff8a3d")}
const ACCENT := Color("ffb547")
const WALK_SPEED := 55.0 # meters per second

var player: BeaconPlayer
var listener: MeshInstance3D
var camera: Camera3D
var lines: MeshInstance3D
var pillars := {} # beacon id -> {mesh, mat, light, label}
var flashes := {} # beacon id -> seconds left
var input: ListenerInput
var zoom := 0.7
var env: Environment
var ground: MeshInstance3D
var grid_lines: MeshInstance3D
var hud: BeaconHud

var _shot := ""
var _frames := 60


func _ready() -> void:
	_build_world()
	player = BeaconPlayer.new()
	player.name = "BeaconPlayer"
	add_child(player)
	player.load_songs("res://songs/grid.json")
	player.note_played.connect(func(_role, id): flashes[id] = 0.25)
	_build_beacons()
	hud = BeaconHud.new(player)
	add_child(hud)
	_build_input()
	input.jump_to(Vector2(-38, 27))
	_parse_args()


## Walking comes from ListenerKit (keyboard / gamepad, click or tap, wander); this
## scene only listens for the position and the commands.
func _build_input() -> void:
	var m := 2.5 * player.field.spacing # half the grid plus half a spacing
	input = ListenerInput.new()
	input.name = "ListenerInput"
	input.space = ListenerSpace.planar(Rect2(-m, -m, 2 * m, 2 * m), WALK_SPEED)
	input.add_child(KeyboardSource.new())
	var ptr := PointerSource.new()
	ptr.camera = camera
	ptr.pick = PointerSource.ground_picker(0.0)
	input.add_child(ptr)
	add_child(input)
	input.moved.connect(player.set_position)
	input.action.connect(_on_action)


func _on_action(name: String, arg: Variant) -> void:
	match name:
		"toggle_play":
			Transport.toggle()
		"switch_scene":
			get_tree().change_scene_to_file("res://scenes/globe_field.tscn")
		"zoom":
			zoom = clampf(zoom * float(arg), 0.35, 2.0)
		"select":
			# A tap near a beacon walks onto it, like the browser playfield.
			var near: Array = player.field.nearest(arg, 1)
			if not near.is_empty() and near[0].d < 14.0:
				input.set_target(near[0].beacon.pos)


# ---------------------------------------------------------------- world

func _build_world() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("0b1016")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("3a4656")
	env.ambient_light_energy = 0.6
	env.glow_enabled = true
	env.glow_intensity = 0.8
	env.glow_bloom = 0.15
	env.fog_enabled = true
	env.fog_light_color = Color("0b1016")
	env.fog_density = 0.0016
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -35, 0)
	sun.light_energy = 0.7
	add_child(sun)

	ground = MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(1200, 1200)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color("121921")
	gm.roughness = 0.95
	ground.material_override = gm
	add_child(ground)

	# Grid lines every 100 m, plus a finer 25 m grid.
	var im := ImmediateMesh.new()
	var lm := StandardMaterial3D.new()
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.vertex_color_use_as_albedo = true
	lm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	im.surface_begin(Mesh.PRIMITIVE_LINES, lm)
	for k in range(-250, 251, 25):
		var major := k % 100 == 0 and absi(k) <= 200
		var c := Color(0.35, 0.45, 0.55, 0.45 if major else 0.12)
		for seg in [[Vector3(k, 0.05, -250), Vector3(k, 0.05, 250)], [Vector3(-250, 0.05, k), Vector3(250, 0.05, k)]]:
			im.surface_set_color(c)
			im.surface_add_vertex(seg[0])
			im.surface_set_color(c)
			im.surface_add_vertex(seg[1])
	im.surface_end()
	grid_lines = MeshInstance3D.new()
	grid_lines.mesh = im
	add_child(grid_lines)

	listener = MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 4.0
	cap.height = 12.0
	listener.mesh = cap
	var lmat := StandardMaterial3D.new()
	lmat.albedo_color = ACCENT
	lmat.emission_enabled = true
	lmat.emission = ACCENT
	lmat.emission_energy_multiplier = 0.6
	listener.material_override = lmat
	add_child(listener)

	lines = MeshInstance3D.new()
	lines.mesh = ImmediateMesh.new()
	var linemat := StandardMaterial3D.new()
	linemat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	linemat.vertex_color_use_as_albedo = true
	linemat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	linemat.cull_mode = BaseMaterial3D.CULL_DISABLED
	lines.material_override = linemat
	add_child(lines)

	camera = Camera3D.new()
	camera.fov = 50
	camera.far = 3000
	add_child(camera)


func _build_beacons() -> void:
	for b in player.field.beacons:
		var song: Dictionary = player.songs[b.id]
		var col: Color = MOOD_COLOR.get(song.get("mood", ""), Color.WHITE)
		var root := Node3D.new()
		root.position = Vector3(b.pos.x, 0, b.pos.y)
		add_child(root)
		var mesh := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 3.5
		cyl.bottom_radius = 5.0
		cyl.height = 14.0
		mesh.mesh = cyl
		mesh.position.y = 7.0
		var mat := StandardMaterial3D.new()
		mat.albedo_color = col.darkened(0.3)
		mat.emission_enabled = true
		mat.emission = col
		mat.emission_energy_multiplier = 0.4
		mesh.material_override = mat
		root.add_child(mesh)
		var ring := MeshInstance3D.new()
		var torus := TorusMesh.new()
		torus.inner_radius = 9.0
		torus.outer_radius = 10.0
		ring.mesh = torus
		ring.position.y = 0.3
		var rmat := StandardMaterial3D.new()
		rmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		rmat.albedo_color = Color(col, 0.0)
		rmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		ring.material_override = rmat
		root.add_child(ring)
		var label := Label3D.new()
		label.text = "%s\n%s" % [b.label, song.title]
		label.position.y = 24.0
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.font_size = 64
		label.pixel_size = 0.08
		label.outline_size = 12
		label.modulate = Color(0.9, 0.93, 0.97)
		label.outline_modulate = Color("0b1016")
		root.add_child(label)
		pillars[b.id] = {"mesh": mesh, "mat": mat, "ring": ring, "rmat": rmat, "label": label, "color": col}


# ---------------------------------------------------------------- update

func _process(delta: float) -> void:
	_update_camera(delta)
	_update_world(delta)
	_check_shot()


func _update_camera(delta: float) -> void:
	var p := player.pos
	# Look a little left of the listener so the HUD panel doesn't cover the beacons around them.
	var cam_target := Vector3(p.x - 40.0 * zoom, 0, p.y)
	camera.position = camera.position.lerp(cam_target + Vector3(0, 230, 210) * zoom, minf(1.0, delta * 4.0)) if camera.position != Vector3.ZERO else cam_target + Vector3(0, 230, 210) * zoom
	camera.look_at(cam_target + Vector3(0, 0, -20))


## Listener marker, blend lines, beacon glow and the HUD hint: everything but the camera.
func _update_world(delta: float) -> void:
	var p := player.pos
	listener.position = Vector3(p.x, 6.0 + sin(Time.get_ticks_msec() / 300.0) * 0.6, p.y)
	_draw_lines()
	_update_beacons(delta)
	hud.help_text = help_text()


func help_text() -> String:
	return "WASD walk · click to go · T auto-walk%s · wheel zoom · G globe · I instruments" % (" (on)" if input.wander else "")


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_I:
		get_tree().change_scene_to_file("res://scenes/instrument_table.tscn")


func _check_shot() -> void:
	if _shot != "":
		_frames -= 1
		if _frames <= 0:
			DirAccess.make_dir_recursive_absolute(_shot.get_base_dir())
			get_viewport().get_texture().get_image().save_png(_shot)
			print("screenshot: ", _shot)
			get_tree().quit()


func _draw_lines() -> void:
	var im: ImmediateMesh = lines.mesh
	im.clear_surfaces()
	if player.active.is_empty():
		return
	im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
	var from := Vector3(player.pos.x, 0.4, player.pos.y)
	for a in player.active:
		var to := Vector3(a.beacon.pos.x, 0.4, a.beacon.pos.y)
		var col: Color = pillars[a.id].color
		col.a = 0.25 + 0.7 * a.w
		var side: Vector3 = (to - from).cross(Vector3.UP).normalized() * (0.4 + 3.5 * float(a.w))
		for v in [from - side, from + side, to + side, from - side, to + side, to - side]:
			im.surface_set_color(col)
			im.surface_add_vertex(v)
	im.surface_end()


func _update_beacons(delta: float) -> void:
	var weights := {}
	for a in player.active:
		weights[a.id] = a.w
	for id in pillars:
		var pl: Dictionary = pillars[id]
		var w: float = weights.get(id, 0.0)
		var f: float = flashes.get(id, 0.0)
		if f > 0.0:
			flashes[id] = f - delta
		pl.mat.emission_energy_multiplier = 0.35 + 2.2 * w + 3.0 * maxf(f, 0.0)
		pl.mesh.scale = Vector3.ONE * (1.0 + 0.25 * w)
		pl.rmat.albedo_color.a = 0.15 + 0.75 * w
		var is_key: bool = id == player.harmony.id
		pl.ring.scale = Vector3.ONE * (1.25 if is_key else 1.0)


func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot = a.trim_prefix("--shot=")
		elif a.begins_with("--frames="):
			_frames = int(a.trim_prefix("--frames="))
		elif a.begins_with("--pos="):
			var xy := a.trim_prefix("--pos=").split(",")
			input.jump_to(Vector2(float(xy[0]), float(xy[1])))
		elif a == "--play":
			Transport.metronome_on = false
			Transport.count_in_bars = 0
			Transport.start()
		elif a == "--wander":
			input.wander = true
