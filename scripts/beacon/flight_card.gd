class_name FlightCard
extends CanvasLayer
## The flight you're riding along with, as a card: tap the plane on the globe.
## Airline and flight number, the route as big airport codes joined by a
## progress track with the plane on it, time to go / landing / time in the
## air, a grid of live numbers (altitude, speed, heading, Mach, outside air,
## squawk), the aircraft, and a Stop button. Live numbers refresh while it's
## open. Words come from FlightFollow.summary().

signal stop_requested()

const ACCENT := Color("ffb547")
const MUTED := Color("93a0b2")
const REFRESH_S := 4.0

var flight: FlightFollow
var ui_scale := 1.0
var _blocker: Control
var _card: PanelContainer
var _details := {}
var _t := 0.0
var _progress := -1.0
# Filled in by _show():
var _airline: Label
var _code: Label
var _sub: Label
var _o_code: Label
var _o_city: Label
var _d_code: Label
var _d_city: Label
var _track: Control
var _route_note: Label
var _route_row: HBoxContainer
var _times := {} # key -> [value Label, caption Label, tile]
var _stats := {} # key -> [value Label, sub Label, tile]
var _plane: Label
var _owner: Label


func _init(p_flight: FlightFollow) -> void:
	flight = p_flight
	name = "FlightCard"
	layer = 8
	add_to_group(PopupFx.GROUP)


func _ready() -> void:
	ui_scale = FieldMenu.PHONE_SCALE if BuildInfo.is_phone() else 1.0
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--ui-scale="):
			ui_scale = float(a.trim_prefix("--ui-scale="))
	_blocker = Control.new()
	_blocker.set_anchors_preset(Control.PRESET_FULL_RECT)
	_blocker.mouse_filter = Control.MOUSE_FILTER_STOP
	_blocker.gui_input.connect(func(e: InputEvent):
		if (e is InputEventMouseButton or e is InputEventScreenTouch) and e.pressed:
			close())
	add_child(_blocker)
	_card = PanelContainer.new()
	_card.mouse_filter = Control.MOUSE_FILTER_STOP
	var sb := StyleBoxFlat.new()
	sb.bg_color = FieldMenu.POP_BG
	sb.border_color = ACCENT
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(16)
	sb.set_content_margin_all(16)
	sb.shadow_color = Color(0, 0, 0, 0.5)
	sb.shadow_size = 14
	_card.add_theme_stylebox_override("panel", sb)
	add_child(_card)
	PopupFx.glass(_card)
	_build()
	_card.visible = false
	_blocker.visible = false


func _label(size: int, color := Color.WHITE, bold := false) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if bold:
		l.add_theme_constant_override("outline_size", 1)
		l.add_theme_color_override("font_outline_color", color)
	return l


func _tile(parent: Container, caption: String) -> Array:
	var box := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.08, 0.1, 0.14, 0.7)
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 7
	sb.content_margin_bottom = 7
	box.add_theme_stylebox_override("panel", sb)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 1)
	box.add_child(v)
	var cap := _label(11, MUTED)
	cap.text = caption.to_upper()
	v.add_child(cap)
	var val := _label(17, Color.WHITE, true)
	v.add_child(val)
	var sub := _label(11, MUTED)
	v.add_child(sub)
	parent.add_child(box)
	return [val, sub, box]


