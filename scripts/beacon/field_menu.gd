class_name FieldMenu
extends CanvasLayer
## The buttons at the top right of a field (Play, Click, ☰ Fields) and the
## pop-out panel behind ☰: pick the field (test grid, globe, local grid), set
## up the local grid (size, spacing, follow my location), and open the
## Instrument Table, the Synths or the manual. Used by the grid / local field
## and the globe, so every field has the same way around the app.

## The local grid's size or spacing changed (the scene rebuilds around the listener).
signal local_changed
## "Center on me" (local grid): find the device's location now.
signal center_requested
signal follow_changed(on: bool)

const ACCENT := Color("ffb547")
const MANUAL_URL := "https://sterlingy.github.io/MusicBeaconXR/manual.html"
const FIELDS := [["grid", "Test grid"], ["globe", "Globe"], ["local", "Local grid"]]
## How much bigger the buttons and panel are on phones (they were too small to tap).
const PHONE_SCALE := 4.0

var kind := "grid"
var panel: PanelContainer
var status: Label
var _play: Button
var _click: Button
var _fields_btn: Button
var _field_btns := {}
var _row: HBoxContainer
## 1 on desktops, PHONE_SCALE on phones (dev: --ui-scale=N).
var ui_scale := 1.0


func _init(p_kind: String) -> void:
	kind = p_kind
	name = "FieldMenu"
	layer = 5


func _ready() -> void:
	var row := HBoxContainer.new()
	row.anchor_left = 1.0
	row.anchor_right = 1.0
	row.offset_left = -420
	row.offset_right = -12
	row.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	row.offset_top = 12
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	add_child(row)
	_row = row
	ui_scale = PHONE_SCALE if BuildInfo.is_phone() else 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui-scale="):
			ui_scale = float(a.trim_prefix("--ui-scale="))
	_play = _button("▶ Play", func(): Transport.toggle())
	row.add_child(_play)
	_click = _button("Click", func(): pass, true)
	_click.toggled.connect(func(t): Transport.metronome_on = t)
	row.add_child(_click)
	_fields_btn = _button("☰ Fields", func(): set_open(not panel.visible), true)
	row.add_child(_fields_btn)
	_build_panel()
	set_open(false)


func _process(_delta: float) -> void:
	_fit()
	_play.text = "■ Stop" if Transport.running else "▶ Play"
	if _click.button_pressed != Transport.metronome_on:
		_click.set_pressed_no_signal(Transport.metronome_on)


## Scales the button row and the panel from their top-right corners; the
## panel shrinks if it wouldn't fit on the screen at full scale.
func _fit() -> void:
	var view := get_viewport().get_visible_rect().size
	var s := minf(ui_scale, (view.x - 24.0) / maxf(1.0, _row.size.x))
	_row.pivot_offset = Vector2(_row.size.x, 0)
	_row.scale = Vector2(s, s)
	var ps := minf(s, minf((view.x - 24.0) / maxf(1.0, panel.size.x), (view.y - _row.size.y * s - 32.0) / maxf(1.0, panel.size.y)))
	panel.offset_top = 12.0 + _row.size.y * s + 8.0
	panel.pivot_offset = Vector2(panel.size.x, 0)
	panel.scale = Vector2(ps, ps)


func set_open(open: bool) -> void:
	panel.visible = open
	_fields_btn.set_pressed_no_signal(open)
	# While the panel is open, Android's back gesture closes it instead of the app.
	get_tree().quit_on_go_back = not open


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST and panel and panel.visible:
		set_open(false)


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	match event.keycode:
		KEY_M:
			Transport.metronome_on = not Transport.metronome_on
		KEY_F:
			set_open(not panel.visible)
		KEY_I:
			open_scene("res://scenes/instrument_table.tscn")
		KEY_ESCAPE:
			if panel.visible:
				set_open(false)


func set_status(text: String) -> void:
	status.text = text
	status.visible = text != ""


## Goes to another field, remembering it for the next launch.
func go_field(k: String) -> void:
	FieldPrefs.set_field(k)
	get_tree().quit_on_go_back = true
	get_tree().change_scene_to_file(FieldPrefs.scene_for(k))


func open_scene(path: String) -> void:
	get_tree().quit_on_go_back = true
	get_tree().change_scene_to_file(path)


# ---------------------------------------------------------------- panel

