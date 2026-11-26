extends Node3D
## 3D beacon field: the 5x5 test grid, or the local grid around you, as
## pillars on a plane, a listener you walk around, and the blend playing on
## SynthKit. The starting point for the XR version (scenes/xr_field.tscn).
##
## Which one it shows comes from FieldPrefs (the ☰ Fields panel). The local
## grid follows the device's location (GeoLocation), makes each beacon's song
## as it comes near (SongGen, the same songs as the website), and re-centers
## as you travel. Its beacons can be a kilometer apart, so the view is scaled
## to the spacing (`view_scale`): the scene always looks like the test grid.
##
## Controls: WASD / arrows walk, click the ground to walk there, Space play/stop,
## T auto-walk, mouse wheel zoom, F the Fields panel.
## Dev: `-- --shot=<path> [--frames=N] [--pos=x,y] [--play] [--field=grid|local] [--at=lat,lon] [--menu]`
## saves a screenshot and quits.

const MOOD_COLOR := {"Drift": Color("8fa7ff"), "Glow": Color("f5c04a"), "Tide": Color("2ec4b6"), "Pulse": Color("ff4f9a"), "Rush": Color("ff8a3d")}
const ACCENT := Color("ffb547")
const WALK_SPEED := 55.0 # view units per second (meters on the test grid)
## Local grid: pillars are built this many rows and columns around the listener.
const WINDOW := 4

var player: BeaconPlayer
var listener: MeshInstance3D
var camera: Camera3D
var lines: MeshInstance3D
var pillars := {} # beacon id -> {root, mesh, mat, ring, rmat, label, color}
var flashes := {} # beacon id -> seconds left
var input: ListenerInput
var zoom := 0.7
var env: Environment
var ground: MeshInstance3D
var grid_lines: MeshInstance3D
var hud: BeaconHud
var menu: FieldMenu
var geo: GeoLocation

## "grid" (the 5x5 test grid) or "local".
var kind := "grid"
## View units per meter: 1 on the test grid, 100 / spacing on a local grid.
var view_scale := 1.0
var _window_at := Vector2i(-1000000, 0)
var _fixed := false # the local grid has been centered on a real location
var _recheck := 0.0

var _shot := ""
var _frames := 60


func _ready() -> void:
	kind = "local" if FieldPrefs.field() == "local" else "grid"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--field="):
			kind = a.trim_prefix("--field=")
	_build_world()
	player = BeaconPlayer.new()
	player.name = "BeaconPlayer"
	if kind == "local":
		player.field = _make_local(FieldPrefs.last_lat(), FieldPrefs.last_lon())
		player.song_source = func(id: String) -> Dictionary: return SongGen.generate("local:" + id)
	add_child(player)
	if kind == "grid":
		player.load_songs("res://songs/grid.json")
	player.note_played.connect(func(_role, id): flashes[id] = 0.25)
	hud = BeaconHud.new(player)
	if kind == "local":
		hud.title_text = "MUSIC BEACON XR · LOCAL"
	add_child(hud)
	menu = FieldMenu.new(kind)
	add_child(menu)
	_build_input()
	_build_walks()
	if kind == "grid":
		_build_beacons()
		input.jump_to(Vector2(-38, 27))
	else:
		input.jump_to(player.field.from_lat_lon(FieldPrefs.last_lat(), FieldPrefs.last_lon()))
		_start_local()
	_parse_args()


func _make_local(lat: float, lon: float) -> BeaconField:
	var f := BeaconField.make_local(lat, lon, FieldPrefs.local_km(), FieldPrefs.spacing_km())
	view_scale = 100.0 / f.spacing
	return f


## Walking comes from ListenerKit (keyboard / gamepad, click or tap, wander); this
## scene only listens for the position and the commands. Positions are meters.
func _build_input() -> void:
	input = ListenerInput.new()
	input.name = "ListenerInput"
	_set_space()
	input.add_child(KeyboardSource.new())
	var ptr := PointerSource.new()
	ptr.camera = camera
	var ground_pick := PointerSource.ground_picker(0.0)
	ptr.pick = func(origin: Vector3, dir: Vector3) -> Variant:
		var hit = ground_pick.call(origin, dir)
		return null if hit == null else hit / view_scale
	input.add_child(ptr)
	add_child(input)
	input.moved.connect(player.set_position)
	input.action.connect(_on_action)


func _set_space() -> void:
	var f := player.field
	var m := 2.5 * f.spacing if kind == "grid" else (f.steps / 2.0 + 0.5) * f.spacing
	input.space = ListenerSpace.planar(Rect2(-m, -m, 2 * m, 2 * m), WALK_SPEED / view_scale)