func _build() -> void:
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(430, 0)
	v.add_theme_constant_override("separation", 10)
	_card.add_child(v)
	# Header: airline, close.
	var head := HBoxContainer.new()
	_airline = _label(12, ACCENT, true)
	_airline.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_airline)
	var x := Button.new()
	x.text = "✕"
	x.flat = true
	x.focus_mode = Control.FOCUS_NONE
	x.custom_minimum_size = Vector2(36, 30)
	x.add_theme_font_size_override("font_size", 16)
	x.pressed.connect(close)
	head.add_child(x)
	v.add_child(head)
	var title := HBoxContainer.new()
	title.add_theme_constant_override("separation", 10)
	_code = _label(28, Color.WHITE, true)
	title.add_child(_code)
	_sub = _label(13, MUTED)
	_sub.size_flags_vertical = Control.SIZE_SHRINK_END
	title.add_child(_sub)
	v.add_child(title)
	# Route: PER ✈──── SYD, cities under the codes.
	_route_row = HBoxContainer.new()
	_route_row.add_theme_constant_override("separation", 12)
	var o := VBoxContainer.new()
	_o_code = _label(30, Color.WHITE, true)
	_o_city = _label(12, MUTED)
	o.add_child(_o_code)
	o.add_child(_o_city)
	_route_row.add_child(o)
	_track = Control.new()
	_track.custom_minimum_size = Vector2(150, 44)
	_track.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_track.draw.connect(_draw_track)
	_route_row.add_child(_track)
	var d := VBoxContainer.new()
	_d_code = _label(30, Color.WHITE, true)
	_d_code.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_d_city = _label(12, MUTED)
	_d_city.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	d.add_child(_d_code)
	d.add_child(_d_city)
	_route_row.add_child(d)
	v.add_child(_route_row)
	_route_note = _label(12, MUTED)
	v.add_child(_route_note)
	# Times.
	var times := HBoxContainer.new()
	times.add_theme_constant_override("separation", 8)
	for t in [["to_go", "To go"], ["lands", "Lands (your time)"], ["airborne", "In the air"]]:
		_times[t[0]] = _tile(times, t[1])
	v.add_child(times)
	# Live numbers.
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	for t in [["alt", "Altitude"], ["speed", "Speed"], ["heading", "Heading"], ["mach", "Mach"], ["oat", "Outside"], ["squawk", "Squawk"]]:
		_stats[t[0]] = _tile(grid, t[1])
	v.add_child(grid)
	# The aircraft.
	var ac := VBoxContainer.new()
	ac.add_theme_constant_override("separation", 0)
	_plane = _label(15, Color.WHITE, true)
	_owner = _label(12, MUTED)
	_owner.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	ac.add_child(_plane)
	ac.add_child(_owner)
	v.add_child(ac)
	# Footer.
	var foot := HBoxContainer.new()
	var credit := _label(10, MUTED)
	credit.text = "Live: adsb.lol (ODbL) · route and aircraft: adsbdb.com\nTimes are estimates from distance and speed"
	credit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	foot.add_child(credit)
	var menu := FieldMenu.new("globe")
	var stop := menu._button("■ Stop following", func():
		close()
		stop_requested.emit())
	menu.free()
	foot.add_child(stop)
	v.add_child(foot)


func _draw_track() -> void:
	var w := _track.size.x
	var y := _track.size.y * 0.5
	var p := clampf(_progress, 0.0, 1.0)
	var c := Color(1, 1, 1, 0.28)
	# Dashed line for the whole route, solid for the part flown.
	var x := 6.0
	while x < w - 6.0:
		_track.draw_line(Vector2(x, y), Vector2(minf(x + 6.0, w - 6.0), y), c, 2.0, true)
		x += 11.0
	_track.draw_circle(Vector2(6, y), 4.0, ACCENT)
	_track.draw_circle(Vector2(w - 6.0, y), 4.0, Color(1, 1, 1, 0.6))
	if _progress < 0.0:
		return
	var px := 6.0 + (w - 12.0) * p
	_track.draw_line(Vector2(6, y), Vector2(px, y), ACCENT, 3.0, true)
	# The plane, nose to the right.
	var s := 9.0
	var body := PackedVector2Array([Vector2(px + s * 1.3, y), Vector2(px - s, y - s * 0.28), Vector2(px - s, y + s * 0.28)])
	_track.draw_colored_polygon(body, Color.WHITE)
	_track.draw_colored_polygon(PackedVector2Array([Vector2(px + s * 0.2, y), Vector2(px - s * 0.5, y - s * 1.1), Vector2(px - s * 0.25, y)]), Color.WHITE)
	_track.draw_colored_polygon(PackedVector2Array([Vector2(px + s * 0.2, y), Vector2(px - s * 0.5, y + s * 1.1), Vector2(px - s * 0.25, y)]), Color.WHITE)


