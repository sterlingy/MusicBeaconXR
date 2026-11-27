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
const PHONE_SCALE := 2.8

var kind := "grid"
var panel: PanelContainer
var status: Label
var _play: Button
var _fields_btn: Button
var _field_btns := {}
var _row: HBoxContainer
var _scroll: ScrollContainer
var _follow: CheckButton
var _sound_btns := {} # quality mode -> button
var _flight_q: LineEdit
var _flight_btn: Button
var _flight_msg: Label
var _sound_now: Label
## 1 on desktops, PHONE_SCALE on phones (dev: --ui-scale=N).
var ui_scale := 1.0
## Unscaled height kept free for a bar of buttons (this menu's row at the top,
## the Walks and My beacons buttons at the bottom), margins included.
const BAR := 60.0
## Pop-out panels (Fields, Walks, My beacons) sit a shade lighter than the
## world and the readout, so they read as a layer on top.
const POP_BG := Color(0.14, 0.175, 0.23, 0.97)
const POP_BORDER := Color("44566d")


func _init(p_kind: String) -> void:
	kind = p_kind
	name = "FieldMenu"
	layer = 5
	add_to_group("field_menu")
	add_to_group(PopupFx.GROUP)


func _ready() -> void:
	var row := HBoxContainer.new()
	row.anchor_left = 1.0
	row.anchor_right = 1.0
	row.offset_left = -420
	row.offset_right = -12
	row.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	row.offset_top = 12
	row.alignment = BoxContainer.ALIGNMENT_END
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE # only its buttons take taps, not the empty space beside them
	row.add_theme_constant_override("separation", 8)
	add_child(row)
	_row = row
	ui_scale = PHONE_SCALE if BuildInfo.is_phone() else 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui-scale="):
			ui_scale = float(a.trim_prefix("--ui-scale="))
	_play = _button("▶ Play", func(): Transport.toggle())
	row.add_child(_play)
	_fields_btn = _button("☰ Fields", func(): set_open(not PopupFx.is_open(panel)), true)
	row.add_child(_fields_btn)
	_build_panel()
	PopupFx.glass(panel)
	set_open(false, false)


func _process(_delta: float) -> void:
	_fit()
	_play.text = "■ Stop" if Transport.running else "▶ Play"
	if PopupFx.is_open(panel):
		_show_quality()


## Scales the button row and the panel from their top-right corners; the
## panel shrinks if it wouldn't fit on the screen at full scale.
## The scale for the screen-corner buttons (Play, Fields, My beacons, Wander,
## Walks): a little under the panels' scale on phones, so they leave the view room.
static func button_scale(ui: float) -> float:
	return ui * (0.8 if ui > 1.5 else 1.0)


func _fit() -> void:
	var view := get_viewport().get_visible_rect().size
	# The top buttons a little smaller than the panels on phones, leaving the readout room beside them.
	var s := minf(button_scale(ui_scale), (view.x - 24.0) / maxf(1.0, _row.size.x))
	_row.pivot_offset = Vector2(_row.size.x, 0)
	_row.scale = Vector2(s, s)
	# Full size, between this row and the buttons along the bottom edge; what
	# doesn't fit scrolls.
	var room := view.y - 12.0 - _row.size.y * s - 8.0 - BAR * s
	var ps := minf(s, (view.x - 24.0) / maxf(1.0, panel.size.x))
	fit_scroll(_scroll, room / ps - 30.0)
	panel.reset_size()
	panel.offset_top = 12.0 + _row.size.y * s + 8.0
	PopupFx.apply(panel, ps, Vector2(panel.size.x, 0)) # pops open from its top-right corner, under the button


## Where the top-right button row starts on screen (x): panels on the left stop short of it.
func row_left() -> float:
	if _row == null:
		return INF
	var left := INF
	for c in _row.get_children():
		if c is Control and c.visible:
			left = minf(left, (c as Control).get_global_transform_with_canvas().origin.x)
	return left


