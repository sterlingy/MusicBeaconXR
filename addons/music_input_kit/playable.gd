class_name Playable
extends Node3D
## Base for every 3D object you play. An object is a box in its own space
## (`box`) that hands touch: the drivers call hand_down / hand_move / hand_up
## with a PlayHand whose position is in world space, and the object turns that
## into notes and moves on the MusicInput hub. Part of MusicInputKit.
##
## Subclasses override _build() for their meshes and the three hand_* methods.
## They name their moving parts with declare("turn", "Dial turn", part, param)
## and move them with send("turn", 0..1), which goes through the patch bay.

## Emitted on every strike, pluck or press (for haptics, particles, tutorials).
signal touched(hand: PlayHand, strength: float)

## Which part (instrument role) the object's notes go to.
@export var part := "keys"
## The object's touchable volume, in its own space.
var box := AABB(Vector3(-0.15, 0, -0.15), Vector3(0.3, 0.1, 0.3))
## The hub (found through the "music_input" group when left empty).
var kit: MusicInput
## Hands currently on this object: hand id -> anything the object keeps.
var holds := {}
## Base color; each object tints its parts from it.
var tint := Color("ffb547")


func _ready() -> void:
	add_to_group("playables")
	if kit == null:
		kit = get_tree().get_first_node_in_group("music_input") as MusicInput
	_build()
	if kit:
		kit.scale.changed.connect(_on_scale_changed)
		_declare_sources()


## Make meshes and labels here.
func _build() -> void:
	pass


## Call declare() for each moving part here (runs once the kit is known).
func _declare_sources() -> void:
	pass


func _on_scale_changed() -> void:
	pass


# ---- what the drivers call (override)

func hand_down(_hand: PlayHand) -> void:
	pass


func hand_move(_hand: PlayHand) -> void:
	pass


func hand_up(_hand: PlayHand) -> void:
	pass


## Mouse wheel over the object (desktop): +1 / -1 per notch.
func wheel(_hand: PlayHand, _steps: float) -> void:
	pass


## The plane a pointer drags on after pressing this object, as
## [point, normal] in world space. Default: the object's top surface plane
## through the hit point. Objects you drag upward override it.
func drag_plane(hit: Vector3) -> Array:
	return [hit, global_basis.y.normalized()]


# ---- geometry

## Distance along the ray to the box, or -1 if it misses.
func hit_ray(origin: Vector3, dir: Vector3) -> float:
	var inv := global_transform.affine_inverse()
	var o := inv * origin
	var d := (inv.basis * dir)
	var hit: Variant = box.intersects_ray(o, d)
	if hit == null:
		return -1.0
	return origin.distance_to(global_transform * (hit as Vector3))


func contains(world: Vector3, margin := 0.0) -> bool:
	return box.grow(margin).has_point(global_transform.affine_inverse() * world)


## A hand's position in the object's own space.
func local_of(hand: PlayHand) -> Vector3:
	return global_transform.affine_inverse() * hand.position


## 0..1 across the box on one axis (0 = x, 1 = y, 2 = z), clamped.
func frac(local: Vector3, axis: int) -> float:
	return clampf((local[axis] - box.position[axis]) / maxf(box.size[axis], 1e-6), 0.0, 1.0)


# ---- sources

func source_name(what: String) -> String:
	return "%s.%s" % [name, what]


## Names a moving part, and patches it to part/param unless the patch bay
## already has something for it (a saved layout).
func declare(what: String, label: String, to_part := "", to_param := "", lo := 0.0, hi := 1.0) -> void:
	var s := source_name(what)
	kit.patches.register(s, label)
	if to_param != "" and kit.patches.targets_of(s).is_empty():
		kit.patches.set_patch(s, to_part, to_param, lo, hi)


func send(what: String, v: float) -> void:
	if kit:
		kit.send(source_name(what), v)


# ---- building helpers

static func mat(color: Color, glow := 0.0, alpha := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(color, alpha)
	m.roughness = 0.55
	if glow > 0.0:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = glow
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m


func add_mesh(mesh: Mesh, color: Color, pos := Vector3.ZERO, glow := 0.0, alpha := 1.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat(color, glow, alpha)
	mi.position = pos
	add_child(mi)
	return mi


func add_box(size: Vector3, color: Color, pos := Vector3.ZERO, glow := 0.0) -> MeshInstance3D:
	var b := BoxMesh.new()
	b.size = size
	return add_mesh(b, color, pos, glow)


func add_label(text: String, pos: Vector3, px := 0.0012, flat := true) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.pixel_size = px
	l.font_size = 30
	l.outline_size = 8
	l.outline_modulate = Color("0b1016")
	l.position = pos
	if flat:
		l.rotation_degrees = Vector3(-70, 0, 0)
	else:
		l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.double_sided = true
	add_child(l)
	return l


## Brightens a mesh for a moment (strikes and plucks).
func flash(mi: MeshInstance3D, glow := 2.5, time := 0.25) -> void:
	var m := mi.material_override as StandardMaterial3D
	if m == null:
		return
	m.emission_enabled = true
	m.emission = m.albedo_color
	m.emission_energy_multiplier = glow
	if is_inside_tree():
		create_tween().tween_property(m, "emission_energy_multiplier", 0.15, time)