func is_open() -> bool:
	return PopupFx.is_open(_card)


func close_popup(except: Object) -> void:
	if except != self and is_open():
		close()


## Opens the card for the flight being followed (details load in the background).
func open() -> void:
	if not flight.active():
		return
	PopupFx.claim(self)
	_blocker.visible = true
	PopupFx.animate(_card, true)
	_details = {}
	_show()
	var f := flight.fix.duplicate()
	_details = await flight.details(f)
	if is_open():
		_show()


func close() -> void:
	if is_open():
		PopupFx.animate(_card, false)
	_blocker.visible = false


func _show() -> void:
	if not flight.active():
		close()
		return
	var tz := float(Time.get_time_zone_from_system().get("bias", 0)) * 60.0
	var s := FlightFollow.summary(flight.fix, _details, FlightFollow.now_s(), tz)
	var f := flight.fix
	_airline.text = String(s.get("airline", "")).to_upper() if String(s.get("airline", "")) != "" else "IN THE AIR"
	_code.text = String(s.get("code", f.get("flight", "")))
	var sub := PackedStringArray()
	if String(s.get("callsign", "")) != "" and s.get("callsign") != s.get("code"):
		sub.append(String(s.callsign))
	if String(f.get("type", "")) != "":
		sub.append(String(f.type))
	_sub.text = " · ".join(sub)
	var has_route := s.has("o_code")
	_route_row.visible = has_route
	_o_code.text = String(s.get("o_code", ""))
	_o_city.text = String(s.get("o_city", ""))
	_d_code.text = String(s.get("d_code", ""))
	_d_city.text = String(s.get("d_city", ""))
	_progress = float(s.get("progress", -1.0))
	_track.queue_redraw()
	if not has_route:
		_route_note.text = "Loading the route…" if _details.is_empty() else "Route not known for this flight"
	elif not s.get("plausible", true):
		_route_note.text = "Route unconfirmed: the plane isn't on the scheduled route (a reused flight number?)"
	else:
		_route_note.text = "%s flown · %s to go" % [s.get("flown", ""), s.get("left", "")] if s.has("flown") else ""
	_route_note.visible = _route_note.text != ""
	for k in _times:
		var t: Array = _times[k]
		t[0].text = String(s.get(k, "–"))
		t[2].visible = s.has(k)
	_set_stat("alt", s.get("alt", ""), s.get("alt_m", ""))
	_set_stat("speed", s.get("speed", ""), s.get("speed_alt", ""))
	_set_stat("heading", s.get("heading", ""), "")
	_set_stat("mach", s.get("mach", ""), "")
	_set_stat("oat", s.get("oat", ""), "")
	_set_stat("squawk", s.get("squawk", ""), "")
	_plane.text = String(s.get("aircraft", ""))
	_owner.text = String(s.get("owner", ""))
	_card.reset_size()


func _set_stat(k: String, value: Variant, sub: Variant) -> void:
	var t: Array = _stats[k]
	t[0].text = String(value) if String(value) != "" else "–"
	t[1].text = String(sub)
	t[1].visible = String(sub) != ""


func _process(delta: float) -> void:
	if not _card.visible:
		return # (still visible while it animates closed)
	_t += delta
	if _t >= REFRESH_S and is_open():
		_t = 0.0
		_show()
	var view := get_viewport().get_visible_rect().size
	var s := minf(ui_scale, minf((view.x - 24.0) / maxf(1.0, _card.size.x), (view.y - 24.0) / maxf(1.0, _card.size.y)))
	PopupFx.apply(_card, s, _card.size * 0.5) # pops open from its middle
	_card.position = (view - _card.size * s) * 0.5


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE and is_open():
		close()
		get_viewport().set_input_as_handled()