## Another window is opening: this one closes.
func close_popup(except: Object) -> void:
	if except != self and PopupFx.is_open(panel):
		set_open(false)


func set_open(open: bool, sound := true) -> void:
	if open:
		PopupFx.claim(self)
	PopupFx.animate(panel, open, sound)
	_fields_btn.set_pressed_no_signal(open)
	# While the panel is open, Android's back gesture closes it instead of the app.
	get_tree().quit_on_go_back = not open


func _notification(what: int) -> void:
	if what == NOTIFICATION_WM_GO_BACK_REQUEST and panel and PopupFx.is_open(panel):
		set_open(false)


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	match event.keycode:
		KEY_M:
			Transport.metronome_on = not Transport.metronome_on
		KEY_F:
			set_open(not PopupFx.is_open(panel))
		KEY_I:
			open_scene("res://scenes/instrument_table.tscn")
		KEY_ESCAPE:
			if PopupFx.is_open(panel):
				set_open(false)


## Shows the follow switch as on or off without announcing it (the scene turned it off).
func set_follow(on: bool) -> void:
	if _follow:
		_follow.set_pressed_no_signal(on)


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
	sb.bg_color = POP_BG
	sb.border_color = POP_BORDER
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", sb)
	add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	_scroll = scroller(v)
	panel.add_child(_scroll)

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

	# The metronome click and the orchestral samples live in the song panel;
	# auto-walk (wander) in the Wander pop-up, by the travel speed.

	var head := _heading("MY LOCATION" if kind == "globe" else "LOCAL GRID")
	v.add_child(head)
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
	_follow = follow
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
	# The grid size is the local grid's, so it shows only there; following your
	# location works on the globe too. The test grid has none of these.
	if kind != "local":
		sizes.visible = false
		if kind != "globe":
			head.visible = false
			loc.visible = false
	status = _small("")
	status.visible = false
	v.add_child(status)

	# Follow a flight (globe only): the plane drives the listener.
	if kind == "globe":
		v.add_child(_heading("FOLLOW A FLIGHT"))
		var fr := HBoxContainer.new()
		fr.add_theme_constant_override("separation", 6)
		_flight_q = LineEdit.new()
		_flight_q.placeholder_text = "Flight DL934 or tail N733YX"
		_flight_q.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_flight_q.add_theme_font_size_override("font_size", 15)
		_flight_q.text_submitted.connect(func(_t): follow_flight(_flight_q.text))
		fr.add_child(_flight_q)
		_flight_btn = _button("✈ Follow", func(): follow_flight(_flight_q.text) if _flight_btn.text.begins_with("✈") else stop_flight())
		fr.add_child(_flight_btn)
		var rnd := _button("🎲 Random", follow_random_flight)
		rnd.tooltip_text = "Ride along with a random flight in the air somewhere in the world"
		fr.add_child(rnd)
		v.add_child(fr)
		_flight_msg = _small("Type the flight number from your ticket or the plane's tail number, or pick a random flight. Your position follows the plane; tap the plane for its details.")
		v.add_child(_flight_msg)

	# Sound quality (AudioQuality): Auto fits the device, High plays the full
	# samples at full quality, Light saves battery. Only where a beacon player runs.
	v.add_child(_heading("SOUND QUALITY"))
	var modes := HBoxContainer.new()
	modes.add_theme_constant_override("separation", 6)
	v.add_child(modes)
	for m in AudioQuality.MODES:
		var mode: String = m
		var b := _button(AudioQuality.MODE_NAMES[mode], func(): _pick_quality(mode), true)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_sound_btns[mode] = b
		modes.add_child(b)
	_sound_now = _small("")
	v.add_child(_sound_now)

	v.add_child(_heading("OPEN"))
	var links := HBoxContainer.new()
	links.add_theme_constant_override("separation", 6)
	v.add_child(links)
	# Instruments and Synths are in the song panel's top row.
	for l in [["Manual ↗", func(): OS.shell_open(MANUAL_URL)]]:
		var b := _button(l[0], l[1])
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		links.add_child(b)
	var build := _small("Build %s · %s · UI ×%s" % [BuildInfo.BUILD, OS.get_name(), _num(ui_scale)])
	build.add_theme_font_size_override("font_size", 11)
	v.add_child(build)


