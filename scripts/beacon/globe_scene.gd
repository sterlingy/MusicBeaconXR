extends Node3D
## The globe: a beacon every 10° of latitude and longitude (614 in all), each
## with its own song. Walk the surface; the three closest beacons blend.
##
## Controls: WASD / arrows / gamepad walk, click the globe to go there, 1-9 jump to cities, T auto-walk, wheel zoom,
## Space play/stop, G back to the test grid.
## My beacons (MyBeacons): your own grids, planted songs and custom maps,
## blended with the globe. Zoom in close (down to about 1 km) to see them.
## Dev: `-- --shot=<path> [--frames=N] [--at=lat,lon] [--alt=units] [--play] [--fakegps=lat,lon] [--drafts-demo]`.

const MOOD_COLOR := {"Drift": Color("8fa7ff"), "Glow": Color("f5c04a"), "Tide": Color("2ec4b6"), "Pulse": Color("ff4f9a"), "Rush": Color("ff8a3d")}
const ACCENT := Color("ffb547")
const R := 300.0 # globe radius in scene units
const WALK_DEG := 6.0 # degrees per second
## Closest zoom: about 1 km above the ground, to see your own beacons.
const MIN_ALT := 0.05
const CITIES := [["London", 51.507, -0.128], ["New York", 40.713, -74.006], ["Tokyo", 35.68, 139.69], ["Lagos", 6.524, 3.379],
	["São Paulo", -23.55, -46.63], ["Sydney", -33.87, 151.21], ["Reykjavík", 64.147, -21.94], ["Mumbai", 19.076, 72.878], ["North Pole", 89.5, 0.0]]

var player: BeaconPlayer
var hud: BeaconHud
var menu: FieldMenu
var camera: Camera3D
var listener: MeshInstance3D
var arcs: MeshInstance3D
var highlights := [] # 3 glowing pillars over the active beacons
var labels := [] # 3 labels for the active beacons
var input: ListenerInput
var altitude := 90.0
var _cam_basis := Basis.IDENTITY
var _shot := ""
var _frames := 60
var _status := ""
var mine: MyBeacons
var user_mesh: MultiMeshInstance3D
var outlines: MeshInstance3D
var _drawn_pool := {} # the pool the user beacons were last drawn from
var _drawn_at := Vector2(INF, INF)


static func to_world(lat: float, lon: float, r := R) -> Vector3:
	var la := deg_to_rad(lat)
	var lo := deg_to_rad(lon)
	return Vector3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo)) * r


func _ready() -> void:
	_build_world()
	player = BeaconPlayer.new()
	player.field = BeaconField.make_globe()
	add_child(player)
	player.load_songs("res://songs/globe.json")
	_build_beacons()
	hud = BeaconHud.new(player)
	hud.title_text = "MUSIC BEACON XR · GLOBE"
	add_child(hud)
	menu = FieldMenu.new("globe")
	add_child(menu)
	mine = MyBeacons.new()
	mine.player = player
	add_child(mine)
	mine.go_to.connect(_go_to)
	_build_user_beacons()
	_build_input()
	_build_walks()
	input.jump_to(Vector2(-0.128, 51.507))
	_start_follow()
	_parse_args()


## Walking comes from ListenerKit: keyboard / gamepad, click or tap the globe, wander.
func _build_input() -> void:
	input = ListenerInput.new()
	input.name = "ListenerInput"
	input.space = ListenerSpace.geo(WALK_DEG)
	input.add_child(KeyboardSource.new())
	var ptr := PointerSource.new()
	ptr.camera = camera
	ptr.pick = PointerSource.sphere_picker(R, PointerSource.unit_to_lonlat)
	ptr.send_select = true # a tap places a map beacon while placing (MyBeacons)
	input.add_child(ptr)
	add_child(input)
	input.moved.connect(player.set_position)
	input.action.connect(_on_action)


func _on_action(name: String, arg: Variant) -> void:
	match name:
		"toggle_play":
			Transport.toggle()
		"switch_scene":
			menu.go_field("grid")
		"zoom":
			altitude = clampf(altitude * float(arg), MIN_ALT, 900.0)
		"select":
			mine.place_at(arg.x, arg.y)
		"jump":
			var c: Array = CITIES[int(arg)]
			input.jump_to(Vector2(c[2], c[1]))
			_status = "Jumped to " + c[0]


