class_name XRTravelCard
extends Node3D
## The Jump / Move card in a headset: it floats over the spot you held the
## trigger on, turned toward you. Point the controller at a button (it lights
## up) and pull the trigger; pulling it anywhere else closes the card.
## Sized in meters at life size; set `world_scale` to match XROrigin3D.

signal chosen(kind: String)
signal closed()

const W := 0.46
const H := 0.22
const BTN := Vector2(0.2, 0.075)
const BUTTONS := {"jump": Vector2(-0.11, -0.05), "move": Vector2(0.11, -0.05)} # button centres, card space

## The controller whose ray points at the card (for the hover highlight).
var pointer: XRController3D
var world_scale := 1.0
var _title: Label3D
var _detail: Label3D
var _btn := {} # kind -> MeshInstance3D
var _hover := ""


func _ready() -> void:
	visible = false
	var bg := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(W, H)
	bg.mesh = q
	bg.material_override = _mat(FieldMenu.POP_BG)
	add_child(bg)
	var edge := MeshInstance3D.new()
	var eq := QuadMesh.new()
	eq.size = Vector2(W + 0.008, H + 0.008)
	edge.mesh = eq
	edge.position.z = -0.001
	edge.material_override = _mat(FieldMenu.ACCENT)
	add_child(edge)
	_title = _label(0.018, Color.WHITE)
	_title.position = Vector3(0, 0.06, 0.002)
	add_child(_title)
	_detail = _label(0.011, Color("aab4c2"))
	_detail.position = Vector3(0, 0.025, 0.002)
	add_child(_detail)
	for kind in BUTTONS:
		var b := MeshInstance3D.new()
		var bq := QuadMesh.new()
		bq.size = BTN
		b.mesh = bq
		b.position = Vector3(BUTTONS[kind].x, BUTTONS[kind].y, 0.001)
		b.material_override = _mat(Color(0.08, 0.11, 0.15))
		add_child(b)
		_btn[kind] = b
		var l := _label(0.016, Color.WHITE)
		l.text = "⚡ Jump" if kind == "jump" else "➜ Move"
		l.position = b.position + Vector3(0, 0, 0.002)
		add_child(l)


func _mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m


func _label(size: float, c: Color) -> Label3D:
	var l := Label3D.new()
	l.pixel_size = size / 32.0
	l.font_size = 32
	l.modulate = c
	l.outline_size = 0
	l.double_sided = true
	return l


## Shows the card over `at` (world), turned toward `eye` (the headset).
func open(at: Vector3, eye: Vector3, title: String, detail: String) -> void:
	_title.text = title
	_detail.text = detail
	scale = Vector3.ONE * world_scale
	position = at + Vector3(0, 0.35 * world_scale, 0)
	var look := Vector3(eye.x, position.y, eye.z)
	if look.distance_to(position) > 1e-3:
		look_at(look, Vector3.UP, true) # +z (the card's face) toward the viewer
	visible = true


func close() -> void:
	if visible:
		visible = false
		closed.emit()


## Which button a ray hits ("jump", "move"), "card" for the card itself, or "".
func hit(origin: Vector3, dir: Vector3) -> String:
	if not visible:
		return ""
	var inv := global_transform.affine_inverse()
	var o := inv * origin
	var d := (inv.basis * dir)
	if absf(d.z) < 1e-5:
		return ""
	var t := -o.z / d.z
	if t < 0.0:
		return ""
	var p := o + d * t
	for kind in BUTTONS:
		var c: Vector2 = BUTTONS[kind]
		if absf(p.x - c.x) <= BTN.x * 0.5 and absf(p.y - c.y) <= BTN.y * 0.5:
			return kind
	return "card" if absf(p.x) <= W * 0.5 and absf(p.y) <= H * 0.5 else ""


## A trigger press while the card is up: a button chooses, anything else closes.
## Returns true when the card used the press.
func click(origin: Vector3, dir: Vector3) -> bool:
	if not visible:
		return false
	var h := hit(origin, dir)
	if h == "jump" or h == "move":
		visible = false
		chosen.emit(h)
	elif h == "":
		close()
	return true


func _process(_delta: float) -> void:
	if not visible or pointer == null:
		return
	var h := hit(pointer.global_position, -pointer.global_transform.basis.z.normalized())
	if h != _hover:
		_hover = h
		for kind in _btn:
			var m: StandardMaterial3D = _btn[kind].material_override
			m.albedo_color = Color("3a2a10") if kind == h else Color(0.08, 0.11, 0.15)
