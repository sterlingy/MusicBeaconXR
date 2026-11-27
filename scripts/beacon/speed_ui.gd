class_name SpeedUi
extends CanvasLayer
## Wander and travel speed: a "Wander" button beside Walks (the speed under its
## name, lit while auto-walk is on), and a pop-up with the auto-walk switch and a
## horizontal slider from 1 m/s (walking) to 250 m/s (a jet cruising). The
## slider is logarithmic (slow speeds get as much room as fast ones), snaps to
## 1, 2, 5, 10, 25, 50, 100 and 250 m/s, and names the ranges: walk, jog, run,
## bike, drive, train, bullet train, prop plane, jet.
## Remembered between launches (FieldPrefs "walk_speed"). Walking with keys or
## a stick, walking to a tapped spot and auto-walk all use it.
##
##   var sp := SpeedUi.new()
##   add_child(sp)
##   sp.changed.connect(func(mps): ...)

signal changed(mps: float)

const MIN := 1.0
const MAX := 250.0
const MARKS := [1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0]
## Named ranges: [from m/s, short name (under the slider), full name].
const BANDS := [[1.0, "Walk", "Walk"], [2.0, "Jog", "Jog"], [4.0, "Run", "Run"], [8.0, "Bike", "Bike"],
	[15.0, "Drive", "Drive"], [35.0, "Train", "Train"], [60.0, "Bullet", "Bullet train"],
	[100.0, "Prop", "Prop plane"], [180.0, "Jet", "Jet"]]
const SNAP := 0.035 # how close (in slider travel, 0..1) snaps to a mark

var ui_scale := 1.0
## Shown under the value, e.g. that the globe scales speed with the zoom.
var note := ""
var mps := 10.0
var _toggle: Button
var _title: Label
var _sub: Label
var _wander: CheckButton
var _panel: PanelContainer
var _value: Label
var _note: Label
var _slider: HSlider
var _ticks: Control


func _init() -> void:
	name = "SpeedUi"
	layer = 6
	add_to_group(PopupFx.GROUP)


static func saved() -> float:
	return clampf(float(FieldPrefs.get_value("walk_speed", 10.0)), MIN, MAX)


## Slider travel (0..1) for a speed, and back.
static func to_t(v: float) -> float:
	return log(clampf(v, MIN, MAX) / MIN) / log(MAX / MIN)


static func from_t(t: float) -> float:
	return MIN * pow(MAX / MIN, clampf(t, 0.0, 1.0))


## The speed for a slider position, snapped to a mark when it's close to one.
static func snapped_speed(t: float) -> float:
	for m in MARKS:
		if absf(to_t(m) - t) < SNAP:
			return m
	var v := from_t(t)
	return roundf(v) if v >= 10.0 else snappedf(v, 0.5)


static func label_of(v: float) -> String:
	return ("%d m/s" % roundi(v)) if v >= 2.0 or is_equal_approx(v, roundf(v)) else ("%.1f m/s" % v)


## The named range a speed falls in ("Walk" ... "Jet").
static func band_of(v: float) -> String:
	var name: String = BANDS[0][2]
	for b in BANDS:
		if v >= float(b[0]) - 0.001:
			name = b[2]
	return name


## "25 m/s · Drive · 90 km/h"
static func describe(v: float) -> String:
	return "%s · %s · %d km/h" % [label_of(v), band_of(v), roundi(v * 3.6)]


func _ready() -> void:
	ui_scale = FieldMenu.PHONE_SCALE if BuildInfo.is_phone() else 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui-scale="):
			ui_scale = float(a.trim_prefix("--ui-scale="))
	mps = saved()
	var menu := FieldMenu.new("grid")
	# Two lines: "Wander", and the speed under it. Lit (pressed) while auto-walk is on.
	_toggle = menu._button("", func(): set_open(not PopupFx.is_open(_panel)), true)
	_toggle.tooltip_text = "Auto-walk and travel speed"
	var lines := VBoxContainer.new()
	lines.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lines.add_theme_constant_override("separation", -3)
	lines.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	lines.alignment = BoxContainer.ALIGNMENT_CENTER
	_title = Label.new()
	_title.text = "Wander"
	_title.add_theme_font_size_override("font_size", 15)
	_sub = Label.new()
	_sub.add_theme_font_size_override("font_size", 11)
	_sub.add_theme_color_override("font_color", Color(1, 1, 1, 0.62))
	for l in [_title, _sub]:
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		lines.add_child(l)
	_toggle.add_child(lines)
	_toggle.custom_minimum_size = Vector2(0, 46)
	add_child(_toggle)
	_panel = PanelContainer.new()
	_panel.mouse_filter = Control.MOUSE_FILTER_STOP
	var sb := StyleBoxFlat.new()
	sb.bg_color = FieldMenu.POP_BG
	sb.border_color = FieldMenu.POP_BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(12)
	sb.set_content_margin_all(14)
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.visible = false
	add_child(_panel)
	PopupFx.glass(_panel)
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(440, 0)
	v.add_theme_constant_override("separation", 6)
	_panel.add_child(v)
	# Auto-walk: the listener wanders between beacons by itself (the T key too).
	_wander = CheckButton.new()
	_wander.text = "Wander: auto-walk between beacons"
	_wander.focus_mode = Control.FOCUS_NONE
	_wander.add_theme_font_size_override("font_size", 15)
	_wander.toggled.connect(func(on):
		var li := _listener()
		if li:
			li.wander = on)
	v.add_child(_wander)
	var head := HBoxContainer.new()
	var h := menu._heading("TRAVEL SPEED")
	h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(h)
	_value = Label.new()
	_value.add_theme_font_size_override("font_size", 18)
	head.add_child(_value)
	v.add_child(head)
	_slider = HSlider.new()
	_slider.min_value = 0.0
	_slider.max_value = 1.0
	_slider.step = 0.001
	_slider.custom_minimum_size = Vector2(0, 36)
	_slider.focus_mode = Control.FOCUS_NONE
	_slider.value_changed.connect(func(t: float):
		var s := snapped_speed(t)
		if not is_equal_approx(s, mps):
			set_speed(s))
	_slider.drag_ended.connect(func(_c): _slider.set_value_no_signal(to_t(mps))) # settle on the snapped mark
	v.add_child(_slider)
	_ticks = Control.new()
	_ticks.custom_minimum_size = Vector2(0, 40)
	_ticks.draw.connect(_draw_ticks)
	v.add_child(_ticks)
	_note = menu._small("")
	v.add_child(_note)
	menu.free()
	set_speed(mps, false)


