class_name TangleModuleCard
extends PanelContainer
## One Tangle module on the patch editor: title bar, knobs, input jacks on the
## left, output jacks on the right.

signal jack_pressed(id: int, port: String, is_output: bool)
signal title_pressed(card: Control)
signal remove_requested(id: int)

var module_id := -1
var grid_pos := Vector2.ZERO
var input_jacks := {} # port id -> Control
var output_jacks := {}


func setup(module: Dictionary, desc: Dictionary, rig: InstrumentRig, accent: Color) -> void:
	module_id = int(module.id)
	custom_minimum_size = Vector2(232, 0)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.13, 0.13, 0.17)
	sb.border_color = Color(accent, 0.6)
	sb.set_border_width_all(1)
	sb.border_width_top = 0
	sb.set_corner_radius_all(6)
	sb.set_content_margin_all(0)
	add_theme_stylebox_override("panel", sb)
	tooltip_text = desc.description

	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	add_child(v)

	# Title bar (drag handle) with a remove button.
	var bar := PanelContainer.new()
	var bsb := StyleBoxFlat.new()
	bsb.bg_color = Color(accent, 0.85)
	bsb.corner_radius_top_left = 6
	bsb.corner_radius_top_right = 6
	bsb.set_content_margin_all(4)
	bar.add_theme_stylebox_override("panel", bsb)
	bar.mouse_default_cursor_shape = Control.CURSOR_MOVE
	bar.gui_input.connect(func(e):
		if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT and e.pressed:
			title_pressed.emit(self))
	var bh := HBoxContainer.new()
	bar.add_child(bh)
	var title := Label.new()
	title.text = desc.name
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_theme_color_override("font_color", Color(0.05, 0.05, 0.08))
	title.add_theme_font_size_override("font_size", 13)
	title.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bh.add_child(title)
	var x := Button.new()
	x.text = "×"
	x.flat = true
	x.add_theme_color_override("font_color", Color(0.05, 0.05, 0.08))
	x.tooltip_text = "Remove module"
	x.pressed.connect(func(): remove_requested.emit(module_id))
	bh.add_child(x)
	v.add_child(bar)

	# Knobs (the step sequencer's 32 step controls get their own compact grid).
	var knobs := HFlowContainer.new()
	knobs.add_theme_constant_override("h_separation", 0)
	var steps := GridContainer.new()
	steps.columns = 8
	var gates := GridContainer.new()
	gates.columns = 8
	var values: Dictionary = module.params
	for p in desc.params:
		var id: String = p.id
		var val: float = values.get(id, p.default)
		if p.group == "Notes":
			var k := Knob.new()
			k.min_value = p.min
			k.max_value = p.max
			k.default_value = p.default
			k.integer = true
			k.label = id.trim_prefix("note")
			k.accent = accent
			k.value = val
			k.custom_minimum_size = Vector2(28, 50)
			k.value_changed.connect(func(nv): rig.set_param("%d/%s" % [module_id, id], nv))
			k.ready.connect(func(): k.custom_minimum_size = Vector2(28, 50))
			steps.add_child(k)
		elif p.group == "Gates":
			var g := Button.new()
			g.toggle_mode = true
			g.button_pressed = val > 0.5
			g.custom_minimum_size = Vector2(26, 18)
			g.tooltip_text = p.name
			var on := StyleBoxFlat.new()
			on.bg_color = accent
			on.set_corner_radius_all(3)
			g.add_theme_stylebox_override("pressed", on)
			g.toggled.connect(func(t): rig.set_param("%d/%s" % [module_id, id], 1.0 if t else 0.0))
			gates.add_child(g)
		elif p.type == "enum":
			var ob := OptionButton.new()
			for o in p.options:
				ob.add_item(o)
			ob.select(int(val))
			ob.tooltip_text = p.name
			ob.custom_minimum_size.x = 104
			ob.item_selected.connect(func(i): rig.set_param("%d/%s" % [module_id, id], i))
			knobs.add_child(ob)
		elif p.type == "bool":
			var b := CheckButton.new()
			b.text = p.name
			b.button_pressed = val > 0.5
			b.toggled.connect(func(t): rig.set_param("%d/%s" % [module_id, id], 1.0 if t else 0.0))
			knobs.add_child(b)
		else:
			var k := Knob.new()
			k.min_value = p.min
			k.max_value = p.max
			k.default_value = p.default
			k.log_scale = p.log
			k.integer = p.type == "int"
			k.label = p.name
			k.unit = p.unit
			k.accent = accent
			k.value = val
			k.value_changed.connect(func(nv): rig.set_param("%d/%s" % [module_id, id], nv))
			knobs.add_child(k)
	var pad := MarginContainer.new()
	for side in ["left", "right"]:
		pad.add_theme_constant_override("margin_" + side, 6)
	var inner := VBoxContainer.new()
	inner.add_child(knobs)
	if steps.get_child_count() > 0:
		inner.add_child(steps)
		inner.add_child(gates)
	pad.add_child(inner)
	v.add_child(pad)

	# Jacks
	var jacks := HBoxContainer.new()
	var ins := VBoxContainer.new()
	ins.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var outs := VBoxContainer.new()
	outs.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for port in desc.inputs:
		ins.add_child(_jack_row(port, false, accent))
	for port in desc.outputs:
		outs.add_child(_jack_row(port, true, accent))
	jacks.add_child(ins)
	jacks.add_child(outs)
	var jpad := MarginContainer.new()
	for side in ["left", "right", "bottom"]:
		jpad.add_theme_constant_override("margin_" + side, 6)
	jpad.add_child(jacks)
	v.add_child(jpad)


func _jack_row(port: Dictionary, output: bool, accent: Color) -> Control:
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END if output else BoxContainer.ALIGNMENT_BEGIN
	var jack := Jack.new()
	jack.output = output
	jack.accent = accent
	jack.tooltip_text = ("Output: " if output else "Input: ") + port.name
	var pid: String = port.id
	jack.pressed.connect(func(): jack_pressed.emit(module_id, pid, output))
	var l := Label.new()
	l.text = port.name
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", Color(1, 1, 1, 0.75))
	if output:
		row.add_child(l)
		row.add_child(jack)
		output_jacks[pid] = jack
	else:
		row.add_child(jack)
		row.add_child(l)
		input_jacks[pid] = jack
	return row
