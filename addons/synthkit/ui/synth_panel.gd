class_name SynthPanel
extends ScrollContainer
## Front panel for an instrument, built from its parameter list: one framed
## section per group, knobs for continuous values, selectors for enums,
## switches for booleans. Right-click any control for MIDI learn.

var rig: InstrumentRig
var _controls := {} # param id -> Control
var _flow: HFlowContainer
var _menu: PopupMenu
var _menu_param := ""


func _ready() -> void:
	horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_flow = HFlowContainer.new()
	_flow.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_flow.add_theme_constant_override("h_separation", 10)
	_flow.add_theme_constant_override("v_separation", 10)
	add_child(_flow)
	_menu = PopupMenu.new()
	_menu.add_item("MIDI Learn", 0)
	_menu.add_item("Forget MIDI Mapping", 1)
	_menu.add_separator()
	_menu.add_item("Reset to Default", 2)
	_menu.id_pressed.connect(_on_menu)
	add_child(_menu)


func bind(p_rig: InstrumentRig) -> void:
	rig = p_rig
	rig.preset_changed.connect(func(_p): refresh())
	rig.param_changed.connect(func(id, v): _show(id, v))
	rig.learn_changed.connect(func(_id): _update_learn_marks())
	rebuild()


func rebuild() -> void:
	for c in _flow.get_children():
		c.queue_free()
	_controls.clear()
	if rig == null:
		return
	var groups := {}
	var order: Array[String] = []
	for p in rig.synth.get_param_list():
		if not groups.has(p.group):
			groups[p.group] = []
			order.append(p.group)
		groups[p.group].append(p)
	for g in order:
		_flow.add_child(_make_group(g, groups[g]))
	_update_learn_marks()


func refresh() -> void:
	for p in rig.synth.get_param_list():
		_show(p.id, p.value)


func _show(id: String, v: float) -> void:
	var c: Control = _controls.get(id)
	if c == null:
		return
	if c is Knob:
		(c as Knob).set_value_silently(v)
	elif c is OptionButton:
		(c as OptionButton).select(int(v))
	elif c is Button:
		(c as Button).set_pressed_no_signal(v > 0.5)


func _make_group(title: String, params: Array) -> Control:
	var accent := rig.color()
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.11, 0.12, 0.14)
	sb.border_color = Color(accent, 0.35)
	sb.set_border_width_all(1)
	sb.border_width_top = 3
	sb.set_corner_radius_all(6)
	sb.set_content_margin_all(8)
	panel.add_theme_stylebox_override("panel", sb)
	var v := VBoxContainer.new()
	panel.add_child(v)
	var head := Label.new()
	head.text = title.to_upper()
	head.add_theme_font_size_override("font_size", 12)
	head.add_theme_color_override("font_color", accent)
	v.add_child(head)
	var row := HFlowContainer.new()
	row.custom_minimum_size.x = clampf(params.size(), 2, 6) * 70.0
	row.add_theme_constant_override("h_separation", 4)
	v.add_child(row)
	for p in params:
		row.add_child(_make_control(p, accent))
	return panel


func _make_control(p: Dictionary, accent: Color) -> Control:
	var id: String = p.id
	match p.type:
		"enum":
			var box := VBoxContainer.new()
			box.custom_minimum_size = Vector2(110, 82)
			var l := Label.new()
			l.text = p.name
			l.add_theme_font_size_override("font_size", 11)
			box.add_child(l)
			var ob := OptionButton.new()
			for o in p.options:
				ob.add_item(o)
			ob.select(int(p.value))
			ob.item_selected.connect(func(i): rig.set_param(id, i))
			_attach_menu(ob, id)
			box.add_child(ob)
			_controls[id] = ob
			return box
		"bool":
			var b := Button.new()
			b.toggle_mode = true
			b.text = p.name
			b.custom_minimum_size = Vector2(110, 36)
			b.button_pressed = p.value > 0.5
			b.add_theme_font_size_override("font_size", 11)
			var on := StyleBoxFlat.new()
			on.bg_color = Color(accent, 0.55)
			on.set_corner_radius_all(4)
			b.add_theme_stylebox_override("pressed", on)
			b.toggled.connect(func(t): rig.set_param(id, 1.0 if t else 0.0))
			_attach_menu(b, id)
			_controls[id] = b
			var wrap := CenterContainer.new()
			wrap.custom_minimum_size = Vector2(110, 82)
			wrap.add_child(b)
			return wrap
		_:
			var k := Knob.new()
			k.min_value = p.min
			k.max_value = p.max
			k.default_value = p.default
			k.log_scale = p.log
			k.integer = p.type == "int"
			k.label = p.name
			k.unit = p.unit
			k.accent = accent
			k.value = p.value
			k.value_changed.connect(func(v): rig.set_param(id, v))
			k.context_requested.connect(func(at): _open_menu(id, at))
			_controls[id] = k
			return k


func _attach_menu(c: Control, id: String) -> void:
	c.gui_input.connect(func(e):
		if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_RIGHT and e.pressed:
			_open_menu(id, c.get_global_mouse_position()))


func _open_menu(id: String, at: Vector2) -> void:
	_menu_param = id
	_menu.set_item_disabled(1, rig.mapped_cc(id) < 0)
	var cc := rig.mapped_cc(id)
	_menu.set_item_text(1, "Forget MIDI Mapping" + (" (CC %d)" % cc if cc >= 0 else ""))
	_menu.position = Vector2i(at)
	_menu.popup()


func _on_menu(item: int) -> void:
	match item:
		0: rig.learn(_menu_param)
		1:
			rig.forget(_menu_param)
			_update_learn_marks()
		2:
			for p in rig.synth.get_param_list():
				if p.id == _menu_param:
					rig.set_param(_menu_param, p.default)
					_show(_menu_param, p.default)


func _update_learn_marks() -> void:
	for id in _controls:
		var c = _controls[id]
		if c is Knob:
			c.mapped = rig.mapped_cc(id) >= 0
			c.learning = rig.learning == id