func _draw_ticks() -> void:
	var font := ThemeDB.fallback_font
	var w := _ticks.size.x
	var grab := 10.0 # the slider's grabber keeps the ends this far in
	# The named ranges, each label centred in its stretch of the slider.
	for i in BANDS.size():
		var a := to_t(float(BANDS[i][0]))
		var b := to_t(float(BANDS[i + 1][0])) if i + 1 < BANDS.size() else 1.0
		var x0 := grab + (w - 2.0 * grab) * a
		var x1 := grab + (w - 2.0 * grab) * b
		var here: bool = band_of(mps) == String(BANDS[i][2])
		var col := FieldMenu.ACCENT if here else Color(1, 1, 1, 0.4)
		var name: String = BANDS[i][1]
		var nw := font.get_string_size(name, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
		_ticks.draw_string(font, Vector2(clampf((x0 + x1 - nw) * 0.5, 0.0, w - nw), 37), name, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, col)
		if i > 0:
			_ticks.draw_line(Vector2(x0, 25), Vector2(x0, 39), Color(1, 1, 1, 0.12), 1.0)
	for m in MARKS:
		var x := grab + (w - 2.0 * grab) * to_t(m)
		var on := is_equal_approx(m, mps)
		var col := FieldMenu.ACCENT if on else Color(1, 1, 1, 0.55)
		_ticks.draw_line(Vector2(x, 0), Vector2(x, 5), col, 2.0)
		var t := str(int(m))
		var tw := font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, 13).x
		_ticks.draw_string(font, Vector2(clampf(x - tw * 0.5, 0.0, w - tw), 19), t, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, col)


static func _button_text(v: float) -> String:
	return "%s · %s" % [band_of(v), label_of(v)]


func _listener() -> ListenerInput:
	return get_tree().get_first_node_in_group("listener_input") as ListenerInput if is_inside_tree() else null


## Sets the speed (and saves it); `tell` sends changed.
func set_speed(v: float, tell := true) -> void:
	mps = clampf(v, MIN, MAX)
	_value.text = describe(mps)
	_sub.text = _button_text(mps)
	_slider.set_value_no_signal(to_t(mps)) # dragging past a mark settles on it (a detent)
	_ticks.queue_redraw()
	_note.text = note
	_note.visible = note != ""
	if tell:
		FieldPrefs.set_value("walk_speed", mps)
		changed.emit(mps)


func set_open(open: bool, sound := true) -> void:
	if open:
		PopupFx.claim(self)
		_note.text = note
		_note.visible = note != ""
	PopupFx.animate(_panel, open, sound)


func close_popup(except: Object) -> void:
	if except != self and PopupFx.is_open(_panel):
		set_open(false)


## Bottom right, just left of the Walks button; the slider pops up above it.
func _process(_delta: float) -> void:
	# The button is lit while wandering (T, the switch, or something that stopped it).
	var li := _listener()
	var on := li != null and li.wander
	if _toggle.button_pressed != on:
		_toggle.set_pressed_no_signal(on)
	if _wander.button_pressed != on:
		_wander.set_pressed_no_signal(on)
	_title.add_theme_color_override("font_color", FieldMenu.ACCENT if on else Color.WHITE)
	var want := maxf(_title.get_minimum_size().x, _sub.get_minimum_size().x) + 26.0
	if not is_equal_approx(_toggle.custom_minimum_size.x, want):
		_toggle.custom_minimum_size.x = want
		_toggle.reset_size()
	var view := get_viewport().get_visible_rect().size
	var ts := minf(ui_scale, (view.x * 0.25) / maxf(1.0, _toggle.size.x))
	_toggle.scale = Vector2(ts, ts)
	var walks := get_tree().get_first_node_in_group("beacon_walks")
	var right := view.x - 12.0
	if walks and walks.get("_toggle") is Control:
		var wt: Control = walks._toggle
		right = wt.position.x - 8.0
	_toggle.position = Vector2(right - _toggle.size.x * ts, view.y - 12.0 - _toggle.size.y * ts)
	if _panel.visible:
		_panel.reset_size()
		var s := minf(ui_scale, (view.x - 24.0) / maxf(1.0, _panel.size.x))
		var sz := _panel.size * s
		var top_left := Vector2(clampf(_toggle.position.x + _toggle.size.x * ts - sz.x, 12.0, view.x - 12.0 - sz.x), _toggle.position.y - 8.0 - sz.y)
		PopupFx.apply(_panel, s, Vector2(_panel.size.x, _panel.size.y), top_left)
