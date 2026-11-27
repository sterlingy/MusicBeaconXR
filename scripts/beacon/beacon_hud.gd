class_name BeaconHud
extends CanvasLayer
## On-screen readout for a BeaconPlayer: key and chord, tempo, the three
## active beacons with their weights, and each part's level with mute (M) and
## solo (S) buttons, to hear what one part is doing.

const ACCENT := Color("ffb547")
const MUTE_COLOR := Color("e0565b")
## The expand button scales the panel up to this (less if the screen is smaller).
## Phones show the panel larger; it shrinks to fit above the buttons along the bottom edge.
const PHONE_SCALE := 2.0
const ROLE_COLOR := {"drums": Color("ff8a3d"), "bass": Color("2ec4b6"), "keys": Color("f5c04a"), "lead": Color("ff4f9a"), "pluck": Color("9ccc65"), "texture": Color("8b6cf0"), "pad": Color("7ad7ff")}

var player: BeaconPlayer
var help_text := ""
var title_text := "MUSIC BEACON XR"

var _now: Label
var _sub: Label
var _rows := []
var _parts := {}
var _names := {} # role -> its label
var _buttons := {} # role -> [mute, solo]
var _help: Label
var _quality: Label
var _quality_btn: Button
var _flash := 0.0
var _panel: PanelContainer
var _collapse: Button
## Collapsed: only the key, chord and tempo show (phones start this way, out of the map's way).
var collapsed := false
var _body: Array[Control] = []


func _init(p_player: BeaconPlayer) -> void:
	player = p_player
	add_to_group(PopupFx.GROUP) # opening another window folds the readout (and unfolding it closes them)


## Another window is opening: fold away.
func close_popup(except: Object) -> void:
	if except != self and not collapsed:
		set_collapsed(true)


func _ready() -> void:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.08, 0.1, 0.13, 0.96)
	sb.border_color = Color(0.25, 0.3, 0.38)
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", sb)
	_panel = panel
	# Clicks and taps on the panel stay on it (containers pass them on to the
	# world by default, which walked the listener).
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.position = Vector2(16, 16)
	panel.custom_minimum_size = Vector2(300, 0)
	add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	panel.add_child(v)
	var head := HBoxContainer.new()
	var title := _label(title_text, 13, ACCENT)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	_collapse = _collapse_button()
	head.add_child(_collapse)
	v.add_child(head)
	_now = _label("", 22, Color.WHITE)
	v.add_child(_now)
	_sub = _label("", 13, Color(1, 1, 1, 0.6))
	v.add_child(_sub)
	# Two columns under the key line, so the open panel is short: the beacons
	# you hear and the sound on the left, the parts on the right.
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 14)
	v.add_child(cols)
	var left := VBoxContainer.new()
	left.add_theme_constant_override("separation", 8)
	left.custom_minimum_size.x = 300
	cols.add_child(left)
	cols.add_child(VSeparator.new())
	var right := VBoxContainer.new()
	right.add_theme_constant_override("separation", 3)
	right.custom_minimum_size.x = 330
	cols.add_child(right)
	for i in 3:
		var row := VBoxContainer.new()
		var l := _label("", 14, Color.WHITE)
		row.add_child(l)
		var bar := ProgressBar.new()
		bar.max_value = 1.0
		bar.show_percentage = false
		bar.custom_minimum_size.y = 6
		row.add_child(bar)
		left.add_child(row)
		_rows.append({"label": l, "bar": bar})
	for role in BeaconPlayer.PARTS:
		var h := HBoxContainer.new()
		# Fixed width (room for "Pluck · strings pizz") so every part's bar starts in line.
		var l := _label(role.capitalize(), 13, Color.WHITE)
		l.custom_minimum_size.x = 132
		l.clip_text = true
		l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
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
		right.add_child(h)
		_parts[role] = bar
		_names[role] = l
	# Sound quality: what this device plays at, and a button to choose Auto, High or Light.
	var qrow := HBoxContainer.new()
	_quality = _label("", 12, Color(1, 1, 1, 0.6))
	_quality.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_quality.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	qrow.add_child(_quality)
	_quality_btn = Button.new()
	_quality_btn.focus_mode = Control.FOCUS_NONE
	_quality_btn.add_theme_font_size_override("font_size", 12)
	_quality_btn.tooltip_text = "Sound quality: Auto fits this device, High plays everything, Light saves battery"
	_quality_btn.pressed.connect(func():
		var modes: Array = AudioQuality.MODES
		player.set_quality_mode(modes[(modes.find(player.quality.mode) + 1) % modes.size()]))
	qrow.add_child(_quality_btn)
	var gap := Control.new()
	gap.size_flags_vertical = Control.SIZE_EXPAND_FILL # the sound line sits at the column's foot
	left.add_child(gap)
	left.add_child(qrow)
	_help = _label("", 12, Color(1, 1, 1, 0.5))
	_help.autowrap_mode = TextServer.AUTOWRAP_WORD
	_help.custom_minimum_size.x = 600
	v.add_child(_help)
	player.harmony_changed.connect(func(_i): _flash = 1.0)
	# Everything below the key line folds away.
	var past_sub := false
	for c in v.get_children():
		if past_sub:
			_body.append(c)
		if c == _sub:
			past_sub = true
	set_collapsed(BuildInfo.is_phone(), false)


