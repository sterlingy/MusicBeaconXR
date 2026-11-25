class_name BeaconHud
extends CanvasLayer
## On-screen readout for a BeaconPlayer: key and chord, tempo, the three
## active beacons with their weights, and each part's level with mute (M) and
## solo (S) buttons, to hear what one part is doing.

const ACCENT := Color("ffb547")
const MUTE_COLOR := Color("e0565b")
## The expand button scales the panel up to this (less if the screen is smaller).
const LARGE_SCALE := 1.6
const PREFS := "user://beacon_hud.cfg"
const ROLE_COLOR := {"drums": Color("ff8a3d"), "bass": Color("2ec4b6"), "keys": Color("f5c04a"), "lead": Color("ff4f9a"), "pluck": Color("9ccc65"), "texture": Color("8b6cf0"), "pad": Color("7ad7ff")}

var player: BeaconPlayer
var help_text := ""
var title_text := "BEACON FIELD"

var _now: Label
var _sub: Label
var _rows := []
var _parts := {}
var _names := {} # role -> its label
var _buttons := {} # role -> [mute, solo]
var _help: Label
var _flash := 0.0
var _panel: PanelContainer
var _expand: Button
var large := false


func _init(p_player: BeaconPlayer) -> void:
	player = p_player


func _ready() -> void:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.08, 0.1, 0.13, 0.88)
	sb.border_color = Color(0.25, 0.3, 0.38)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", sb)
	_panel = panel
	panel.position = Vector2(16, 16)
	panel.custom_minimum_size = Vector2(360, 0)
	add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	panel.add_child(v)
	var head := HBoxContainer.new()
	var title := _label(title_text, 13, ACCENT)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	_expand = _expand_button()
	head.add_child(_expand)
	v.add_child(head)
	_now = _label("", 22, Color.WHITE)
	v.add_child(_now)
	_sub = _label("", 13, Color(1, 1, 1, 0.6))
	v.add_child(_sub)
	v.add_child(HSeparator.new())
	for i in 3:
		var row := VBoxContainer.new()
		var l := _label("", 14, Color.WHITE)
		row.add_child(l)
		var bar := ProgressBar.new()
		bar.max_value = 1.0
		bar.show_percentage = false
		bar.custom_minimum_size.y = 6
		row.add_child(bar)
		v.add_child(row)
		_rows.append({"label": l, "bar": bar})
	v.add_child(HSeparator.new())
	for role in BeaconPlayer.PARTS:
		var h := HBoxContainer.new()
		var l := _label(role.capitalize(), 13, Color.WHITE)
		l.custom_minimum_size.x = 70
		h.add_child(l)
		var bar := ProgressBar.new()
		bar.max_value = 1.0
		bar.show_percentage = false
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.custom_minimum_size.y = 10
		var fill := StyleBoxFlat.new()
		fill.bg_color = ROLE_COLOR[role]
		fill.set_corner_radius_all(3)
		bar.add_theme_stylebox_override("fill", fill)
		h.add_child(bar)
		var m := _toggle("M", MUTE_COLOR, func(on): player.set_muted(role, on))
		var so := _toggle("S", ACCENT, func(on): player.set_soloed(role, on))
		h.add_child(m)
		h.add_child(so)
		_buttons[role] = [m, so]
		h.add_theme_constant_override("separation", 6)
		v.add_child(h)
		_parts[role] = bar
		_names[role] = l
	_help = _label("", 12, Color(1, 1, 1, 0.5))
	_help.autowrap_mode = TextServer.AUTOWRAP_WORD
	_help.custom_minimum_size.x = 330
	v.add_child(_help)
	player.harmony_changed.connect(func(_i): _flash = 1.0)
	var cfg := ConfigFile.new()
	if cfg.load(PREFS) == OK:
		large = bool(cfg.get_value("panel", "large", false))


## Toggles the panel between its normal size and a larger one that is easier
## to read and tap. Remembered between runs.
func set_large(on: bool) -> void:
	large = on
	var cfg := ConfigFile.new()
	cfg.set_value("panel", "large", on)
	cfg.save(PREFS)