func _build_world() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("070a0f")
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("44526a")
	env.ambient_light_energy = 0.7
	env.glow_enabled = true
	env.glow_intensity = 0.9
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-30, 40, 0)
	sun.light_energy = 0.8
	add_child(sun)

	var globe := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = R
	sm.height = R * 2
	sm.radial_segments = 96
	sm.rings = 48
	globe.mesh = sm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color("142030")
	gm.roughness = 0.9
	globe.material_override = gm
	add_child(globe)

	# Graticule every 10°, equator and prime meridian brighter.
	var im := ImmediateMesh.new()
	var lm := StandardMaterial3D.new()
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.vertex_color_use_as_albedo = true
	lm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	im.surface_begin(Mesh.PRIMITIVE_LINES, lm)
	for lat in range(-80, 90, 10):
		var c := Color(0.45, 0.6, 0.75, 0.5 if lat == 0 else 0.16)
		for k in 120:
			for t in [k, k + 1]:
				im.surface_set_color(c)
				im.surface_add_vertex(to_world(lat, -180.0 + t * 3.0, R + 0.3))
	for lon in range(-180, 180, 10):
		var c := Color(0.45, 0.6, 0.75, 0.5 if lon == 0 else 0.16)
		for k in 60:
			for t in [k, k + 1]:
				im.surface_set_color(c)
				im.surface_add_vertex(to_world(-90.0 + t * 3.0, lon, R + 0.3))
	im.surface_end()
	var grat := MeshInstance3D.new()
	grat.mesh = im
	add_child(grat)

	listener = MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 2.2
	cap.height = 7.0
	listener.mesh = cap
	var lmat := StandardMaterial3D.new()
	lmat.albedo_color = ACCENT
	lmat.emission_enabled = true
	lmat.emission = ACCENT
	lmat.emission_energy_multiplier = 1.0
	listener.material_override = lmat
	add_child(listener)

	arcs = MeshInstance3D.new()
	arcs.mesh = ImmediateMesh.new()
	var am := StandardMaterial3D.new()
	am.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	am.vertex_color_use_as_albedo = true
	am.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	am.cull_mode = BaseMaterial3D.CULL_DISABLED
	arcs.material_override = am
	add_child(arcs)

	camera = Camera3D.new()
	camera.fov = 50
	camera.far = 4000
	add_child(camera)


func _build_beacons() -> void:
	# All 614 beacons in one MultiMesh, tinted by their song's mood.
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var cyl := CylinderMesh.new()
	cyl.top_radius = 1.4
	cyl.bottom_radius = 2.0
	cyl.height = 6.0
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.emission_enabled = true
	mat.emission = Color(0.25, 0.25, 0.25)
	cyl.material = mat
	mm.mesh = cyl
	var beacons := player.field.beacons
	mm.instance_count = beacons.size()
	for i in beacons.size():
		var b: Dictionary = beacons[i]
		mm.set_instance_transform(i, _surface_xform(b.pos.y, b.pos.x, 3.0))
		mm.set_instance_color(i, MOOD_COLOR.get(player.songs[b.id].get("mood", ""), Color.WHITE))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	add_child(mmi)
	for i in 3:
		var hl := MeshInstance3D.new()
		var hc := CylinderMesh.new()
		hc.top_radius = 2.0
		hc.bottom_radius = 2.8
		hc.height = 10.0
		hl.mesh = hc
		var hm := StandardMaterial3D.new()
		hm.emission_enabled = true
		hl.material_override = hm
		add_child(hl)
		highlights.append(hl)
		var lab := Label3D.new()
		lab.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		lab.font_size = 48
		lab.pixel_size = 0.06
		lab.outline_size = 10
		lab.outline_modulate = Color("070a0f")
		lab.no_depth_test = true
		add_child(lab)
		labels.append(lab)


## A transform standing on the surface at lat/lon, `lift` units up, y along the normal.
func _surface_xform(lat: float, lon: float, lift: float) -> Transform3D:
	var up := to_world(lat, lon, 1.0)
	var east := Vector3.UP.cross(up)
	if east.length() < 1e-4:
		east = Vector3.RIGHT
	east = east.normalized()
	var north := up.cross(east).normalized()
	return Transform3D(Basis(east, up, -north), up * (R + lift))