func _on_action(name: String, arg: Variant) -> void:
	match name:
		"toggle_play":
			Transport.toggle()
		"switch_scene":
			menu.go_field("globe")
		"zoom":
			zoom = clampf(zoom * float(arg), 0.35, 2.0)
		"select":
			# A tap near a beacon walks onto it, like the browser playfield.
			var near: Array = player.field.nearest(arg, 1)
			if not near.is_empty() and near[0].d < 14.0 / view_scale:
				input.set_target(near[0].beacon.pos)


# ---------------------------------------------------------------- local grid

func _start_local() -> void:
	geo = GeoLocation.new()
	add_child(geo)
	geo.located.connect(_on_located)
	geo.unavailable.connect(func(reason: String):
		menu.set_status(reason + " The grid stays where it was last (London before the first fix)."))
	menu.local_changed.connect(func(): _recenter(_here(), "Rebuilt the grid around you."))
	menu.center_requested.connect(func():
		_fixed = false
		menu.set_status("Finding you…")
		geo.start())
	menu.follow_changed.connect(func(on: bool):
		if on:
			_fixed = false
			geo.start()
		else:
			geo.stop()
			menu.set_status("Not following your location: walk anywhere."))
	if FieldPrefs.follow():
		menu.set_status("Finding you… (allow location if Android asks)")
		geo.start()


## Where the listener is, as {lat, lon}.
func _here() -> Dictionary:
	return player.field.to_lat_lon(player.pos)


func _on_located(lat: float, lon: float, accuracy_m: float) -> void:
	if not FieldPrefs.follow() and _fixed:
		return
	FieldPrefs.set_place(lat, lon)
	var f := player.field
	var q := f.from_lat_lon(lat, lon)
	var lim := maxf(0.6 * f.spacing, 0.4 * f.side_m)
	if _fixed and absf(q.x) < lim and absf(q.y) < lim:
		input.jump_to(q)
		return
	var first := not _fixed
	_fixed = true
	if not FieldPrefs.follow():
		geo.stop() # "Center on me" with following off: one fix is enough
	_recenter({"lat": lat, "lon": lon}, "Centered on you (accurate to %s). Following your location." % _dist(accuracy_m) if first else "")


## Rebuilds the local grid around (lat, lon) and puts the listener there. Beacon
## ids are worldwide, so beacons the old and new grids share keep their songs.
func _recenter(at: Dictionary, message := "") -> void:
	player.set_field(_make_local(at.lat, at.lon))
	for id in pillars.keys():
		pillars[id].root.queue_free()
	pillars.clear()
	_window_at = Vector2i(-1000000, 0)
	_set_space()
	input.jump_to(player.field.from_lat_lon(at.lat, at.lon))
	if message != "":
		menu.set_status(message)


## Pillars only for the beacons around the listener: a local grid can have
## thousands. Rebuilt when the listener moves to another row or column.
func _update_window() -> void:
	var f := player.field
	var half := f.steps / 2.0
	var cell := Vector2i(clampi(roundi(half + player.pos.x / f.spacing), 0, f.n - 1), clampi(roundi(half + player.pos.y / f.spacing), 0, f.n - 1))
	if cell == _window_at:
		return
	_window_at = cell
	var want := {}
	for r in range(maxi(0, cell.y - WINDOW), mini(f.n - 1, cell.y + WINDOW) + 1):
		for k in range(maxi(0, cell.x - WINDOW), mini(f.n - 1, cell.x + WINDOW) + 1):
			var b: Dictionary = f.beacons[r * f.n + k]
			want[b.id] = true
			if not pillars.has(b.id):
				_add_pillar(b)
	for id in pillars.keys():
		if not want.has(id):
			pillars[id].root.queue_free()
			pillars.erase(id)


static func _dist(m: float) -> String:
	return "%d m" % roundi(m) if m < 1000.0 else "%.1f km" % (m / 1000.0)


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_CLOSE_REQUEST or what == NOTIFICATION_APPLICATION_PAUSED:
		if kind == "local" and player:
			var at := _here()
			FieldPrefs.set_place(at.lat, at.lon)


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

	# Grid lines every 100 view units (a beacon spacing), plus a finer quarter grid.
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
		_add_pillar(b)


func _add_pillar(b: Dictionary) -> void:
	var song: Dictionary = player.song_for(b.id)
	var col: Color = MOOD_COLOR.get(song.get("mood", ""), Color.WHITE)
	var root := Node3D.new()
	root.position = Vector3(b.pos.x * view_scale, 0, b.pos.y * view_scale)
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
	label.text = "%s\n%s" % [b.label, song.get("title", "")]
	label.position.y = 24.0
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.font_size = 64
	label.pixel_size = 0.08
	label.outline_size = 12
	label.modulate = Color(0.9, 0.93, 0.97)
	label.outline_modulate = Color("0b1016")
	root.add_child(label)
	pillars[b.id] = {"root": root, "mesh": mesh, "mat": mat, "ring": ring, "rmat": rmat, "label": label, "color": col}


