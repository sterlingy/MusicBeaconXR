class_name TangleEditor
extends ScrollContainer
## Patch editor for the Tangle modular: module cards with jacks and knobs,
## patch cables drawn as sagging curves. Drag from an output jack to an input
## jack to patch; click a patched input to pull its cable out (and re-plug it
## elsewhere); drag a card by its title. "+ Module" adds one.

const GRID := Vector2(250, 300)
const CABLE_COLORS := [Color("ff5d5d"), Color("ffd166"), Color("06d6a0"), Color("4cc9f0"), Color("f72585"), Color("b388ff"), Color("ff9f1c")]

var rig: InstrumentRig
var _canvas: Control
var _cables: Control
var _cards := {} # module id -> card
var _types := {} # type -> descriptor
var _drag_from := {} # {"id", "port"} while dragging a new cable
var _drag_pos := Vector2.ZERO
var _move_card: Control = null
var _move_offset := Vector2.ZERO


func _ready() -> void:
	_canvas = Control.new()
	_canvas.custom_minimum_size = Vector2(2200, 1400)
	_canvas.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(_canvas)
	_cables = Control.new()
	_cables.set_anchors_preset(Control.PRESET_FULL_RECT)
	_cables.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_cables.draw.connect(_draw_cables)
	_cables.z_index = 10
	_canvas.add_child(_cables)


func bind(p_rig: InstrumentRig) -> void:
	rig = p_rig
	for m in rig.synth.tangle_get_module_types():
		_types[m.type] = m
	rig.preset_changed.connect(func(_p): rebuild())
	rebuild()


func module_types() -> Array:
	return rig.synth.tangle_get_module_types()


func add_module(type: String) -> void:
	# Place it in the first free grid cell.
	var used := {}
	for c in _cards.values():
		used[c.grid_pos] = true
	var pos := Vector2.ZERO
	for y in 4:
		for x in 8:
			if not used.has(Vector2(x, y)):
				pos = Vector2(x, y)
				break
		if pos != Vector2.ZERO or not used.has(Vector2.ZERO):
			break
	if rig.synth.tangle_add_module(type, pos) < 0:
		push_warning("Tangle is full (32 modules).")
	rebuild()


func rebuild() -> void:
	for c in _cards.values():
		c.queue_free()
	_cards.clear()
	if rig == null or rig.synth.instrument != "Tangle":
		return
	var patch := rig.synth.tangle_get_patch()
	for m in patch.modules:
		var card := TangleModuleCard.new()
		card.setup(m, _types[m.type], rig, rig.color())
		var pos = m.position
		card.grid_pos = Vector2(pos.x, pos.y) if pos is Vector2 else Vector2(pos[0], pos[1])
		card.jack_pressed.connect(_on_jack_pressed)
		card.title_pressed.connect(_on_title_pressed)
		card.remove_requested.connect(func(id):
			rig.synth.tangle_remove_module(id)
			rebuild())
		_canvas.add_child(card)
		_cards[int(m.id)] = card
	_canvas.move_child(_cables, -1)
	_layout.call_deferred()


## Cards sit in grid columns; within a column they stack by height so tall
## modules (the sequencer) never overlap the next one.
func _layout() -> void:
	var cols := {}
	for card in _cards.values():
		var x := int(card.grid_pos.x)
		if not cols.has(x):
			cols[x] = []
		cols[x].append(card)
	for x in cols:
		var list: Array = cols[x]
		list.sort_custom(func(a, b): return a.grid_pos.y < b.grid_pos.y)
		var y := 16.0
		for card in list:
			card.position = Vector2(16 + x * GRID.x, y)
			y += card.get_combined_minimum_size().y + 16.0
	_cables.queue_redraw()


func _on_jack_pressed(id: int, port: String, is_output: bool) -> void:
	if is_output:
		_drag_from = {"id": id, "port": port}
	else:
		# Pull an existing cable out of this input and carry it.
		for c in rig.synth.tangle_get_patch().cables:
			if int(c.to) == id and c["in"] == port:
				rig.synth.tangle_disconnect(id, port)
				_drag_from = {"id": int(c.from), "port": c.out}
				break
	_drag_pos = _canvas.get_local_mouse_position()
	_cables.queue_redraw()


func _on_title_pressed(card: Control) -> void:
	_move_card = card
	_move_offset = card.position - _canvas.get_local_mouse_position()


func _input(event: InputEvent) -> void:
	if not is_visible_in_tree():
		return
	if event is InputEventMouseMotion:
		if not _drag_from.is_empty():
			_drag_pos = _canvas.get_local_mouse_position()
			_cables.queue_redraw()
		elif _move_card:
			_move_card.position = _canvas.get_local_mouse_position() + _move_offset
			_cables.queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and not event.pressed:
		if not _drag_from.is_empty():
			var target := _input_jack_at(get_global_mouse_position())
			if not target.is_empty():
				rig.synth.tangle_connect(_drag_from.id, _drag_from.port, target.id, target.port)
			_drag_from = {}
			_cables.queue_redraw()
		if _move_card:
			# Column from x; order within the column from y (between neighbours).
			var col := clampf(roundf((_move_card.position.x - 16.0) / GRID.x), 0, 7)
			var row := 0.0
			for card in _cards.values():
				if card != _move_card and int(card.grid_pos.x) == int(col) and card.position.y < _move_card.position.y:
					row = maxf(row, card.grid_pos.y + 0.5)
			_move_card.grid_pos = Vector2(col, row)
			rig.synth.tangle_set_position(_move_card.module_id, _move_card.grid_pos)
			_move_card = null
			_layout()


func _input_jack_at(global: Vector2) -> Dictionary:
	for card in _cards.values():
		for port in card.input_jacks:
			var j: Control = card.input_jacks[port]
			if j.get_global_rect().grow(6).has_point(global):
				return {"id": card.module_id, "port": port}
	return {}


func _jack_pos(id: int, port: String, output: bool) -> Vector2:
	var card = _cards.get(id)
	if card == null:
		return Vector2.ZERO
	var jacks: Dictionary = card.output_jacks if output else card.input_jacks
	var j: Control = jacks.get(port)
	if j == null:
		return Vector2.ZERO
	return _canvas.get_global_transform().affine_inverse() * j.get_global_rect().get_center()


func _draw_cable(a: Vector2, b: Vector2, col: Color) -> void:
	var sag := clampf(a.distance_to(b) * 0.25, 30.0, 160.0)
	var c1 := a + Vector2(60, sag)
	var c2 := b + Vector2(-60, sag)
	var pts := PackedVector2Array()
	for i in 25:
		var t := i / 24.0
		var u := 1.0 - t
		pts.append(u * u * u * a + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * b)
	_cables.draw_polyline(pts, Color(0, 0, 0, 0.45), 6.0, true)
	_cables.draw_polyline(pts, col, 3.5, true)
	_cables.draw_circle(a, 5.0, col)
	_cables.draw_circle(b, 5.0, col)


func _draw_cables() -> void:
	if rig == null or rig.synth.instrument != "Tangle":
		return
	var i := 0
	for c in rig.synth.tangle_get_patch().cables:
		_draw_cable(_jack_pos(int(c.from), c.out, true), _jack_pos(int(c.to), c["in"], false), CABLE_COLORS[i % CABLE_COLORS.size()])
		i += 1
	if not _drag_from.is_empty():
		_draw_cable(_jack_pos(_drag_from.id, _drag_from.port, true), _drag_pos, Color(1, 1, 1, 0.8))