## Markers are sized for the whole globe; up close they shrink with the camera.
func _k() -> float:
	var a := minf(1.0, altitude / 90.0)
	return a * clampf(a * 3.0, 0.25, 1.0)


func _process(delta: float) -> void:
	# Following a flight: the plane drives the listener (walking is paused meanwhile).
	if mine.flight.active():
		var fp := mine.flight.position()
		input.process_mode = Node.PROCESS_MODE_DISABLED
		if not fp.is_empty():
			player.set_position(Vector2(fp.lon, fp.lat))
	elif input.process_mode == Node.PROCESS_MODE_DISABLED and walks.replay.is_empty():
		input.process_mode = Node.PROCESS_MODE_INHERIT
		input.jump_to(player.pos)
	var p := player.pos # (lon, lat)
	var up := to_world(p.y, p.x, 1.0)
	var k := _k()
	listener.transform = _surface_xform(p.y, p.x, 3.5 * k).scaled_local(Vector3.ONE * k)
	camera.near = clampf(altitude * 0.01, 0.0005, 0.05)
	input.space.walk_speed = WALK_DEG * maxf(0.002, k)
	_draw_user_beacons()
	_draw_trail()
	# Camera: above and a little south of the listener, north at the top of the screen.
	var east := Vector3.UP.cross(up)
	if east.length() < 1e-3:
		east = _cam_basis.x if _cam_basis.x != Vector3.ZERO else Vector3.RIGHT
	east = east.normalized()
	var north := up.cross(east).normalized()
	_cam_basis = Basis(east, north, up)
	var cam_pos := up * (R + altitude) - north * altitude * 0.55
	camera.position = camera.position.lerp(cam_pos, minf(1.0, delta * 5.0)) if camera.position.length() > 1.0 else cam_pos
	camera.look_at(up * R + north * altitude * 0.1, north)
	_update_active()
	_draw_arcs()
	hud.help_text = "WASD walk · click to go · 1-9 cities · T auto-walk%s · wheel zoom · G grid%s" % [" (on)" if input.wander else "", ("  ·  " + _status) if _status != "" else ""]
	if _shot != "":
		_frames -= 1
		if _frames <= 0:
			DirAccess.make_dir_recursive_absolute(_shot.get_base_dir())
			get_viewport().get_texture().get_image().save_png(_shot)
			print("screenshot: ", _shot)
			get_tree().quit()


func _update_active() -> void:
	for i in 3: # the three loudest (the player sorts both layers loudest first)
		var hl: MeshInstance3D = highlights[i]
		var lab: Label3D = labels[i]
		if i >= player.active.size():
			hl.visible = false
			lab.visible = false
			continue
		var a: Dictionary = player.active[i]
		var col: Color = MOOD_COLOR.get(a.song.get("mood", ""), Color.WHITE)
		hl.visible = true
		hl.transform = _surface_xform(a.beacon.pos.y, a.beacon.pos.x, 5.0 * _k())
		hl.scale = Vector3.ONE * (0.8 + 0.6 * a.w) * _k()
		var m: StandardMaterial3D = hl.material_override
		m.albedo_color = col
		m.emission = col
		m.emission_energy_multiplier = 0.5 + 3.0 * a.w + (1.0 if a.id == player.harmony.id else 0.0)
		# Neighbouring beacons' labels mustn't collide: name and share only (the
		# panel has the coordinates), quieter ones smaller and lower.
		lab.visible = a.w >= 0.03
		lab.position = to_world(a.beacon.pos.y, a.beacon.pos.x, R + (14.0 + 10.0 * a.w) * _k())
		lab.pixel_size = 0.06 * _k() * (0.7 + 0.3 * a.w)
		lab.text = "%s\n%d%%" % [a.song.title, roundi(a.w * 100)]
		lab.modulate = Color.WHITE.lerp(col, 0.35)