func _build_panel() -> void:
	panel = PanelContainer.new()
	panel.anchor_left = 1.0
	panel.anchor_right = 1.0
	panel.offset_left = -372
	panel.offset_right = -12
	panel.offset_top = 62
	panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN # wider content grows leftward, never off screen
	panel.mouse_filter = Control.MOUSE_FILTER_STOP # taps on the panel never walk the listener
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.085, 0.115, 0.96)
	sb.border_color = Color("2a3644")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", sb)
	add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	panel.add_child(v)

	v.add_child(_heading("FIELD"))
	var fields := HBoxContainer.new()
	fields.add_theme_constant_override("separation", 6)
	v.add_child(fields)
	for f in FIELDS:
		var k: String = f[0]
		var b := _button(f[1], func(): _pick_field(k), true)
		b.set_pressed_no_signal(k == kind)
		_field_btns[k] = b
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		fields.add_child(b)

	v.add_child(_heading("LOCAL GRID"))
	var side := _option(FieldPrefs.SIDES_KM, FieldPrefs.local_km(), "%s km a side")
	side.item_selected.connect(func(i):
		FieldPrefs.set_value("local_km", FieldPrefs.SIDES_KM[i])
		local_changed.emit())
	var spacing := _option(FieldPrefs.SPACINGS_KM, FieldPrefs.spacing_km(), "every %s km")
	spacing.item_selected.connect(func(i):
		FieldPrefs.set_value("spacing_km", FieldPrefs.SPACINGS_KM[i])
		local_changed.emit())
	var sizes := HBoxContainer.new()
	sizes.add_theme_constant_override("separation", 6)
	side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	spacing.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sizes.add_child(side)
	sizes.add_child(spacing)
	v.add_child(sizes)
	var follow := CheckButton.new()
	follow.text = "Follow my location"
	follow.button_pressed = FieldPrefs.follow()
	follow.focus_mode = Control.FOCUS_NONE
	follow.add_theme_font_size_override("font_size", 15)
	follow.toggled.connect(func(on):
		FieldPrefs.set_value("follow", on)
		follow_changed.emit(on))
	var center := _button("Center on me", func(): center_requested.emit())
	var loc := HBoxContainer.new()
	loc.add_child(follow)
	loc.add_child(center)
	follow.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(loc)
	if kind != "local":
		for c in [side, spacing, follow, center]:
			c.disabled = true
		var note := _small("Open the local grid to use these.")
		v.add_child(note)
	status = _small("")
	status.visible = false
	v.add_child(status)

	v.add_child(_heading("OPEN"))
	var links := HBoxContainer.new()
	links.add_theme_constant_override("separation", 6)
	v.add_child(links)
	for l in [["Instruments", func(): open_scene("res://scenes/instrument_table.tscn")],
			["Synths", func(): open_scene("res://scenes/studio.tscn")],
			["Manual ↗", func(): OS.shell_open(MANUAL_URL)]]:
		var b := _button(l[0], l[1])
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		links.add_child(b)
	var build := _small("Build %s · %s · UI ×%s" % [BuildInfo.BUILD, OS.get_name(), _num(ui_scale)])
	build.add_theme_font_size_override("font_size", 11)
	v.add_child(build)


func _pick_field(k: String) -> void:
	if k == kind:
		_field_btns[k].set_pressed_no_signal(true) # already here: stay lit
		set_open(false)
	else:
		go_field(k)


func _heading(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", ACCENT)
	return l


func _small(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 13)
	l.add_theme_color_override("font_color", Color("8d9aab"))
	return l


func _option(values: Array, current: float, fmt: String) -> OptionButton:
	var o := OptionButton.new()
	o.focus_mode = Control.FOCUS_NONE
	o.add_theme_font_size_override("font_size", 15)
	var best := 0
	for i in values.size():
		o.add_item(fmt % _num(values[i]))
		if absf(values[i] - current) < absf(values[best] - current):
			best = i
	o.select(best)
	return o


static func _num(v: float) -> String:
	return ("%.2f" % v).rstrip("0").rstrip(".")


func _button(text: String, on_press: Callable, toggle := false) -> Button:
	var b := Button.new()
	b.text = text
	b.toggle_mode = toggle
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(0, 40)
	b.add_theme_font_size_override("font_size", 15)
	for state in ["normal", "hover", "pressed", "hover_pressed", "disabled"]:
		var sb := StyleBoxFlat.new()
		var on: bool = state.contains("pressed")
		sb.bg_color = Color("3a2a10") if on else Color(0.08, 0.11, 0.15, 0.88)
		sb.border_color = ACCENT if on or state == "hover" else Color("2a3644")
		sb.set_border_width_all(1)
		sb.set_corner_radius_all(8)
		sb.content_margin_left = 12
		sb.content_margin_right = 12
		b.add_theme_stylebox_override(state, sb)
	b.pressed.connect(on_press)
	return b
