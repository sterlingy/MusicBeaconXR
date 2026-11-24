extends Node
## Renders a 1920x1080 hero image of the project: the Instrument Table being
## played, standing in the beacon field with its glowing beacons and blend lines.
## Off-screen (a SubViewport), so the size doesn't depend on the window.
##
## godot --path . res://tools/hero_shot.tscn -- --out=<file.png>
##   [--tscale=6] [--at=x,y] [--aim=x,y] [--dist=26] [--height=13] [--side=6]
##   [--ahead=30] [--lookY=3] [--fov=40] [--frames=90] [--labels] [--title=Name]

var out := "user://hero.png"
var tscale := 6.0
## Field spot the table faces (the key beacon, C3, is at the origin).
var aim := Vector2(0, 0)
## Camera: behind the table, `dist` back, `height` up, `side` to the right (meters).
var dist := 26.0
var height := 13.0
var side := 6.0
## Where it looks: this far past the table toward the aim, this high.
var look_ahead := 30.0
var look_y := 3.0
var fov := 40.0
var frames := 90
var labels := false
## Optional title over the image ("" = none).
var title := ""
var listener_at := Vector2(-38, 27)
var size := Vector2i(1920, 1080)

var vp: SubViewport
var field: Node
var table: Node3D


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.trim_prefix("--").split("=", true, 1)
		match kv[0]:
			"out": out = kv[1]
			"tscale": tscale = float(kv[1])
			"aim":
				var ap := kv[1].split(",")
				aim = Vector2(float(ap[0]), float(ap[1]))
			"dist": dist = float(kv[1])
			"height": height = float(kv[1])
			"side": side = float(kv[1])
			"ahead": look_ahead = float(kv[1])
			"lookY": look_y = float(kv[1])
			"fov": fov = float(kv[1])
			"frames": frames = int(kv[1])
			"labels": labels = true
			"title": title = kv[1]
			"at":
				var xy := kv[1].split(",")
				listener_at = Vector2(float(xy[0]), float(xy[1]))
	vp = SubViewport.new()
	vp.size = size
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)

	field = load("res://scenes/beacon_field.tscn").instantiate()
	vp.add_child(field)
	field.input.jump_to(listener_at)
	Transport.metronome_on = false
	Transport.count_in_bars = 0
	Transport.start()

	table = load("res://scenes/instrument_table.tscn").instantiate()
	table.set("_shot", "none") # never saves patches
	vp.add_child(table)
	_strip_table()
	# The table is the listener: it stands where they are and faces the key beacon.
	var here := Vector3(listener_at.x, 0, listener_at.y)
	var dir := Vector3(aim.x - listener_at.x, 0, aim.y - listener_at.y).normalized()
	var right := Vector3(-dir.z, 0, dir.x)
	table.scale = Vector3.ONE * tscale
	table.position = here
	table.rotation.y = atan2(-dir.x, -dir.z)
	table.call("_run_demo")
	_hide_ui(field)
	field.get("listener").visible = false
	_dress_sky(field.get("env"))

	var cam := Camera3D.new()
	cam.fov = fov
	cam.far = 3000
	vp.add_child(cam)
	cam.look_at_from_position(here - dir * dist + Vector3.UP * height + right * side, here + dir * look_ahead + Vector3.UP * look_y)
	cam.current = true
	if title != "":
		_add_title()


## Project name and a one-line description, top left, drawn into the image.
func _add_title() -> void:
	var layer := CanvasLayer.new()
	vp.add_child(layer)
	var box := VBoxContainer.new()
	box.position = Vector2(110, 52)
	box.add_theme_constant_override("separation", 2)
	layer.add_child(box)
	var name_l := Label.new()
	name_l.text = title
	name_l.add_theme_font_size_override("font_size", 84)
	name_l.add_theme_color_override("font_color", Color("ffb547"))
	name_l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	name_l.add_theme_constant_override("shadow_offset_y", 3)
	box.add_child(name_l)
	var sub := Label.new()
	sub.text = "Walk between beacons and hear their songs blend.\nPlay the instruments with your hands, on screen, in VR and in AR."
	sub.add_theme_font_size_override("font_size", 28)
	sub.add_theme_color_override("font_color", Color("c9d3df"))
	sub.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	sub.add_theme_constant_override("shadow_offset_y", 2)
	box.add_child(sub)


## A dark night gradient with a faint blue horizon, fog that fades into it, more bloom.
func _dress_sky(env: Environment) -> void:
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color("04070b")
	sm.sky_horizon_color = Color("1a2736")
	sm.ground_horizon_color = Color("1a2736")
	sm.ground_bottom_color = Color("04070b")
	sm.sun_angle_max = 0.0
	var sky := Sky.new()
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.fog_light_color = Color("16212d")
	env.fog_density = 0.0035
	env.glow_intensity = 1.1
	env.glow_bloom = 0.22


## The table scene brings its own sky, floor, light, camera and panel: the field has those.
func _strip_table() -> void:
	for c in table.get_children():
		if c is WorldEnvironment or c is CanvasLayer or c is Camera3D or c is DirectionalLight3D:
			c.queue_free()
	table.get("floor_mesh").queue_free()
	if table.get("cam"):
		table.get("cam").current = false


func _hide_ui(n: Node) -> void:
	for c in n.get_children():
		if c is CanvasLayer or c is Control:
			c.visible = false
		_hide_ui(c)


func _hide_labels(n: Node) -> void:
	for c in n.get_children():
		if c is Label3D:
			c.visible = false
		_hide_labels(c)


func _process(_delta: float) -> void:
	if not labels:
		_hide_labels(vp)
	frames -= 1
	if frames == 0:
		var img := vp.get_texture().get_image()
		img.save_png(out)
		print("hero: ", out, " ", img.get_size())
		get_tree().quit()