## Wraps a panel's content so it scrolls when the screen is too short for it
## (a drag scrolls; a tap still presses buttons). fit_scroll() sizes it.
static func scroller(content: Control) -> ScrollContainer:
	var sc := ScrollContainer.new()
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	sc.scroll_deadzone = 10
	sc.add_child(content)
	return sc


## A scroller's height: all of its content when that fits in `avail`
## (unscaled pixels), else `avail`, with room for the scroll bar.
static func fit_scroll(sc: ScrollContainer, avail: float) -> void:
	var content: Control = sc.get_child(0)
	var want := content.get_combined_minimum_size()
	var h := minf(want.y, maxf(120.0, avail))
	var w := want.x + (14.0 if h < want.y else 0.0)
	if not sc.custom_minimum_size.is_equal_approx(Vector2(w, h)):
		sc.custom_minimum_size = Vector2(w, h)


func _listener() -> ListenerInput:
	return get_tree().get_first_node_in_group("listener_input") as ListenerInput


func _mine() -> MyBeacons:
	return get_tree().get_first_node_in_group("my_beacons") as MyBeacons


## Starts following a flight; the panel closes so you can watch the globe fly to it.
func follow_flight(q: String) -> void:
	var m := _mine()
	if m == null or q.strip_edges() == "":
		return
	if _flight_q:
		_flight_q.text = q
		_flight_q.release_focus()
	_flight_say("Looking for %s…" % q.strip_edges().to_upper())
	var why: String = await m.start_flight(q)
	if why != "":
		_flight_say(why, true)
		return
	if _flight_btn:
		_flight_btn.text = "■ Stop"
	_flight_say("✈ Following %s. Data: adsb.lol (ODbL)." % FlightFollow.describe(m.flight.fix))
	set_open(false)


## Follows a random flight in the air (anywhere in the world, where it's daytime first).
func follow_random_flight() -> void:
	var m := _mine()
	if m == null:
		return
	_flight_say("Finding a flight in the air…")
	var why: String = await m.start_random_flight()
	if why != "":
		_flight_say(why, true)
		return
	if _flight_btn:
		_flight_btn.text = "■ Stop"
	if _flight_q:
		_flight_q.text = String(m.flight.fix.get("flight", m.flight.fix.get("reg", "")))
	_flight_say("✈ Following %s. Tap the plane for its details." % FlightFollow.describe(m.flight.fix))
	set_open(false)


func stop_flight() -> void:
	var m := _mine()
	var was: String = m.stop_flight() if m else ""
	if _flight_btn:
		_flight_btn.text = "✈ Follow"
	_flight_say("Stopped following %s." % was if was != "" else "")


func _flight_say(text: String, err := false) -> void:
	if _flight_msg:
		_flight_msg.text = text
		_flight_msg.add_theme_color_override("font_color", Color("ff6b6b") if err else Color("8d9aab"))


func _player() -> BeaconPlayer:
	return get_tree().get_first_node_in_group("beacon_player") as BeaconPlayer


func _pick_quality(mode: String) -> void:
	var p := _player()
	if p:
		p.set_quality_mode(mode)
	else:
		AudioQuality.save_mode(mode)


## The sound section: which setting is lit, and what it's playing at right now.
func _show_quality() -> void:
	var p := _player()
	var mode := p.quality.mode if p and p.quality else AudioQuality.saved_mode()
	for m in _sound_btns:
		_sound_btns[m].set_pressed_no_signal(m == mode)
	if p and p.quality:
		var q := p.quality
		_sound_now.text = "Playing at %s with the %s samples · audio load %d%% · this device: %s" % [q.level_name(), q.tier, roundi(q.load * 100.0), q.device_text()]
	else:
		_sound_now.text = "Applies when music plays."


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