# ---------------------------------------------------------------- update

func _process(delta: float) -> void:
	if kind == "local":
		_update_window()
		_check_edge(delta)
	_update_camera(delta)
	_update_world(delta)
	_check_shot()


## Walking (not GPS) toward the edge of a local grid re-centers it on the
## listener, so the grid never runs out.
func _check_edge(delta: float) -> void:
	_recheck -= delta
	if _recheck > 0.0:
		return
	_recheck = 0.5
	var f := player.field
	var lim := maxf(0.6 * f.spacing, 0.4 * f.side_m)
	if absf(player.pos.x) > lim or absf(player.pos.y) > lim:
		_recenter(_here())


func _view_pos() -> Vector2:
	return player.pos * view_scale


func _update_camera(delta: float) -> void:
	var p := _view_pos()
	# Look a little left of the listener so the HUD panel doesn't cover the beacons around them.
	var cam_target := Vector3(p.x - 40.0 * zoom, 0, p.y)
	camera.position = camera.position.lerp(cam_target + Vector3(0, 230, 210) * zoom, minf(1.0, delta * 4.0)) if camera.position != Vector3.ZERO else cam_target + Vector3(0, 230, 210) * zoom
	camera.look_at(cam_target + Vector3(0, 0, -20))


## Listener marker, blend lines, beacon glow and the HUD hint: everything but the camera.
func _update_world(delta: float) -> void:
	var p := _view_pos()
	listener.position = Vector3(p.x, 6.0 + sin(Time.get_ticks_msec() / 300.0) * 0.6, p.y)
	if kind == "local":
		# The floor and its lines move with the listener (snapped to a spacing).
		var snap := Vector3(snappedf(p.x, 100.0), 0, snappedf(p.y, 100.0))
		ground.position = snap
		grid_lines.position = snap
	_draw_lines()
	_draw_trail()
	_update_beacons(delta)
	hud.help_text = help_text()


func help_text() -> String:
	return "WASD walk · click to go · T auto-walk%s · wheel zoom · F fields · I instruments · M click" % (" (on)" if input.wander else "")


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
	var lp := _view_pos()
	var from := Vector3(lp.x, 0.4, lp.y)
	for a in player.active:
		if not pillars.has(a.id):
			continue
		var to := Vector3(a.beacon.pos.x * view_scale, 0.4, a.beacon.pos.y * view_scale)
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
		elif a.begins_with("--at=") and kind == "local":
			var ll := a.trim_prefix("--at=").split(",")
			_fixed = true
			_recenter({"lat": float(ll[0]), "lon": float(ll[1])})
		elif a == "--play":
			Transport.metronome_on = false
			Transport.count_in_bars = 0
			Transport.start()
		elif a.begins_with("--solo="):
			player.set_soloed(a.trim_prefix("--solo="), true)
		elif a == "--wander":
			input.wander = true
		elif a == "--menu":
			menu.set_open(true)


# ---------------------------------------------------------------- walks: trail

var walks: BeaconWalks
var trail_mesh: MeshInstance3D


func _build_walks() -> void:
	walks = BeaconWalks.new()
	walks.player = player
	walks.input = input
	add_child(walks)
	trail_mesh = MeshInstance3D.new()
	trail_mesh.mesh = ImmediateMesh.new()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	trail_mesh.material_override = m
	add_child(trail_mesh)


## The trail of where you've been (and a replaying walk's path) as a ribbon on the floor.
func _draw_trail() -> void:
	var im: ImmediateMesh = trail_mesh.mesh
	im.clear_surfaces()
	var any := false
	var lp := _view_pos()
	for line in walks.lines():
		var prev = null
		for pt in line.pts:
			var fp := BeaconWalks.field_pos(player.field, pt.p) * view_scale
			var here := Vector3(fp.x, 0.25, fp.y)
			if prev != null and (here - prev).length() < 2000.0 and Vector2(fp.x - lp.x, fp.y - lp.y).length() < 3000.0:
				if not any:
					im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
					any = true
				var col: Color = Color.WHITE if line.replay else MOOD_COLOR.get(pt.m, Color(0.6, 0.6, 0.6))
				col.a = 0.55 if line.replay else 0.8
				var side: Vector3 = (here - prev).cross(Vector3.UP).normalized() * (0.8 if line.replay else 1.4)
				for v in [prev - side, prev + side, here + side, prev - side, here + side, here - side]:
					im.surface_set_color(col)
					im.surface_add_vertex(v)
			prev = here
	if any:
		im.surface_end()