func _draw_arcs() -> void:
	var im: ImmediateMesh = arcs.mesh
	im.clear_surfaces()
	if player.active.is_empty():
		return
	var from := to_world(player.pos.y, player.pos.x, 1.0)
	im.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
	for a in player.active:
		var to := to_world(a.beacon.pos.y, a.beacon.pos.x, 1.0)
		var col: Color = MOOD_COLOR.get(a.song.get("mood", ""), Color.WHITE)
		col.a = 0.3 + 0.7 * float(a.w)
		var width := (0.4 + 2.5 * float(a.w)) * _k()
		var n := 24
		for k in n:
			var p0 := from.slerp(to, float(k) / n)
			var p1 := from.slerp(to, float(k + 1) / n)
			var side := (p1 - p0).cross(p0).normalized() * width
			var q0 := p0 * (R + _k())
			var q1 := p1 * (R + _k())
			for v in [q0 - side, q0 + side, q1 + side, q0 - side, q1 + side, q1 - side]:
				im.surface_set_color(col)
				im.surface_add_vertex(v)
	im.surface_end()


func _parse_args() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shot="):
			_shot = a.trim_prefix("--shot=")
		elif a.begins_with("--frames="):
			_frames = int(a.trim_prefix("--frames="))
		elif a.begins_with("--at="):
			var ll := a.trim_prefix("--at=").split(",")
			input.jump_to(Vector2(float(ll[1]), float(ll[0])))
		elif a.begins_with("--alt="):
			altitude = float(a.trim_prefix("--alt="))
		elif a.begins_with("--flight="):
			_follow_flight_dev(a.trim_prefix("--flight="))
		elif a == "--drafts-demo":
			_drafts_demo()
		elif a == "--play":
			Transport.metronome_on = false
			Transport.count_in_bars = 0
			Transport.start()


# ---------------------------------------------------------------- following the device's location

var _followed := false # had a fix since following started


## "Follow my location" (Fields) on the globe: the listener stands where the
## device is and moves with it; the first fix zooms in close. Paused while
## following a flight. Same setting as the local grid's.
func _start_follow() -> void:
	mine.geo.located.connect(_on_located)
	mine.geo.unavailable.connect(func(reason: String):
		if FieldPrefs.follow():
			menu.set_status("Can't follow your location: %s" % reason))
	menu.follow_changed.connect(func(on: bool):
		_followed = false
		if on:
			menu.set_status("Finding you… (allow location if Android asks)")
			mine.geo.start()
		else:
			menu.set_status("Not following your location: walk anywhere."))
	menu.center_requested.connect(func():
		_followed = false
		_centering = true
		menu.set_status("Finding you…")
		mine.geo.start())
	if FieldPrefs.follow():
		mine.geo.start()


var _centering := false # "Center on me": one jump even when not following


func _on_located(lat: float, lon: float, accuracy_m: float) -> void:
	if not (FieldPrefs.follow() or _centering) or mine.flight.active():
		return
	_centering = false
	if not _followed:
		_followed = true
		_go_to(lat, lon, 30.0)
		menu.set_status("Centered on you (accurate to %d m).%s" % [roundi(accuracy_m), " Following your location." if FieldPrefs.follow() else ""])
	else:
		input.jump_to(Vector2(lon, lat))


# ---------------------------------------------------------------- my beacons on the globe

func _go_to(lat: float, lon: float, span_km: float) -> void:
	input.jump_to(Vector2(lon, lat))
	if span_km > 0.0:
		altitude = clampf(span_km / BeaconField.EARTH_RADIUS_KM * R * 1.1, MIN_ALT, 900.0)


func _build_user_beacons() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.emission_enabled = true
	mat.emission = Color(0.3, 0.3, 0.3)
	box.material = mat
	mm.mesh = box
	user_mesh = MultiMeshInstance3D.new()
	user_mesh.multimesh = mm
	add_child(user_mesh)
	outlines = MeshInstance3D.new()
	outlines.mesh = ImmediateMesh.new()
	var lm := StandardMaterial3D.new()
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.vertex_color_use_as_albedo = true
	outlines.material_override = lm
	add_child(outlines)