## A square button with corner arrows drawn on it: outward to expand, inward
## to go back to normal size.
func _expand_button() -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(28, 24)
	b.tooltip_text = "Larger panel"
	for state in ["normal", "hover", "pressed"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.13, 0.16, 0.2) if state != "pressed" else Color(0.2, 0.24, 0.3)
		sb.border_color = ACCENT if state == "hover" else Color(0.25, 0.3, 0.38)
		sb.set_border_width_all(1)
		sb.set_corner_radius_all(5)
		b.add_theme_stylebox_override(state, sb)
	b.draw.connect(func():
		var c := b.size / 2.0
		var r := 6.0
		var t := 3.5
		var col := Color(1, 1, 1, 0.85)
		for sx in [-1.0, 1.0]:
			for sy in [-1.0, 1.0]:
				var corner := c + Vector2(sx, sy) * r
				# Expand: corner brackets point outward. Shrink: they point inward.
				var d := Vector2(-sx, -sy) * t if not large else Vector2(sx, sy) * t
				var tip := corner if not large else corner - Vector2(sx, sy) * t
				b.draw_line(tip, tip + Vector2(d.x, 0), col, 1.6, true)
				b.draw_line(tip, tip + Vector2(0, d.y), col, 1.6, true))
	b.pressed.connect(func():
		set_large(not large)
		b.tooltip_text = "Normal size" if large else "Larger panel"
		b.queue_redraw())
	return b


## A small square toggle (touch friendly) that lights up in its colour when on.
func _toggle(text: String, on_color: Color, on_toggle: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(30, 26)
	b.add_theme_font_size_override("font_size", 12)
	b.tooltip_text = "Mute" if text == "M" else "Solo"
	for state in ["normal", "hover", "pressed", "hover_pressed"]:
		var sb := StyleBoxFlat.new()
		var on: bool = state.contains("pressed")
		sb.bg_color = on_color if on else Color(0.13, 0.16, 0.2)
		sb.border_color = on_color if on or state == "hover" else Color(0.25, 0.3, 0.38)
		sb.set_border_width_all(1)
		sb.set_corner_radius_all(5)
		b.add_theme_stylebox_override(state, sb)
	b.add_theme_color_override("font_pressed_color", Color(0.05, 0.06, 0.08))
	b.add_theme_color_override("font_hover_pressed_color", Color(0.05, 0.06, 0.08))
	b.toggled.connect(on_toggle)
	return b


func _fit_scale() -> void:
	var k := 1.0
	if large and _panel.size.y > 0.0:
		var room := get_viewport().get_visible_rect().size - Vector2(32, 32)
		k = maxf(1.0, minf(LARGE_SCALE, minf(room.x / _panel.size.x, room.y / _panel.size.y)))
	if not is_equal_approx(_panel.scale.x, k):
		_panel.scale = Vector2(k, k)


func _label(t: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = t
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _process(delta: float) -> void:
	_fit_scale()
	var h := player.harmony
	if h.song.is_empty():
		return
	var bar := maxi(0, floori(Transport.current_beat() / 4.0)) if Transport.running else 0
	_now.text = "%s %s  ·  %s" % [BeaconMixer.NOTE_NAMES[int(h.song.key.root)], String(h.song.key.mode), BeaconMixer.chord_name(h.song.key, h.chord_degree(bar))]
	_sub.text = "%d BPM  ·  bar %s  ·  key from %s" % [roundi(Transport.bpm), Transport.position_text() if Transport.running else "–", h.song.title]
	_flash = maxf(0.0, _flash - delta)
	_now.add_theme_color_override("font_color", Color.WHITE.lerp(ACCENT, _flash))
	for i in 3:
		var r: Dictionary = _rows[i]
		if i < player.active.size():
			var a: Dictionary = player.active[i]
			var dist := "%d m" % roundi(a.d) if player.field.kind == "grid" else "%d km" % roundi(a.d)
			r.label.text = "%s  %s  %d%%  · %s%s" % [a.beacon.label, a.song.title, roundi(a.w * 100), dist, "  · key" if a.id == h.id else ""]
			r.bar.value = a.w
		else:
			r.label.text = ""
			r.bar.value = 0
	for role in _parts:
		_parts[role].value = float(player.mix[role].gain) if not player.mix.is_empty() else 0.0
		# Parts you can't hear (muted, or another part soloed) fade back.
		var a := 1.0 if player.audible(role) else 0.3
		_parts[role].modulate.a = a
		_names[role].modulate.a = a
		_buttons[role][0].set_pressed_no_signal(player.muted.has(role))
		_buttons[role][1].set_pressed_no_signal(player.soloed.has(role))
	_help.text = ("Space stop" if Transport.running else "Space PLAY") + "  ·  " + help_text