func set_collapsed(on: bool, sound := true) -> void:
	if sound and on != collapsed and is_inside_tree():
		PopupFx.swoosh(get_tree(), not on)
	if not on and sound and is_inside_tree():
		PopupFx.claim(self) # one window at a time
	collapsed = on
	for c in _body:
		c.visible = not on
	_collapse.tooltip_text = "Show the parts" if on else "Fold the panel away"
	_collapse.queue_redraw()
	_panel.reset_size()


## A finger-sized button with a chevron: down to unfold the panel, up to fold it.
func _collapse_button() -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(40, 32)
	for state in ["normal", "hover", "pressed"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.13, 0.16, 0.2) if state != "pressed" else Color(0.2, 0.24, 0.3)
		sb.border_color = ACCENT if state == "hover" else Color(0.25, 0.3, 0.38)
		sb.set_border_width_all(1)
		sb.set_corner_radius_all(6)
		b.add_theme_stylebox_override(state, sb)
	b.draw.connect(func():
		var c := b.size / 2.0
		var w := 8.0
		var h := 4.5 * (1.0 if collapsed else -1.0) # down when folded, up when open
		b.draw_polyline(PackedVector2Array([c + Vector2(-w, -h), c + Vector2(0, h), c + Vector2(w, -h)]), Color(1, 1, 1, 0.9), 2.2, true))
	b.pressed.connect(func(): set_collapsed(not collapsed))
	return b


## A small square toggle (touch friendly) that lights up in its colour when on.
func _toggle(text: String, on_color: Color, on_toggle: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(30, 24)
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
	_panel.reset_size() # shrink back after folding or a shorter line (no empty space at the foot)
	var phone := BuildInfo.is_phone()
	var want := PHONE_SCALE if phone else 1.0
	var k := want
	if _panel.size.y > 0.0:
		var view := get_viewport().get_visible_rect().size
		# Phones keep the bottom-left My beacons button clear.
		var bottom := FieldMenu.BAR * FieldMenu.PHONE_SCALE if phone else 0.0
		var room := view - Vector2(32, 32 + bottom)
		# Never under the top-right buttons (they'd take the taps meant for this panel).
		var menu := get_tree().get_first_node_in_group("field_menu")
		var right: float = menu.row_left() - 16.0 if menu else view.x
		var wide := right - 16.0 - 12.0
		# One scale for folded and open (the title stays the same size); only
		# if the open panel can't fit at all does it shrink.
		k = minf(want, minf(wide / _panel.size.x, room.y / _panel.size.y))
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
			# Meters on the test grid and local grid, kilometers on the globe.
			var meters: float = a.d * 1000.0 if player.field.kind == "globe" else a.d
			var dist := "%d m" % roundi(meters) if meters < 1000.0 else ("%.1f km" % (meters / 1000.0) if meters < 10000.0 else "%d km" % roundi(meters / 1000.0))
			r.label.text = "%s  %s  %d%%  · %s%s" % [a.beacon.label, a.song.title, roundi(a.w * 100), dist, "  · key" if a.id == h.id else ""]
			r.bar.value = a.w
		else:
			r.label.text = ""
			r.bar.value = 0
	for role in _parts:
		# The part's live level (it pulses with the music), not just its share of the blend.
		_parts[role].value = float(player.meters.get(role, 0.0)) if Transport.running else (float(player.mix[role].gain) if not player.mix.is_empty() else 0.0)
		# Parts you can't hear (muted, or another part soloed) fade back.
		var a := 1.0 if player.audible(role) else 0.3
		_parts[role].modulate.a = a
		_names[role].modulate.a = a
		var sample := player.sample_playing(role)
		_names[role].text = role.capitalize() if sample == "" else "%s · %s" % [role.capitalize(), sample.replace("_", " ")]
		_buttons[role][0].set_pressed_no_signal(player.muted.has(role))
		_buttons[role][1].set_pressed_no_signal(player.soloed.has(role))
	if player.quality:
		_quality.text = "Sound: " + player.quality.describe()
		_quality_btn.text = AudioQuality.MODE_NAMES[player.quality.mode]
	# Keyboard hints mean nothing on a phone, and the room is better spent on the parts.
	_help.visible = not BuildInfo.is_phone() and not collapsed
	_help.text = ("Space stop" if Transport.running else "Space PLAY") + "  ·  " + help_text