## Redraws your beacons near the listener when they change or you travel far.
func _draw_user_beacons() -> void:
	var pool: Dictionary = mine.drafts.pool
	var p := player.pos
	if is_same(pool, _drawn_pool) and absf(p.x - _drawn_at.x) < 1.0 and absf(p.y - _drawn_at.y) < 1.0:
		return
	_drawn_pool = pool
	_drawn_at = p
	var near := []
	for e in pool.playing:
		if absf(e.lat - p.y) < 3.0 and absf(BeaconDrafts._wrap180(e.lon - p.x)) < 3.0:
			near.append(e)
	if near.size() > 8000:
		near.resize(8000)
	var mm := user_mesh.multimesh
	mm.instance_count = near.size()
	var unit := R / (BeaconField.EARTH_RADIUS_KM * 1000.0) # scene units per meter
	for i in near.size():
		var e: Dictionary = near[i]
		var gen: bool = e.kind == "gen" or e.kind == "edited"
		var s: float = (float(e.spacingM) * 0.3 if gen else 120.0) * unit
		var xf := _surface_xform(e.lat, e.lon, s * (0.5 if gen else 2.0))
		xf.basis = xf.basis.scaled_local(Vector3(s, s * (1.0 if gen else 4.0), s))
		mm.set_instance_transform(i, xf)
		var mood: Color = MOOD_COLOR.get(mine.drafts.song_of(e).get("mood", ""), Color.WHITE)
		mm.set_instance_color(i, mood.lerp(Color(e.tint), 0.35))
	var im: ImmediateMesh = outlines.mesh
	im.clear_surfaces()
	if mine.drafts.doc.grids.is_empty():
		return
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	for g in mine.drafts.doc.grids:
		var corners := BeaconDrafts.grid_outline(g)
		var col := Color(g.tint)
		col.a = 1.0 if g.on else 0.35
		for c in 4:
			var a: Dictionary = corners[c]
			var b: Dictionary = corners[(c + 1) % 4]
			for t in 8:
				for q in [t, t + 1]:
					im.surface_set_color(col)
					im.surface_add_vertex(to_world(lerpf(a.lat, b.lat, q / 8.0), lerpf(a.lon, b.lon, q / 8.0), R + 0.002))
	im.surface_end()


## Dev: a demo grid, planted song and map around --fakegps (for screenshots). Never saved.
func _drafts_demo() -> void:
	var d := mine.drafts
	d.path = ""
	if mine.fix.is_empty():
		mine.fix = {"lat": 30.2672, "lon": -97.7431, "accuracy": 10.0, "at": INF, "fake": true}
	d.doc = BeaconDrafts.empty_doc()
	d.doc.grids.append(d.make_grid(mine.fix.lat, mine.fix.lon, 500))
	var m := d.make_map("Lakeside walk")
	d.add_map_beacon(m, mine.fix.lat + 0.02, mine.fix.lon - 0.03, 1500)
	d.doc.maps.append(m)
	d.plant_song(mine.fix.lat, mine.fix.lon, SongGen.generate("demo:planted"), 800)
	mine._changed()
	mine._panel.visible = true
	_go_to(mine.fix.lat + 0.002, mine.fix.lon + 0.003, 14.0)


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
	trail_mesh.material_override = m
	add_child(trail_mesh)


## The trail (and a replaying walk's path) as lines just above the surface.
func _draw_trail() -> void:
	var im: ImmediateMesh = trail_mesh.mesh
	im.clear_surfaces()
	var lift := maxf(0.0005, 0.3 * _k())
	var any := false
	for line in walks.lines():
		var prev = null
		for pt in line.pts:
			var here := to_world(float(pt.p.lat), float(pt.p.lon), R + lift)
			if prev != null and (here - prev).length() < R * 0.2:
				if not any:
					im.surface_begin(Mesh.PRIMITIVE_LINES)
					any = true
				var col: Color = Color.WHITE if line.replay else MOOD_COLOR.get(pt.m, Color(0.7, 0.7, 0.7))
				col.a = 0.6 if line.replay else 0.9
				for v in [prev, here]:
					im.surface_set_color(col)
					im.surface_add_vertex(v)
			prev = here
	if any:
		im.surface_end()


## Dev: --flight=<tail or flight no.> starts following it (for screenshots).
func _follow_flight_dev(q: String) -> void:
	mine._flight_q.text = q
	mine._panel.visible = true
	mine._toggle_flight()
